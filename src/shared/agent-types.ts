/**
 * Agent 共享类型（主进程 + Preload + 渲染进程三端共享）
 *
 * 包含 v0.9 引入的：
 * - Provider 抽象层类型（ProviderConfig / PersistedProviderConfig / ProviderType / ThinkingStrength）
 * - Token 统计类型（TokenUsageRecord / TokenStats）
 * - Supervisor chat 结果类型（ChatResult）
 * - IPC 推送载荷类型（AgentChunkPayload / AgentDonePayload / AgentErrorPayload）
 *
 * v0.9.4 新增：
 * - IPC_PROTOCOL_VERSION 常量 + getProtocolVersion 同步获取
 * - SessionId branded type + generateSessionId 工厂函数
 * - SessionEntry / SystemPingResponse 接口
 * - AgentChunkPayload / AgentDonePayload / AgentErrorPayload 增加可选 sessionId
 * - ClaudeSdkChatParams 增加可选 sessionId
 *
 * 设计原则：
 * - 不依赖 main 进程的任何模块（确保 preload/renderer 可安全导入）
 * - 不依赖 'ai' SDK 的运行时类型（LanguageModel 仅在 main 进程使用，定义在 main/types.ts）
 * - 类型为主，少量纯函数 / 常量（DEFAULT_PROVIDER_ID / IPC_PROTOCOL_VERSION / generateSessionId）
 *   均为无副作用、不依赖运行时环境，可被 preload/renderer 安全导入
 *
 * 方案书依据：v0.9 §3（Provider 抽象）+ §5（Token 监控）+ §11.2（IPC 命名规范）
 *           + v0.9.4 §2 IPC 协议优化（sessionId / abort signal / protocolVersion / ping-pong）
 */

/**
 * Provider 类型枚举（区分不同厂商的创建逻辑）
 *
 * - openai-compatible：通用 OpenAI 兼容协议（自定义 baseURL，覆盖 DeepSeek/Qwen/Ollama/Ark 等大多数国产模型）
 * - anthropic：Claude 直连（@ai-sdk/anthropic createAnthropic）
 * - google：Google Gemini 直连（@ai-sdk/google createGoogleGenerativeAI）
 * - volcengine-ark：火山方舟（OpenAI 兼容，但单独标识以便统计与默认 baseURL）
 * - ollama：本地 Ollama（OpenAI 兼容，默认 http://localhost:11434/v1）
 * - deepseek：DeepSeek（OpenAI 兼容，默认 https://api.deepseek.com；@ai-sdk/openai 会自动追加 /v1）
 * - qwen：通义千问 / DashScope（OpenAI 兼容，默认 https://dashscope.aliyuncs.com/compatible-mode/v1）
 * - claude-sdk：Claude Agent SDK（@anthropic-ai/claude-agent-sdk query() 异步生成器，agent loop 模式）
 *
 * v0.9 新增 'claude-sdk'：
 * - 与 'anthropic' 区分：'anthropic' 走 @ai-sdk/anthropic 的 LanguageModelV2 单次调用契约；
 *   'claude-sdk' 走 Claude Agent SDK 的 query() agent loop（多轮工具调用 + 反思）。
 * - 不通过 provider-factory.createLanguageModel 创建，而是由 IPC handler 直接实例化 ClaudeSdkProvider。
 * - 调用方通过 `claude-sdk:generate` / `claude-sdk:stream` IPC 通道使用。
 */
export type ProviderType =
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'volcengine-ark'
  | 'ollama'
  | 'deepseek'
  | 'qwen'
  | 'claude-sdk'

/**
 * 思考强度三档（方案书 §6）
 *
 * - fast：单次 LLM 调用，无 Subagent（简单问答、查文档）
 * - standard：Supervisor + 1-2 Subagent + 1 轮 Reflect（运维决策、命令生成）
 * - deep：Supervisor + 8 Subagent 并行 + 多轮 Reflect + Self-Consistency（复杂故障排查、方案设计）
 */
export type ThinkingStrength = 'fast' | 'standard' | 'deep'

/**
 * 模型角色（v0.9.4 批次 2 - 任务 3，借鉴 ContinueDev ModelRole）
 *
 * 不同任务用不同模型：主对话用 chat，代码补全用 autocomplete 等。
 * 通过 ProviderConfig.roles 声明该 Provider 适配的角色，
 * 主进程根据 role 查找对应 Provider（见 provider-registry.getProviderByRole）。
 *
 * 8 类角色（覆盖典型 AI 编码助手场景）：
 * - chat：主对话（用户聊天，最常用）
 * - edit：代码编辑（生成 diff，需要精确代码能力）
 * - autocomplete：自动补全（IDE 内联，需要快速响应）
 * - embedding：向量嵌入（代码库索引，需要嵌入模型）
 * - rerank：重排序（检索结果精排，需要 reranker 模型）
 * - preview：预览模型（廉价快速预览，如简单分类）
 * - apply：应用模型（执行代码块，需要工具调用能力）
 * - summarize：摘要模型（长上下文压缩，需要长上下文窗口）
 */
export type ModelRole =
  | 'chat'         // 主对话
  | 'edit'         // 代码编辑
  | 'autocomplete' // 自动补全
  | 'embedding'    // 向量嵌入
  | 'rerank'       // 重排序
  | 'preview'      // 预览
  | 'apply'        // 应用
  | 'summarize'    // 摘要

/**
 * 模型角色 → Provider ID 映射（v0.9.4 批次 2 - 任务 3）
 *
 * 主进程根据 role 查找对应 Provider，未配置时 fallback 到默认 Provider。
 * 用户可在设置中为每个角色指定首选 Provider ID。
 */
export type ModelRoleMapping = Partial<Record<ModelRole, string>>

/**
 * Provider 能力声明（v0.9.4 批次 2 - 任务 4，借鉴 ContinueDev BaseLLM.capabilities）
 *
 * 用于 UI 显示能力图标 + 调用方按能力选择 Provider。
 * 例如：autocomplete 需要流式（streaming），edit 需要工具调用（toolCall）。
 *
 * 未在 ProviderConfig 中显式声明时，由 `provider-capabilities.ts` 的
 * `PROVIDER_CAPABILITIES` 默认表按 type 推断。
 */
