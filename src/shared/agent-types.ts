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

import type { FusionSourceId } from './credibility'

/**
 * Provider 类型枚举（区分不同厂商的创建逻辑）
 *
 * - openai-compatible：通用 OpenAI 兼容协议（自定义 baseURL，覆盖 DeepSeek/Qwen/Ollama/Ark 等大多数国产模型）
 * - anthropic：Claude 直连（@ai-sdk/anthropic createAnthropic）
 * - google：Google Gemini 直连（@ai-sdk/google createGoogleGenerativeAI）
 * - volcengine-ark：火山方舟（OpenAI 兼容，但单独标识以便统计与默认 baseURL）
 * - ollama：本地 Ollama（OpenAI 兼容，默认 http://localhost:11434/v1）
 * - deepseek：DeepSeek（OpenAI 兼容，baseURL 必须自带版本段 https://api.deepseek.com/v1；
 *   @ai-sdk/openai 不补 /v1，缺了会打在 https://api.deepseek.com/chat/completions 上）
 * - qwen：通义千问 / DashScope（OpenAI 兼容，默认 https://dashscope.aliyuncs.com/compatible-mode/v1）
 *
 */
export type ProviderType =
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'volcengine-ark'
  | 'ollama'
  | 'deepseek'
  | 'qwen'

/**
 * 思考强度三档（方案书 §6）
 *
 * - fast：单次 LLM 调用，无 Subagent（简单问答、查文档）
 * - standard：Supervisor + 1-2 Subagent + 1 轮 Reflect（运维决策、命令生成）
 * - deep：Supervisor + 8 Subagent 并行 + 多轮 Reflect + Self-Consistency（复杂故障排查、方案设计）
 */
export type ThinkingStrength = 'fast' | 'standard' | 'deep'

/**
 * 用户侧可请求的思考强度（v2.10 新增 'auto'）
 *
 * - auto：按查询复杂度本地评分自动路由到 standard/deep（快慢思考结合）
 * 内部执行时 supervisor 会把 auto 解析为 ThinkingStrength 三档之一，
 * 因此 TokenUsageRecord / ChatResult 仍只记录解析后的三档，不含 auto。
 */
export type RequestedThinkingStrength = ThinkingStrength | 'auto'

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
  /** API Base URL（ai-sdk 风格，**须已含版本段**，如 'https://api.deepseek.com/v1'；
   *  @ai-sdk/openai 只在末尾接 /chat/completions，不会替我们补 /v1） */
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
 *
 * v2.3.9 修复：provider:list 返回时由主进程附加 hasApiKey 标识，
 * 前端用来区分"已配置 API Key"与"未配置 API Key"，避免用户测试连接
 * 成功（走旧 llmTest 通道）但 AI 对话（走 Provider 通道）因无 Key 而失败。
 */
export interface PersistedProviderConfig extends Omit<ProviderConfig, 'apiKey'> {
  /** 是否已配置 API Key（Ollama 本地无 Key 也视为 true；由 provider:list 运行时附加） */
  hasApiKey?: boolean
}

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
  /** 本次调用成本（v0.9.4 批次 2 - 任务 5，可选）
   *
   * 单位：USD（默认），由主进程根据 ProviderConfig.pricing 计算。
   * 未设置时表示未计算成本（旧记录或 pricing 缺失）。
   */
  cost?: number
  /**
   * 实际发出的请求次数（含重试），缺省视作 1
   *
   * 重试是要钱的：自研客户端最多 4 趟（1 + 3 次指数退避），
   * 只记最后一次的 token 就等于把面板数字写成真实账单的四分之一。
   */
  attempts?: number
  /**
   * 这组数字是估算的还是提供方给的
   *
   * 流式响应默认不回 usage，OpenAI 兼容端也常常省掉这个字段。
   * 估算必须标出来：宁可说"这是估的"，不要把估算当成账本上的真数。
   */
  estimated?: boolean
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
  /**
   * 输入/输出拆分（#132），与上面四个总数同一批记录、同一套窗口起点
   *
   * 以前这里只有合计数，界面要说"输入多少、输出多少"就只能猜一个比例
   * （旧版 TokenUsageChart 就是按 55/45 画出来的）。底层每条记录本来就存了
   * inputTokens / outputTokens，所以拆分不需要新数据，只是聚合时没往上传。
   *
   * 判据钉的是每个窗口 input + output + unknown 必须等于该窗口总数：
   * 两头不同源、或者有条记录被漏掉，都会当场对不上账。
   */
  split: {
    today: TokenDirection
    week: TokenDirection
    month: TokenDirection
    total: TokenDirection
  }
  /** 按 Subagent 分布（subagent name → token count） */
  bySubagent: Record<string, number>
  /** 按 Provider 分布（provider id → token count） */
  byProvider: Record<string, number>
}

