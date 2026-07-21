/**
 * electronAPI 全局类型声明
 *
 * preload 脚本通过 contextBridge 暴露的 IPC 桥接接口类型定义。
 * 渲染进程通过 window.electronAPI 调用主进程能力，所有方法返回 Promise。
 *
 * 事件监听方法（onXxx）用于接收主进程推送的实时数据。
 */
import type {
  SshConfig,
  CommandResult,
  SystemInfo,
  MonitorData,
  ChatMessage,
  LlmConfig,
  LlmValidationResult,
  EnvironmentContext,
  LlmStreamChunk,
  LlmError,
  Evidence,
  KnowledgeEntry,
  KnowledgeType,
  DecisionCard,
  AgentWorkflowState,
  ProfilerRunResponse,
  RiskItem,
  // v0.9.5 P0 新增：MCP 5 阶段状态机
  McpStateContext,
  // v0.9.6 新增：外部 MCP Server 状态
  ExternalMcpServerStatus,
} from '@shared/models'

// 部署助手类型（来自共享层 @shared/deploy-types）
import type {
  DeployTemplate as DeployTemplateModel,
  DeployPlan as DeployPlanModel,
  DeployResult as DeployResultModel,
  DeployStepResult as DeployStepResultModel,
  DeployLogEvent as DeployLogEventModel,
} from '@shared/deploy-types'

// LLM Tool Calling 类型（v0.5.0）
import type {
  ToolCallProgress,
  ToolApprovalRequest,
  ToolApprovalResponse,
} from '@shared/llm-tool-types'

// 教程爬虫类型（v0.6.0）
import type {
  TutorialSourceSpec,
  CrawlProgress,
  CrawlResult,
  CrawlStatus
} from '@shared/crawler-types'

// v0.9 Agent Runtime 共享类型（Provider 抽象 + Token 统计 + Supervisor chat 载荷）
import type {
  ProviderConfig,
  PersistedProviderConfig,
  ThinkingStrength,
  TokenStats,
  TokenUsageRecord,
  AgentChunkPayload,
  AgentDonePayload,
  AgentErrorPayload,
} from '@shared/agent-types'

// v0.9 Claude Agent SDK 共享类型（claude-sdk:generate / stream / cancel + ChatResult）
import type {
  ChatResult,
  ClaudeSdkChatParams,
} from '@shared/agent-types'

// v0.9.4 IPC 协议优化（sessionId + abort signal + protocolVersion + ping/pong）
import type {
  SystemPingResponse,
} from '@shared/agent-types'

// v0.9 @命令共享类型（8 类 @命令：log/cmd/file/metric/decision/kb/skill/server）
import type {
  AtCommand,
  AtCommandParseResult,
  AtCommandSource,
  AtCommandType,
} from '@shared/at-command-types'

// v0.9 可信度算法共享类型（D-S + PCR5 + 6 源证据 + DAG 可视化）
import type {
  CredibilityEvidenceInput,
  ConfidenceAssessment,
  DagData,
  // v0.9.6 P1 新增：ECE 校准器共享类型（CalibrationTuner）
  CalibrationSample,
  CalibrationState,
  EceResult,
  OptimizeTOptions,
  ProviderCalibration,
  ProviderId,
  TemperatureScalingResult,
} from '@shared/agent-types'

// v0.9.5 P0 新增：5 组缺失 IPC 通道共享类型（成本透明 / 模式切换 / 注意力 / Subagent / Provider 信息）
import type {
  CostStats,
  AgentMode,
  ModeInfo,
  ModeListResponse,
  ModeSetDefaultRequest,
  ModeSetDefaultResponse,
  ModeCurrentResponse,
  AttentionFocus,
  CustomAgentConfig,
  SubagentReloadRequest,
  SubagentReloadResponse,
  ProviderCapabilities,
  ModelPricing,
  ProviderCapabilitiesRequest,
  ProviderCapabilitiesResponse,
  ProviderCapabilitiesAllResponse,
  ProviderPricingRequest,
  ProviderPricingResponse,
  ProviderPricingAllResponse,
} from '@shared/agent-types'

// ============================================================================
// v0.9 OpenHands 沙箱集成类型声明（独立于 ElectronAPI interface）
// ============================================================================

/**
 * 沙箱运行状态
 *
 * - STARTING：启动中
 * - RUNNING：运行中
 * - PAUSED：已暂停
 * - ERROR：错误
 * - MISSING：已删除
 */
export type SandboxStatus = 'STARTING' | 'RUNNING' | 'PAUSED' | 'ERROR' | 'MISSING'

/** 沙箱内服务暴露 URL */
export interface SandboxExposedUrl {
  name: string
  url: string
  port: number
}

/** 沙箱信息（与 OpenHands SandboxInfo 模型对应） */
export interface SandboxInfo {
  id: string
  created_by_user_id: string | null
  sandbox_spec_id: string
  status: SandboxStatus
  /** 访问 Key（STARTING/PAUSED 时为 null），作为 X-Session-API-Key Header */
  session_api_key: string | null
  exposed_urls: SandboxExposedUrl[] | null
  created_at: string
}

/** 沙箱分页响应 */
export interface SandboxPage {
  items: SandboxInfo[]
  next_page_id: string | null
}

/** 沙箱内命令执行结果 */
export interface SandboxCommandResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs?: number
}

/** Docker 检测结果 */
export interface DockerInfo {
  installed: boolean
  version: string | null
  running: boolean
  error?: string
}

/** 沙箱集成健康状态 */
export interface SandboxHealthStatus {
  dockerReady: boolean
  dockerVersion: string | null
  openhandsRunning: boolean
  error?: string
}

/** 沙箱 IPC 失败响应 */
export interface SandboxErrorResponse {
  success: false
  error: string
  code?: string
}

/**
 * 沙箱命令危险度评级（与主进程 sandbox.ts CommandRiskLevel 对应）
 *
 * - low：只读操作（ls / cat / grep / ps）
 * - medium：包管理 / 用户管理 / 服务管理 / sudo 提权
 * - high：高危命令（rm -rf / chmod 777 / iptables / dd / mkfs / fork bomb / shutdown）
 */
export type SandboxCommandRiskLevel = 'low' | 'medium' | 'high'

/**
 * 沙箱命令审批请求载荷（主进程推送 sandbox:approval-request 事件）
 *
 * P-2 HC-6 强制审批：sandbox:execute 调用时主进程会推送此事件，
 * 渲染进程弹窗显示命令 + 风险等级，用户通过 sandboxApprove(callId, approved) 响应。
 */
export interface SandboxApprovalRequest {
  /** 审批调用 ID（与 sandboxApprove 的 callId 参数对应） */
  callId: string
  /** 沙箱 ID */
  sandboxId: string
  /** 待执行的命令 */
  command: string
  /** 命令危险度评级 */
  risk: SandboxCommandRiskLevel
  /** 风险原因列表（high/medium 时非空，辅助 UI 展示） */
  reasons: string[]
  /** 推送时间戳（ms） */
  timestamp: number
}

/**
 * PAOR 审批请求载荷（v0.9.5 新增，主进程推送 paor:approval-request 事件）
 *
 * PAOR 循环中遇到 HIGH/CRITICAL 风险命令时主进程推送此事件，
 * 渲染进程弹窗显示命令 + 风险等级，用户通过 paorApprove(callId, approved) 响应。
 * 60 秒未响应主进程自动拒绝。
 */
export interface PaorApprovalRequest {
  /** 审批调用 ID（与 paorApprove 的 callId 参数对应） */
  callId: string
  /** 待执行的命令 */
  command: string
  /** 风险等级（HIGH / CRITICAL） */
  riskLevel: string
  /** 风险描述 */
  riskDescription: string
  /** 当前步骤索引 */
  stepIndex: number
  /** 推送时间戳（ms） */
  timestamp: number
}