export interface ProviderCapabilities {
  /** 是否支持流式输出（streaming） */
  streaming: boolean
  /** 是否支持工具调用（function calling） */
  toolCall: boolean
  /** 是否支持视觉（图像输入，多模态） */
  vision: boolean
  /** 上下文窗口大小（token 数，0 表示未知） */
  contextWindow: number
  /**
   * 是否支持 token logprobs（v0.9.7 P3 M1 新增）
   * - true：provider 暴露 per-token logprobs，可计算**真实** token-distribution Shannon 熵
   * - false：provider 不暴露 logprobs，可信度模块走 thinking-block / text-fallback 兑底
   *
   * 论文依据：Zhao 2026, arXiv:2603.18940 — token entropy 比 text-Shannon entropy 更预测 LLM 推理可靠性
   *
   * 主流支持情况（2024-2025）：
   * - openai / openai-compatible：支持（`logprobs=true, top_logprobs=N`）
   * - deepseek：支持
   * - qwen：支持（火山方舟 / 阿里百炼 OpenAI 兼容端点）
   * - volcengine-ark：支持
   * - ollama：支持（`logprobs: true`）
   * - anthropic：不支持（Anthropic 协议无 logprobs 字段）
   * - google：不支持（Gemini 协议无 token-level logprobs）
   * - claude-sdk：不支持（Agent SDK 不暴露 per-step logprobs）
   */
  logprobs: boolean
}

/**
 * 模型成本定价（v0.9.4 批次 2 - 任务 5）
 *
 * 每百万 token 的美元价格（USD / 1M tokens）。
 * 借鉴 ContinueDev SessionUsage + Aider 成本累计展示，
 * 实现 Hard Constraint：Token 消耗必须透明（每次执行后展示 token + 成本）。
 *
 * 未在 ProviderConfig 中显式声明时，由 `provider-pricing.ts` 的
 * `PROVIDER_PRICING` 默认表按 type 推断。
 */
export interface ModelPricing {
  /** 输入 token 成本（USD / 1M tokens） */
  inputCostPer1M: number
  /** 输出 token 成本（USD / 1M tokens） */
  outputCostPer1M: number
  /** 货币单位（默认 USD） */
  currency?: 'USD' | 'CNY'
}

/**
 * Provider 配置（统一接口）
 *
 * 注意：
 * - apiKey 字段仅在内存中传递，持久化时由 SecureStore 加密存储
 * - 持久化版本（PersistedProviderConfig）应排除 apiKey
 *
 * v0.9.4 批次 2 新增字段（均为可选，向后兼容）：
 * - selectedModels：备用模型链（主模型失败时按序尝试，借鉴 ContinueDev selectedModels）
 * - roles：该 Provider 适配的模型角色（用于角色映射查找）
 * - capabilities：Provider 能力声明（未设置时由 capabilityRegistry 推断）
 * - pricing：模型定价（用于成本透明化，未设置时由 PROVIDER_PRICING 推断）
 */
export interface ProviderConfig {
  /** Provider 唯一标识（如 'deepseek-v4'） */
  id: string
  /** 显示名称（如 'DeepSeek V4 Pro'） */
  name: string
  /** Provider 类型（决定创建逻辑） */
  type: ProviderType
  /** API Base URL（如 'https://api.deepseek.com'，@ai-sdk/openai 会自动追加 /v1） */
  baseURL: string
  /** API Key（运行时由 SecureStore 回填，不进持久化） */
  apiKey?: string
  /** 默认模型名（如 'deepseek-chat'） */
  model: string
  /** 默认参数（temperature/maxTokens 等，可选覆盖） */
  defaultParams?: {
    temperature?: number
    maxTokens?: number
    topP?: number
  }
  /** 是否为预置模板（true 表示系统内置，不可删除） */
  builtin?: boolean
  /** 是否启用（false 表示用户禁用，不出现在选择器中） */
  enabled?: boolean
  /**
   * 备用模型链（v0.9.4 批次 2 - 任务 2，借鉴 ContinueDev selectedModels）
   *
   * 主模型（config.model）调用失败时按序尝试，提供容错能力。
   * 例如：主用 deepseek-chat，失败降级到 deepseek-coder，再降级到 qwen-max。
   *
   * 注意：fallback 链目前只在 main 进程内部使用（createLanguageModelWithFallback），
   * 不暴露 IPC 通道；UI 集成留给 v0.9.4 后续批次或 v0.9.5。
   */
  selectedModels?: string[]
  /**
   * 该 Provider 适配的模型角色（v0.9.4 批次 2 - 任务 3）
   *
   * 用于角色映射查找：主进程通过 getProviderByRole(role) 查找 roles 数组
   * 包含该角色的第一个 enabled Provider。未设置时该 Provider 不参与角色查找。
   */
  roles?: ModelRole[]
  /**
   * Provider 能力声明（v0.9.4 批次 2 - 任务 4）
   *
   * 未设置时由 `provider-capabilities.ts` 的 PROVIDER_CAPABILITIES 按 type 推断。
   * 用户可显式覆盖（如自部署 Ollama 调整 contextWindow）。
   */
  capabilities?: ProviderCapabilities
  /**
   * 模型定价（v0.9.4 批次 2 - 任务 5）
   *
   * 用于成本透明化，未设置时由 `provider-pricing.ts` 的 PROVIDER_PRICING 按 type 推断。
   * 用户可显式覆盖（如代理服务有折扣）。
   */
  pricing?: ModelPricing
}

/**
 * 持久化版本的 Provider 配置（不含 apiKey，存入 electron-store）
 *
 * apiKey 单独走 SecureStore.saveApiKey(`provider:${id}`, key)
 */
export type PersistedProviderConfig = Omit<ProviderConfig, 'apiKey'>

/**
 * Token 使用记录（单次调用）
 *
 * v0.9.4 批次 2 - 任务 5：新增可选 cost 字段（成本透明化）
 * - 由主进程根据 ProviderConfig.pricing 计算
 * - 计算逻辑见 `provider-pricing.ts` 的 `calculateCost` 函数
 * - 公式：`cost = (inputTokens * inputCostPer1M + outputTokens * outputCostPer1M) / 1_000_000`
 */