/**
 * 一个时间窗里的 token 去向
 *
 * unknown 不是凑数：老记录是从 electron-store 恢复的，校验只要求
 * totalTokens 与 timestamp 存在（见 providers/token-stats.ts 的 loadPersisted），
 * 所以历史数据里可能压根没有方向字段。把它们算进 unknown 而不是悄悄丢掉，
 * 用户才能看出"这一段时间里的用量有 N 个 token 没记方向"。
 */
export interface TokenDirection {
  /** 提示词侧（口径与记录里的 inputTokens 一致） */
  input: number
  /** 模型生成侧 */
  output: number
  /** 这条记录没带方向字段，只能计入合计数 */
  unknown: number
  /**
   * 前三个数里"按字符估算"的那部分（#137）
   *
   * 它是**子集**，不参与 input + output + unknown = 合计 的守恒：
   * 提供方没回 usage 时我们照估算记账（见 services/llm/client.ts 的 estimated 标记），
   * 那些数与实测数混在一个合计里，用户有权知道"这个月有 N 个 token 其实是估的"。
   */
  estimated: number
}

/**
 * 空的 Token 统计（首屏在 IPC 返回之前显示的就是它）
 *
 * 界面侧有两处需要这个零对象（agent-store 的默认值、TokenUsageChart 的 EMPTY）。
 * 各写一份的后果不是重复四行，而是加字段时一定会漏一处——
 * 漏掉的那处带着 undefined.split 上界面，读到才崩。
 */
export function emptyTokenStats(): TokenStats {
  const d = (): TokenDirection => ({ input: 0, output: 0, unknown: 0, estimated: 0 })
  return {
    today: 0,
    week: 0,
    month: 0,
    total: 0,
    split: { today: d(), week: d(), month: d(), total: d() },
    bySubagent: {},
    byProvider: {},
  }
}

/**
 * 默认 Provider ID（用于首次启动时回退）
 */
export const DEFAULT_PROVIDER_ID = 'deepseek-v4'

/**
 * Compaction 触发层级
 *
 * L5 = 语义去重（context.ts 里真实存在的一层）。以前这张表只到 L4，
 * 于是 supervisor 只能把 L5 硬报成 L4 —— 把"去重"说成"摘要压缩"。
 */
export type CompactionLevel = 'none' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

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
   * compaction 到底动了什么（2026-10-15 全维度审查 D4）
   *
   * 只有 compactionLevel 是不够的：L2/L3/L5 会**整条丢掉**历史消息，
   * 而此前渲染层对这个等级零消费，于是"AI 忘了三分钟前说过的话"没有任何可看见的痕迹。
   * 这里给出去向数据，界面才能在回答旁边写一句"本轮上下文已压缩，剪掉 N 条"。
   */
  compactionDetail?: {
    /** 压缩前估算 tokens */
    beforeTokens: number
    /** 压缩后估算 tokens */
    afterTokens: number
    /** 被截断/丢弃的消息条数 */
    truncatedCount: number
    /**
     * 被折叠进摘要的条数。
     *
     * 与 truncatedCount 的区别是要不要对用户说"丢了"：滑动窗口把旧消息移出列表时，
     * 现在会把那一段压成一条摘要留下痕迹，所以这些条**内容还在**（以摘要形式），
     * 界面该说"已把 N 条较早对话压成摘要"，而不是"剪掉 N 条"。
     */
    summarizedCount: number
  }
  /**
   * 本轮结束时对话真实占用的 tokens（末步 prompt + 末步 completion）
   *
   * 与 usage.inputTokens 的区别是这一轮的全部意义：`usage` 是**各步之和**（计费口径），
   * 12 步工具链里同一个上下文被重发 12 次，于是它能把 4 万 tokens 的会话报成 40 万。
   * 上下文徽章要回答的是"这个窗口还剩多少"，那只有末步口径是对的。
   */
  contextTokens?: number
  /** 本次实际走的步数（无工具时为 1） */
  stepCount?: number
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
 * agent:tool-event 推送载荷（工具调用实时可视化，v2.4 新增）
 *
 * 背景：主对话 Agent 真实会调用工具（如 ssh_readonly 执行诊断命令），
 * 但此前 streamText 的 tool-call/tool-result 事件被丢弃，前端看不到。
 * 本事件把【真实发生】的工具调用/结果推送到前端，用于渲染“执行卡片”。
 *
 * phase：
 * - 'call'：工具开始调用（携带工具名 + 输入参数）
 * - 'output'：执行中间输出块（v2.6：ssh_readonly 流式 stdout/stderr，可多次）
 * - 'result'：工具返回结果（携带成败 + 输出摘要）
 */