// ============================================================================
// v0.9 @命令元信息类型（与 preload/index.ts 中的 AtCommandInfo 对应）
// ============================================================================

/** @命令元信息（at:list 返回的单项，UI 选择器渲染用） */
export interface AtCommandInfo {
  /** 命令类型（8 类之一：log/cmd/file/metric/decision/kb/skill/server） */
  type: AtCommandType
  /** 中文展示标签 */
  label: string
  /** Ant Design 图标名 */
  icon: string
  /** 命令描述 */
  description: string
}

// ============================================================================
// v0.9.6 Sprint 7 任务 E：混合检索类型声明
// ============================================================================
// 注意：与 preload/index.ts 中内联定义的 HybridSearchResult / TutorialHybridSearchOptions /
//      TutorialBackfillOptions / TutorialBackfillResult / TutorialSearchStatus 保持字段一致。
//      不从 preload 导入（preload 不能被 renderer types 依赖），
//      也不放到 @shared/hybrid-search-types.ts（避免新增 shared 文件，与 preload 注释一致）。

/**
 * 混合检索单条结果
 *
 * 同时包含原始分数和融合分数，便于 UI 展示和调试：
 *   - ftsScore：BM25 原始分（负值，越小越相关；未参与 FTS 时为 0）
 *   - vecDistance：余弦距离（0-2，越小越相关；未参与 vec 时为 -1）
 *   - rrfScore：RRF 融合分（越大越相关，最终排序依据）
 *   - source：标记该条目由哪一路召回（fts / vec / both）
 */
export interface TutorialHybridSearchResult {
  /** 知识条目 ID（对应 knowledge_entries.id） */
  id: string
  /** 标题 */
  title: string
  /** 问题描述（教程场景下即摘要 summary） */
  problem: string
  /** 分类（取自 tags[0]） */
  category?: string
  /** BM25 原始分（负值，越小越相关；未参与 FTS 时为 0） */
  ftsScore: number
  /** 余弦距离原始值（0-2，越小越相关；未参与向量检索时为 -1） */
  vecDistance: number
  /** RRF 融合分（越大越相关，最终排序依据） */
  rrfScore: number
  /** 召回来源：fts=仅 FTS 命中 / vec=仅向量命中 / both=双路同时命中 */
  source: 'fts' | 'vec' | 'both'
}

/** tutorial:hybrid-search 通道的 options 参数 */
export interface TutorialHybridSearchOptions {
  /** 知识类型过滤（默认 'tutorial'） */
  type?: 'tutorial' | 'command_skill' | 'incident_case'
  /** 返回数量上限（默认 10） */
  limit?: number
  /** 是否启用向量检索（默认 true） */
  useVector?: boolean
}

/** tutorial:backfill-embeddings 通道的 options 参数 */
export interface TutorialBackfillOptions {
  /** 每批大小（默认 8） */
  batchSize?: number
}

/** tutorial:backfill-embeddings 通道的返回值 */
export interface TutorialBackfillResult {
  /** 总条目数（待回填的条目数） */
  total: number
  /** 成功回填的条目数 */
  success: number
  /** 回填失败的条目数 */
  failed: number
  /** 错误信息（失败时存在，与 crawlStart 通道风格一致） */
  error?: string
}

/** tutorial:search-status 通道的返回值 */
export interface TutorialSearchStatus {
  /** sqlite-vec 扩展是否加载成功 */
  vectorEnabled: boolean
  /** BGE embedding 模型是否已加载到内存 */
  embeddingModelLoaded: boolean
  /** embedding 维度（BGE-small-zh-v1.5 固定 512） */
  embeddingDim: number
  /** tutorial 类型条目总数 */
  totalEntries: number
}

// ============================================================================
// v0.9.6 Sprint 9 任务：学习路径推荐类型声明
// ============================================================================
// 注意：与 preload/index.ts 中内联定义的 PathStep / TutorialPath /
//      RecommendPathOptions 保持字段一致。

/** 学习路径步骤 */
export interface PathStep {
  /** 步骤序号（从 1 开始） */
  order: number
  /** 教程 ID */
  tutorialId: string
  /** 教程标题 */
  title: string
  /** 分类 */
  category: string
  /** 难度 */
  difficulty: string
  /** 预估阅读时间（分钟） */
  readingTime: number
  /** 关键命令 */
  commands: string[]
  /** 为什么学这个（LLM 生成或模板） */
  why: string
  /** 教程摘要 */
  summary: string
}

/** 学习路径 */
export interface TutorialPath {
  /** 路径 ID（生成） */
  id: string
  /** 路径名称 */
  name: string
  /** 路径描述 */
  description: string
  /** 目标分类 */
  targetCategory: string
  /** 目标难度 */
  targetDifficulty: string
  /** 路径步骤 */
  steps: PathStep[]
  /** 预估总时间（分钟） */
  estimatedMinutes: number
  /** 前置知识（依赖的分类） */
  prerequisites: string[]
  /** 推荐理由 */
  reason: string
}

/** 路径推荐请求参数 */
export interface RecommendPathOptions {
  /** 学习目标（自然语言，如"想学 Docker"） */
  goal?: string
  /** 当前水平（如 beginner / intermediate / advanced） */
  currentLevel?: string
  /** 偏好分类（如 networking） */
  preferredCategory?: string
  /** 最大步骤数（默认 8） */
  maxSteps?: number
}

/** electronAPI 接口定义 */
export interface ElectronAPI {
  // ===== SSH 相关 =====
  /** 建立 SSH 连接，返回 sessionId */
  sshConnect(config: SshConfig): Promise<string>
  /** 断开 SSH 连接 */
  sshDisconnect(sessionId: string): Promise<boolean>
  /** 执行 SSH 命令 */
  sshExec(sessionId: string, command: string): Promise<CommandResult>
  /** 启动交互式 Shell */
  sshShellStart(sessionId: string): Promise<boolean>
  /** 向 Shell 写入数据 */
  sshShellWrite(sessionId: string, data: string): Promise<boolean>
  /** 调整 Shell 终端尺寸 */
  sshShellResize(sessionId: string, cols: number, rows: number): Promise<boolean>

  // ===== SFTP 文件管理 =====
  /** 列出远程目录内容 */
  sftpList(sessionId: string, remotePath: string): Promise<import('@shared/models').SftpEntry[]>
  /** 上传本地文件到远程 */
  sftpUpload(sessionId: string, localPath: string, remotePath: string): Promise<boolean>
  /** 下载远程文件到本地 */
  sftpDownload(sessionId: string, remotePath: string, localPath: string): Promise<boolean>
  /** 删除远程文件/目录 */
  sftpDelete(sessionId: string, remotePath: string): Promise<boolean>
  /** 重命名远程文件/目录 */
  sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<boolean>
  /** 修改远程文件/目录权限 */
  sftpChmod(sessionId: string, remotePath: string, mode: number): Promise<boolean>
  /** 读取远程文件内容到字符串（v0.8 IDE 工作台，10MB 上限） */
  sftpReadFile(sessionId: string, remotePath: string): Promise<string>
  /** 写入字符串到远程文件（v0.8 IDE 工作台，覆盖原文件） */
  sftpWriteFile(sessionId: string, remotePath: string, content: string): Promise<boolean>
  /** 获取远程文件/目录元信息（返回 SftpEntry 或 null） */
  sftpStat(sessionId: string, remotePath: string): Promise<import('@shared/models').SftpEntry | null>
  /** 创建远程目录 */
  sftpMkdir(sessionId: string, remotePath: string): Promise<boolean>