export interface TokenUsageRecord {
  /** 关联的 Provider ID */
  providerId: string
  /** 模型名 */
  model: string
  /** 输入 token 数 */
  inputTokens: number
  /** 输出 token 数 */
  outputTokens: number
  /** 总 token 数（input + output） */
  totalTokens: number
  /** 触发的 Subagent 名（如 'supervisor'、'coding-subagent'，未启用时为 'direct'） */
  subagent: string
  /** 思考强度 */
  strength: ThinkingStrength
  /** 时间戳（ms） */
  timestamp: number
  /**
   * 本次调用成本（v0.9.4 批次 2 - 任务 5，可选）
   *
   * 单位：USD（默认），由主进程根据 ProviderConfig.pricing 计算。
   * 未设置时表示未计算成本（旧记录或 pricing 缺失）。
   */
  cost?: number
}

/**
 * Token 统计聚合（按时间维度 + Subagent 维度）
 *
 * 方案书 §5.1：当日/当周/当月 + Subagent 分布
 */
export interface TokenStats {
  /** 当日累计 token */
  today: number
  /** 当周累计 token */
  week: number
  /** 当月累计 token */
  month: number
  /** 总累计 token */
  total: number
  /** 按 Subagent 分布（subagent name → token count） */
  bySubagent: Record<string, number>
  /** 按 Provider 分布（provider id → token count） */
  byProvider: Record<string, number>
}

/**
 * 默认 Provider ID（用于首次启动时回退）
 */
export const DEFAULT_PROVIDER_ID = 'deepseek-v4'

/**
 * Compaction 触发层级
 */
export type CompactionLevel = 'none' | 'L1' | 'L2' | 'L3' | 'L4'

/**
 * Supervisor chat 调用结果
 *
 * 由主进程 SupervisorAgent.chat() 返回，通过 IPC 推送到渲染进程。
 *
 * v0.9.6 P2 M5+ 扩展：
 * - 新增 `cotEntropyTrajectory` 字段（可选），把推理过程的熵轨迹附加到结果
 * - 渲染层 / 上游调用方可选择把 trajectory 透传到 credibility:assess
 *   走 ai-param 证据的 CoT-shape 融合（详见 mass-functions/cot-trace-signal.ts）
 */
export interface ChatResult {
  /** 完整文本输出 */
  text: string
  /** token 使用统计 */
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  /** 完成原因（stop / length / content-filter / tool-calls / error / cancelled） */
  finishReason: string
  /** 触发的 Provider ID */
  providerId: string
  /** 实际使用的模型名 */
  model: string
  /** 思考强度 */
  strength: ThinkingStrength
  /** 耗时（ms） */
  durationMs: number
  /** compaction 触发层级 */
  compactionLevel: CompactionLevel
  /**
   * CoT 熵轨迹（v0.9.6 P2 M5+ 新增，可选）
   *
   * 每步 Shannon 熵 ∈ [0, 1]，由 `CotTraceCollector` 在流式过程中累积。
   *
   * 数据来源优先级（详见 `mass-functions/cot-trace-collector.ts`）：
   * 1. 显式 thinking block（Anthropic Claude with thinking）
   * 2. 多 turn 累积（reasoning model 每个 turn 一个 trace point）
   * 3. 文本启发式 fallback（按句子切分 + text-feature entropy）
   *
   * 论文依据：Zhao 2026, arXiv:2603.18940
   * - 熵轨迹**形状单调性**比标量总熵更具预测力（OR=2.50）
   * - 单调链 68.8% 准确率 vs 非单调链 46.8%
   *
   * 透传方式：渲染层拿到 ChatResult 后，可把 trajectory 写入
   * `buildCredibilityInputs` 的 DecisionContext.cotEntropyTrajectory，
   * 由 `credibility:assess` 走 `createAiParamMassFunction` 时的 CoT-shape 融合消费。
   *
   * 不传 / 数组为空时：ai-param 走 v0.9.6 P1 行为（不应用 CoT-shape 融合）。
   */
  cotEntropyTrajectory?: number[]
}

/**
 * agent:chunk 推送载荷（流式 token 块）
 *
 * v0.9.4 新增 sessionId（可选，向后兼容）：
 * - 主进程在流式事件中携带 sessionId，渲染进程可通过 sessionId 关联请求与响应
 * - 旧的 correlationId 字段保留，向后兼容
 */
export interface AgentChunkPayload {
  /** 关联 ID（与启动时返回的 correlationId 一致） */
  correlationId: string
  /** 本 chunk 的文本增量 */
  delta: string
  /** 会话 ID（v0.9.4 新增，可选；主进程在 agent:chat / claude-sdk:stream 启动时回传） */
  sessionId?: string
}

/**
 * agent:done 推送载荷（完成信号）
 *
 * v0.9.4 新增 sessionId（可选，向后兼容）
 */
export interface AgentDonePayload {
  /** 关联 ID */
  correlationId: string
  /** 完整结果 */
  result: ChatResult
  /** 会话 ID（v0.9.4 新增，可选） */
  sessionId?: string
}

/**
 * agent:error 推送载荷（错误信号）
 *
 * v0.9.4 新增 sessionId（可选，向后兼容）
 */
export interface AgentErrorPayload {
  /** 关联 ID */
  correlationId: string
  /** 错误信息（不含 stack trace） */
  message: string
  /** 错误码 */
  code: 'AUTH' | 'RATE_LIMIT' | 'TIMEOUT' | 'NETWORK' | 'SERVER' | 'UNKNOWN' | 'CANCELLED'
  /** 会话 ID（v0.9.4 新增，可选） */
  sessionId?: string
}

// ============================================================================
// v0.9 Claude Agent SDK 集成类型
//
// 方案书依据：v0.9 §3 决策 5（Claude 集成方式 B：@anthropic-ai/claude-agent-sdk）
// 设计文档：d:\ai\linux教学一体\idea-to-dev-output\26-方案书-v0.9修订版-质量优先实施.md
//
// 设计原则：
// - ClaudeSdkProvider 不实现 LanguageModelV2 契约（agent loop 不能降级为单次 doGenerate）
// - 通过专属 IPC 通道 claude-sdk:generate / claude-sdk:stream 调用
// - 类型放在 shared 层，确保 main / preload / renderer 三端共用
// ============================================================================