export interface AgentToolEventPayload {
  /** 关联 ID（与 agent:chunk 一致） */
  correlationId: string
  /** 工具调用唯一 ID（同一次调用的 call 与 result 共享，用于前端配对） */
  toolCallId: string
  /** 阶段：call=开始调用，output=执行中间输出，result=返回结果 */
  phase: 'call' | 'output' | 'result'
  /** 工具名（如 ssh_readonly / kb_search） */
  toolName: string
  /** 调用入参（call 阶段，已序列化为展示用的简短字符串，如命令文本） */
  input?: string
  /** 是否成功（result 阶段） */
  ok?: boolean
  /** 输出（output 阶段为增量块；result 阶段为摘要，已截断） */
  output?: string
  /**
   * 结果条数（result 阶段，由工具自己报，不是界面从摘要文本里猜的）。
   *
   * 检索类工具（kb_search / tutorial_search / memory_recall）的返回体本来就带
   * `count`，此前只把摘要文本推给前端、前端再用正则数 `1. 2. 3.` 行——
   * 于是技能匹配、工具装配这类输出不是编号列表的卡片被判成"无结果"，
   * 说的是界面上从没发生过的事。没有这个字段就只显示成/败，不显示数字。
   */
  count?: number
  /** 会话 ID（可选，与其它 agent 事件一致） */
  sessionId?: string
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
  /**
   * 增量类型（v2.5 深度思考可视化）
   * - 缺省 / 'text'：正文增量
   * - 'reasoning'：思考链增量（DeepSeek reasoning_content），前端折叠展示
   */
  kind?: 'text' | 'reasoning'
  /** 会话 ID（v0.9.4 新增，可选；主进程在 agent:chat 启动时回传） */
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
/**
 * Provider 调用错误的分类码（#101 单源）
 *
 * 唯一一份，供三处消费：agent:chat 的错误推送、llm:* 的 LlmError、
 * 以及分类器本身（src/main/core/agent/providers/llm-error.ts）。
 * 以前每个调用点各自手抄一份码表，分叉的方向是"少判一类"。
 *
 * - QUOTA_EXHAUSTED：额度用尽。和 RATE_LIMIT 必须分开——对"再试一次"没用的事
 *   说"请稍后重试"是错的建议。
 * - CONTENT_POLICY：服务端安全策略拒绝，不是我们的请求写错了。
 */
/**
 * 错误码清单（单源）：union 由这张表推出来，判据也从这张表取数。
 * 手写一份数组贴在测试里迟早与 union 分叉，那样"每个码都有下一步"就是句空话。
 */
export const LLM_ERROR_CODES = [
  'AUTH',
  'PAYMENT_REQUIRED',
  'PERMISSION',
  'MODEL_NOT_FOUND',
  'BAD_REQUEST',
  'CONTEXT_OVERFLOW',
  'VALIDATION',
  'RATE_LIMIT',
  'QUOTA_EXHAUSTED',
  'CONTENT_POLICY',
  'TIMEOUT',
  'NETWORK',
  'SERVER',
  'PARSE',
  'NO_API_KEY',
  'CONFIG',
  'UNKNOWN',
  'CANCELLED',
] as const

export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number]