  // ===== 监控相关 =====
  /** 启动监控采集 */
  monitorStart(sessionId: string, interval: number): Promise<boolean>
  /** 停止监控采集 */
  monitorStop(sessionId: string): Promise<boolean>
  /** 获取系统静态信息 */
  monitorGetSystemInfo(sessionId: string): Promise<SystemInfo>

  // ===== LLM 相关 =====
  /** LLM 对话 */
  llmChat(messages: ChatMessage[]): Promise<string>
  /** 测试 LLM 连接 */
  llmTest(config: LlmConfig): Promise<boolean>
  /** LLM 分析（结合证据） */
  llmAnalyze(question: string, evidences: Evidence[]): Promise<string>
  /**
   * 校验 LLM 配置是否有效（不发起网络请求）
   *
   * P-9 修复：d.ts 补齐（主进程已注册 + preload 已暴露，但 d.ts 此前缺失类型声明）
   */
  llmValidate(config: LlmConfig): Promise<LlmValidationResult>
  /**
   * 带系统环境上下文的对话
   *
   * P-9 修复：d.ts 补齐（主进程已注册 + preload 已暴露，但 d.ts 此前缺失类型声明）
   */
  llmChatWithContext(messages: ChatMessage[], envCtx: EnvironmentContext): Promise<string>

  // ===== Agent 工作流（v0.8 旧 AgentWorkflow，保留） =====
  /** 启动 Agent 工作流 */
  agentStart(sessionId: string, question: string): Promise<boolean>
  /** 确认/拒绝 Agent 决策 */
  agentConfirm(sessionId: string, approved: boolean): Promise<boolean>
  /**
   * 通过 sessionId 统一取消进行中的会话（v0.9.4 新签名）
   *
   * 同时调用 agent:chat:cancel 与 claude-sdk:cancel 两个 IPC 通道，
   * 主进程 handler 已兼容 sessionId 与 correlationId，会按 sessionId 查找
   * session-registry 中的 AbortController 并触发 abort。
   *
   * 注意：v0.8 旧 agentCancel（调用 agent:cancel 通道）已被 v0.9.4 新签名覆盖。
   * v0.8 旧 agent:cancel IPC 通道仍保留在主进程（向后兼容 IPC 层），
   * 但 preload 不再暴露 v0.8 旧 agentCancel 方法。
   *
   * @param sessionId 会话 ID（agent:chat / claude-sdk:stream 启动时回传）
   * @returns 各通道取消结果（true 表示该通道存在且成功取消）
   */
  agentCancel(sessionId: string): Promise<{ agentChat: boolean; claudeSdk: boolean }>

  // ===== v0.9 Agent Runtime（Supervisor chat + Provider + Token） =====
  /**
   * 启动 Supervisor 流式 chat
   *
   * 异步执行，立即返回 correlationId。
   * 通过 onAgentChunk / onAgentDone / onAgentError 监听后续事件。
   *
   * @param messages 对话消息列表（P-3：与主进程 agent-runtime.ts 入参类型统一为 ChatMessage[]）
   * @param providerId Provider ID（可选，不传用默认）
   * @param strength 思考强度（fast / standard / deep，可选）
   * @returns correlationId（用于监听事件 + 取消请求）
   */
  agentChat(
    messages: ChatMessage[],
    providerId?: string,
    strength?: ThinkingStrength,
    /** 活跃 SSH sessionId；传入后 Supervisor 启用 ssh_readonly 工具 */
    sshSessionId?: string,
  ): Promise<string>
  /** 取消进行中的 Supervisor chat 请求 */
  agentChatCancel(correlationId: string): Promise<boolean>
  /**
   * PAOR 自动循环（Plan→Act→Observe→Reflect 多步自主编排，方案书 §3.2）
   *
   * 对多步运维任务自动规划并逐步执行，高危命令自动拦截。
   * 每轮迭代通过 agent:paor:iteration 事件实时推送。
   *
   * @param task 运维任务描述
   * @param sshSessionId SSH 会话 ID
   * @param maxIterations 最大迭代次数（默认 5）
   * @returns PAOR 循环完整结果（含可审计的迭代轨迹）
   */
  agentPaor(task: string, sshSessionId: string, maxIterations?: number): Promise<unknown>
  /**
   * 响应 PAOR 审批请求（v0.9.5 新增）
   *
   * @param callId 审批调用 ID（来自 paor:approval-request 事件载荷）
   * @param approved 是否批准执行
   */
  paorApprove(callId: string, approved: boolean): Promise<boolean>

  // ===== v0.9.4 系统级 IPC（协议版本 + 心跳保活） =====
  /**
   * 同步获取 IPC 协议版本号
   *
   * 从 @shared/agent-types 导入 IPC_PROTOCOL_VERSION 常量，无需 IPC 调用。
   * 渲染进程可在启动时校验版本一致性（preload 与 main 应保持同步）。
   *
   * @returns IPC 协议版本号（如 '0.9.4'）
   */
  getProtocolVersion(): string
  /**
   * 心跳保活 ping（检测主进程是否响应）
   *
   * 渲染进程可定期（如每 30 秒）调用本方法，超时无响应可判定主进程卡死。
   *
   * @returns { ok: true, timestamp: number, protocolVersion: string }
   */
  systemPing(): Promise<SystemPingResponse>

  // ===== v0.9 Provider 管理 =====
  /** 列出所有 Provider 配置（不含 apiKey） */
  providerList(onlyEnabled?: boolean): Promise<PersistedProviderConfig[]>
  /** 获取指定 Provider 配置（不含 apiKey） */
  providerGet(id: string): Promise<PersistedProviderConfig | null>
  /** 保存 / 更新 Provider 配置（apiKey 自动走 SecureStore 加密） */
  providerSave(config: ProviderConfig): Promise<boolean>
  /** 设置默认 Provider ID */
  providerSetDefault(id: string): Promise<boolean>

  // ===== v0.9 Token 统计 =====
  /** 获取 token 统计聚合（当日/当周/当月/总 + 按 Subagent/Provider 分布） */
  tokenStats(): Promise<TokenStats>
  /** 重置 token 统计（清空所有记录） */
  tokenReset(): Promise<boolean>
  /**
   * 获取 token 使用明细记录（P-5 新增）
   *
   * @param limit 返回最近 N 条记录，默认 100，上限 1000
   * @returns TokenUsageRecord[]（按时间正序，最近一条在末尾）
   */
  tokenRecords(limit?: number): Promise<TokenUsageRecord[]>

  // ===== v0.9 Claude Agent SDK（claude-sdk:generate / stream / cancel） =====
  // 使用场景：Provider 选择器中选 claude-sdk 类型时走本通道，其他类型走 agentChat
  /**
   * 同步聚合调用 Claude SDK（返回完整 ChatResult，不流式推送 token）
   *
   * 适用场景：批量分析、定时任务、不需要流式 UI 的后台调用
   *
   * @param providerId Provider ID（必须是 type='claude-sdk' 的 Provider）
   * @param params chat 调用参数（prompt / strength / systemPrompt 等）
   * @returns 完整 ChatResult
   */
  claudeSdkGenerate(providerId: string, params: ClaudeSdkChatParams): Promise<ChatResult>
  /**
   * 异步流式调用 Claude SDK（立即返回 correlationId）
   *
   * 异步执行，立即返回 correlationId。
   * 通过 onClaudeSdkChunk / onClaudeSdkDone / onClaudeSdkError 监听后续事件。
   *
   * 适用场景：交互式对话（ChatPanel）
   *
   * @param providerId Provider ID（必须是 type='claude-sdk' 的 Provider）
   * @param params chat 调用参数
   * @returns correlationId（用于监听事件 + 取消请求）
   */
  claudeSdkStream(providerId: string, params: ClaudeSdkChatParams): Promise<string>
  /** 取消进行中的 Claude SDK 请求 */
  claudeSdkCancel(correlationId: string): Promise<boolean>