/**
 * Claude SDK 流式 chat 调用参数（与 SupervisorAgent.chat 风格对齐）
 *
 * 与 ModelMessage[] 不同：
 * - SupervisorAgent.chat 接收 messages 数组（多轮对话历史）
 * - ClaudeSdkProvider 接收单个 prompt 字符串（SDK 内部维护对话历史）
 *
 * 与 IPC 通道的关系：
 * - claude-sdk:generate — 同步聚合调用，返回 ChatResult
 * - claude-sdk:stream   — 异步流式调用，返回 correlationId
 *                        通过 onClaudeSdkChunk / onClaudeSdkDone / onClaudeSdkError 监听后续事件
 * - claude-sdk:cancel   — 取消进行中的请求
 */
export interface ClaudeSdkChatParams {
  /** 用户提示文本（会先经 redactSecrets 脱敏，HC-2） */
  prompt: string
  /** 思考强度（影响 maxTurns + thinking 配置） */
  strength?: ThinkingStrength
  /** 系统提示（可选，覆盖默认 Linux 运维助手 prompt） */
  systemPrompt?: string
  /** 当前工作目录（默认 process.cwd()，Linux 运维场景一般不需要） */
  cwd?: string
  /** 是否启用流式增量消息（默认 true，stream() 时启用） */
  includePartialMessages?: boolean
  /** 关联 ID（用于日志追踪 + 取消请求，可选，未传自动生成） */
  correlationId?: string
  /**
   * 会话 ID（v0.9.4 新增，可选）
   *
   * 用于关联请求与响应、支持 abort signal。
   * 未提供时主进程自动生成并通过响应回传。
   */
  sessionId?: string
}

// ============================================================================
// v0.9 可信度算法类型（D-S 证据理论 + PCR5 冲突融合）
//
// 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
// 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md
//
// 设计原则：
// - 所有类型均为纯数据（可序列化，支持 IPC structured clone）
// - MassFunction 的 focalElements 使用数组形式（而非 Map），便于 IPC 传输
// - 不依赖 main 进程的任何模块（确保 preload/renderer 可安全导入）
// ============================================================================

/**
 * 可信度证据来源 ID（6 源证据）
 *
 * - log：日志证据（Drain3 模板匹配，先验 0.6）
 * - kb：知识库匹配（向量检索相似度，先验 0.5）
 * - ai-param：AI 参数证据（Verbalized Confidence + Logprobs，先验 0.7）
 * - human：人工证据（用户标注 / 反馈，先验 0.9）
 * - history：历史证据（历史决策案例，先验 0.75）
 * - best-practice：最佳实践证据（规则库匹配，先验 0.8）
 */
export type CredibilitySourceId =
  | 'log'
  | 'kb'
  | 'ai-param'
  | 'human'
  | 'history'
  | 'best-practice'

/**
 * 可信度评估请求 - 单个证据源输入
 *
 * 渲染进程通过 IPC 传入证据源列表，每个证据源包含 sourceId 和对应的 fields。
 * fields 的具体字段取决于 sourceId（见各 mass function 的 Input 接口）。
 *
 * 字段约定：
 * - log: { drainMatch: number, sourcePrior?: number }
 * - kb: { hasResults: boolean, topScore?: number, avgScore?: number }
 * - ai-param: { verbalizedConfidence: number, logprobConfidence?: number, consistency?: number, cotEntropyTrajectory?: number[] }
 *   （v0.9.6 P2 M4：cotEntropyTrajectory 为可选，每步 Shannon 熵，详见 CotEntropyTrajectory；
 *    v0.9.6 P2 M5+ 修正：Electron IPC 的 structured clone 实际支持数组传输，
 *    因此 cotEntropyTrajectory 可以走 CredibilityEvidenceInput 通道，
 *    无需再"在主进程侧直接调用 createAiParamMassFunction"）
 * - human: { hasAnnotations: boolean, positiveRate?: number, agreement?: number }
 * - history: { hasCases: boolean, weightedSuccessRate?: number }
 * - best-practice: { hasMatches: boolean, positiveRate?: number, negativeRate?: number }
 */
export interface CredibilityEvidenceInput {
  /** 证据来源 ID */
  sourceId: CredibilitySourceId
  /**
   * 证据特定字段（键值对）
   *
   * 值类型支持：
   * - number：标量证据（drainMatch / topScore / confidence 等）
   * - boolean：开关型证据（hasResults / hasAnnotations 等）
   * - number[]：序列证据（v0.9.6 P2 M5+ 新增，如 cotEntropyTrajectory）
   *
   * IPC structured clone 兼容性：
   * - 纯 JS 对象 + number/boolean/number[] 全部支持
   * - 避免传递 Date / Map / Set / 函数 / Symbol（不可序列化）
   */
  fields: Record<string, number | boolean | number[]>
}

/**
 * 可序列化的 Mass 函数（用于 IPC 传输）
 *
 * 与 main/core/agent/credibility/ds-theory.ts 中的 MassFunction 接口兼容，
 * 但 focalElements 使用数组形式而非 Map（便于 IPC structured clone）。
 */
export interface SerializableMassFunction {
  /** 证据源 ID */
  sourceId: string
  /** 证据源显示名称 */
  sourceName: string
  /** 焦元质量分布（数组形式，按质量降序） */
  focalElements: Array<{ elements: string; mass: number }>
  /** 原始置信度 [0, 1] */
  confidence: number
}

/**
 * 融合步骤数据（用于 IPC 传输和 DAG 可视化）
 */
export interface FusionStepData {
  /** 步骤序号（从 1 开始） */
  step: number
  /** 使用的组合规则 */
  ruleUsed: 'dempster' | 'pcr5'
  /** 左操作数来源 ID */
  leftSourceId: string
  /** 右操作数来源 ID */
  rightSourceId: string
  /** 冲突系数 k ∈ [0, 1] */
  conflict: number
  /** 组合结果的 Bel({T}) */
  resultBelief: number
  /** 组合结果的 Pl({T}) */
  resultPlausibility: number
}