export interface AgentErrorPayload {
  /** 关联 ID */
  correlationId: string
  /** 错误信息（不含 stack trace；原始消息已脱敏并截断） */
  message: string
  /** 错误码，取值见 LlmErrorCode */
  code: LlmErrorCode
  /** 会话 ID（v0.9.4 新增，可选） */
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
 * 可信度证据来源 ID（7 源，唯一一套词表在 @shared/credibility）
 *
 * - log：日志证据（Drain3 模板匹配）
 * - observation：直接观测证据（命令退出码 / 指标读数 / 配置读数）
 * - knowledge：知识库匹配（向量检索相似度）
 * - ai-param：AI 参数证据（Verbalized Confidence + Logprobs）
 * - human：人工证据（用户标注 / 反馈）
 * - history：历史证据（历史决策案例）
 * - best-practice：最佳实践证据（规则库匹配）
 *
 * #106：原先这里是手抄的第二个名单（多一个 'kb'、少一个 'observation'），
 * 与质量算法那份表各说各话。现在只是同一张表的类型别名，加源只改一处。
 * 先验数值不在本文件重复声明，见 SOURCE_PRIORS。
 */
export type CredibilitySourceId = FusionSourceId

/**
 * 可信度评估请求 - 单个证据源输入
 *
 * 渲染进程通过 IPC 传入证据源列表，每个证据源包含 sourceId 和对应的 fields。
 * fields 的具体字段取决于 sourceId（见各 mass function 的 Input 接口）。
 *
 * 字段约定（每一档都可带 sourcePrior?: number，不带则用 SOURCE_PRIORS 的默认值）：
 * - log: { drainMatch: number, sourcePrior?: number }
 * - observation: { hasObservations: boolean, successRate?: number, sourcePrior?: number }
 * - knowledge: { hasResults: boolean, topScore?: number, avgScore?: number, sourcePrior?: number }
 * - ai-param: { verbalizedConfidence: number, logprobConfidence?: number, consistency?: number, cotEntropyTrajectory?: number[], sourcePrior?: number }
 *   （v0.9.6 P2 M4：cotEntropyTrajectory 为可选，每步 Shannon 熵，详见 CotEntropyTrajectory；
 *    v0.9.6 P2 M5+ 修正：Electron IPC 的 structured clone 实际支持数组传输，
 *    因此 cotEntropyTrajectory 可以走 CredibilityEvidenceInput 通道，
 *    无需再"在主进程侧直接调用 createAiParamMassFunction"）
 * - human: { hasAnnotations: boolean, positiveRate?: number, agreement?: number, sourcePrior?: number }
 * - history: { hasCases: boolean, weightedSuccessRate?: number, sourcePrior?: number }
 * - best-practice: { hasMatches: boolean, positiveRate?: number, negativeRate?: number, sourcePrior?: number }
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
 * 界面上那个置信度数字的来路
 *
 * - fused：D-S/PCR5 融合算出来的结论
 * - self-reported：模型在回复里自己报的数，没做过融合
 *
 * 这两个数曾经在同一个位置显示、长得一模一样（评估失败时页面拿自报数去填融合公式的坑，
 * 还配上了 m(A)=Σ… 的公式排版），而用户是照它做决策的。数字必须带着来路一起走。
 */
export type ConfidenceProvenance = 'fused' | 'self-reported'

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
 * - sandbox:execute     — 沙箱命令执行
 */
export type SessionKind = 'agent:chat' | 'sandbox:execute'

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
  /** Provider ID（agent:chat 通道用） */
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
// v0.9.5 P0 级缺失 IPC 通道共享类型
//
// 任务：v0.9.5 渲染层 UI 集成 - 补齐主进程已实现但界面拿不到的通道
//   token:cost-stats（成本透明）
//   subagent:list / subagent:reload（自定义 Agent 加载器）
//   provider:capabilities / provider:capabilities-all / provider:pricing /
//   provider:pricing-all（Provider 能力 + 定价透明）
//
// 组 2（mode:* 五模式切换）的类型已于 2026-10-24 随实现整删：
// mode 既不注入 system prompt 也不拦工具，渲染层零调用，
// 而 MCP 资源曾把 allowedTools/canWriteFiles 当真实能力对外公布。
//
// 设计原则：
// - SSOT：所有跨端共享的类型集中在 src/shared/agent-types.ts
// - 不依赖 main 进程的任何模块（确保 preload/renderer 可安全导入）
// - 类型穷尽性：用字面量联合 + Record<T, V> 强制穷尽
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