  // ===== v0.9 OpenHands 沙箱集成 =====
  /** 检测 Docker Desktop 是否安装且运行 */
  sandboxDetectDocker(): Promise<DockerInfo>
  /** 启动 OpenHands App Server 容器（首次启动需拉镜像，可能数分钟） */
  sandboxStart(): Promise<{ success: true } | SandboxErrorResponse>
  /** 停止 OpenHands App Server 容器 */
  sandboxStop(): Promise<{ success: true } | SandboxErrorResponse>
  /** 获取沙箱集成状态（Docker + OpenHands 健康） */
  sandboxStatus(): Promise<SandboxHealthStatus>
  /** 创建新沙箱（隔离 Docker 容器） */
  sandboxCreate(sandboxSpecId?: string): Promise<SandboxInfo | SandboxErrorResponse>
  /** 列出当前用户的所有沙箱 */
  sandboxList(limit?: number): Promise<SandboxPage | SandboxErrorResponse>
  /**
   * 在沙箱内执行 shell 命令（P-2 + P-4 修复：HC-6 强制审批 + 句柄模式）
   *
   * P-4 句柄模式：session_api_key 不再由渲染进程传入，主进程从 sessionKeyMap 查找。
   * P-2 强制审批：调用后主进程会推送 sandbox:approval-request 事件，
   *              渲染进程需监听 onSandboxApprovalRequest 并弹窗，
   *              用户通过 sandboxApprove(callId, approved) 响应后才执行。
   *
   * @param sandboxId 沙箱 ID
   * @param command shell 命令
   */
  sandboxExecute(
    sandboxId: string,
    command: string
  ): Promise<SandboxCommandResult | SandboxErrorResponse>
  /**
   * 响应沙箱命令审批请求（P-2：HC-6 强制审批）
   *
   * @param callId 审批调用 ID（来自 sandbox:approval-request 事件载荷）
   * @param approved 是否批准执行
   */
  sandboxApprove(callId: string, approved: boolean): Promise<boolean>
  /** 删除沙箱（不可逆，工作区数据将丢失） */
  sandboxDelete(sandboxId: string): Promise<{ success: true } | SandboxErrorResponse>

  // ===== v0.9 @命令 8 类（log/cmd/file/metric/decision/kb/skill/server） =====
  /**
   * 列出所有可用 @命令（8 类）
   *
   * @returns AtCommandInfo[]（含 type / label / icon / description）
   */
  atList(): Promise<AtCommandInfo[]>
  /**
   * 解析单个 @命令
   *
   * @param type 命令类型（log/cmd/file/metric/decision/kb/skill/server）
   * @param args 命令参数（键值对，由 UI 收集）
   * @param source 来源标识（IDE/终端/监控/历史/chat-input/drag-drop）
   * @param userId 用户 ID（可选，预留多用户场景）
   * @returns 完整的 AtCommand 对象（含 displayText 与 injectedText）
   */
  atResolve(
    type: AtCommandType,
    args: Record<string, unknown>,
    source?: AtCommandSource,
    userId?: string
  ): Promise<AtCommand>
  /**
   * 解析文本中所有 @命令
   *
   * @param text ChatPanel 输入框原始文本
   * @param source 来源标识
   * @param userId 用户 ID（可选）
   * @returns AtCommandParseResult（含 text 去除 @命令后的纯文本 + commands 列表）
   */
  atParse(
    text: string,
    source?: AtCommandSource,
    userId?: string
  ): Promise<AtCommandParseResult>

  // ===== v0.9 可信度算法（D-S + PCR5 + 6 源证据 + DAG 可视化） =====
  /**
   * 评估给定证据集的可信度
   *
   * @param inputs 证据源输入列表（1-6 个，每项含 sourceId + fields）
   * @returns ConfidenceAssessment（含 Bel/Pl/confidence/conflictLevel/fusionSteps）
   */
  credibilityAssess(inputs: CredibilityEvidenceInput[]): Promise<ConfidenceAssessment>
  /**
   * 获取 DAG 可视化数据
   *
   * @param inputs 证据源输入列表
   * @returns DagData（含 nodes + edges，用于 React Flow 渲染）
   */
  credibilityDag(inputs: CredibilityEvidenceInput[]): Promise<DagData>

  // v0.9.6 P1：ECE 校准器 API（Temperature Scaling，按 Provider 分类）
  // 论文支撑：Guo et al. 2017, "On Calibration of Modern Neural Networks", ICML
  //   arXiv:1706.04599 §3.1-3.2

  /**
   * 触发指定 Provider 的重新校准
   *
   * 基于历史决策样本网格搜索最优 Temperature Scaling 参数 T 值。
   * 不同 LLM（DeepSeek / Claude / GPT / Ollama）应使用不同 T。
   *
   * @param providerId Provider ID（如 'deepseek' / 'claude'）
   * @param options 可选优化参数（tMin / tMax / tSteps / numBuckets / minSamples）
   * @returns TemperatureScalingResult（最优 T、ECE 改善、searchTrace）
   */
  credibilityCalibrate(
    providerId: ProviderId,
    options?: OptimizeTOptions
  ): Promise<TemperatureScalingResult>

  /**
   * 获取指定 Provider 的当前校准状态
   *
   * 未校准过的 Provider 返回 optimalT = defaultT = 1.0
   *
   * @param providerId Provider ID
   * @returns ProviderCalibration（optimalT / lastCalibratedAt / sampleCount / ece）
   */
  credibilityGetCalibration(providerId: ProviderId): Promise<ProviderCalibration>

  /**
   * 获取全局校准状态（含所有 Provider 的 T 值表）
   *
   * @returns CalibrationState（providers + defaultT + updatedAt）
   */
  credibilityGetCalibrationState(): Promise<CalibrationState>

  /**
   * 重置指定 Provider 的校准（T 回到 defaultT=1.0）
   *
   * @param providerId Provider ID
   * @returns boolean（是否成功重置）
   */
  credibilityResetCalibration(providerId: ProviderId): Promise<boolean>

  /**
   * 计算指定 Provider 的当前 ECE（不修改 T）
   *
   * 用于 UI 实时展示校准质量，不触发重新校准。
   *
   * @param providerId Provider ID
   * @param numBuckets 可选分桶数（默认 10）
   * @returns EceResult（ECE / MCE / 各桶统计 / 总样本数）
   */
  credibilityComputeEce(
    providerId: ProviderId,
    numBuckets?: number
  ): Promise<EceResult>

  /**
   * 记录新的校准样本（决策卡验证后回灌 ground truth）
   *
   * 满足 RETUNE_THRESHOLD 阈值后，下次 calibrate 会重新计算最优 T。
   *
   * @param sample CalibrationSample（决策 ID、置信度、是否正确、Provider、时间戳）
   * @returns boolean（是否成功入库）
   */
  credibilityAddCalibrationSample(sample: CalibrationSample): Promise<boolean>

  // ========================================================================
  // v0.9.6 P2：EU AI Act 合规审计报告（4 个新通道）
  // ========================================================================