/**
 * 可信度评估结果（用于 IPC 传输）
 *
 * 包含信任区间 [Bel, Pl]、综合可信度、冲突程度、来源追溯和融合步骤。
 */
export interface ConfidenceAssessment {
  /** 信任度下界 Bel({T}) ∈ [0, 1] */
  belief: number
  /** 似真度上界 Pl({T}) ∈ [0, 1] */
  plausibility: number
  /** 综合可信度 = (Bel + Pl) / 2 ∈ [0, 1]（中点策略） */
  confidence: number
  /** 不确定性区间宽度 = Pl - Bel ∈ [0, 1] */
  uncertainty: number
  /** 冲突程度：融合过程中遇到的最大成对冲突 k ∈ [0, 1] */
  conflictLevel: number
  /** 最终使用的规则（dempster / pcr5 / mixed） */
  ruleUsed: 'dempster' | 'pcr5' | 'mixed'
  /** 参与融合的证据来源列表 */
  sources: Array<{
    sourceId: string
    sourceName: string
    confidence: number
  }>
  /** 融合步骤追踪（用于 DAG 可视化） */
  fusionSteps: FusionStepData[]
  /** 融合后的 Mass 函数（序列化形式，用于进一步分析或展示） */
  fusedMassFunction: SerializableMassFunction
}

/**
 * DAG 节点类型
 */
export type DagNodeType = 'source' | 'fusion' | 'result'

/**
 * DAG 节点数据（对应 React Flow Node）
 */
export interface DagNodeData {
  /** 节点唯一 ID */
  id: string
  /** 节点类型 */
  type: DagNodeType
  /** 节点显示标签 */
  label: string
  /** 节点附加数据（用于 React Flow 节点渲染） */
  data: {
    sourceId?: string
    confidence?: number
    ruleUsed?: 'dempster' | 'pcr5'
    conflict?: number
    belief?: number
    plausibility?: number
    finalConfidence?: number
    focalElements?: Array<{ elements: string; mass: number }>
  }
}

/**
 * DAG 边数据（对应 React Flow Edge）
 */
export interface DagEdgeData {
  /** 边唯一 ID */
  id: string
  /** 源节点 ID */
  source: string
  /** 目标节点 ID */
  target: string
  /** 边标签 */
  label: string
}

/**
 * DAG 完整数据（节点 + 边，用于 React Flow 渲染）
 */
export interface DagData {
  /** 节点列表 */
  nodes: DagNodeData[]
  /** 边列表 */
  edges: DagEdgeData[]
}

// ============================================================================
// v0.9.4 IPC 协议优化（批次 1：sessionId + abort signal + protocolVersion + ping/pong）
//
// 任务：v0.9.4 批次 1 - IPC 协议优化 4 项
//   2.1 sessionId（每个会话唯一 ID）
//   2.2 abort signal（中断信号）
//   2.3 protocolVersion（协议版本号）
//   2.4 ping/pong 心跳（连接保活）
//
// 设计原则：
// - 所有新增字段均为可选（向后兼容，现有调用方无需立即升级）
// - SSOT：跨端共享类型必须在本文件定义，main/preload/renderer 三端 import
// - SessionId 使用 branded type，避免与 correlationId / sandboxId 等字符串混淆
// ============================================================================

/**
 * IPC 协议版本号
 *
 * 主进程启动时输出日志（[ipc] protocol version: x.y.z），
 * preload 同步返回（从 @shared 导入常量，无需 IPC 调用），
 * 渲染进程可查询当前 IPC 协议版本（用于诊断版本不匹配问题）。
 *
 * 版本号约定：与发行版本号对齐（v0.9.4 → '0.9.4'）
 */
export const IPC_PROTOCOL_VERSION = '0.9.4'

/**
 * 会话 ID（每个 IPC 会话唯一标识）
 *
 * 用于关联请求与响应、支持 abort signal（中断长时运行 IPC 调用）。
 * 主进程自动生成（如未提供），渲染进程可通过响应中的 sessionId 关联。
 *
 * branded type 设计：避免与其他 string 类型混淆（如 correlationId / sandboxId / sessionId-ssh）。
 * 使用时通过 `as SessionId` 显式断言，或调用 generateSessionId() 工厂函数。
 */
export type SessionId = string & { readonly __brand: 'SessionId' }

/**
 * 会话类型（标识会话来源 IPC 通道）
 *
 * - agent:chat          — Supervisor 流式 chat
 * - claude-sdk:stream   — Claude SDK 流式调用
 * - claude-sdk:generate — Claude SDK 同步聚合调用
 * - sandbox:execute     — 沙箱命令执行
 */
export type SessionKind = 'agent:chat' | 'claude-sdk:stream' | 'claude-sdk:generate' | 'sandbox:execute'

/**
 * 会话注册表条目（可序列化视图，用于诊断 / 查询 / 日志）
 *
 * 注意：abortController 不可跨 IPC 序列化，因此本类型仅包含元数据。
 * 实际的 AbortController 由主进程 session-registry 内部维护。
 */
export interface SessionEntry {
  /** 会话 ID（唯一标识） */
  sessionId: SessionId
  /** 关联 ID（用于流式事件推送，与 agent:chunk/done/error 中的 correlationId 一致） */
  correlationId: string
  /** 会话类型（标识来源 IPC 通道） */
  kind: SessionKind
  /** Provider ID（agent:chat / claude-sdk:* 通道用） */
  providerId?: string
  /** 模型名 */
  model?: string
  /** 启动时间戳（ms） */
  startedAt: number
  /** 是否已取消 */
  cancelled: boolean
}

/**
 * system:ping 心跳响应载荷
 *
 * 用于渲染进程检测主进程是否响应，并验证协议版本是否匹配。
 *
 * 渲染进程可定期（如 30 秒）调用 systemPing() 检测主进程是否响应。
 * 若 protocolVersion 与预期不一致，可提示用户重启应用或检查构建产物。
 */