  /**
   * 导出 EU AI Act 合规审计报告
   *
   * 法规依据：EU AI Act 2026 Art.11/12/13/14/15 + NIST AI RMF 1.0 + NIST AI 600-1
   *
   * @param input AuditReportInput（决策上下文 + 6 源证据 + 校准 + 人工监督 + 决策动作）
   * @param options 导出选项（format / outputDir / force / writeAllFormats）
   * @returns ExportResult（reportId / fingerprint / 文件路径 / 字节数）
   */
  credibilityExportAuditReport(input: unknown, options?: unknown): Promise<unknown>

  /**
   * 列出已落盘的审计报告
   *
   * @param outputDir 可选自定义目录（默认 userData/audit-reports/）
   * @returns AuditReportListItem[]（按决策时间倒序）
   */
  credibilityListAuditReports(outputDir?: string): Promise<unknown[]>

  /**
   * 从 JSON 文件加载审计报告
   *
   * @param filepath 报告 JSON 绝对路径
   * @returns ComplianceAuditReport
   */
  credibilityLoadAuditReport(filepath: string): Promise<unknown>

  /**
   * 仅格式化（不落盘），用于预览
   *
   * @param input AuditReportInput
   * @param format json / markdown / html
   * @returns string（序列化后的报告内容）
   */
  credibilityFormatAuditReport(input: unknown, format: 'json' | 'markdown' | 'html'): Promise<string>

  // ===== 安全存储 =====
  /** 保存 API Key（加密存储） */
  storageSaveApiKey(key: string, value: string): Promise<boolean>
  /** 获取 API Key */
  storageGetApiKey(key: string): Promise<string | null>
  /** 删除 API Key */
  storageDeleteApiKey(key: string): Promise<boolean>

  // ===== 配置存储 =====
  /** 获取配置项 */
  configGet<T = unknown>(key: string): Promise<T>
  /** 设置配置项 */
  configSet(key: string, value: unknown): Promise<boolean>

  // ===== 知识库 =====
  /** 搜索知识库 */
  kbSearch(query: string, type?: KnowledgeType, limit?: number): Promise<KnowledgeEntry[]>
  /** 添加知识条目 */
  kbAdd(entry: KnowledgeEntry): Promise<boolean>
  /** 更新知识条目 */
  kbUpdate(id: string, partial: Partial<KnowledgeEntry>): Promise<boolean>
  /** 删除知识条目 */
  kbDelete(id: string): Promise<boolean>
  /** 批量导入知识 */
  kbImport(entries: KnowledgeEntry[]): Promise<number>
  /** 导出知识库 */
  kbExport(type?: KnowledgeType): Promise<KnowledgeEntry[]>

  // ===== 决策历史 =====
  /** 获取决策历史列表 */
  historyList(offset?: number, limit?: number): Promise<DecisionCard[]>
  /** 获取单个决策详情 */
  historyGet(id: string): Promise<DecisionCard | null>
  /** 保存决策记录 */
  historySave(card: DecisionCard): Promise<boolean>

  // ===== 系统架构感知 =====
  /** 执行 27 项并发探查 + 风险检测 + md 渲染 */
  profilerRun(sessionId: string, host: string): Promise<ProfilerRunResponse>
  /** 导出 md 文件 */
  profilerExportMd(
    md: string,
    outputPath: string
  ): Promise<{ filePath: string; size: number }>
  /** 导出 PDF 文件 */
  profilerExportPdf(
    md: string,
    outputPath: string
  ): Promise<{ filePath: string; size: number }>
  /** 生成默认文件名（host-yyyymmdd-hhmm.md/pdf） */
  profilerDefaultFileName(host: string, ext: 'md' | 'pdf'): Promise<string>

  // ===== 知识库教程 =====
  /** 列出教程（可选按分类过滤） */
  tutorialList(category?: TutorialCategory): Promise<TutorialEntry[]>
  /** 按 ID 获取单篇 */
  tutorialGet(id: string): Promise<TutorialEntry | null>
  /** 关键词搜索 */
  tutorialSearch(query: string, limit?: number): Promise<TutorialEntry[]>
  /** 分类汇总（含数量） */
  tutorialCategories(): Promise<TutorialCategorySummary[]>
  /** 当前种子版本 */
  tutorialSeedVersion(): Promise<string>
  /** 重新加载种子（清空 + 重写，仅 dev） */
  tutorialSeedReload(): Promise<number>

  // ===== v0.9.6 Sprint 7 任务 E：混合检索 + embedding 回填 + 检索状态 =====
  // 通道与主进程 ipc/tutorial.ts 一一对应：
  // - tutorial:hybrid-search       → tutorialHybridSearch（FTS5 BM25 + vec0 KNN + RRF 融合）
  // - tutorial:backfill-embeddings → tutorialBackfillEmbeddings（回填缺失 embedding）
  // - tutorial:search-status       → tutorialSearchStatus（检索能力快照）
  //
  // 与现有 tutorialSearch 的区别：
  // - tutorialSearch（旧）：Jaccard 关键词搜索，返回 TutorialEntry[]
  // - tutorialHybridSearch（新）：FTS5 + 向量 KNN + RRF 融合，返回 HybridSearchResult[]
  //   含 rrfScore/ftsScore/vecDistance/source 等调试字段，便于 UI 高亮展示
  /**
   * 混合检索（FTS5 BM25 + vec0 KNN + RRF 融合）
   *
   * @param query 用户查询字符串
   * @param options.type 知识类型过滤（默认 'tutorial'）
   * @param options.limit 返回数量上限（默认 10）
   * @param options.useVector 是否启用向量检索（默认 true）
   * @returns HybridSearchResult[]（按 rrfScore 降序）
   */
  tutorialHybridSearch(
    query: string,
    options?: TutorialHybridSearchOptions
  ): Promise<TutorialHybridSearchResult[]>
  /**
   * 回填缺失的 embedding 字段（长任务，2578 条需 1-3 分钟）
   *
   * 触发场景：
   * - 用户在 EmbeddingBanner 点击「下载模型」
   * - 主进程首次启动时自动检测（如配置了 autoBackfill=true）
   *
   * @param options.batchSize 每批大小（默认 8）
   * @returns { total, success, failed, error? } 统计信息
   */
  tutorialBackfillEmbeddings(
    options?: TutorialBackfillOptions
  ): Promise<TutorialBackfillResult>
  /**
   * 获取检索状态（向量是否可用 + 模型是否加载 + 总条目数）
   *
   * @returns TutorialSearchStatus（vectorEnabled / embeddingModelLoaded / embeddingDim / totalEntries）
   */
  tutorialSearchStatus(): Promise<TutorialSearchStatus>

  // ===== v0.9.6 Sprint 9：学习路径推荐 =====
  // 通道与主进程 ipc/tutorial.ts 一一对应：
  // - tutorial:recommend-path → tutorialRecommendPath（4 层融合路径推荐）
  /**
   * 推荐学习路径（4 层融合：分类依赖 + 难度递进 + 命令关联 + 混合检索）
   *
   * @param options.goal 学习目标（自然语言，如"想学 Docker"）
   * @param options.currentLevel 当前水平（如 beginner / intermediate / advanced）
   * @param options.preferredCategory 偏好分类（如 networking）
   * @param options.maxSteps 最大步骤数（默认 8）
   * @returns TutorialPath[]（按融合分数排序的学习路径）
   */
  tutorialRecommendPath(options?: RecommendPathOptions): Promise<TutorialPath[]>

  // ===== 教程爬虫（v0.6.0）=====
  /** 列出所有可用源（含元信息、license、kind） */
  tutorialListSources(): Promise<TutorialSourceSpec[]>
  /** 启动爬虫（默认抓取所有 enabledByDefault=true 的源） */
  tutorialCrawlStart(args?: { sourceIds?: string[]; force?: boolean }): Promise<{
    success: boolean
    error?: string
    results: CrawlResult[]
  }>
  /** 查询当前抓取状态 */
  tutorialCrawlStatus(): Promise<CrawlStatus>
  /** 取消当前抓取任务 */
  tutorialCrawlCancel(): Promise<{ success: boolean }>

  // ===== Web 部署助手 =====
  /** 列出所有部署模板 */
  deployListTemplates(): Promise<DeployTemplateModel[]>
  /** 按 ID 获取模板 */
  deployGetTemplate(id: string): Promise<DeployTemplateModel | null>
  /** 校验变量（返回错误信息数组，通过返回空数组） */
  deployValidate(templateId: string, values: Record<string, string>): Promise<string[]>
  /** 构建部署计划（返回 { plan, errors }） */
  deployBuild(
    templateId: string,
    values: Record<string, string>,
    targetHost: string
  ): Promise<{ plan?: DeployPlanModel; errors: string[] }>
  /** 执行部署计划（异步，结果通过事件推送） */
  deployExecute(plan: DeployPlanModel, sessionId: string): Promise<DeployResultModel>
  /** 取消正在执行的部署 */
  deployCancel(planId: string): Promise<boolean>
  /** 获取计划状态 */
  deployGetStatus(planId: string): Promise<{ status: string; currentIndex: number; total: number } | null>

  // ===== 服务器列表管理（v0.7.0 双重持久化） =====
  /** 加载服务器列表（敏感信息从 safeStorage 解密） */
  serverList(): Promise<SshConfig[]>
  /** 保存服务器列表（敏感信息加密存储） */
  serverSave(servers: SshConfig[]): Promise<boolean>
  /** 导出服务器列表为 JSON（脱敏，不含密码/私钥） */
  serverExport(): Promise<string>
  /** 导入服务器列表（生成新 ID，敏感信息留空） */
  serverImport(json: string): Promise<SshConfig[]>
  /** 删除服务器凭证 */
  serverDeleteCred(serverId: string): Promise<boolean>

  // ===== 事件监听（主进程 → 渲染进程） =====
  /** 监听终端数据推送，返回取消监听函数 */
  onTerminalData(callback: (sessionId: string, data: string) => void): () => void
  /** 监听监控数据推送（实时指标），返回取消监听函数 */
  onMonitorData(callback: (sessionId: string, data: MonitorData) => void): () => void
  /** 监听系统信息推送（首次采集时推送一次），返回取消监听函数 */
  onMonitorSystemInfo(callback: (sessionId: string, info: SystemInfo) => void): () => void
  /** 监听 LLM 流式 token，返回取消监听函数 */
  onLlmToken(callback: (token: string) => void): () => void
  /**
   * 监听 LLM 流式 token 块推送（增强版，含 totalTokens）
   *
   * P-9 修复：d.ts 补齐（主进程推送 llm:chunk + preload 已暴露，但 d.ts 此前缺失类型声明）
   */
  onLlmChunk(callback: (chunk: LlmStreamChunk) => void): () => void
  /**
   * 监听 LLM 流式完成信号（含完整文本）
   *
   * P-9 修复：d.ts 补齐
   */
  onLlmDone(callback: (fullText: string) => void): () => void
  /**
   * 监听 LLM 流式错误信号（含错误码/消息/是否可重试）
   *
   * P-9 修复：d.ts 补齐
   */
  onLlmError(callback: (error: LlmError) => void): () => void
  /** 监听 Agent 工作流步骤更新，返回取消监听函数 */
  onAgentStep(callback: (state: AgentWorkflowState) => void): () => void
  // v0.9.5 P0 新增：MCP 5 阶段状态机
  mcpGetState(): Promise<McpStateContext>
  mcpReset(): Promise<boolean>
  onMcpStateChanged(callback: (ctx: McpStateContext) => void): () => void