export interface SystemPingResponse {
  /** 主进程是否正常 */
  ok: boolean
  /** 主进程时间戳（ms，渲染进程可计算 IPC 往返延迟） */
  timestamp: number
  /** IPC 协议版本号（与 IPC_PROTOCOL_VERSION 常量一致） */
  protocolVersion: string
}

/**
 * 生成新的 SessionId（v0.9.4 新增）
 *
 * @param prefix 前缀（可选，默认 'sess'）
 * @returns 新的 SessionId（branded type）
 */
export function generateSessionId(prefix: string = 'sess'): SessionId {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` as SessionId
}

// ============================================================================
// v0.9.4 批次 3 - Mode 五模式 + Edit Format 多策略（任务 4 类型定义）
//
// 方案书依据：v0.9.4 §11 第 5 类（Mode 五模式）+ 第 3 类（Edit Format 多策略）
// 调研文档：
//   - d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md
//     （Kilo Code 多模式架构：Code/Plan/Debug/Ask/Review，mode 即 primary agent）
//   - d:\ai\linux教学一体\idea-to-dev-output\31-源码分析-Aider-终端优先与git沙箱回滚.md
//     （Aider edit_format：editblock/wholefile/udiff/patch + ask mode）
//
// 设计原则：
// - SSOT：所有跨端共享的类型集中在 src/shared/agent-types.ts
// - 不依赖 main 进程的任何模块（确保 preload/renderer 可安全导入）
// - 类型穷尽性：AgentMode 用字面量联合，便于 switch 穷尽性检查
// - 与 ThinkingStrength 正交：Mode 控制工具白名单 + 行为约束，
//   Strength 控制思考深度（fast/standard/deep）。两者可自由组合。
// ============================================================================

/**
 * Agent 工作模式（v0.9.4 批次 3 - 任务 4，借鉴 Kilo Code 多模式架构）
 *
 * 不同模式用不同的 system prompt + 工具集 + 行为约束。
 * 与 ThinkingStrength（fast/standard/deep）正交：
 * - Mode 控制"能做什么"（工具白名单 + 是否能写文件 / 执行命令）
 * - Strength 控制"想多深"（单次 LLM 调用 vs 多 Subagent + Reflect）
 *
 * 5 个模式（覆盖典型 Linux 运维 Agent 场景）：
 * - chat     — 普通对话（默认，纯问答无副作用）
 * - ask      — 询问模式（只读，不修改文件，类似 Aider ask mode）
 * - plan     — 计划模式（仅生成方案不执行，类似 Cline plan-and-act 的 plan 阶段）
 * - code     — 代码模式（读写文件 + 执行命令，全功能模式）
 * - debug    — 调试模式（分析问题 + 提出修复方案，但不直接应用）
 *
 * 借鉴 Kilo Code 的 mode 设计：mode 即 primary agent，每个 mode 有独立的
 * system prompt + 工具白名单 + 行为约束（canWriteFiles / canExecuteCommands）。
 * 与 Kilo Code 的差异：
 * - 我们不引入 Review 模式（用 /review AT 命令实现，避免 Mode 膨胀）
 * - 我们保留 chat 模式作为默认（Kilo Code 默认是 code 模式）
 */
export type AgentMode = 'chat' | 'ask' | 'plan' | 'code' | 'debug'

/**
 * 模式配置（每种模式的 system prompt + 工具白名单 + 行为约束）
 *
 * v0.9.4 批次 3 - 任务 4：Mode 五模式 main 层支持
 *
 * 由 mode-registry.ts 的 MODE_CONFIGS 提供默认值，主进程在调用 LLM 前
 * 根据当前 mode 应用对应配置：
 * - systemPrompt 拼接到 LLM 的 system message 前缀
 * - allowedTools 用于过滤工具调用（未在白名单中的工具被禁用）
 * - canWriteFiles / canExecuteCommands / canModifySandbox 用于运行时权限校验
 *
 * 设计要点：
 * - allowedTools 用字符串数组（工具名），'*' 表示允许全部
 * - canWriteFiles / canExecuteCommands / canModifySandbox 三个布尔字段
 *   是"硬约束"，与 allowedTools 互补：即使 allowedTools 包含 'file.write'，
 *   canWriteFiles=false 时仍禁止写文件
 * - description 用于 UI tooltip，便于用户理解每个模式的差异
 */
export interface ModeConfig {
  /** 模式 ID */
  mode: AgentMode
  /** 显示名称（如"普通对话"/"询问模式"） */
  displayName: string
  /** 系统提示模板（覆盖 Supervisor 默认 prompt） */
  systemPrompt: string
  /** 允许的工具白名单（未在白名单中的工具被禁用，'*' 表示允许全部） */
  allowedTools: string[]
  /** 是否允许写文件（硬约束，与 allowedTools 互补） */
  canWriteFiles: boolean
  /** 是否允许执行 shell 命令（硬约束） */
  canExecuteCommands: boolean
  /** 是否允许修改 sandbox 配置（如 SSH 主机、密钥等敏感操作） */
  canModifySandbox: boolean
  /** 简短描述（UI tooltip） */
  description: string
  /**
   * v0.9.5 P0 新增：Plan→Build 双模衔接（借鉴 xai-org/grok-build §4 Plan/Build 双模）
   *
   * 如果当前 mode 是 plan，用户确认方案后，UI 应提示是否切到 nextMode 模式执行。
   *
   * - undefined：不支持衔接（保持当前 mode）
   * - 'code'：plan 完成后可切到 code 模式执行
   * - 'debug'：plan 完成后可切到 debug 模式验证
   *
   * 实际模式切换由 setCurrentMode() IPC 处理，UI 显示"开始执行"按钮。
   */
  nextModeOnConfirm?: AgentMode
  /** 衔接按钮的 UI 文案（如"开始执行"/"开始调试"） */
  nextModeButtonLabel?: string
}

// ============================================================================
// v0.9.4 批次 4 - 注意力跟踪 + 预期回显（任务 4 类型定义）
//
// 方案书依据：v0.9.4 §11 第 7 类（其他 3 项）
// 调研文档：
//   - d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md
//     （Kilo Code attention 字段：标记当前关注的关键文件 / 命令 / 错误，跨 Subagent 传递上下文）
//
// 设计原则：
// - SSOT：跨端共享类型集中在 src/shared/agent-types.ts
// - 不依赖 main 进程的任何模块（确保 preload/renderer 可安全导入）
// - 字段全部可选（除 since），允许部分跟踪（如只跟踪 files 不跟踪 commands）
// ============================================================================

/**
 * 注意力字段（v0.9.4 批次 4 - 任务 4，借鉴 Kilo Code attention）
 *
 * 标记当前 Subagent 关注的关键文件 / 命令 / 错误，
 * 用于 UI 高亮显示 + 跨 Subagent 传递上下文。
 *
 * 使用场景：
 * - Subagent 执行时调用 AttentionTracker.trackFiles/trackCommands/trackErrors 更新
 * - UI 通过 IPC 查询当前 attention，高亮显示关注的文件 / 命令
 * - 新会话开始时调用 AttentionTracker.reset() 清空
 *
 * 字段全部可选（除 since），允许部分跟踪：
 * - 只跟踪 files（如 explore-subagent 探查文件）
 * - 只跟踪 commands（如 running-subagent 执行命令）
 * - 只跟踪 errors（如 debug 模式分析错误）
 * - 只跟踪 keywords（如 search-subagent 搜索关键词）
 */
export interface AttentionFocus {
  /** 关注的文件路径（绝对路径或相对项目根的路径） */
  files?: string[]
  /** 关注的命令（最近执行的 shell 命令） */
  commands?: string[]
  /** 关注的错误（最近发生的错误信息） */
  errors?: string[]
  /** 关注的搜索关键词 */
  keywords?: string[]
  /** 时间戳（ms，标记何时开始关注） */
  since: number
}

// ============================================================================
// v0.9.5 P0 级缺失 IPC 通道共享类型
//
// 任务：v0.9.5 渲染层 UI 集成 - 补齐 5 组 P0 级缺失 IPC 通道
//   组 1：token:cost-stats（成本透明）
//   组 2：mode:list / mode:set-default / mode:get-current（五模式切换）
//   组 3：attention:current / attention:history / attention:track-* / attention:reset（注意力跟踪）
//   组 4：subagent:list / subagent:reload（自定义 Agent 加载器）
//   组 5：provider:capabilities / provider:capabilities-all / provider:pricing / provider:pricing-all（Provider 能力 + 定价透明）
//
// 设计原则：
// - SSOT：所有跨端共享的类型集中在 src/shared/agent-types.ts
// - 不依赖 main 进程的任何模块（确保 preload/renderer 可安全导入）
// - 类型穷尽性：用字面量联合 + Record<T, V> 强制穷尽
// - IPC 4 步同步：main handler → ipc/index.ts → preload → electron.d.ts
// ============================================================================

/**
 * 成本统计聚合（v0.9.5 P0 - 组 1，从 main/core/agent/providers/token-stats.ts 迁移）
 *
 * 借鉴 Aider 成本累计展示：让 Token 监控面板可以展示累计成本（USD）。
 *
 * 字段说明：
 * - todayCost / weekCost / monthCost / totalCost：按时间窗口聚合
 * - bySubagent：按 Subagent 维度聚合（如 'supervisor' / 'coding-subagent'）
 * - byProvider：按 Provider 维度聚合（如 'deepseek-v4' / 'anthropic-claude'）
 *
 * 由 main 进程 getCostStats() 计算，通过 token:cost-stats IPC 通道暴露给渲染进程。
 */
export interface CostStats {
  /** 当日累计成本（USD） */
  todayCost: number
  /** 当周累计成本（USD） */
  weekCost: number
  /** 当月累计成本（USD） */
  monthCost: number
  /** 总累计成本（USD） */
  totalCost: number
  /** 按 Subagent 分布（subagent name → cost USD） */
  bySubagent: Record<string, number>
  /** 按 Provider 分布（provider id → cost USD） */
  byProvider: Record<string, number>
}

/**
 * 自定义 Agent 配置（v0.9.5 P0 - 组 4，从 main/core/agent/subagents/agent-loader.ts 迁移）
 *
 * 从项目根 .tdsf/agent/*.md 加载，YAML frontmatter 声明元数据，正文是 system prompt 模板。
 *
 * 字段来源：
 * - name / displayName / description / tools：YAML frontmatter
 * - systemPrompt：Markdown 正文（frontmatter 之后的内容）
 * - sourceFile：文件路径（用于热重载）
 */
export interface CustomAgentConfig {
  /** Agent 名称（唯一标识，如 'linux-expert'） */
  name: string
  /** 显示名称（如 'Linux 专家'） */
  displayName: string
  /** 简短描述（如 'Linux 运维专家，擅长故障排查'） */
  description: string
  /** 允许的工具白名单（如 ['search', 'log', 'metric']） */
  tools: string[]
  /** System prompt 模板（Markdown 正文） */
  systemPrompt: string
  /** 来源文件路径（用于热重载） */
  sourceFile: string
}

/**
 * Mode 简要信息（v0.9.5 P0 - 组 2，不含 systemPrompt 避免泄露）
 *
 * 用于 mode:list IPC 通道返回值，UI 模式选择器渲染用。
 *
 * 字段说明：
 * - name：模式 ID（'chat' | 'ask' | 'plan' | 'code' | 'debug'）
 * - displayName：显示名称（如 '普通对话' / '询问模式'）
 * - description：简短描述（UI tooltip）
 * - allowedTools：工具白名单（'*' 表示允许全部）
 */
export interface ModeInfo {
  /** 模式 ID */
  name: AgentMode
  /** 显示名称（如 '普通对话' / '询问模式'） */
  displayName: string
  /** 简短描述（UI tooltip） */
  description: string
  /** 允许的工具白名单（'*' 表示允许全部） */
  allowedTools: string[]
}

/**
 * mode:list IPC 通道返回类型
 */
export type ModeListResponse = ModeInfo[]

/**
 * mode:set-default IPC 通道请求参数
 */
export interface ModeSetDefaultRequest {
  /** 要设置为默认的 mode */
  mode: AgentMode
}

/**
 * mode:set-default IPC 通道返回值
 */
export interface ModeSetDefaultResponse {
  /** 是否设置成功 */
  success: boolean
  /** 设置前的 mode */
  previousMode: AgentMode
  /** 设置后的 mode（与 success=true 时等于 request.mode） */
  currentMode: AgentMode
}

/**
 * mode:get-current IPC 通道返回值
 */
export interface ModeCurrentResponse {
  /** 当前默认 mode */
  mode: AgentMode
  /** 显示名称（便于 UI 直接渲染） */
  displayName: string
}

/**
 * subagent:reload IPC 通道请求参数
 */
export interface SubagentReloadRequest {
  /** 指定文件路径（绝对路径），不指定则全部重载 */
  filePath?: string
}

/**
 * subagent:reload IPC 通道返回值
 */
export interface SubagentReloadResponse {
  /** 是否整体成功（即使部分失败也返回 true，只要重载流程完成） */
  success: boolean
  /** 重载成功的文件路径列表 */
  reloaded: string[]
  /** 重载失败的文件列表（含错误信息） */
  failed: Array<{ filePath: string; error: string }>
}

/**
 * v0.9.7 P3 M1 新增：终端智能补全建议项
 *
 * 主进程 src/main/services/terminal/terminal-completion-engine.ts 的同名接口
 * 在此重复声明（IPC 跨进程类型边界，主进程服务类型不能直接穿透 preload）。
 *
 * 字段：
 * - command     完整命令（用户补全后应追加的完整文本）
 * - completion  需要追加到当前输入后面的文本（去掉前缀后剩余部分）
 * - score       Frecency 分数（频次 + 时间衰减）
 * - source      建议来源：history（用户历史）/ static（静态兜底）
 */
export interface TerminalCompletionSuggestion {
  command: string
  completion: string
  score: number
  source: 'history' | 'static'
}

/**
 * provider:capabilities IPC 通道请求参数
 */
export interface ProviderCapabilitiesRequest {
  /** Provider ID */
  providerId: string
}

/**
 * provider:capabilities IPC 通道返回值
 *
 * 注意：返回 ProviderCapabilities 而非 ProviderConfig.capabilities，
 * 因为 main 进程的 getProviderCapabilities() 会按优先级回退到默认表。
 */
export type ProviderCapabilitiesResponse = ProviderCapabilities | null

/**
 * provider:capabilities-all IPC 通道返回值
 *
 * 返回所有 ProviderType 的默认能力声明（按 type 索引）。
 */
export type ProviderCapabilitiesAllResponse = Record<string, ProviderCapabilities>

/**
 * provider:pricing IPC 通道请求参数
 */
export interface ProviderPricingRequest {
  /** Provider ID */
  providerId: string
}

/**
 * provider:pricing IPC 通道返回值
 */
export type ProviderPricingResponse = ModelPricing | null

/**
 * provider:pricing-all IPC 通道返回值
 *
 * 返回所有 ProviderType 的默认定价表（按 type 索引）。
 */
export type ProviderPricingAllResponse = Record<string, ModelPricing>

// ============================================================================
// v0.9.4 批次 4 - 任务 5：预期回显监控共享类型
//
// 借鉴 Kilo Code 的"预期回显"机制：
//   执行命令前先记录"预期输出特征"，执行后对比实际输出，发现异常时告警。
//
// 这部分类型从 src/main/core/agent/expectation-monitor.ts 提取到 shared，
// 以便 preload/renderer 可以直接导入，避免主进程模块跨端引用。
//
// 方案书依据：v0.9.4 §11 第 7 类（其他 3 项 - 任务 5）
// ============================================================================

/**
 * 命令预期配置
 *
 * 由调用方（running-subagent / supervisor）在执行命令前构造，
 * 传入 checkExpectation 进行对比。
 */
export interface CommandExpectation {
  /** 命令文本 */
  command: string
  /**
   * 预期必须出现的关键词（任一匹配即视为符合预期）
   *
   * 空数组或 undefined 表示不检查 mustContain 规则。
   */
  mustContain?: string[]
  /**
   * 预期不能出现的关键词（任一匹配即视为违反预期）
   *
   * 例如：['Permission denied', 'command not found', 'No such file or directory']
   */
  mustNotContain?: string[]
  /**
   * 预期退出码（默认 0）
   *
   * 设为 null 表示不检查退出码。
   */
  expectedExitCode?: number | null
  /**
   * 超时阈值（ms，默认 30000）
   *
   * 注意：超时检查不由本模块执行（由调用方控制超时），
   * 此字段仅作为元数据记录，便于审计。
   */
  timeoutMs?: number
}

/**
 * 预期违反类型
 */
export type ExpectationViolationType =
  | 'missing-required' // 缺少必须出现的关键词
  | 'forbidden-found' // 出现了禁止的关键词
  | 'exit-code-mismatch' // 退出码不匹配
  | 'timeout' // 超时（由调用方标记）

/**
 * 预期违反详情
 *
 * checkExpectation 返回的违规列表元素。
 */
export interface ExpectationViolation {
  /** 违反类型 */
  type: ExpectationViolationType
  /** 实际退出码（exit-code-mismatch / timeout 时填充） */
  actualExitCode?: number
  /** 实际输出片段（截断 500 字符，避免长输出导致日志膨胀） */
  actualOutputSnippet: string
  /** 违反原因（人类可读） */
  reason: string
  /** 触发违反的关键词（missing-required / forbidden-found 时填充） */
  triggeredKeyword?: string
}

/**
 * 预期检查结果（IPC 传输载荷）
 *
 * 由主进程 expectation:check 通道返回，包含违规列表与是否通过。
 * 渲染层据此展示"预期 vs 实际"对比 UI。
 */
export interface ExpectationCheckResult {
  /** 是否符合预期（violations.length === 0） */
  met: boolean
  /** 违规列表（空数组表示符合预期） */
  violations: ExpectationViolation[]
  /** 原始预期配置（便于 UI 展示对比） */
  expectation: CommandExpectation
  /** 实际退出码 */
  actualExitCode: number
  /** 检查时间戳（ms） */
  timestamp: number
}