  // v0.9.6 新增：外部 MCP Server（Client 侧）
  /** 获取所有外部 MCP 服务器状态 */
  mcpExternalStatus(): Promise<ExternalMcpServerStatus[]>
  /** 列出所有外部 MCP 工具 */
  mcpExternalTools(): Promise<
    Array<{ name: string; description: string; serverId: string; serverName: string }>
  >
  /** 调用外部 MCP 工具 */
  mcpExternalCall(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{
    success: boolean
    content: Array<{ type: 'text'; text: string }>
    error?: string
  }>
  /** 重连外部 MCP 服务器 */
  mcpExternalReconnect(serverId: string): Promise<boolean>
  /** v0.9 监听 Supervisor 流式 token 块推送 */
  onAgentChunk(callback: (payload: AgentChunkPayload) => void): () => void
  /** v0.9 监听 Supervisor chat 完成信号（含完整结果） */
  onAgentDone(callback: (payload: AgentDonePayload) => void): () => void
  /** v0.9 监听 Supervisor chat 错误信号 */
  onAgentError(callback: (payload: AgentErrorPayload) => void): () => void
  // v0.9 Claude Agent SDK 流式事件（独立于 Supervisor，避免通道混用）
  /** 监听 Claude SDK 流式 token 块推送 */
  onClaudeSdkChunk(callback: (payload: AgentChunkPayload) => void): () => void
  /** 监听 Claude SDK 完成信号（含完整 ChatResult） */
  onClaudeSdkDone(callback: (payload: AgentDonePayload) => void): () => void
  /** 监听 Claude SDK 错误信号 */
  onClaudeSdkError(callback: (payload: AgentErrorPayload) => void): () => void
  /**
   * 监听沙箱命令审批请求（P-2：HC-6 强制审批）
   *
   * 主进程推送 sandbox:approval-request 事件时触发，
   * 渲染进程弹窗显示命令 + 风险等级，用户通过 sandboxApprove(callId, approved) 响应。
   * 30 秒未响应主进程自动拒绝。
   */
  onSandboxApprovalRequest(callback: (request: SandboxApprovalRequest) => void): () => void
  /**
   * 监听 PAOR 审批请求（v0.9.5 新增）
   *
   * PAOR 循环遇到 HIGH/CRITICAL 命令时主进程推送 paor:approval-request 事件，
   * 渲染进程弹窗让用户确认后调用 paorApprove() 响应。60 秒未响应自动拒绝。
   */
  onPaorApprovalRequest(callback: (request: PaorApprovalRequest) => void): () => void
  /** 监听 Web 部署助手实时日志 */
  onDeployLog(callback: (event: DeployLogEventModel) => void): () => void
  /** 监听部署步骤状态变化 */
  onDeployStepUpdate(callback: (payload: { planId: string; step: DeployStepResultModel }) => void): () => void
  /** 监听部署完成事件 */
  onDeployDone(callback: (result: DeployResultModel) => void): () => void

  // ===== LLM Tool Calling（v0.5.0）=====
  /** 带工具调用的对话 */
  llmChatWithTools(messages: ChatMessage[]): Promise<string>
  /** 工具审批响应（high 风险工具） */
  llmToolApprove(response: ToolApprovalResponse): Promise<boolean>
  /** 监听工具调用进度 */
  onLlmToolProgress(callback: (progress: ToolCallProgress) => void): () => void
  /** 监听工具审批请求（弹窗） */
  onLlmToolApproval(callback: (request: ToolApprovalRequest) => void): () => void

  // ===== 教程爬虫事件（v0.6.0）=====
  /** 监听爬虫进度推送 */
  onTutorialCrawlProgress(callback: (progress: CrawlProgress) => void): () => void
  /** 监听爬虫单个源完成 */
  onTutorialCrawlDone(callback: (result: CrawlResult) => void): () => void

  // ===== 日志系统（v0.7.0）=====
  /** 读取日志条目（按条件过滤） */
  logRead(filter?: {
    level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
    category?: string
    categoryPrefix?: string
    keyword?: string
    since?: string
    limit?: number
  }): Promise<Array<{
    ts: string
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
    category: string
    message: string
    meta?: Record<string, unknown>
    correlationId?: string
    source: 'main' | 'renderer'
    date: string
  }>>
  /** 获取日志统计 */
  logStats(): Promise<{
    total: number
    byLevel: Record<string, number>
    byCategory: Record<string, number>
    oldestTs: string | null
    newestTs: string | null
  }>
  /** 清空内存 buffer */
  logClearBuffer(): Promise<boolean>
  /** 设置最低日志级别 */
  logSetMinLevel(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'): Promise<boolean>
  /** 异步刷新待写入日志 */
  logFlush(): Promise<boolean>
  /** 渲染进程日志上报（转发到主进程 logger，统一日志系统） */
  logRenderer(payload: {
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
    category: string
    message: string
    meta?: Record<string, unknown>
    correlationId?: string
  }): Promise<boolean>

  // ===== v0.9.5 P0 新增：5 组缺失 IPC 通道（17 个方法） =====
  // 通道与主进程 ipc/{token-stats,mode,attention,subagent,provider-info}.ts 一一对应
  // 设计依据：v0.9.5 §UI接入接线图（5 组 P0 级缺失 IPC - 4 步同步铁律）

  // ----- 组 1：Token 成本透明（1 个）-----
  /**
   * 获取累计成本统计（USD）
   *
   * 通道：token:cost-stats
   * 返回：CostStats（含 todayCost/weekCost/monthCost/totalCost + bySubagent/byProvider）
   * 用途：Token 监控面板展示累计成本（USD）
   */
  tokenCostStats(): Promise<CostStats>

  // ----- 组 2：Mode 五模式切换（3 个）-----
  /**
   * 列出所有可用 mode 配置（不含 systemPrompt）
   *
   * 通道：mode:list
   * 返回：ModeInfo[]（5 个 mode：chat / ask / plan / code / debug）
   * 用途：UI 模式选择器渲染
   */
  modeList(): Promise<ModeListResponse>
  /**
   * 设置当前默认 mode
   *
   * 通道：mode:set-default
   * @param request { mode: AgentMode }
   * @returns { success, previousMode, currentMode }（非法 mode 返回 success=false）
   */
  modeSetDefault(request: ModeSetDefaultRequest): Promise<ModeSetDefaultResponse>
  /**
   * 返回当前默认 mode
   *
   * 通道：mode:get-current
   * @returns { mode, displayName }（便于 UI 直接渲染）
   */
  modeGetCurrent(): Promise<ModeCurrentResponse>

  // ----- 组 3：Attention 注意力跟踪（7 个）-----
  /**
   * 获取当前 attention（始终非 null，since 字段必有）
   *
   * 通道：attention:current
   * 用途：UI 高亮显示当前关注的文件 / 命令 / 错误 / 关键词
   */
  attentionCurrent(): Promise<AttentionFocus>
  /**
   * 获取历史 attention 列表（按时间顺序，最早在前）
   *
   * 通道：attention:history
   * 用途：UI 展示历史 attention 快照（如时间轴 / 历史列表）
   */
  attentionHistory(): Promise<AttentionFocus[]>
  /**
   * 跟踪关注的文件
   *
   * 通道：attention:track-files
   * @param files 文件路径列表
   * @returns true 表示跟踪成功
   */
  attentionTrackFiles(files: string[]): Promise<boolean>
  /**
   * 跟踪关注的命令
   *
   * 通道：attention:track-commands
   * @param commands 命令列表
   * @returns true 表示跟踪成功
   */
  attentionTrackCommands(commands: string[]): Promise<boolean>
  /**
   * 跟踪关注的错误
   *
   * 通道：attention:track-errors
   * @param errors 错误信息列表
   * @returns true 表示跟踪成功
   */
  attentionTrackErrors(errors: string[]): Promise<boolean>
  /**
   * 跟踪关注的搜索关键词
   *
   * 通道：attention:track-keywords
   * @param keywords 关键词列表
   * @returns true 表示跟踪成功
   */
  attentionTrackKeywords(keywords: string[]): Promise<boolean>
  /**
   * 重置当前 attention（归档到 history）
   *
   * 通道：attention:reset
   * @returns true 表示重置成功
   */
  attentionReset(): Promise<boolean>

  // ----- 组 4：Subagent 自定义 Agent 加载器（2 个）-----
  /**
   * 加载所有自定义 agent 配置
   *
   * 通道：subagent:list
   * @returns CustomAgentConfig[]（目录不存在返回空数组，不抛错）
   */
  subagentList(): Promise<CustomAgentConfig[]>
  /**
   * 重新加载指定 agent 或全部重载
   *
   * 通道：subagent:reload
   * @param request { filePath?: string }（不传则重载整个 .tdsf/agent/ 目录）
   * @returns { success, reloaded, failed }（即使部分失败也返回 success=true）
   */
  subagentReload(request?: SubagentReloadRequest): Promise<SubagentReloadResponse>

  // ----- 组 5：Provider Info 能力 + 定价透明（4 个）-----
  /**
   * 查询指定 provider 的能力声明
   *
   * 通道：provider:capabilities
   * @param request { providerId: string }
   * @returns ProviderCapabilities | null（Provider 不存在时返回 null）
   */
  providerCapabilities(request: ProviderCapabilitiesRequest): Promise<ProviderCapabilitiesResponse>
  /**
   * 查询所有 provider 类型的能力声明默认表
   *
   * 通道：provider:capabilities-all
   * @returns Record<string, ProviderCapabilities>（按 ProviderType 索引）
   */
  providerCapabilitiesAll(): Promise<ProviderCapabilitiesAllResponse>
  /**
   * 查询指定 provider 的定价表
   *
   * 通道：provider:pricing
   * @param request { providerId: string }
   * @returns ModelPricing | null（Provider 不存在时返回 null）
   */
  providerPricing(request: ProviderPricingRequest): Promise<ProviderPricingResponse>
  /**
   * 查询所有 provider 类型的定价表默认表
   *
   * 通道：provider:pricing-all
   * @returns Record<string, ModelPricing>（按 ProviderType 索引）
   */
  providerPricingAll(): Promise<ProviderPricingAllResponse>

  // ===== v1.0 新增：Sidecar-A 进程管理 + 端到端 Pipeline =====
  // 通道与主进程 ipc/sidecar.ts 一一对应
  // 设计参考：v1.0 工业级方案集成（OpenDerisk + Drain3 + Python Sidecar 多进程隔离）
  // 方案书：idea-to-dev-output/36-约束审计-质量优先升级方案.md
  /**
   * 启动 Sidecar-A 进程（SRE + 日志解析 Python 子进程）
   * 通道：sidecar:start
   * @returns { ok, status: 'ready'|'starting'|'crashed', error? }
   */
  sidecarStart(): Promise<{ ok: boolean; status: string; error?: string }>
  /**
   * 停止 Sidecar-A 进程
   * 通道：sidecar:stop
   */
  sidecarStop(): Promise<{ ok: boolean }>
  /**
   * 获取 Sidecar 当前状态
   * 通道：sidecar:status
   * @returns { status: 'stopped'|'starting'|'ready'|'degraded'|'crashed', lastError?, restartCount }
   */
  sidecarStatus(): Promise<{
    status: 'stopped' | 'starting' | 'ready' | 'degraded' | 'crashed'
    lastError: string | null
    restartCount: number
  }>
  /**
   * 主动健康检查（调用 Sidecar-A /health 端点）
   * 通道：sidecar:health
   */
  sidecarHealth(): Promise<{
    ok: boolean
    error?: string
    status?: string
    version?: string
    adapters?: {
      drain3: { ready: boolean; total_clusters: number }
      open_derisk: { ready: boolean; mode: string; rules_count: number }
    }
    uptime_seconds?: number
  }>
  /**
   * 端到端 Pipeline（v1.0 核心，v1.5 增强）：日志输入 → Drain3 解析 → OpenDerisk 诊断
   * 通道：sidecar:pipeline
   *
   * 使用场景：
   * - ChatPanel 顶部"🔍 SRE 诊断"按钮 → 弹窗输入日志 → 调此函数 → 展示诊断结果
   * - 用户粘贴服务异常日志 → 1 次调用拿到结构化诊断（根因 + 置信度 + 严重度 + 建议）
   *
   * @param logLines 原始日志行列表
   * @param serviceName 服务名（可选，辅助诊断）
   * @param llmConfig v1.5 新增：LLM 配置（启用 LLM 增强诊断）
   */
  sidecarPipeline(
    logLines: string[],
    serviceName?: string,
    llmConfig?: { apiKey: string; baseUrl: string; model: string },
  ): Promise<
    | {
        ok: true
        data: {
          /** Drain3 解析结果 */
          parse: {
            templates: Array<{
              template_id: string
              template: string
              count: number
              examples: string[]
            }>
            total_lines: number
            unique_templates: number
          }
          /** OpenDerisk 诊断结果 */
          diagnose: {
            root_cause: string
            confidence: number
            severity: 'critical' | 'high' | 'medium' | 'low'
            recommendations: string[]
            reasoning: string[]
            source: string
            // v1.5 新增字段
            related_risks?: string[]
            rule_confidence?: number | null
            llm_confidence?: number | null
          }
        }
      }
    | { ok: false; error: string }
  >

  // ===== v1.5 新增：多 Sidecar 状态管理（A/B/C 三 Sidecar 架构）=====
  /**
   * 单个 Sidecar 状态项（v1.5）
   * - id: sre / analytics / agent
   * - name: 中文显示名
   * - port: 监听端口（19000/19001/19002）
   * - status: 状态（stopped/starting/ready/degraded/crashed）
   * - lastError: 最近一次错误（crashed 时显示）
   */
  sidecarListStatus(): Promise<{
    ok: boolean
    data?: Record<
      string,
      {
        id: 'sre' | 'analytics' | 'agent'
        name: string
        port: number
        status: 'stopped' | 'starting' | 'ready' | 'degraded' | 'crashed'
        lastError: string | null
      }
    >
    error?: string
  }>
  /**
   * 启动指定 Sidecar（v1.5 懒启动：Sidecar-B/C 首次调用时启动）
   * 通道：sidecar:start-one
   * @param sidecarId 'sre' | 'analytics' | 'agent'
   */
  sidecarStartOne(
    sidecarId: 'sre' | 'analytics' | 'agent',
  ): Promise<{ ok: boolean; status: string; error?: string }>
  /**
   * 停止指定 Sidecar（v1.5）
   * 通道：sidecar:stop-one
   */
  sidecarStopOne(
    sidecarId: 'sre' | 'analytics' | 'agent',
  ): Promise<{ ok: boolean }>
  /**
   * 单个 Sidecar 健康检查（v1.5）
   * 通道：sidecar:health-one
   */
  sidecarHealthOne(
    sidecarId: 'sre' | 'analytics' | 'agent',
  ): Promise<{
    ok: boolean
    error?: string
    status?: string
    version?: string
    adapters?: Record<string, { ready: boolean; note?: string }>
    uptime_seconds?: number
  }>
  /**
   * 通用 Sidecar 工具调用（v1.5 多 Sidecar 架构）
   * 用于 Sidecar-B/C 的占位端点（dowhy/phoenix/smolagents/agentscope）
   * 通道：sidecar:tool-call
   *
   * @example
   * window.electronAPI.sidecarToolCall('analytics', '/analytics/dowhy', { treatment, outcome, confounders })
   */
  sidecarToolCall(
    sidecarId: 'sre' | 'analytics' | 'agent',
    endpoint: string,
    payload?: unknown,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }>
  /**
   * 单独调用 Drain3 日志解析（不调 OpenDerisk，v1.5）
   * 通道：sidecar:parse-logs
   */
  sidecarParseLogs(
    logLines: string[],
    maxClusters?: number,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }>

  // ===== v0.9.6 Sprint 9：学习路径推荐 =====
  // 通道与主进程 ipc/tutorial.ts 一一对应：
  // - tutorial:recommend-path → tutorialRecommendPath（4 层融合路径推荐）
  /**
   * 推荐学习路径（4 层融合：分类依赖 + 难度递进 + 命令关联 + 混合检索）
   *
   * @param options.goal 学习目标（自然语言，如"想学 Docker"）
   * @param options.currentLevel 当前水平（如 beginner / intermediate / advanced）
   * @param options.preferredCategory 偏好分类（如 networking）
   * @param options.maxSteps 最大步骤数（默认 8）
   * @returns TutorialPath[]（按融合分数排序的学习路径）
   */
  tutorialRecommendPath(options?: RecommendPathOptions): Promise<TutorialPath[]>

  // ===== v1.5 循环工程子 Agent（loop:* 通道）=====
  /** 启动循环工程（假设生成 + 7步HITL工作流） */
  loopStart(input: {
    problem: string
    connId: string
    providerId?: string
    strength?: 'fast' | 'standard' | 'deep'
  }): Promise<{ correlationId: string; status: string; error?: string }>

  /** 人工确认（批准/拒绝） */
  loopConfirm(correlationId: string, approved: boolean): Promise<boolean>

  /** 取消工作流 */
  loopCancel(correlationId: string): Promise<boolean>

  /** 监听 loop:llm-start — LLM 推理开始 */
  onLoopLlmStart(
    callback: (payload: { type: 'loop:llm-start'; correlationId: string; problem: string }) => void,
  ): () => void

  /** 监听 loop:llm-done — LLM 推理完成 */
  onLoopLlmDone(
    callback: (payload: {
      type: 'loop:llm-done'
      correlationId: string
      hypothesis: { hypothesis: string; fixCommand: string; confidence: number }
    }) => void,
  ): () => void

  /** 监听 loop:step — 7步HITL步骤变化 */
  onLoopStep(
    callback: (payload: {
      type: 'loop:step'
      correlationId: string
      state: {
        currentStep: 'collect' | 'analyze' | 'reason' | 'check' | 'confirm' | 'execute' | 'verify'
        completedSteps: string[]
        stepDetails: Record<string, string>
        waitingForConfirmation: boolean
        decisionCard: unknown | null
        error: string | null
        timestamp: number
      }
    }) => void,
  ): () => void

  /** 监听 loop:decision — 决策卡片就绪 */
  onLoopDecision(
    callback: (payload: {
      type: 'loop:decision'
      correlationId: string
      state: unknown
      decisionCard: unknown
    }) => void,
  ): () => void

  /** 监听 loop:done — 工作流完成 */
  onLoopDone(
    callback: (payload: {
      type: 'loop:done'
      correlationId: string
      decisionCard: unknown
    }) => void,
  ): () => void

  /** 监听 loop:error — 工作流错误 */
  onLoopError(
    callback: (payload: {
      type: 'loop:error'
      correlationId: string
      error: string
    }) => void,
  ): () => void
}

/** 扩展 Window 接口，声明 electronAPI 全局变量 */
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
