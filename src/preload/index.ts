/**
 * Preload 安全桥接
 *
 * 使用 contextBridge.exposeInMainWorld 把受限的 IPC 接口暴露给渲染进程。
 *
 * 安全原则：
 * 1. 不暴露 raw ipcRenderer（渲染进程无法任意发送 IPC 请求）
 * 2. 仅暴露预定义的通道白名单
 * 3. 事件监听返回取消函数，便于 React useEffect 清理
 *
 * 暴露的 API 结构（window.electronAPI）：
 * - ssh: SSH 连接管理（connect/disconnect/exec/shell.*）
 * - sftp: SFTP 文件操作（list/upload/download/delete/rename/chmod）
 * - monitor: 服务器监控（start/stop/getSystemInfo）
 * - storage: API Key 加密存储（saveApiKey/getApiKey/deleteApiKey）
 * - config: 配置存储（get/set）
 * - on: 事件监听（terminalData/monitorData/llmToken/agentStep）
 *
 * 通道列表与 IpcChannelMap 一一对应。
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import {
  SSH,
  STORAGE,
  CONFIG,
  SERVER,
  MONITOR,
  LLM,
  LLM_INLINE,
  MCP,
  SANDBOX,
  AT_COMMANDS,
  TOKEN,
  SFTP_SEARCH,
  FILE_WATCH,
} from '@shared/ipc-channels'
import type {
  SshConfig,
  CommandResult,
  SftpEntry,
  SystemInfo,
  MonitorData,
  AgentWorkflowState,
  ChatMessage,
  LlmConfig,
  LlmValidationResult,
  EnvironmentContext,
  LlmStreamChunk,
  LlmError,
  ProfilerRunResponse,
  DecisionCard,
  ExternalMcpServerStatus,
  // K.2 心跳保活状态变更事件载荷
  SshStateEvent,
  // Phase L 主机密钥校验弹窗事件载荷
  SshHostKeyPromptEvent,
  SshHostKeyResponseAction,
  // Phase M SSH 密钥管理共享类型
  SshKeyPair,
  GenerateKeyPairRequest,
  GenerateKeyPairResponse,
} from '@shared/models'
import type {
  TutorialEntry,
  TutorialCategory,
  TutorialCategorySummary,
  TutorialDifficulty
} from '@shared/tutorial-types'
import type {
  DeployTemplate as DeployTemplateModel,
  DeployPlan as DeployPlanModel,
  DeployResult as DeployResultModel,
  DeployLogEvent as DeployLogEventModel,
  DeployStepResult as DeployStepResultModel
} from '@shared/deploy-types'
import type {
  ToolCallProgress,
  ToolApprovalRequest,
  ToolApprovalResponse,
} from '@shared/llm-tool-types'
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
  // v0.9 可信度算法共享类型（D-S + PCR5 + 6 源证据 + DAG 可视化）
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
  // v0.9 Claude Agent SDK 共享类型（claude-sdk:generate / stream / cancel）
  ChatResult,
  ClaudeSdkChatParams,
  // v0.9.4 IPC 协议优化（sessionId + abort signal + protocolVersion + ping/pong）
  SystemPingResponse,
  // v0.9.5 P0 新增：5 组缺失 IPC 通道共享类型
  // 组 1：token:cost-stats（成本透明）
  CostStats,
  // 组 2：mode:list / mode:set-default / mode:get-current（五模式切换）
  ModeListResponse,
  ModeSetDefaultRequest,
  ModeSetDefaultResponse,
  ModeCurrentResponse,
  // 组 3：attention:* 7 通道（注意力跟踪）
  AttentionFocus,
  // 组 4：subagent:list / subagent:reload（自定义 Agent 加载器）
  CustomAgentConfig,
  SubagentReloadRequest,
  SubagentReloadResponse,
  // 组 5：provider:capabilities* / provider:pricing* 4 通道（Provider 能力 + 定价透明）
  ProviderCapabilitiesRequest,
  ProviderCapabilitiesResponse,
  ProviderCapabilitiesAllResponse,
  ProviderPricingRequest,
  ProviderPricingResponse,
  ProviderPricingAllResponse,
  // v0.9.4 批次 4 - 任务 5 P2-E：预期回显监控共享类型（expectation:check / format）
  CommandExpectation,
  ExpectationCheckResult,
  ExpectationViolation,
} from '@shared/agent-types'
// v0.9.5 P0 新增：MCP 5 阶段状态机共享类型（来自 @shared/models）
import type { McpStateContext } from '@shared/models'
// v0.9.4 IPC 协议版本号（同步常量，无需 IPC 调用，preload/renderer 直接 import）
import { IPC_PROTOCOL_VERSION } from '@shared/agent-types'
// v0.9.6 P2：EU AI Act 审计报告类型（type-only import，不引入运行时依赖）
import type {
  AuditFormat,
  AuditReportInput,
  ComplianceAuditReport,
} from '../main/core/agent/credibility/audit/types'
import type {
  ExportOptions,
  ExportResult,
  AuditReportListItem,
} from '../main/core/agent/credibility/audit/exporter'
// v0.9 @命令共享类型（8 类 @命令：log/cmd/file/metric/decision/kb/skill/server）
import type {
  AtCommand,
  AtCommandParseResult,
  AtCommandSource,
  AtCommandType,
} from '@shared/at-command-types'
// Phase 6 Task 6.5：调度器共享类型 + IPC 通道常量
import type { SchedulerTaskStatus, TaskResult } from '@shared/scheduler-types'
import { SCHEDULER } from '@shared/ipc-channels'

// ============================================================================
// v0.9.6 Sprint 7 任务 E：混合检索结果类型（内联定义，与 main/services/tutorial/hybrid-search.ts 保持一致）
// ============================================================================
// 注意：这里不直接从主进程导入（preload 不能依赖主进程模块），
//      也不放到 @shared/hybrid-search-types.ts（避免新增 shared 文件）。
//      类型结构与主进程 HybridSearchResult 接口保持一致。

/**
 * 混合检索单条结果
 *
 * 同时包含原始分数和融合分数，便于 UI 展示和调试：
 *   - ftsScore：BM25 原始分（负值，越小越相关；未参与 FTS 时为 0）
 *   - vecDistance：余弦距离（0-2，越小越相关；未参与 vec 时为 -1）
 *   - rrfScore：RRF 融合分（越大越相关，最终排序依据）
 *   - source：标记该条目由哪一路召回（fts / vec / both）
 */
interface HybridSearchResult {
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
interface TutorialHybridSearchOptions {
  /** 知识类型过滤（默认 'tutorial'） */
  type?: 'tutorial' | 'command_skill' | 'incident_case'
  /** 返回数量上限（默认 10） */
  limit?: number
  /** 是否启用向量检索（默认 true） */
  useVector?: boolean
}

/** tutorial:backfill-embeddings 通道的 options 参数 */
interface TutorialBackfillOptions {
  /** 每批大小（默认 8） */
  batchSize?: number
}

/** tutorial:backfill-embeddings 通道的返回值 */
interface TutorialBackfillResult {
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
interface TutorialSearchStatus {
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
// v0.9.6 Sprint 9 任务：学习路径推荐类型（内联定义，与主进程 path-recommender.ts 保持一致）
// ============================================================================
// 注意：这里不直接从主进程导入（preload 不能依赖主进程模块），
//      也不放到 @shared/path-recommender-types.ts（避免新增 shared 文件）。
//      类型结构与主进程保持一致。

/** 学习路径步骤 */
interface PathStep {
  /** 步骤序号（从 1 开始） */
  order: number
  /** 教程 ID */
  tutorialId: string
  /** 教程标题 */
  title: string
  /** 分类 */
  category: TutorialCategory
  /** 难度 */
  difficulty: TutorialDifficulty
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
interface TutorialPath {
  /** 路径 ID（生成） */
  id: string
  /** 路径名称 */
  name: string
  /** 路径描述 */
  description: string
  /** 目标分类 */
  targetCategory: TutorialCategory
  /** 目标难度 */
  targetDifficulty: TutorialDifficulty
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
interface RecommendPathOptions {
  /** 学习目标（自然语言，如"想学 Docker"） */
  goal?: string
  /** 当前水平（如 beginner / intermediate / advanced） */
  currentLevel?: TutorialDifficulty
  /** 偏好分类（如 networking） */
  preferredCategory?: TutorialCategory
  /** 最大步骤数（默认 8） */
  maxSteps?: number
}

// ============================================================================
// v0.9 Sandbox 类型（内联定义，与主进程 services/sandbox/types.ts 结构一致）
// ============================================================================
// 注意：这里不直接从主进程导入（preload 不能依赖主进程模块），
//      也不放到 @shared/sandbox-types.ts（避免新增 shared 文件）。
//      类型结构与主进程保持一致，字段命名 snake_case 与 OpenHands API 对齐。

/** 沙箱运行状态 */
type SandboxStatus = 'STARTING' | 'RUNNING' | 'PAUSED' | 'ERROR' | 'MISSING'

/** 沙箱内服务暴露 URL */
interface SandboxExposedUrl {
  name: string
  url: string
  port: number
}

/** 沙箱信息（与 OpenHands SandboxInfo 模型对应） */
interface SandboxInfo {
  id: string
  created_by_user_id: string | null
  sandbox_spec_id: string
  status: SandboxStatus
  session_api_key: string | null
  exposed_urls: SandboxExposedUrl[] | null
  created_at: string
}

/** 沙箱分页响应 */
interface SandboxPage {
  items: SandboxInfo[]
  next_page_id: string | null
}

/** 沙箱内命令执行结果 */
interface SandboxCommandResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs?: number
}

/** Docker 检测结果 */
interface DockerInfo {
  installed: boolean
  version: string | null
  running: boolean
  error?: string
}

/** 沙箱集成健康状态 */
interface SandboxHealthStatus {
  dockerReady: boolean
  dockerVersion: string | null
  openhandsRunning: boolean
  error?: string
}

/** 沙箱 IPC 失败响应（与主进程 ErrorResponse 对应） */
interface SandboxErrorResponse {
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
type SandboxCommandRiskLevel = 'low' | 'medium' | 'high'

/**
 * 沙箱命令审批请求载荷（主进程推送 sandbox:approval-request 事件）
 *
 * P-2 HC-6 强制审批：sandbox:execute 调用时主进程会推送此事件，
 * 渲染进程弹窗显示命令 + 风险等级，用户通过 sandboxApprove(callId, approved) 响应。
 */
interface SandboxApprovalRequest {
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
 * PAOR 审批请求载荷（v0.9.5 新增）
 *
 * PAOR 循环中遇到 HIGH/CRITICAL 风险命令时主进程推送 paor:approval-request 事件，
 * 渲染进程弹窗显示命令 + 风险等级，用户通过 paorApprove(callId, approved) 响应。
 *
 * 注意：60 秒未响应主进程会自动拒绝。
 */
interface PaorApprovalRequest {
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
// v0.9 @命令元信息类型（与主进程 ipc/at-commands.ts 的 AtCommandInfo 对应）
// ============================================================================

/** @命令元信息（at:list 返回的单项，UI 选择器渲染用） */
interface AtCommandInfo {
  /** 命令类型（8 类之一） */
  type: AtCommandType
  /** 中文展示标签 */
  label: string
  /** Ant Design 图标名 */
  icon: string
  /** 命令描述 */
  description: string
}

// ============================================================================
// invoke 通道封装（渲染 → 主，请求-响应）
// ============================================================================

/**
 * SSH 相关 invoke 调用
 */
const ssh = {
  /** 建立 SSH 连接，返回 sessionId */
  connect: (config: SshConfig): Promise<string> =>
    ipcRenderer.invoke(SSH.CONNECT, config),

  /** 断开 SSH 连接 */
  disconnect: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(SSH.DISCONNECT, sessionId),

  /** 执行 SSH 命令 */
  exec: (sessionId: string, command: string): Promise<CommandResult> =>
    ipcRenderer.invoke('ssh:exec', sessionId, command),

  /** 交互式 Shell 操作 */
  shell: {
    /** 启动交互式 shell */
    start: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke(SSH.SHELL_START, sessionId),

    /** 向 shell 写入数据 */
    write: (sessionId: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke('ssh:shell:write', sessionId, data),

    /** 调整 shell 终端窗口大小 */
    resize: (sessionId: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke('ssh:shell:resize', sessionId, cols, rows),
  },

  /**
   * 响应主机密钥确认弹窗（Phase L）
   *
   * 渲染进程收到 onSshHostKeyPrompt 事件后，弹窗等待用户选择，
   * 然后调用此方法将用户选择发送回主进程，恢复 SSH 握手。
   *
   * @param requestId 关联请求 ID（来自 SshHostKeyPromptEvent.requestId）
   * @param action 用户选择的动作
   */
  respondHostKey: (
    requestId: string,
    action: SshHostKeyResponseAction,
  ): Promise<boolean> => ipcRenderer.invoke(SSH.HOST_KEY_RESPONSE, { requestId, action }),

  // ========================================================================
  // Phase M：SSH 密钥管理（删除 / 上传 / 生成 / 列表）
  // ========================================================================
  // 通道与主进程 ipc/ssh.ts 一一对应：
  // - ssh:delete-keypair   → deleteKeyring（幂等删除 ~/.ssh/<keyName> + .pub）
  // - ssh:upload-keypair   → uploadKeypair（文件对话框 + 复制 + chmod 600 + derive 公钥）
  // - ssh:generate-keypair → generateKeypair（ssh-keygen 生成 ed25519/rsa 密钥对）
  // - ssh:list-keypairs    → listKeypairs（扫描 ~/.ssh/ 列出所有密钥对）
  //
  // 安全说明：
  // - 所有文件 I/O 在主进程执行，渲染进程不直接访问文件系统
  // - 私钥权限 600（owner rw only），公钥 644（owner rw / others r）
  // - 删除操作幂等：删除不存在的密钥返回 success=true，不抛错
  // ========================================================================

  /**
   * 删除 SSH 密钥对（Phase M）
   *
   * 幂等：删除不存在的密钥返回 success=true，不抛错。
   *
   * @param keyName 密钥名称（如 id_ed25519），不含路径
   * @returns { success: boolean, error?: string }
   */
  deleteKeyring: (
    keyName: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(SSH.DELETE_KEYPAIR, keyName),

  /**
   * 上传 SSH 私钥到 ~/.ssh/（Phase M）
   *
   * 流程：
   * 1. 主进程弹出文件选择对话框
   * 2. 用户选择私钥文件后复制到 ~/.ssh/<filename>
   * 3. chmod 600 设置私钥权限
   * 4. ssh-keygen -y derive 公钥，写入 .pub，chmod 644
   *
   * 用户取消选择时返回 { success: false, canceled: true }，UI 应静默处理。
   *
   * @returns { success, keyPair?, error?, canceled? }
   */
  uploadKeypair: (): Promise<{
    success: boolean
    keyPair?: SshKeyPair
    error?: string
    canceled?: boolean
  }> => ipcRenderer.invoke(SSH.UPLOAD_KEYPAIR),

  /**
   * 生成 SSH 密钥对（Phase M）
   *
   * 调用 ssh-keygen 生成 ed25519（默认）或 rsa（4096 位）密钥对，
   * 输出到 ~/.ssh/<name>。私钥权限 600，公钥 644。
   *
   * @param request { type, name, passphrase?, comment? }
   * @returns GenerateKeyPairResponse（成功含 keyPair，失败含 error）
   */
  generateKeypair: (
    request: GenerateKeyPairRequest,
  ): Promise<GenerateKeyPairResponse> =>
    ipcRenderer.invoke(SSH.GENERATE_KEYPAIR, request),

  /**
   * 列出 ~/.ssh/ 目录下所有密钥对（Phase M）
   *
   * 扫描 ~/.ssh/ 目录，排除 .pub / known_hosts / config / authorized_keys /
   * 备份文件 / 隐藏文件，返回 SshKeyPair[]。
   *
   * @returns SshKeyPair[]（空目录返回空数组，不抛错）
   */
  listKeypairs: (): Promise<SshKeyPair[]> =>
    ipcRenderer.invoke(SSH.LIST_KEYPAIRS),
}

/**
 * SFTP 文件操作 invoke 调用
 */
const sftp = {
  /** 列出远程目录 */
  list: (sessionId: string, remotePath: string): Promise<SftpEntry[]> =>
    ipcRenderer.invoke('sftp:list', sessionId, remotePath),

  /** 上传文件 */
  upload: (
    sessionId: string,
    localPath: string,
    remotePath: string
  ): Promise<boolean> =>
    ipcRenderer.invoke('sftp:upload', sessionId, localPath, remotePath),

  /** 下载文件 */
  download: (
    sessionId: string,
    remotePath: string,
    localPath: string
  ): Promise<boolean> =>
    ipcRenderer.invoke('sftp:download', sessionId, remotePath, localPath),

  /** 删除文件/目录 */
  delete: (sessionId: string, remotePath: string): Promise<boolean> =>
    ipcRenderer.invoke('sftp:delete', sessionId, remotePath),

  /** 重命名 */
  rename: (
    sessionId: string,
    oldPath: string,
    newPath: string
  ): Promise<boolean> =>
    ipcRenderer.invoke('sftp:rename', sessionId, oldPath, newPath),

  /** 修改权限 */
  chmod: (
    sessionId: string,
    remotePath: string,
    mode: number
  ): Promise<boolean> =>
    ipcRenderer.invoke('sftp:chmod', sessionId, remotePath, mode),

  /** 读取远程文件内容到字符串（v0.8 IDE 工作台，10MB 上限） */
  readFile: (sessionId: string, remotePath: string): Promise<string> =>
    ipcRenderer.invoke('sftp:readFile', sessionId, remotePath),

  /** 写入字符串到远程文件（v0.8 IDE 工作台，覆盖原文件） */
  writeFile: (
    sessionId: string,
    remotePath: string,
    content: string
  ): Promise<boolean> =>
    ipcRenderer.invoke('sftp:writeFile', sessionId, remotePath, content),

  /** 获取文件/目录元信息（返回 SftpEntry 或 null） */
  stat: (sessionId: string, remotePath: string): Promise<SftpEntry | null> =>
    ipcRenderer.invoke('sftp:stat', sessionId, remotePath),

  /** 创建远程目录 */
  mkdir: (sessionId: string, remotePath: string): Promise<boolean> =>
    ipcRenderer.invoke('sftp:mkdir', sessionId, remotePath),
}

/**
 * 服务器监控 invoke 调用
 */
const monitor = {
  /** 启动监控 */
  start: (sessionId: string, interval: number): Promise<boolean> =>
    ipcRenderer.invoke('monitor:start', sessionId, interval),

  /** 停止监控 */
  stop: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(MONITOR.STOP, sessionId),

  /** 获取系统静态信息 */
  getSystemInfo: (sessionId: string): Promise<SystemInfo> =>
    ipcRenderer.invoke('monitor:getSystemInfo', sessionId),
}

/**
 * 安全存储 invoke 调用
 */
const storage = {
  /** 加密保存 API Key */
  saveApiKey: (provider: string, key: string): Promise<boolean> =>
    ipcRenderer.invoke('storage:saveApiKey', provider, key),

  /** 读取并解密 API Key */
  getApiKey: (provider: string): Promise<string | null> =>
    ipcRenderer.invoke(STORAGE.GET_API_KEY, provider),

  /** 删除 API Key */
  deleteApiKey: (provider: string): Promise<boolean> =>
    ipcRenderer.invoke(STORAGE.DELETE_API_KEY, provider),
}

/**
 * 配置存储 invoke 调用
 */
const config = {
  /** 读取配置 */
  get: (key: string): Promise<unknown> =>
    ipcRenderer.invoke(CONFIG.GET, key),

  /** 写入配置 */
  set: (key: string, value: unknown): Promise<boolean> =>
    ipcRenderer.invoke('config:set', key, value),
}

/**
 * LLM 相关 invoke 调用
 */
const llm = {
  /** 普通对话（流式推送 token，返回完整文本） */
  chat: (messages: ChatMessage[]): Promise<string> =>
    ipcRenderer.invoke('llm:chat', messages),

  /** 测试连接 */
  test: (config: LlmConfig): Promise<boolean> =>
    ipcRenderer.invoke(LLM.TEST, config),

  /** 分析问题（内置降级，返回 JSON 字符串） */
  analyze: (problem: string, evidences: unknown[]): Promise<string> =>
    ipcRenderer.invoke('llm:analyze', problem, evidences),

  /** 校验 LLM 配置是否有效（不发起网络请求） */
  validate: (config: LlmConfig): Promise<LlmValidationResult> =>
    ipcRenderer.invoke('llm:validate', config),

  /** 带系统环境上下文的对话 */
  chatWithContext: (messages: ChatMessage[], envCtx: EnvironmentContext): Promise<string> =>
    ipcRenderer.invoke('llm:chat-with-context', messages, envCtx),
}

/**
 * 服务器列表管理 invoke 调用
 */
const server = {
  /** 加载服务器列表（敏感信息从 safeStorage 解密） */
  list: (): Promise<SshConfig[]> =>
    ipcRenderer.invoke('server:list'),

  /** 保存服务器列表（敏感信息加密存储） */
  save: (servers: SshConfig[]): Promise<boolean> =>
    ipcRenderer.invoke('server:save', servers),

  /** 导出服务器列表为 JSON（脱敏，不含密码/私钥） */
  export: (): Promise<string> =>
    ipcRenderer.invoke('server:export'),

  /** 导入服务器列表（生成新 ID，敏感信息留空） */
  import: (json: string): Promise<SshConfig[]> =>
    ipcRenderer.invoke(SERVER.IMPORT, json),

  /** 删除服务器凭证 */
  deleteCred: (serverId: string): Promise<boolean> =>
    ipcRenderer.invoke('server:delete-cred', serverId),
}

/**
 * 系统架构感知 invoke 调用
 */
const profiler = {
  /** 执行系统架构感知（27 项探查 + 风险检测 + md 渲染） */
  run: (sessionId: string, host: string): Promise<ProfilerRunResponse> =>
    ipcRenderer.invoke('profiler:run', sessionId, host),

  /** 导出 md 文件 */
  exportMd: (md: string, outputPath: string): Promise<{ filePath: string; size: number }> =>
    ipcRenderer.invoke('profiler:exportMd', md, outputPath),

  /** 导出 PDF 文件 */
  exportPdf: (md: string, outputPath: string): Promise<{ filePath: string; size: number }> =>
    ipcRenderer.invoke('profiler:exportPdf', md, outputPath),

  /** 生成默认文件名 */
  defaultFileName: (host: string, ext: 'md' | 'pdf'): Promise<string> =>
    ipcRenderer.invoke('profiler:defaultFileName', host, ext),
}

/**
 * v0.9 Agent Runtime invoke 调用（Supervisor chat + 取消请求）
 */
const agentRuntime = {
  /**
   * 启动 Supervisor 流式 chat
   *
   * 异步执行，立即返回 correlationId。
   * 渲染进程通过 onAgentChunk/onAgentDone/onAgentError 监听后续事件。
   *
   * v0.9.4 新增：流式事件载荷携带 sessionId（可选，未传时主进程自动生成）
   *
   * @param messages 对话消息列表
   * @param providerId Provider ID（可选，不传用默认）
   * @param strength 思考强度（fast/standard/deep，可选）
   * @returns correlationId（用于监听事件 + 取消请求）
   */
  chat: (
    messages: ChatMessage[],
    providerId?: string,
    strength?: ThinkingStrength,
    sshSessionId?: string,
  ): Promise<string> =>
    // 第 4 参 agentSession 留空由主进程生成；第 5 参为 SSH session（启用只读工具）
    ipcRenderer.invoke('agent:chat', messages, providerId, strength, undefined, sshSessionId),

  /**
   * 取消进行中的 chat 请求
   *
   * v0.9.4 改造：主进程 handler 已兼容 sessionId 与 correlationId 两种 ID
   * （先按 sessionId 查找 session-registry，回退到 correlationId）。
   * 调用方可传入任一种 ID，均可成功取消。
   *
   * @param sessionIdOrCorrelationId 会话 ID 或关联 ID
   * @returns 是否成功取消（false 表示请求已结束或不存在）
   */
  cancel: (sessionIdOrCorrelationId: string): Promise<boolean> =>
    ipcRenderer.invoke('agent:chat:cancel', sessionIdOrCorrelationId),

  /**
   * PAOR 自动循环（Plan→Act→Observe→Reflect 多步自主编排）
   *
   * 方案书 v0.9 §3.2：对多步运维任务自动规划并逐步执行，
   * 每轮迭代通过 agent:paor:iteration 事件实时推送到渲染进程。
   * 高危命令自动拦截（安全默认策略）。
   *
   * @param task 运维任务描述
   * @param sshSessionId SSH 会话 ID
   * @param maxIterations 最大迭代次数（默认 5）
   * @returns PAOR 循环完整结果（含可审计的迭代轨迹）
   */
  paor: (task: string, sshSessionId: string, maxIterations?: number): Promise<unknown> =>
    ipcRenderer.invoke('agent:paor', task, sshSessionId, maxIterations),

  /**
   * 响应 PAOR 审批请求（v0.9.5 新增）
   *
   * 主进程推送 paor:approval-request 事件后，
   * 渲染进程弹窗让用户确认，通过本函数回传审批结果。
   *
   * @param callId 审批调用 ID（来自 paor:approval-request 事件载荷）
   * @param approved 是否批准执行
   */
  approve: (callId: string, approved: boolean): Promise<boolean> =>
    ipcRenderer.invoke('paor:approve', callId, approved),
}

/**
 * v0.9.4 系统级 IPC 调用（协议版本 + 心跳保活 + 通用取消）
 *
 * 通道与主进程 ipc/index.ts 注册的 system:ping 一一对应。
 *
 * 设计原则：
 * - getProtocolVersion 同步返回常量（无需 IPC 调用，从 @shared 直接 import）
 * - systemPing 异步调用 system:ping IPC，用于心跳保活
 * - agentCancel 通过 sessionId 统一取消 agent:chat / claude-sdk 两类会话
 *   （主进程 handler 已通过 session-registry 集中管理 AbortController）
 */
const system = {
  /**
   * 同步获取 IPC 协议版本号
   *
   * 从 @shared/agent-types 导入 IPC_PROTOCOL_VERSION 常量，无需 IPC 调用。
   * 渲染进程可在启动时校验版本一致性（preload 与 main 应保持同步）。
   *
   * @returns IPC 协议版本号（如 '0.9.4'）
   */
  getProtocolVersion: (): string => IPC_PROTOCOL_VERSION,

  /**
   * 心跳保活 ping（检测主进程是否响应）
   *
   * 渲染进程可定期（如每 30 秒）调用本方法，超时无响应可判定主进程卡死。
   *
   * @returns { ok: true, timestamp: number, protocolVersion: string }
   */
  ping: (): Promise<SystemPingResponse> =>
    ipcRenderer.invoke('system:ping'),

  /**
   * 通过 sessionId 统一取消进行中的会话（v0.9.4 新增）
   *
   * 同时调用 agent:chat:cancel 与 claude-sdk:cancel 两个 IPC 通道，
   * 主进程 handler 已兼容 sessionId 与 correlationId，会按 sessionId 查找
   * session-registry 中的 AbortController 并触发 abort。
   *
   * 使用场景：
   * - 用户点击"停止"按钮时，调用本方法可同时取消 agent:chat / claude-sdk 流式请求
   * - 不需要区分会话类型（sessionId 是统一的）
   *
   * @param sessionId 会话 ID（agent:chat / claude-sdk:stream 启动时回传）
   * @returns 各通道取消结果（true 表示该通道存在且成功取消）
   */
  cancel: (sessionId: string): Promise<{ agentChat: boolean; claudeSdk: boolean }> =>
    Promise.all([
      ipcRenderer.invoke('agent:chat:cancel', sessionId),
      ipcRenderer.invoke('claude-sdk:cancel', sessionId),
    ]).then(([agentChat, claudeSdk]) => ({ agentChat, claudeSdk })),
}

/**
 * v0.9 Provider 管理 invoke 调用（Provider 抽象层）
 */
const provider = {
  /** 列出所有 Provider 配置（不含 apiKey） */
  list: (onlyEnabled?: boolean): Promise<PersistedProviderConfig[]> =>
    ipcRenderer.invoke('provider:list', onlyEnabled),

  /** 获取指定 Provider 配置（不含 apiKey） */
  get: (id: string): Promise<PersistedProviderConfig | null> =>
    ipcRenderer.invoke('provider:get', id),

  /** 保存 / 更新 Provider 配置（apiKey 自动走 SecureStore 加密） */
  save: (config: ProviderConfig): Promise<boolean> =>
    ipcRenderer.invoke('provider:save', config),

  /** 设置默认 Provider ID */
  setDefault: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('provider:set-default', id),
}

/**
 * v0.9 Token 统计 invoke 调用
 */
const token = {
  /** 获取 token 统计聚合（当日/当周/当月/总 + 按 Subagent/Provider 分布） */
  stats: (): Promise<TokenStats> =>
    ipcRenderer.invoke('token:stats'),

  /** 重置 token 统计（清空所有记录） */
  reset: (): Promise<boolean> =>
    ipcRenderer.invoke(TOKEN.RESET),

  /**
   * 获取 token 使用明细记录（P-5 新增）
   *
   * @param limit 返回最近 N 条记录，默认 100，上限 1000
   * @returns TokenUsageRecord[]（按时间正序，最近一条在末尾）
   */
  records: (limit?: number): Promise<TokenUsageRecord[]> =>
    ipcRenderer.invoke('token:records', limit),
}

/**
 * v0.9 Claude Agent SDK invoke 调用（独立于 agentRuntime）
 *
 * 通道与主进程 ipc/claude-sdk.ts 一一对应：
 * - claude-sdk:generate → generate（同步聚合，返回 ChatResult）
 * - claude-sdk:stream   → stream（异步流式，立即返回 correlationId）
 * - claude-sdk:cancel   → cancel（取消进行中的请求）
 *
 * 流式事件监听（通过 on 命名空间）：
 * - onClaudeSdkChunk  → claude-sdk:chunk（流式 token 块）
 * - onClaudeSdkDone   → claude-sdk:done（完成信号，含 ChatResult）
 * - onClaudeSdkError  → claude-sdk:error（错误信号）
 *
 * 使用场景：
 * - 用户在 Provider 选择器中选 claude-sdk 类型（如 claude-sonnet-4-5 / claude-opus-4-1）
 * - 直接走 Claude Agent SDK 的 agent loop（多轮工具调用 + 反思）
 * - 与 SupervisorAgent.agentChat 互斥（一个 chat 会话只用一个通道）
 */
const claudeSdk = {
  /**
   * 同步聚合调用（返回完整 ChatResult，不流式推送 token）
   *
   * 适用场景：批量分析、定时任务、不需要流式 UI 的后台调用
   *
   * @param providerId Provider ID（必须是 type='claude-sdk' 的 Provider）
   * @param params chat 调用参数（prompt / strength / systemPrompt 等）
   * @returns 完整 ChatResult
   */
  generate: (providerId: string, params: ClaudeSdkChatParams): Promise<ChatResult> =>
    ipcRenderer.invoke('claude-sdk:generate', providerId, params),

  /**
   * 异步流式调用（立即返回 correlationId，后续通过事件推送 token/done/error）
   *
   * 适用场景：交互式对话（ChatPanel）
   *
   * @param providerId Provider ID（必须是 type='claude-sdk' 的 Provider）
   * @param params chat 调用参数（prompt / strength / systemPrompt 等）
   * @returns correlationId（用于监听 claude-sdk:chunk/done/error + 取消请求）
   */
  stream: (providerId: string, params: ClaudeSdkChatParams): Promise<string> =>
    ipcRenderer.invoke('claude-sdk:stream', providerId, params),

  /**
   * 取消进行中的请求
   *
   * @param correlationId 关联 ID（stream 调用返回）
   * @returns 是否成功取消（false 表示请求已结束或不存在）
   */
  cancel: (correlationId: string): Promise<boolean> =>
    ipcRenderer.invoke('claude-sdk:cancel', correlationId),
}

// ============================================================================
// v2.0 Phase B 新增：内联补全 + Diff 应用类型（内联定义，与主进程结构一致）
// ============================================================================

/** 内联补全请求参数（与主进程 InlineCompletionRequest 一致） */
interface InlineCompletionRequest {
  filePath: string
  language: string
  content: string
  cursorLineNumber: number
  cursorColumn: number
  contextBefore?: string
  contextAfter?: string
}

/** 单条补全项（与 Monaco InlineCompletion item 结构兼容） */
interface InlineCompletionItem {
  insertText: string
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
}

/**
 * v2.0 Phase B 内联补全 + Diff 应用 invoke 调用
 *
 * 通道与主进程 ipc/llm-inline.ts 一一对应：
 * - llm:inline-completion         → inlineCompletion（请求光标位置补全）
 * - llm:inline-completion:cancel  → inlineCompletionCancel（取消进行中的补全）
 * - llm:apply-diff                → applyDiff（应用 diff，写入新内容到本地文件）
 * - llm:diff-preview              → diffPreview（预览 diff，返回 unified diff 字符串）
 */
const llmInline = {
  /**
   * 请求光标位置补全
   *
   * @param req 补全请求（文件路径 + 语言 + 内容 + 光标位置 + 上下文）
   * @returns 补全项列表（空数组表示无补全 / 超时 / 被限流）
   */
  inlineCompletion: (req: InlineCompletionRequest): Promise<InlineCompletionItem[]> =>
    ipcRenderer.invoke(LLM_INLINE.INLINE_COMPLETION, req),

  /**
   * 取消所有进行中的补全请求
   */
  inlineCompletionCancel: (): Promise<void> =>
    ipcRenderer.invoke(LLM_INLINE.INLINE_COMPLETION_CANCEL),

  /**
   * 应用 diff 到本地文件（写入新内容）
   *
   * 注意：仅处理本地文件系统；远程文件请走 sftp:writeFile。
   *
   * @param payload { filePath: 绝对路径, newContent: 新内容 }
   * @returns { success, error? }
   */
  applyDiff: (payload: {
    filePath: string
    newContent: string
  }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(LLM_INLINE.APPLY_DIFF, payload),

  /**
   * 预览 diff（unified diff 格式）
   *
   * @param payload { filePath, originalContent, modifiedContent }
   * @returns { diff: string }（unified diff，无变更返回空字符串）
   */
  diffPreview: (payload: {
    filePath: string
    originalContent: string
    modifiedContent: string
  }): Promise<{ diff: string }> =>
    ipcRenderer.invoke(LLM_INLINE.DIFF_PREVIEW, payload),
}

/**
 * v0.9 OpenHands 沙箱集成 invoke 调用
 *
 * 通道与主进程 ipc/sandbox.ts 一一对应：
 * - sandbox:detect-docker → detectDocker
 * - sandbox:start         → start
 * - sandbox:stop          → stop
 * - sandbox:status        → status
 * - sandbox:create        → create
 * - sandbox:list          → list
 * - sandbox:execute       → execute
 * - sandbox:delete        → delete
 *
 * 安全说明：
 * - execute 始终需要 UI 层审批（参考 RiskConfirm 组件）
 * - 通过 Mastra Tool 调用时，sandbox-exec.ts 已设 requireApproval: true
 */
const sandbox = {
  /** 检测 Docker Desktop 是否安装且运行 */
  detectDocker: (): Promise<DockerInfo> =>
    ipcRenderer.invoke(SANDBOX.DETECT_DOCKER),

  /** 启动 OpenHands App Server 容器（首次启动需拉镜像，可能数分钟） */
  start: (): Promise<{ success: true } | SandboxErrorResponse> =>
    ipcRenderer.invoke('sandbox:start'),

  /** 停止 OpenHands App Server 容器 */
  stop: (): Promise<{ success: true } | SandboxErrorResponse> =>
    ipcRenderer.invoke('sandbox:stop'),

  /** 获取沙箱集成状态（Docker + OpenHands 健康） */
  status: (): Promise<SandboxHealthStatus> =>
    ipcRenderer.invoke('sandbox:status'),

  /** 创建新沙箱（隔离 Docker 容器） */
  create: (sandboxSpecId?: string): Promise<SandboxInfo | SandboxErrorResponse> =>
    ipcRenderer.invoke('sandbox:create', sandboxSpecId),

  /** 列出当前用户的所有沙箱 */
  list: (limit?: number): Promise<SandboxPage | SandboxErrorResponse> =>
    ipcRenderer.invoke('sandbox:list', limit),

  /**
   * 在沙箱内执行 shell 命令
   *
   * P-2 + P-4 修复：
   * - session_api_key 不再传入渲染进程（句柄模式）
   * - 主进程 IPC 层会自动推送审批请求（sandbox:approval-request）
   * - 用户通过 sandboxApprove() 响应审批后才执行命令
   *
   * @param sandboxId 沙箱 ID
   * @param command shell 命令
   */
  execute: (
    sandboxId: string,
    command: string
  ): Promise<SandboxCommandResult | SandboxErrorResponse> =>
    ipcRenderer.invoke('sandbox:execute', sandboxId, command),

  /**
   * 响应沙箱命令审批请求（P-2：HC-6 强制审批）
   *
   * 主进程推送 sandbox:approval-request 事件后，
   * 渲染进程弹窗让用户确认，通过本函数回传审批结果。
   *
   * @param callId 审批调用 ID（来自 sandbox:approval-request 事件载荷）
   * @param approved 是否批准执行
   */
  approve: (callId: string, approved: boolean): Promise<boolean> =>
    ipcRenderer.invoke('sandbox:approve', callId, approved),

  /** 删除沙箱（不可逆，工作区数据将丢失） */
  delete: (sandboxId: string): Promise<{ success: true } | SandboxErrorResponse> =>
    ipcRenderer.invoke('sandbox:delete', sandboxId),
}

/**
 * v0.9 @命令 invoke 调用（8 类：log/cmd/file/metric/decision/kb/skill/server）
 *
 * 通道与主进程 ipc/at-commands.ts 一一对应：
 * - at:list    → list
 * - at:resolve → resolve
 * - at:parse   → parse
 *
 * 使用场景：
 * - ChatPanel 输入 `@` 触发选择器：list 获取 8 类命令元信息
 * - 拖拽注入 / 单命令解析：resolve 构造 AtCommand 对象
 * - 提交输入框前：parse 解析文本中所有 @命令，拼装到 LLM prompt
 */
const atCommands = {
  /**
   * 列出所有可用 @命令（8 类）
   *
   * @returns AtCommandInfo[]（含 type / label / icon / description）
   */
  list: (): Promise<AtCommandInfo[]> =>
    ipcRenderer.invoke(AT_COMMANDS.LIST),

  /**
   * 解析单个 @命令
   *
   * @param type 命令类型（log/cmd/file/metric/decision/kb/skill/server）
   * @param args 命令参数（键值对，由 UI 收集）
   * @param source 来源标识（IDE/终端/监控/历史/chat-input/drag-drop）
   * @param userId 用户 ID（可选，预留多用户场景）
   * @returns 完整的 AtCommand 对象（含 displayText 与 injectedText）
   */
  resolve: (
    type: AtCommandType,
    args: Record<string, unknown>,
    source?: AtCommandSource,
    userId?: string
  ): Promise<AtCommand> =>
    ipcRenderer.invoke('at:resolve', type, args, source, userId),

  /**
   * 解析文本中所有 @命令
   *
   * @param text ChatPanel 输入框原始文本
   * @param source 来源标识
   * @param userId 用户 ID（可选）
   * @returns AtCommandParseResult（含 text 去除 @命令后的纯文本 + commands 列表）
   */
  parse: (
    text: string,
    source?: AtCommandSource,
    userId?: string
  ): Promise<AtCommandParseResult> =>
    ipcRenderer.invoke('at:parse', text, source, userId),
}

/**
 * v0.9 可信度算法 invoke 调用（D-S 证据理论 + PCR5 冲突融合 + 6 源证据）
 *
 * 通道与主进程 ipc/credibility.ts 一一对应：
 * - credibility:assess → assess
 * - credibility:dag    → dag
 *
 * v0.9.6 P1 扩展：ECE 校准器（CalibrationTuner）相关 6 个通道：
 * - credibility:calibrate         → calibrate
 * - credibility:get-calibration   → getCalibration
 * - credibility:get-calibration-state → getCalibrationState
 * - credibility:reset-calibration → resetCalibration
 * - credibility:compute-ece       → computeEce
 * - credibility:add-calibration-sample → addCalibrationSample
 *
 * v0.9.6 P2 扩展：EU AI Act 审计报告 4 个通道：
 * - credibility:export-audit-report → exportAuditReport
 * - credibility:list-audit-reports  → listAuditReports
 * - credibility:load-audit-report   → loadAuditReport
 * - credibility:format-audit-report → formatAuditReport
 *
 * 使用场景：
 * - ChatPanel 决策卡片下方展示可信度评估（belief/plausibility/confidence）
 * - 可信度 DAG 可视化面板展示融合步骤（React Flow 渲染）
 * - 6 源证据：log / kb / ai-param / human / history / best-practice
 * - 校准面板：展示/调整 T 值（Temperature Scaling），避免 LLM 过度自信
 * - 审计面板：导出 EU AI Act / NIST AI RMF / NIST AI 600-1 合规报告
 *
 * 论文支撑：
 * - Guo et al. 2017 (ICML, arXiv:1706.04599) - Temperature Scaling
 * - Shafer 1976, Dempster 1967 - D-S 证据理论
 * - Smarandache & Dezert 2004 - PCR5 冲突融合
 * 法规支撑：
 * - EU AI Act 2026 (Regulation 2024/1689) Art.11/12/13/14/15
 * - NIST AI RMF 1.0
 * - NIST AI 600-1 GenAI Profile
 *
 * 调研文档：idea-to-dev-output/22-可信度算法论文支撑调研.md
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
 *           + v0.9.6 P1 §ECE 校准器
 *           + v0.9.6 P2 §EU AI Act 审计报告
 */
const credibility = {
  /**
   * 评估给定证据集的可信度
   *
   * @param inputs 证据源输入列表（至少 1 个，最多 6 个）
   * @returns ConfidenceAssessment（含 Bel/Pl/confidence/conflictLevel/fusionSteps）
   */
  assess: (inputs: CredibilityEvidenceInput[]): Promise<ConfidenceAssessment> =>
    ipcRenderer.invoke('credibility:assess', inputs),

  /**
   * 获取 DAG 可视化数据
   *
   * @param inputs 证据源输入列表
   * @returns DagData（含 nodes + edges，用于 React Flow 渲染）
   */
  dag: (inputs: CredibilityEvidenceInput[]): Promise<DagData> =>
    ipcRenderer.invoke('credibility:dag', inputs),

  // ========================================================================
  // v0.9.6 P1：ECE 校准器方法（CalibrationTuner）
  // ========================================================================

  /**
   * 触发指定 Provider 的重新校准
   *
   * 基于当前已收集的 CalibrationSample 网格搜索最优 T 值，更新内部状态。
   *
   * @param providerId Provider ID（如 'deepseek' / 'claude'）
   * @param options 可选优化参数（tMin / tMax / tSteps / numBuckets / minSamples）
   * @returns TemperatureScalingResult（最优 T、ECE 改善、searchTrace）
   */
  calibrate: (
    providerId: ProviderId,
    options?: OptimizeTOptions
  ): Promise<TemperatureScalingResult> =>
    ipcRenderer.invoke('credibility:calibrate', providerId, options),

  /**
   * 获取指定 Provider 的当前校准状态
   *
   * @param providerId Provider ID
   * @returns ProviderCalibration（optimalT / lastCalibratedAt / sampleCount / ece）
   */
  getCalibration: (providerId: ProviderId): Promise<ProviderCalibration> =>
    ipcRenderer.invoke('credibility:get-calibration', providerId),

  /**
   * 获取全局校准状态（含所有 Provider 的 T 值表）
   *
   * @returns CalibrationState（providers + defaultT + updatedAt）
   */
  getCalibrationState: (): Promise<CalibrationState> =>
    ipcRenderer.invoke('credibility:get-calibration-state'),

  /**
   * 重置指定 Provider 的校准（T 回到 defaultT=1.0）
   *
   * @param providerId Provider ID
   * @returns boolean（是否成功重置）
   */
  resetCalibration: (providerId: ProviderId): Promise<boolean> =>
    ipcRenderer.invoke('credibility:reset-calibration', providerId),

  /**
   * 计算指定 Provider 的当前 ECE（不修改 T）
   *
   * @param providerId Provider ID
   * @param numBuckets 可选分桶数（默认 10）
   * @returns EceResult（ECE / MCE / 各桶统计 / 总样本数）
   */
  computeEce: (providerId: ProviderId, numBuckets?: number): Promise<EceResult> =>
    ipcRenderer.invoke('credibility:compute-ece', providerId, numBuckets),

  /**
   * 记录新的校准样本
   *
   * 触发时机：UI 决策卡状态变为 'verified' 时回灌 ground truth。
   * 满足 RETUNE_THRESHOLD 阈值后，下次 tuneProvider 会重新计算最优 T。
   *
   * @param sample CalibrationSample（决策 ID、置信度、是否正确、Provider、时间戳）
   * @returns boolean（是否成功入库）
   */
  addCalibrationSample: (sample: CalibrationSample): Promise<boolean> =>
    ipcRenderer.invoke('credibility:add-calibration-sample', sample),

  // ========================================================================
  // v0.9.6 P2：EU AI Act 合规审计报告方法
  // ========================================================================

  /**
   * 导出 EU AI Act 合规审计报告
   *
   * 从决策卡 + 校准状态 + 6 源证据构造完整合规审计报告，
   * 支持 JSON / Markdown / HTML 三种格式，可一次导出全部。
   *
   * 法规依据：
   * - EU AI Act 2026 Art.11（技术文档 machine-readable）
   * - EU AI Act Art.12（自动日志 6 个月保留期）
   * - EU AI Act Art.13/14/15（透明度 + 人工监督 + 准确性）
   * - NIST AI RMF 1.0（GOVERN/MAP/MEASURE/MANAGE）
   * - NIST AI 600-1 GenAI Profile（12 类风险）
   *
   * @param input 报告构建输入（决策上下文 + 6 源证据 + 校准状态 + 人工监督 + 决策动作）
   * @param options 导出选项（format / outputDir / force / writeAllFormats）
   * @returns ExportResult（reportId / fingerprint / 文件路径 / 字节数）
   */
  exportAuditReport: (input: AuditReportInput, options?: ExportOptions): Promise<ExportResult> =>
    ipcRenderer.invoke('credibility:export-audit-report', input, options),

  /**
   * 列出已落盘的审计报告
   *
   * 扫描 {userData}/audit-reports/ 目录，按决策时间倒序返回。
   *
   * @param outputDir 可选自定义目录（默认 userData/audit-reports/）
   * @returns AuditReportListItem[]（decisionId / fingerprint / complianceScore / filepath）
   */
  listAuditReports: (outputDir?: string): Promise<AuditReportListItem[]> =>
    ipcRenderer.invoke('credibility:list-audit-reports', outputDir),

  /**
   * 从已落盘的 JSON 报告重建 ComplianceAuditReport 对象
   *
   * 用途：UI 展示已生成的报告、对比不同决策的报告
   *
   * @param filepath 报告 JSON 文件绝对路径
   * @returns ComplianceAuditReport（完整结构）
   */
  loadAuditReport: (filepath: string): Promise<ComplianceAuditReport> =>
    ipcRenderer.invoke('credibility:load-audit-report', filepath),

  /**
   * 仅格式化（不落盘），用于预览
   *
   * @param input 报告构建输入
   * @param format 输出格式（json / markdown / html）
   * @returns string（序列化后的报告内容）
   */
  formatAuditReport: (input: AuditReportInput, format: AuditFormat): Promise<string> =>
    ipcRenderer.invoke('credibility:format-audit-report', input, format),
}

// ============================================================================
// v0.9.5 P0 新增：5 组缺失 IPC 通道（成本透明 / 模式切换 / 注意力 / Subagent / Provider 信息）
//
// 设计原则：
// - 与现有 token / provider / agentRuntime 等模块保持一致的代码风格
// - 每个对象封装对应 IPC 通道，方法名与通道名一一对应（去除前缀后驼峰化）
// - 仅做 IPC 包装：调用 ipcRenderer.invoke，不做业务逻辑
// - 通道命名规范：kebab-case（如 token:cost-stats / mode:list / attention:track-files）
// ============================================================================

/**
 * v0.9.5 P0 - 组 1：Token 成本透明 invoke 调用
 *
 * 通道与主进程 ipc/token-stats.ts 一一对应：
 * - token:cost-stats → costStats（按时间维度 + Subagent 维度 + Provider 维度聚合 USD 成本）
 *
 * 使用场景：
 * - Token 监控面板展示累计成本（USD）
 * - 让用户对消费有直观感知（今日 $X.XX / 本月 $X.XX）
 *
 * 与现有 token.stats（token 数量）的区别：
 * - token.stats 返回 TokenStats（token 数）
 * - tokenCostStats 返回 CostStats（USD 成本，由 main 进程按 Provider 定价回退计算）
 */
const tokenCostStats = {
  /**
   * 获取累计成本统计（USD）
   *
   * @returns CostStats（含 todayCost/weekCost/monthCost/totalCost + bySubagent/byProvider）
   */
  costStats: (): Promise<CostStats> =>
    ipcRenderer.invoke('token:cost-stats'),
}

/**
 * v0.9.5 P0 - 组 2：Mode 五模式切换 invoke 调用
 *
 * 通道与主进程 ipc/mode.ts 一一对应：
 * - mode:list        → list（列出所有可用 mode 配置，不含 systemPrompt）
 * - mode:set-default → setDefault（设置当前默认 mode）
 * - mode:get-current → getCurrent（返回当前默认 mode）
 *
 * 使用场景：
 * - ChatPanel 顶部模式选择器（chat / ask / plan / code / debug）
 * - UI 启动时调用 getCurrent 初始化选中状态
 * - 用户切换 mode 时调用 setDefault
 *
 * 安全设计：
 * - mode:list 返回 ModeInfo[] 不含 systemPrompt（避免泄露内部 prompt 模板）
 * - mode:set-default 入参用 isValidMode 类型守卫防御非法字符串
 */
const mode = {
  /**
   * 列出所有可用 mode 配置（不含 systemPrompt）
   *
   * @returns ModeInfo[]（5 个 mode：chat / ask / plan / code / debug）
   */
  list: (): Promise<ModeListResponse> =>
    ipcRenderer.invoke('mode:list'),

  /**
   * 设置当前默认 mode
   *
   * @param request { mode: AgentMode }
   * @returns { success, previousMode, currentMode }（非法 mode 返回 success=false）
   */
  setDefault: (request: ModeSetDefaultRequest): Promise<ModeSetDefaultResponse> =>
    ipcRenderer.invoke('mode:set-default', request),

  /**
   * 返回当前默认 mode
   *
   * @returns { mode, displayName }（便于 UI 直接渲染）
   */
  getCurrent: (): Promise<ModeCurrentResponse> =>
    ipcRenderer.invoke('mode:get-current'),
}

/**
 * v0.9.5 P0 - 组 3：Attention 注意力跟踪 invoke 调用
 *
 * 通道与主进程 ipc/attention.ts 一一对应：
 * - attention:current        → current（返回当前 AttentionFocus）
 * - attention:history        → history（返回历史 AttentionFocus 列表）
 * - attention:track-files    → trackFiles（跟踪关注的文件）
 * - attention:track-commands → trackCommands（跟踪关注的命令）
 * - attention:track-errors   → trackErrors（跟踪关注的错误）
 * - attention:track-keywords → trackKeywords（跟踪关注的搜索关键词）
 * - attention:reset          → reset（重置当前 attention，归档到 history）
 *
 * 使用场景：
 * - UI 高亮显示当前关注的文件 / 命令 / 错误 / 关键词
 * - 历史时间轴展示 attention 快照
 * - 新会话开始时调用 reset 归档当前 attention
 *
 * 设计要点：
 * - AttentionTracker 是单例，全局唯一，跨 Subagent 共享
 * - track-* 通道接收 string[] 参数
 * - reset 通道将当前 attention 归档到 history（最多 100 条）
 */
const attention = {
  /** 获取当前 attention（始终非 null，since 字段必有） */
  current: (): Promise<AttentionFocus> =>
    ipcRenderer.invoke('attention:current'),

  /** 获取历史 attention 列表（按时间顺序，最早在前） */
  history: (): Promise<AttentionFocus[]> =>
    ipcRenderer.invoke('attention:history'),

  /**
   * 跟踪关注的文件
   *
   * @param files 文件路径列表
   * @returns true 表示跟踪成功
   */
  trackFiles: (files: string[]): Promise<boolean> =>
    ipcRenderer.invoke('attention:track-files', files),

  /**
   * 跟踪关注的命令
   *
   * @param commands 命令列表
   * @returns true 表示跟踪成功
   */
  trackCommands: (commands: string[]): Promise<boolean> =>
    ipcRenderer.invoke('attention:track-commands', commands),

  /**
   * 跟踪关注的错误
   *
   * @param errors 错误信息列表
   * @returns true 表示跟踪成功
   */
  trackErrors: (errors: string[]): Promise<boolean> =>
    ipcRenderer.invoke('attention:track-errors', errors),

  /**
   * 跟踪关注的搜索关键词
   *
   * @param keywords 关键词列表
   * @returns true 表示跟踪成功
   */
  trackKeywords: (keywords: string[]): Promise<boolean> =>
    ipcRenderer.invoke('attention:track-keywords', keywords),

  /**
   * 重置当前 attention（归档到 history）
   *
   * @returns true 表示重置成功
   */
  reset: (): Promise<boolean> =>
    ipcRenderer.invoke('attention:reset'),
}

/**
 * v0.9.4 批次 4 - 任务 5 P2-E：预期回显监控 invoke 调用
 *
 * 通道与主进程 ipc/expectation.ts 一一对应：
 * - expectation:check  → check（对比预期与实际输出，返回 ExpectationCheckResult）
 * - expectation:format → format（格式化违规列表为人类可读字符串）
 *
 * 使用场景：
 * - UI 展示"预期 vs 实际"对比，命令执行异常时高亮告警
 * - 在 Tooltip / 详情面板中展示完整违规描述
 *
 * 设计要点：
 * - check 接收 3 参数（expectation + actualOutput + actualExitCode）
 * - format 接收违规列表，返回字符串
 * - 类型已迁移到 @shared/agent-types.ts（SSOT）
 */
const expectation = {
  /**
   * 对比预期与实际输出
   *
   * @param expectation 命令预期配置（command + mustContain + mustNotContain + expectedExitCode + timeoutMs）
   * @param actualOutput 实际输出（字符串）
   * @param actualExitCode 实际退出码
   * @returns ExpectationCheckResult（含 met / violations / expectation / actualExitCode / timestamp）
   */
  check: (
    expectation: CommandExpectation,
    actualOutput: string,
    actualExitCode: number
  ): Promise<ExpectationCheckResult> =>
    ipcRenderer.invoke('expectation:check', expectation, actualOutput, actualExitCode),

  /**
   * 格式化违规列表为人类可读字符串
   *
   * @param violations 违规列表（空数组返回"符合预期（无违规）"）
   * @returns 格式化后的字符串
   */
  format: (violations: ExpectationViolation[]): Promise<string> =>
    ipcRenderer.invoke('expectation:format', violations),
}

/**
 * v0.9.5 P0 - 组 4：Subagent 自定义 Agent 加载器 invoke 调用
 *
 * 通道与主进程 ipc/subagent.ts 一一对应：
 * - subagent:list   → list（加载所有自定义 agent 配置，从 .tdsf/agent/ 目录）
 * - subagent:reload → reload（重新加载指定 agent 或全部重载）
 *
 * 使用场景：
 * - UI 自定义 agent 列表展示（如下拉框 / 卡片列表）
 * - 用户编辑 .tdsf/agent/*.md 后调用 reload 热重载 agent 配置
 *
 * 设计要点：
 * - subagent:list 不接收参数（始终从默认目录 .tdsf/agent/ 加载）
 * - subagent:reload 入参 filePath 可选（不传则全部重载）
 * - CustomAgentConfig 接口已迁移到 @shared/agent-types.ts（SSOT）
 */
const subagent = {
  /**
   * 加载所有自定义 agent 配置
   *
   * @returns CustomAgentConfig[]（目录不存在返回空数组，不抛错）
   */
  list: (): Promise<CustomAgentConfig[]> =>
    ipcRenderer.invoke('subagent:list'),

  /**
   * 重新加载指定 agent 或全部重载
   *
   * @param request { filePath?: string }（不传则重载整个 .tdsf/agent/ 目录）
   * @returns { success, reloaded, failed }（即使部分失败也返回 success=true）
   */
  reload: (request?: SubagentReloadRequest): Promise<SubagentReloadResponse> =>
    ipcRenderer.invoke('subagent:reload', request),
}

/**
 * v0.9.5 P0 - 组 5：Provider Info 能力 + 定价透明 invoke 调用
 *
 * 通道与主进程 ipc/provider-info.ts 一一对应：
 * - provider:capabilities      → capabilities（指定 provider 的能力声明）
 * - provider:capabilities-all  → capabilitiesAll（所有 provider 类型的能力声明默认表）
 * - provider:pricing           → pricing（指定 provider 的定价表）
 * - provider:pricing-all       → pricingAll（所有 provider 类型的定价表默认表）
 *
 * 与现有 provider.list / provider.get / provider.save / provider.setDefault 的区别：
 * - provider.* 通道用于 Provider 配置 CRUD
 * - providerInfo.* 通道用于查询 Provider 的能力 + 定价（只读，不含敏感信息）
 *
 * 使用场景：
 * - UI 显示能力图标（如 🔄 streaming / 🔧 toolCall / 👁 vision / 📏 contextWindow）
 * - UI 显示 Provider 累计成本（如本月已消费 $X.XX）+ 成本告警
 * - Provider 配置页显示默认能力 + 定价说明表格
 */
const providerInfo = {
  /**
   * 查询指定 provider 的能力声明
   *
   * @param request { providerId: string }
   * @returns ProviderCapabilities | null（Provider 不存在时返回 null）
   */
  capabilities: (request: ProviderCapabilitiesRequest): Promise<ProviderCapabilitiesResponse> =>
    ipcRenderer.invoke('provider:capabilities', request),

  /**
   * 查询所有 provider 类型的能力声明默认表
   *
   * @returns Record<string, ProviderCapabilities>（按 ProviderType 索引）
   */
  capabilitiesAll: (): Promise<ProviderCapabilitiesAllResponse> =>
    ipcRenderer.invoke('provider:capabilities-all'),

  /**
   * 查询指定 provider 的定价表
   *
   * @param request { providerId: string }
   * @returns ModelPricing | null（Provider 不存在时返回 null）
   */
  pricing: (request: ProviderPricingRequest): Promise<ProviderPricingResponse> =>
    ipcRenderer.invoke('provider:pricing', request),

  /**
   * 查询所有 provider 类型的定价表默认表
   *
   * @returns Record<string, ModelPricing>（按 ProviderType 索引）
   */
  pricingAll: (): Promise<ProviderPricingAllResponse> =>
    ipcRenderer.invoke('provider:pricing-all'),
}

// ============================================================================
// Phase 6 Task 6.5：调度器 invoke 调用（定时任务自动化）
// ============================================================================

/**
 * 调度器 invoke 调用
 *
 * 通道与主进程 ipc/scheduler.ts 一一对应：
 * - scheduler:list    → list（查询所有定时任务状态）
 * - scheduler:toggle  → toggle（启用/禁用指定任务）
 * - scheduler:trigger → trigger（立即触发指定任务，不等 cron 时间）
 *
 * 使用场景：
 * - GeneralSettings / SchedulerPanel 展示 3 个定时任务卡片
 * - 用户切换任务启用状态（toggle）
 * - 用户手动触发任务（trigger，用于演示 / 手动重试）
 *
 * push 通道（scheduler:status）通过 onSchedulerStatusChange 监听，
 * 任务执行后主进程主动推送状态更新到渲染层。
 */
const scheduler = {
  /**
   * 查询所有定时任务状态
   *
   * @returns SchedulerTaskStatus[]（3 个任务：daily-health-check / daily-decision-archive / weekly-ops-report）
   */
  list: (): Promise<SchedulerTaskStatus[]> =>
    ipcRenderer.invoke(SCHEDULER.LIST),

  /**
   * 启用/禁用指定任务
   *
   * @param taskId 任务 ID（受控枚举）
   * @param enabled 是否启用
   * @returns 更新后的 SchedulerTaskStatus（任务不存在时返回 null）
   */
  toggle: (taskId: string, enabled: boolean): Promise<SchedulerTaskStatus | null> =>
    ipcRenderer.invoke(SCHEDULER.TOGGLE, taskId, enabled),

  /**
   * 立即触发指定任务（不等 cron 时间）
   *
   * 用于演示 / 手动重试场景。任务正在执行时返回上次结果避免并发重复。
   *
   * @param taskId 任务 ID
   * @returns TaskResult（含 success / summary / details / durationMs / error）
   */
  trigger: (taskId: string): Promise<TaskResult> =>
    ipcRenderer.invoke(SCHEDULER.TRIGGER, taskId),
}

// ============================================================================
// v2.0 Phase C 新增：SFTP 文件搜索 + grep + 文件监听（QuickFileSearch / GlobalSearch / FileWatcher UI）
// ============================================================================

/**
 * SFTP 文件搜索单条结果（结构主进程 sftp-search.ts SftpSearchFileEntry 一致）
 *
 * 注意：preload 不能直接 import 主进程模块，这里内联定义同结构类型。
 */
export interface SftpSearchFileEntry {
  /** 完整远程路径 */
  path: string
  /** 文件名（path 最后一段） */
  name: string
  /** 文件大小（字节，未能解析时为 0） */
  size: number
  /** 修改时间（ms，未能解析时为 0） */
  mtime: number
}

/**
 * SFTP grep 单条匹配（结构主进程 sftp-search.ts SftpGrepMatch 一致）
 */
export interface SftpGrepMatch {
  /** 文件路径 */
  file: string
  /** 行号（1-based，未能解析时为 0） */
  line: number
  /** 整行文本 */
  text: string
  /** 匹配到的子串 */
  match: string
}

/**
 * sftp:grep 请求参数
 */
export interface SftpGrepParams {
  sessionId: string
  path: string
  pattern: string
  isRegex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}

/**
 * 文件变更事件类型（结构主进程 file-watcher.ts FileChangeEvent 一致）
 */
export type FileChangeEvent = 'modify' | 'create' | 'delete' | 'move'

/**
 * file:changed 推送载荷（结构主进程 file-watcher.ts FileChangedPayload 一致）
 */
export interface FileChangedPayload {
  watchId: string
  path: string
  event: FileChangeEvent
}

/**
 * SFTP 文件搜索 + grep 封装
 *
 * 通道与主进程 ipc/sftp-search.ts 一一对应；UI 调用方式：
 *   const { files } = await window.electronAPI.sftpSearch(sessionId, '/etc', 'nginx')
 *   const { results } = await window.electronAPI.sftpGrep({ sessionId, path, pattern, ... })
 */
const sftpSearch = {
  /**
   * 模糊查找远程文件（find -type f -name）
   *
   * @param sessionId SSH 会话 ID
   * @param path 搜索根目录（绝对路径）
   * @param query 文件名模糊匹配（不支持正则，shell glob）
   * @returns 文件列表（最多 50 条，3 秒超时返回空数组）
   */
  search: (
    sessionId: string,
    path: string,
    query: string
  ): Promise<{ files: SftpSearchFileEntry[]; error?: string }> =>
    ipcRenderer.invoke(SFTP_SEARCH.SEARCH, sessionId, path, query),

  /**
   * 远程内容 grep（grep -rn）
   *
   * @param params 搜索参数（sessionId/path/pattern/isRegex/caseSensitive/wholeWord）
   * @returns 匹配列表（最多 100 条，3 秒超时返回空数组）
   */
  grep: (params: SftpGrepParams): Promise<{ results: SftpGrepMatch[]; error?: string }> =>
    ipcRenderer.invoke(SFTP_SEARCH.GREP, params),
}

/**
 * 远程文件监听封装
 *
 * 通道与主进程 ipc/file-watcher.ts 一一对应；UI 调用方式：
 *   const { watchId } = await window.electronAPI.fileWatchStart(sessionId, '/var/log')
 *   const off = window.electronAPI.onFileChanged((payload) => { ... })
 *   await window.electronAPI.fileWatchStop(watchId)
 */
const fileWatch = {
  /**
   * 开始监听远程路径文件变更
   *
   * @param sessionId SSH 会话 ID
   * @param path 监听根目录（绝对路径）
   * @returns watchId（用于后续 stop 调用）
   */
  start: (sessionId: string, path: string): Promise<{ watchId: string }> =>
    ipcRenderer.invoke(FILE_WATCH.WATCH_START, sessionId, path),

  /**
   * 停止监听
   *
   * @param watchId start 返回的 watchId
   * @returns { success: boolean }
   */
  stop: (watchId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(FILE_WATCH.WATCH_STOP, watchId),
}

// ============================================================================
// 事件监听封装（主 → 渲染，单向推送）
// ============================================================================

/**
 * 创建事件监听器，返回取消监听函数
 *
 * 每个监听器注册一个 ipcRenderer.on 回调，
 * 返回的 cleanup 函数调用 ipcRenderer.removeListener 移除监听，
 * 便于 React useEffect 在组件卸载时清理。
 *
 * @param channel IPC 事件通道名
 * @param callback 事件回调
 * @returns 取消监听函数
 */
function createListener<T extends unknown[]>(
  channel: string,
  callback: (...args: T) => void
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]): void => {
    callback(...(args as T))
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * 事件监听 API
 *
 * 每个方法返回一个取消监听函数，调用后移除该监听器。
 * 推荐在 React useEffect 中使用：
 *   useEffect(() => {
 *     const off = window.electronAPI.on.terminalData((sid, data) => {...})
 *     return off  // 组件卸载时自动取消监听
 *   }, [])
 */
const on = {
  /** 监听终端 Shell 数据推送 */
  terminalData: (callback: (sessionId: string, data: string) => void): (() => void) => {
    return createListener('terminal:data', callback)
  },

  /** 监听 SSH 心跳保活状态变更（K.2：心跳失败/重连/最终断开时推送） */
  sshStateChanged: (callback: (event: SshStateEvent) => void): (() => void) => {
    return createListener(SSH.STATE_CHANGED, callback)
  },

  /**
   * 监听主机密钥确认弹窗推送（Phase L）
   *
   * 首次连接或密钥变更时，主进程推送 SshHostKeyPromptEvent，
   * 渲染进程弹窗等待用户选择后通过 sshRespondHostKey 响应。
   */
  sshHostKeyPrompt: (callback: (prompt: SshHostKeyPromptEvent) => void): (() => void) => {
    return createListener(SSH.HOST_KEY_PROMPT, callback)
  },

  /** 监听监控数据推送（实时指标，每 interval 秒一次） */
  monitorData: (callback: (sessionId: string, data: MonitorData) => void): (() => void) => {
    return createListener('monitor:data', callback)
  },

  /** 监听系统信息推送（首次采集时推送一次） */
  monitorSystemInfo: (callback: (sessionId: string, info: SystemInfo) => void): (() => void) => {
    return createListener('monitor:systemInfo', callback)
  },

  /** 监听 LLM 流式 token 推送（兼容旧版） */
  llmToken: (callback: (token: string) => void): (() => void) => {
    return createListener('llm:token', callback)
  },

  /** 监听 LLM 流式 token 块推送（增强版，含 totalTokens） */
  llmChunk: (callback: (chunk: LlmStreamChunk) => void): (() => void) => {
    return createListener('llm:chunk', callback)
  },

  /** 监听 LLM 流式完成信号（含完整文本） */
  llmDone: (callback: (fullText: string) => void): (() => void) => {
    return createListener('llm:done', callback)
  },

  /** 监听 LLM 流式错误信号（含错误码/消息/是否可重试） */
  llmError: (callback: (error: LlmError) => void): (() => void) => {
    return createListener('llm:error', callback)
  },

  /** 监听 Agent 工作流步骤变更 */
  agentStep: (callback: (state: AgentWorkflowState) => void): (() => void) => {
    return createListener('agent:step', callback)
  },

  // v0.9.5 P0 新增：MCP 5 阶段生命周期状态机（借鉴 claw-code §3.3）
  /** 获取 MCP 状态机当前状态 */
  mcpGetState: (): Promise<McpStateContext> => {
    return ipcRenderer.invoke('mcp:get-state')
  },
  /** 重置 MCP 状态机（用户手动恢复） */
  mcpReset: (): Promise<boolean> => {
    return ipcRenderer.invoke('mcp:reset')
  },
  /** 监听 MCP 状态变更推送 */
  mcpStateChanged: (callback: (ctx: McpStateContext) => void): (() => void) => {
    return createListener('mcp:state-changed', callback)
  },

  // v0.9.6 新增：外部 MCP Server（Client 侧）
  /** 获取所有外部 MCP 服务器状态 */
  mcpExternalStatus: (): Promise<ExternalMcpServerStatus[]> => {
    return ipcRenderer.invoke(MCP.EXTERNAL_STATUS)
  },
  /** 列出所有外部 MCP 工具 */
  mcpExternalTools: (): Promise<
    Array<{ name: string; description: string; serverId: string; serverName: string }>
  > => {
    return ipcRenderer.invoke('mcp:external-tools')
  },
  /** 调用外部 MCP 工具 */
  mcpExternalCall: (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{
    success: boolean
    content: Array<{ type: 'text'; text: string }>
    error?: string
  }> => {
    return ipcRenderer.invoke('mcp:external-call', serverId, toolName, args)
  },
  /** 重连外部 MCP 服务器 */
  mcpExternalReconnect: (serverId: string): Promise<boolean> => {
    return ipcRenderer.invoke('mcp:external-reconnect', serverId)
  },

  // v0.9 Supervisor chat 流式事件
  /** 监听 Supervisor 流式 token 块推送 */
  agentChunk: (callback: (payload: AgentChunkPayload) => void): (() => void) => {
    return createListener('agent:chunk', callback)
  },
  /** 监听 Supervisor chat 完成信号（含完整结果） */
  agentDone: (callback: (payload: AgentDonePayload) => void): (() => void) => {
    return createListener('agent:done', callback)
  },
  /** 监听 Supervisor chat 错误信号 */
  agentError: (callback: (payload: AgentErrorPayload) => void): (() => void) => {
    return createListener('agent:error', callback)
  },

  // v0.9 Claude Agent SDK 流式事件（独立于 agent:chunk/done/error，避免通道混用）
  /** 监听 Claude SDK 流式 token 块推送 */
  claudeSdkChunk: (callback: (payload: AgentChunkPayload) => void): (() => void) => {
    return createListener('claude-sdk:chunk', callback)
  },
  /** 监听 Claude SDK 完成信号（含完整 ChatResult） */
  claudeSdkDone: (callback: (payload: AgentDonePayload) => void): (() => void) => {
    return createListener('claude-sdk:done', callback)
  },
  /** 监听 Claude SDK 错误信号 */
  claudeSdkError: (callback: (payload: AgentErrorPayload) => void): (() => void) => {
    return createListener('claude-sdk:error', callback)
  },

  /**
   * 监听沙箱命令审批请求（P-2：HC-6 强制审批）
   *
   * 主进程在 sandbox:execute 调用时会推送 sandbox:approval-request 事件，
   * 渲染进程通过本监听器接收审批请求载荷，弹窗让用户确认后调用 sandboxApprove() 响应。
   *
   * 注意：30 秒未响应主进程会自动拒绝并返回 APPROVAL_DENIED 错误。
   */
  sandboxApprovalRequest: (callback: (request: SandboxApprovalRequest) => void): (() => void) => {
    return createListener('sandbox:approval-request', callback)
  },

  /**
   * 监听 PAOR 审批请求（v0.9.5 新增）
   *
   * 主进程在 PAOR 循环遇到 HIGH/CRITICAL 命令时推送 paor:approval-request 事件，
   * 渲染进程通过本监听器接收审批请求载荷，弹窗让用户确认后调用 paorApprove() 响应。
   *
   * 注意：60 秒未响应主进程会自动拒绝。
   */
  paorApprovalRequest: (callback: (request: PaorApprovalRequest) => void): (() => void) => {
    return createListener('paor:approval-request', callback)
  },

  // v1.5 循环工程事件监听器
  loopLlmStart: (callback: (payload: unknown) => void): (() => void) => {
    return createListener('loop:llm-start', callback)
  },
  loopLlmDone: (callback: (payload: unknown) => void): (() => void) => {
    return createListener('loop:llm-done', callback)
  },
  loopStep: (callback: (payload: unknown) => void): (() => void) => {
    return createListener('loop:step', callback)
  },
  loopDecision: (callback: (payload: unknown) => void): (() => void) => {
    return createListener('loop:decision', callback)
  },
  loopDone: (callback: (payload: unknown) => void): (() => void) => {
    return createListener('loop:done', callback)
  },
  loopError: (callback: (payload: unknown) => void): (() => void) => {
    return createListener('loop:error', callback)
  },
  loopBlocked: (callback: (payload: unknown) => void): (() => void) => {
    return createListener('loop:blocked', callback)
  },

  // Phase 6 Task 6.5：调度器状态变更推送（主 → 渲染）
  /**
   * 监听调度器任务状态变更
   *
   * 主进程在任务 task-start / task-done / task-error 事件触发后，
   * 通过 scheduler:status 通道推送最新 SchedulerTaskStatus 到渲染层。
   * 渲染层据此更新任务卡片（lastRunAt / lastResult / nextRunAt）。
   *
   * @param callback 回调函数，接收变更后的 SchedulerTaskStatus
   * @returns 取消监听函数（在 React useEffect cleanup 中调用）
   */
  schedulerStatus: (callback: (status: SchedulerTaskStatus) => void): (() => void) => {
    return createListener(SCHEDULER.STATUS, callback)
  },

  // v2.0 Phase C 新增：远程文件变更事件监听
  /**
   * 监听远程文件变更（file:changed 推送）
   *
   * 主进程 FileWatcherAdapter 在 inotifywait / 轮询检测到文件变更时，
   * 通过 file:changed 通道推送 FileChangedPayload 到渲染层。
   * 渲染层据此刷新 FileTree / EditorArea / 决策卡片等 UI。
   *
   * @param callback 回调函数，接收 FileChangedPayload
   * @returns 取消监听函数（在 React useEffect cleanup 中调用）
   */
  fileChanged: (callback: (payload: FileChangedPayload) => void): (() => void) => {
    return createListener(FILE_WATCH.CHANGED, callback)
  },
}

// ============================================================================
// 暴露到渲染进程（扁平化 API，与渲染进程调用方式一致）
// ============================================================================

/**
 * 通过 contextBridge 暴露 electronAPI 到 window 对象
 *
 * 渲染进程使用扁平调用方式：
 *   window.electronAPI.sshConnect(config)
 *   window.electronAPI.onTerminalData((sid, data) => {...})
 *
 * 而非嵌套方式：
 *   window.electronAPI.ssh.connect(config)
 *   window.electronAPI.on.terminalData((sid, data) => {...})
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ===== SSH 扁平化 =====
  sshConnect: ssh.connect,
  sshDisconnect: ssh.disconnect,
  sshExec: ssh.exec,
  sshShellStart: ssh.shell.start,
  sshShellWrite: ssh.shell.write,
  sshShellResize: ssh.shell.resize,
  /** 响应主机密钥确认弹窗（Phase L） */
  sshRespondHostKey: ssh.respondHostKey,
  // Phase M：SSH 密钥管理扁平化（删除 / 上传 / 生成 / 列表）
  /** 删除 SSH 密钥对（幂等） */
  sshDeleteKeyring: ssh.deleteKeyring,
  /** 上传 SSH 私钥（文件对话框 + 复制 + chmod 600 + derive 公钥） */
  sshUploadKeypair: ssh.uploadKeypair,
  /** 生成 SSH 密钥对（ssh-keygen ed25519/rsa） */
  sshGenerateKeypair: ssh.generateKeypair,
  /** 列出 ~/.ssh/ 目录下所有密钥对 */
  sshListKeypairs: ssh.listKeypairs,

  // ===== SFTP 扁平化 =====
  sftpList: sftp.list,
  sftpUpload: sftp.upload,
  sftpDownload: sftp.download,
  sftpDelete: sftp.delete,
  sftpRename: sftp.rename,
  sftpChmod: sftp.chmod,
  // v0.8 IDE 工作台新增
  sftpReadFile: sftp.readFile,
  sftpWriteFile: sftp.writeFile,
  sftpStat: sftp.stat,
  sftpMkdir: sftp.mkdir,

  // ===== 监控扁平化 =====
  monitorStart: monitor.start,
  monitorStop: monitor.stop,
  monitorGetSystemInfo: monitor.getSystemInfo,

  // ===== 安全存储扁平化 =====
  storageSaveApiKey: storage.saveApiKey,
  storageGetApiKey: storage.getApiKey,
  storageDeleteApiKey: storage.deleteApiKey,

  // ===== 配置存储扁平化 =====
  configGet: config.get,
  configSet: config.set,

  // ===== LLM 扁平化 =====
  llmChat: llm.chat,
  llmTest: llm.test,
  llmAnalyze: llm.analyze,
  llmValidate: llm.validate,
  llmChatWithContext: llm.chatWithContext,

  // ===== 服务器管理扁平化 =====
  serverList: server.list,
  serverSave: server.save,
  serverExport: server.export,
  serverImport: server.import,
  serverDeleteCred: server.deleteCred,

  // ===== 事件监听扁平化 =====
  onTerminalData: on.terminalData,
  /** 监听 SSH 心跳保活状态变更（K.2） */
  onSshStateChanged: on.sshStateChanged,
  /** 监听主机密钥确认弹窗推送（Phase L） */
  onSshHostKeyPrompt: on.sshHostKeyPrompt,
  onMonitorData: on.monitorData,
  onMonitorSystemInfo: on.monitorSystemInfo,
  onLlmToken: on.llmToken,
  onLlmChunk: on.llmChunk,
  onLlmDone: on.llmDone,
  onLlmError: on.llmError,
  onAgentStep: on.agentStep,
  // v0.9 Supervisor chat 流式事件
  onAgentChunk: on.agentChunk,
  onAgentDone: on.agentDone,
  onAgentError: on.agentError,

  // v0.9 Claude Agent SDK 流式事件（独立于 Supervisor，避免通道混用）
  onClaudeSdkChunk: on.claudeSdkChunk,
  onClaudeSdkDone: on.claudeSdkDone,
  onClaudeSdkError: on.claudeSdkError,

  // v0.9 沙箱命令审批请求事件（P-2：HC-6 强制审批，主进程推送审批请求）
  onSandboxApprovalRequest: on.sandboxApprovalRequest,

  // v0.9.5 PAOR 审批请求事件（PAOR 循环遇到高危命令时推送审批请求）
  onPaorApprovalRequest: on.paorApprovalRequest,

  // ===== Agent 扁平化（旧 AgentWorkflow，v0.8 及之前） =====
  // 注意：v0.8 旧 agentCancel 已被 v0.9.4 新签名覆盖（通过 sessionId 统一取消多类会话）。
  // v0.8 旧 agent:cancel IPC 通道仍保留在主进程 ipc/agent.ts 中（向后兼容 IPC 层），
  // 但 preload 不再暴露 v0.8 旧 agentCancel 方法（v0.8 AgentWorkflow 已被 v0.9 Supervisor 取代）。
  agentStart: (sessionId: string, problem: string): Promise<boolean> =>
    ipcRenderer.invoke('agent:start', sessionId, problem),
  agentConfirm: (sessionId: string, approved: boolean): Promise<boolean> =>
    ipcRenderer.invoke('agent:confirm', sessionId, approved),

  // ===== v0.9 Agent Runtime 扁平化（Supervisor chat + Provider + Token） =====
  agentChat: agentRuntime.chat,
  agentChatCancel: agentRuntime.cancel,
  // PAOR 自动循环（Plan→Act→Observe→Reflect 多步自主编排，方案书 §3.2）
  agentPaor: agentRuntime.paor,
  // v0.9.5 新增：响应 PAOR 审批请求（与 onPaorApprovalRequest 配合使用）
  paorApprove: agentRuntime.approve,
  // v0.9.4 新增：通过 sessionId 统一取消 agent:chat / claude-sdk 两类会话
  // 与 agentChatCancel 并存（向后兼容）：旧调用方继续用 agentChatCancel(correlationId)，
  // 新调用方推荐用 agentCancel(sessionId) 同时取消多类会话
  agentCancel: system.cancel,
  // v0.9.4 新增：系统级 IPC（协议版本 + 心跳保活）
  getProtocolVersion: system.getProtocolVersion,
  systemPing: system.ping,
  providerList: provider.list,
  providerGet: provider.get,
  providerSave: provider.save,
  providerSetDefault: provider.setDefault,
  tokenStats: token.stats,
  tokenReset: token.reset,
  // P-5 新增：token 使用明细记录（Token 监控面板展示明细列表 + 分布图表）
  tokenRecords: token.records,

  // ===== v0.9 Claude Agent SDK 扁平化（generate / stream / cancel） =====
  // 使用场景：Provider 选择器中选 claude-sdk 类型时走本通道，其他类型走 agentChat
  claudeSdkGenerate: claudeSdk.generate,
  claudeSdkStream: claudeSdk.stream,
  claudeSdkCancel: claudeSdk.cancel,

  // ===== v2.0 Phase B 扁平化：内联补全 + Diff 应用 =====
  // 通道与主进程 ipc/llm-inline.ts 一一对应；UI 调用方式：
  //   const items = await window.electronAPI.llmInlineCompletion(req)
  //   await window.electronAPI.llmInlineCompletionCancel()
  //   const r = await window.electronAPI.llmApplyDiff({ filePath, newContent })
  //   const { diff } = await window.electronAPI.llmDiffPreview({ filePath, originalContent, modifiedContent })
  llmInlineCompletion: llmInline.inlineCompletion,
  llmInlineCompletionCancel: llmInline.inlineCompletionCancel,
  llmApplyDiff: llmInline.applyDiff,
  llmDiffPreview: llmInline.diffPreview,

  // ===== v0.9 OpenHands 沙箱集成扁平化 =====
  // 通道与主进程 ipc/sandbox.ts 一一对应；UI 调用方式：
  //   const info = await window.electronAPI.sandboxCreate()
  //   const result = await window.electronAPI.sandboxExecute(info.id, 'ls', info.session_api_key!)
  sandboxDetectDocker: sandbox.detectDocker,
  sandboxStart: sandbox.start,
  sandboxStop: sandbox.stop,
  sandboxStatus: sandbox.status,
  sandboxCreate: sandbox.create,
  sandboxList: sandbox.list,
  sandboxExecute: sandbox.execute,
  // P-2：HC-6 强制审批响应通道（用户通过本函数响应主进程推送的 sandbox:approval-request）
  sandboxApprove: sandbox.approve,
  sandboxDelete: sandbox.delete,

  // ===== v0.9 @命令 8 类扁平化 =====
  // 通道与主进程 ipc/at-commands.ts 一一对应；UI 调用方式：
  //   const infos = await window.electronAPI.atList()
  //   const cmd = await window.electronAPI.atResolve('log', { rawText: '...' }, 'chat-input')
  //   const result = await window.electronAPI.atParse('请分析 @log[error]', 'chat-input')
  atList: atCommands.list,
  atResolve: atCommands.resolve,
  atParse: atCommands.parse,

  // ===== v0.9 可信度算法扁平化（D-S + PCR5 + 6 源证据 + DAG） =====
  // 通道与主进程 ipc/credibility.ts 一一对应；UI 调用方式：
  //   const assessment = await window.electronAPI.credibilityAssess(inputs)
  //   const dag = await window.electronAPI.credibilityDag(inputs)
  credibilityAssess: credibility.assess,
  credibilityDag: credibility.dag,
  // v0.9.6 P1：ECE 校准器扁平化 API
  credibilityCalibrate: credibility.calibrate,
  credibilityGetCalibration: credibility.getCalibration,
  credibilityGetCalibrationState: credibility.getCalibrationState,
  credibilityResetCalibration: credibility.resetCalibration,
  credibilityComputeEce: credibility.computeEce,
  credibilityAddCalibrationSample: credibility.addCalibrationSample,
  // v0.9.6 P2：EU AI Act 审计报告扁平化 API
  credibilityExportAuditReport: credibility.exportAuditReport,
  credibilityListAuditReports: credibility.listAuditReports,
  credibilityLoadAuditReport: credibility.loadAuditReport,
  credibilityFormatAuditReport: credibility.formatAuditReport,

  // ===== 知识库扁平化 =====
  kbSearch: (query: string, type: string, limit: number): Promise<unknown[]> =>
    ipcRenderer.invoke('kb:search', query, type, limit),
  kbAdd: (entry: unknown): Promise<boolean> =>
    ipcRenderer.invoke('kb:add', entry),
  kbUpdate: (id: string, entry: unknown): Promise<boolean> =>
    ipcRenderer.invoke('kb:update', id, entry),
  kbDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('kb:delete', id),
  kbExport: (type: string): Promise<string> =>
    ipcRenderer.invoke('kb:export', type),
  kbImport: (data: string): Promise<number> =>
    ipcRenderer.invoke('kb:import', data),

  // ===== 历史决策扁平化 =====
  historyList: (offset: number, limit: number): Promise<unknown[]> =>
    ipcRenderer.invoke('history:list', offset, limit),
  historyGet: (id: string): Promise<unknown> =>
    ipcRenderer.invoke('history:get', id),
  // P-8 修复：补充暴露 history:save 通道（主进程已注册，但 preload 此前未暴露）
  historySave: (card: DecisionCard): Promise<boolean> =>
    ipcRenderer.invoke('history:save', card),

  // ===== 系统架构感知扁平化 =====
  profilerRun: (sessionId: string, host: string): Promise<ProfilerRunResponse> =>
    ipcRenderer.invoke('profiler:run', sessionId, host),
  profilerExportMd: (
    md: string,
    outputPath: string
  ): Promise<{ filePath: string; size: number }> =>
    ipcRenderer.invoke('profiler:exportMd', md, outputPath),
  profilerExportPdf: (
    md: string,
    outputPath: string
  ): Promise<{ filePath: string; size: number }> =>
    ipcRenderer.invoke('profiler:exportPdf', md, outputPath),
  profilerDefaultFileName: (host: string, ext: 'md' | 'pdf'): Promise<string> =>
    ipcRenderer.invoke('profiler:defaultFileName', host, ext),

  // ===== 知识库教程扁平化 =====
  tutorialList: (category?: TutorialCategory): Promise<TutorialEntry[]> =>
    ipcRenderer.invoke('tutorial:list', category),
  tutorialGet: (id: string): Promise<TutorialEntry | null> =>
    ipcRenderer.invoke('tutorial:get', id),
  tutorialSearch: (query: string, limit?: number): Promise<TutorialEntry[]> =>
    ipcRenderer.invoke('tutorial:search', query, limit),
  tutorialCategories: (): Promise<TutorialCategorySummary[]> =>
    ipcRenderer.invoke('tutorial:categories'),
  tutorialSeedVersion: (): Promise<string> =>
    ipcRenderer.invoke('tutorial:seedVersion'),
  tutorialSeedReload: (): Promise<number> =>
    ipcRenderer.invoke('tutorial:seedReload'),

  // ===== 教程爬虫扁平化（v0.6.0）=====
  tutorialListSources: (): Promise<TutorialSourceSpec[]> =>
    ipcRenderer.invoke('tutorial:listSources'),
  tutorialCrawlStart: (args?: { sourceIds?: string[]; force?: boolean }): Promise<{
    success: boolean
    error?: string
    results: CrawlResult[]
  }> => ipcRenderer.invoke('tutorial:crawlStart', args),
  tutorialCrawlStatus: (): Promise<CrawlStatus> =>
    ipcRenderer.invoke('tutorial:crawlStatus'),
  tutorialCrawlCancel: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('tutorial:crawlCancel'),

  // 教程爬虫事件监听
  onTutorialCrawlProgress: (callback: (progress: CrawlProgress) => void): (() => void) => {
    return createListener('tutorial:crawlProgress', callback)
  },
  onTutorialCrawlDone: (callback: (result: CrawlResult) => void): (() => void) => {
    return createListener('tutorial:crawlDone', callback)
  },

  // ===== 教程磁盘 + 断点续传（v0.7.0）=====
  tutorialDiskInfo: (): Promise<{
    tempBytes: number
    knowledgeBytes: number
    quotaBytes: number
    usageRatio: number
    bySource: Array<{ sourceId: string; bytes: number; files: number }>
    orphanFiles: number
  }> => ipcRenderer.invoke('tutorial:diskInfo'),
  tutorialCleanupOrphans: (): Promise<{ success: boolean; cleanedBytes: number }> =>
    ipcRenderer.invoke('tutorial:cleanupOrphans'),
  tutorialCheckpoints: (): Promise<
    Array<{
      sourceId: string
      lastCrawledAt: number
      completedUrls: string[]
      totalBytes: number
      etag: string | null
      status: 'running' | 'paused' | 'done' | 'failed'
      errorMessage: string | null
      updatedAt: number
    }>
  > => ipcRenderer.invoke('tutorial:checkpoints'),
  tutorialResetCheckpoint: (sourceId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('tutorial:resetCheckpoint', sourceId),

  // ===== 教程混合检索 + embedding 回填 + 检索状态（v0.9.6 Sprint 7 任务 E）=====
  // 通道与主进程 ipc/tutorial.ts 一一对应：
  // - tutorial:hybrid-search      → tutorialHybridSearch（FTS5 BM25 + vec0 KNN + RRF 融合）
  // - tutorial:backfill-embeddings → tutorialBackfillEmbeddings（回填缺失 embedding）
  // - tutorial:search-status      → tutorialSearchStatus（检索能力快照）
  //
  // 通道名说明：
  //   原任务描述为 `tutorial:search`，但该通道已被现有 Jaccard 关键词搜索占用
  //   （返回 TutorialEntry[]）。为遵守"不破坏现有 API"约束，改用 `tutorial:hybrid-search`。
  //   现有 tutorialSearch（Jaccard 关键词搜索）保持不变。
  /**
   * 混合检索（FTS5 BM25 + vec0 KNN + RRF 融合）
   *
   * @param query 用户查询字符串
   * @param options.type 知识类型过滤（默认 'tutorial'）
   * @param options.limit 返回数量上限（默认 10）
   * @param options.useVector 是否启用向量检索（默认 true）
   * @returns HybridSearchResult[]（按 rrfScore 降序）
   */
  tutorialHybridSearch: (
    query: string,
    options?: TutorialHybridSearchOptions
  ): Promise<HybridSearchResult[]> =>
    ipcRenderer.invoke('tutorial:hybrid-search', query, options),
  /**
   * 回填缺失的 embedding 字段（长任务，2578 条需 1-3 分钟）
   *
   * @param options.batchSize 每批大小（默认 8）
   * @returns { total, success, failed, error? } 统计信息
   */
  tutorialBackfillEmbeddings: (
    options?: TutorialBackfillOptions
  ): Promise<TutorialBackfillResult> =>
    ipcRenderer.invoke('tutorial:backfill-embeddings', options),
  /**
   * 获取检索状态（向量是否可用 + 模型是否加载 + 总条目数）
   *
   * @returns TutorialSearchStatus（vectorEnabled / embeddingModelLoaded / embeddingDim / totalEntries）
   */
  tutorialSearchStatus: (): Promise<TutorialSearchStatus> =>
    ipcRenderer.invoke('tutorial:search-status'),

  // ===== 学习路径推荐（v0.9.6 Sprint 9）=====
  // 通道与主进程 ipc/tutorial.ts 一一对应：
  // - tutorial:recommend-path → tutorialRecommendPath（4 层融合路径推荐）
  //
  // 使用场景：
  // - 新手入门：从 linux-basics 开始，按依赖图逐步深入
  // - 定向提升：指定目标分类（如 networking），推荐前置 + 同级 + 进阶
  // - 命令驱动：学完某个命令后，推荐关联命令教程
  /**
   * 推荐学习路径（4 层融合：分类依赖 + 难度递进 + 命令关联 + 混合检索）
   *
   * @param options.goal 学习目标（自然语言，如"想学 Docker"）
   * @param options.currentLevel 当前水平（如 beginner / intermediate / advanced）
   * @param options.preferredCategory 偏好分类（如 networking）
   * @param options.maxSteps 最大步骤数（默认 8）
   * @returns TutorialPath[]（按融合分数排序的学习路径）
   */
  tutorialRecommendPath: (options?: RecommendPathOptions): Promise<TutorialPath[]> =>
    ipcRenderer.invoke('tutorial:recommend-path', options),

  // ===== Web 部署助手扁平化 =====
  deployListTemplates: (): Promise<DeployTemplateModel[]> =>
    ipcRenderer.invoke('deploy:listTemplates'),
  deployGetTemplate: (id: string): Promise<DeployTemplateModel | null> =>
    ipcRenderer.invoke('deploy:getTemplate', id),
  deployValidate: (
    templateId: string,
    values: Record<string, string>
  ): Promise<string[]> => ipcRenderer.invoke('deploy:validate', templateId, values),
  deployBuild: (
    templateId: string,
    values: Record<string, string>,
    targetHost: string
  ): Promise<{ plan?: DeployPlanModel; errors: string[] }> =>
    ipcRenderer.invoke('deploy:build', templateId, values, targetHost),
  deployExecute: (
    plan: DeployPlanModel,
    sessionId: string
  ): Promise<DeployResultModel> => ipcRenderer.invoke('deploy:execute', plan, sessionId),
  deployCancel: (planId: string): Promise<boolean> =>
    ipcRenderer.invoke('deploy:cancel', planId),
  deployGetStatus: (planId: string): Promise<{ status: string; currentIndex: number; total: number } | null> =>
    ipcRenderer.invoke('deploy:getStatus', planId),

  // 部署事件监听
  onDeployLog: (callback: (event: DeployLogEventModel) => void): (() => void) => {
    return createListener('deploy:log', callback)
  },
  onDeployStepUpdate: (
    callback: (payload: { planId: string; step: DeployStepResultModel }) => void
  ): (() => void) => {
    return createListener('deploy:stepUpdate', callback)
  },
  onDeployDone: (callback: (result: DeployResultModel) => void): (() => void) => {
    return createListener('deploy:done', callback)
  },

  // ===== LLM Tool Calling 扁平化（v0.5.0）=====
  llmChatWithTools: (messages: ChatMessage[]): Promise<string> =>
    ipcRenderer.invoke('llm:chat-with-tools', messages),
  llmToolApprove: (response: ToolApprovalResponse): Promise<boolean> =>
    ipcRenderer.invoke('llm:tool-approve', response),

  // 工具调用事件监听
  onLlmToolProgress: (callback: (progress: ToolCallProgress) => void): (() => void) => {
    return createListener('llm:tool-progress', callback)
  },
  onLlmToolApproval: (callback: (request: ToolApprovalRequest) => void): (() => void) => {
    return createListener('llm:tool-approval', callback)
  },

  // ===== 日志系统（v0.7.0）=====
  /** 读取日志条目（按条件过滤） */
  logRead: (filter?: { level?: string; category?: string; categoryPrefix?: string; keyword?: string; since?: string; limit?: number }): Promise<unknown[]> =>
    ipcRenderer.invoke('log:read', filter),
  /** 获取日志统计 */
  logStats: (): Promise<{ total: number; byLevel: Record<string, number>; byCategory: Record<string, number>; oldestTs: string | null; newestTs: string | null }> =>
    ipcRenderer.invoke('log:stats'),
  /** 清空内存 buffer */
  logClearBuffer: (): Promise<boolean> =>
    ipcRenderer.invoke('log:clearBuffer'),
  /** 设置最低日志级别 */
  logSetMinLevel: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'): Promise<boolean> =>
    ipcRenderer.invoke('log:setMinLevel', level),
  /** 异步刷新待写入日志 */
  logFlush: (): Promise<boolean> =>
    ipcRenderer.invoke('log:flush'),
  /** 渲染进程日志上报（转发到主进程 logger） */
  logRenderer: (payload: { level: string; category: string; message: string; meta?: Record<string, unknown>; correlationId?: string }): Promise<boolean> =>
    ipcRenderer.invoke('log:renderer', payload),

  // ===== v0.9.5 P0 新增：5 组缺失 IPC 通道扁平化（17 个方法） =====
  // 通道与主进程 ipc/{token-stats,mode,attention,subagent,provider-info}.ts 一一对应
  // UI 调用方式：
  //   const cost = await window.electronAPI.tokenCostStats()
  //   const modes = await window.electronAPI.modeList()
  //   const current = await window.electronAPI.attentionCurrent()
  //   const agents = await window.electronAPI.subagentList()
  //   const caps = await window.electronAPI.providerCapabilities({ providerId: 'xxx' })

  // 组 1：Token 成本透明（1 个）
  tokenCostStats: tokenCostStats.costStats,

  // 组 2：Mode 五模式切换（3 个）
  modeList: mode.list,
  modeSetDefault: mode.setDefault,
  modeGetCurrent: mode.getCurrent,

  // 组 3：Attention 注意力跟踪（7 个）
  attentionCurrent: attention.current,
  attentionHistory: attention.history,
  attentionTrackFiles: attention.trackFiles,
  attentionTrackCommands: attention.trackCommands,
  attentionTrackErrors: attention.trackErrors,
  attentionTrackKeywords: attention.trackKeywords,
  attentionReset: attention.reset,

  // v0.9.4 批次 4 - 任务 5 P2-E：预期回显监控（2 个）
  expectationCheck: expectation.check,
  expectationFormat: expectation.format,

  // 组 4：Subagent 自定义 Agent 加载器（2 个）
  subagentList: subagent.list,
  subagentReload: subagent.reload,

  // 组 5：Provider Info 能力 + 定价透明（4 个）
  providerCapabilities: providerInfo.capabilities,
  providerCapabilitiesAll: providerInfo.capabilitiesAll,
  providerPricing: providerInfo.pricing,
  providerPricingAll: providerInfo.pricingAll,

  // ===== v1.0 新增：Sidecar-A 进程管理 + 端到端 Pipeline =====
  // 通道与主进程 ipc/sidecar.ts 一一对应：
  // - sidecar:start    → sidecarStart（启动 Sidecar-A 进程）
  // - sidecar:stop     → sidecarStop（停止 Sidecar-A 进程）
  // - sidecar:status   → sidecarStatus（获取 Sidecar 状态）
  // - sidecar:health   → sidecarHealth（主动健康检查）
  // - sidecar:pipeline → sidecarPipeline（端到端 pipeline：日志 → Drain3 → OpenDerisk）
  /**
   * 启动 Sidecar-A 进程（SRE + 日志解析）
   * 通道：sidecar:start
   */
  sidecarStart: (): Promise<{ ok: boolean; status: string; error?: string }> =>
    ipcRenderer.invoke('sidecar:start'),
  /**
   * 停止 Sidecar-A 进程
   * 通道：sidecar:stop
   */
  sidecarStop: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('sidecar:stop'),
  /**
   * 获取 Sidecar 当前状态（stopped/starting/ready/degraded/crashed）
   * 通道：sidecar:status
   */
  sidecarStatus: (): Promise<{ status: string; lastError: string | null; restartCount: number }> =>
    ipcRenderer.invoke('sidecar:status'),
  /**
   * 主动健康检查（调用 Sidecar-A /health 端点）
   * 通道：sidecar:health
   */
  sidecarHealth: (): Promise<{ ok: boolean; error?: string; status?: string; version?: string; adapters?: { drain3: { ready: boolean; total_clusters: number }; open_derisk: { ready: boolean; mode: string; rules_count: number } }; uptime_seconds?: number }> =>
    ipcRenderer.invoke('sidecar:health'),
  /**
   * 端到端 Pipeline（v1.0 核心，v1.5 增强）：日志输入 → Drain3 解析 → OpenDerisk 诊断
   * 通道：sidecar:pipeline
   * @param logLines 原始日志行列表
   * @param serviceName 服务名（可选，辅助诊断）
   * @param llmConfig v1.5 新增：LLM 配置（启用 LLM 增强诊断，API Key 为空时降级到规则）
   */
  sidecarPipeline: (
    logLines: string[],
    serviceName?: string,
    llmConfig?: { apiKey: string; baseUrl: string; model: string },
  ): Promise<
    | {
        ok: true
        data: {
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
          diagnose: {
            root_cause: string
            confidence: number
            severity: string
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
  > => ipcRenderer.invoke('sidecar:pipeline', logLines, serviceName, llmConfig),

  // ===== v1.5 新增：多 Sidecar 状态查询（v1.5 多 Sidecar 架构）=====
  // 通道：sidecar:list-status → 返回所有 sidecar（A/B/C）的状态
  // 使用场景：UI 状态条 / SidecarStatusPanel 展示
  sidecarListStatus: (): Promise<SidecarListStatusResponse> =>
    ipcRenderer.invoke('sidecar:list-status'),

  // 通道：sidecar:start-one → 启动指定 sidecar（sre/analytics/agent）
  sidecarStartOne: (
    sidecarId: 'sre' | 'analytics' | 'agent',
  ): Promise<{ ok: boolean; status: string; error?: string }> =>
    ipcRenderer.invoke('sidecar:start-one', sidecarId),

  // 通道：sidecar:stop-one → 停止指定 sidecar
  sidecarStopOne: (sidecarId: 'sre' | 'analytics' | 'agent'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('sidecar:stop-one', sidecarId),

  // 通道：sidecar:health-one → 单个 sidecar 的健康检查
  sidecarHealthOne: (
    sidecarId: 'sre' | 'analytics' | 'agent',
  ): Promise<SidecarHealthOneResponse> =>
    ipcRenderer.invoke('sidecar:health-one', sidecarId),

  // 通道：sidecar:tool-call → 通用 Sidecar 工具调用（用于 Sidecar-B/C 的占位端点）
  // 例如：sidecar:tool-call('analytics', '/analytics/dowhy', { treatment, outcome, ... })
  sidecarToolCall: (
    sidecarId: 'sre' | 'analytics' | 'agent',
    endpoint: string,
    payload: unknown,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('sidecar:tool-call', sidecarId, endpoint, payload),

  // 通道：sidecar:parse-logs → 单独调用 Drain3 解析（不调 OpenDerisk）
  sidecarParseLogs: (
    logLines: string[],
    maxClusters?: number,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('sidecar:parse-logs', logLines, maxClusters),

  // ===== v1.5 新增：Promptfoo 红队 / Prompt 评估 =====
  // 通道：promptfoo:run-red-team → 运行红队测试（注入攻击场景，验证模型安全性）
  promptfooRunRedTeam: (
    modelProvider?: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('promptfoo:run-red-team', modelProvider),

  // 通道：promptfoo:run-eval → 运行 Prompt 评估（基于断言的 prompt 质量评估）
  promptfooRunEval: (
    modelProvider?: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('promptfoo:run-eval', modelProvider),

  // 通道：promptfoo:list-tests → 列出所有可用测试用例
  promptfooListTests: (): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('promptfoo:list-tests'),

  // ===== v1.5 新增：诊断服务（后端日志检测）=====
  // 通道：diagnostics:get-report → 获取完整诊断报告（含统计 + 检测结果）
  diagnosticsGetReport: (): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('diagnostics:get-report'),

  // 通道：diagnostics:get-logs → 获取缓冲区日志（可按来源/级别过滤）
  diagnosticsGetLogs: (
    options?: { source?: 'sre' | 'analytics' | 'agent' | 'main' | 'renderer'; level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'; limit?: number },
  ): Promise<{ ok: boolean; data?: unknown; total?: number; error?: string }> =>
    ipcRenderer.invoke('diagnostics:get-logs', options),

  // 通道：diagnostics:get-findings → 获取检测结果（可按严重性过滤）
  diagnosticsGetFindings: (
    options?: { severity?: 'info' | 'warning' | 'error' | 'critical'; limit?: number },
  ): Promise<{ ok: boolean; data?: unknown; total?: number; error?: string }> =>
    ipcRenderer.invoke('diagnostics:get-findings', options),

  // 通道：diagnostics:get-stats → 获取累计统计
  diagnosticsGetStats: (): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('diagnostics:get-stats'),

  // 通道：diagnostics:clear → 清空缓冲区（保留累计统计）
  diagnosticsClear: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('diagnostics:clear'),

  // 通道：diagnostics:set-enabled → 启用/禁用实时推送
  diagnosticsSetEnabled: (enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('diagnostics:set-enabled', enabled),

  // 通道：diagnostics:ingest-test → 测试用：注入测试日志（仅 dev 模式）
  diagnosticsIngestTest: (
    event: { source: 'sre' | 'analytics' | 'agent' | 'main' | 'renderer'; level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'; raw: string },
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('diagnostics:ingest-test', event),

  /**
   * 监听诊断服务实时日志批次推送
   *
   * 主进程通过 diagnostics:log-batch 通道批量推送 LogPushEvent[]，
   * 包含 Sidecar 的 stdout/stderr 日志和检测结果。
   *
   * @param callback 回调函数，接收 LogPushEvent[]
   * @returns 取消监听函数
   */
  onDiagnosticsLogBatch: (
    callback: (events: Array<{
      event: { timestamp: string; source: string; level: string; raw: string; pid?: number }
      hasFinding: boolean
      finding?: unknown
    }>) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, events: unknown) => callback(events as never)
    ipcRenderer.on('diagnostics:log-batch', handler)
    return () => { ipcRenderer.off('diagnostics:log-batch', handler) }
  },

  // ===== v1.5 新增：循环工程子 Agent（假设计 → 可演示真 IDE）=====
  //
  // 通道与主进程 ipc/loop-engineering.ts 一一对应。
  // 设计目标：让 Workbench AIPanel 的"演示模式"调用真实 LLM 推理 + 7 步 HITL 工作流。
  //
  // 使用场景：
  //   1. 用户在 AIPanel 输入问题（如"磁盘空间不足"）
  //   2. 调用 loopStart({ problem, connId, providerId?, strength? }) 启动循环工程
  //   3. 监听 onLoopLlmStart → onLoopLlmDone（LLM 推理阶段）
  //   4. 监听 onLoopStep（7 步 HITL 步骤变化：collect→analyze→reason→check→confirm→execute→verify）
  //   5. 监听 onLoopDecision（决策卡片就绪，显示批准/拒绝按钮）
  //   6. 用户点击批准 → 调用 loopConfirm(correlationId, true)
  //   7. 监听 onLoopDone（工作流完成，含最终 DecisionCard）
  //   8. 用户点击拒绝 → 调用 loopConfirm(correlationId, false) 或 loopCancel(correlationId)

  // 通道：loop:start → 启动循环工程
  loopStart: (
    input: {
      problem: string
      connId: string
      providerId?: string
      strength?: 'fast' | 'standard' | 'deep'
    },
  ): Promise<{ correlationId: string; status: string; error?: string }> =>
    ipcRenderer.invoke('loop:start', input),

  // 通道：loop:confirm → 人工确认（批准/拒绝）
  loopConfirm: (correlationId: string, approved: boolean): Promise<boolean> =>
    ipcRenderer.invoke('loop:confirm', correlationId, approved),

  // 通道：loop:cancel → 取消工作流
  loopCancel: (correlationId: string): Promise<boolean> =>
    ipcRenderer.invoke('loop:cancel', correlationId),

  // 事件：loop:llm-start — LLM 推理开始
  onLoopLlmStart: (
    callback: (payload: { type: 'loop:llm-start'; correlationId: string; problem: string }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on('loop:llm-start', handler)
    return () => { ipcRenderer.off('loop:llm-start', handler) }
  },

  // 事件：loop:llm-done — LLM 推理完成（含 hypothesis + fixCommand + confidence）
  onLoopLlmDone: (
    callback: (payload: {
      type: 'loop:llm-done'
      correlationId: string
      hypothesis: { hypothesis: string; fixCommand: string; confidence: number }
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on('loop:llm-done', handler)
    return () => { ipcRenderer.off('loop:llm-done', handler) }
  },

  // 事件：loop:step — 工作流步骤变化（含完整 AgentWorkflowState）
  onLoopStep: (
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
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on('loop:step', handler)
    return () => { ipcRenderer.off('loop:step', handler) }
  },

  // 事件：loop:decision — 决策卡片就绪（等待用户确认）
  onLoopDecision: (
    callback: (payload: {
      type: 'loop:decision'
      correlationId: string
      state: unknown
      decisionCard: {
        id: string
        problem: string
        hypothesis: string
        evidences: unknown[]
        confidence: number
        risk: { level: string; score: number; description: string; requireConfirmation: boolean; blocked: boolean }
        fixCommand: string
        fixDescription: string
        rollbackCommand?: string
        status: string
        timestamp: number
      }
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on('loop:decision', handler)
    return () => { ipcRenderer.off('loop:decision', handler) }
  },

  // 事件：loop:done — 工作流完成（含最终 DecisionCard）
  onLoopDone: (
    callback: (payload: {
      type: 'loop:done'
      correlationId: string
      state: unknown
      decisionCard: unknown | null
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on('loop:done', handler)
    return () => { ipcRenderer.off('loop:done', handler) }
  },

  // 事件：loop:error — 工作流出错
  onLoopError: (
    callback: (payload: { type: 'loop:error'; correlationId: string; error: string; state?: unknown }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on('loop:error', handler)
    return () => { ipcRenderer.off('loop:error', handler) }
  },

  // 事件：loop:blocked — 工作流被阻止（如 SSH 未连接）
  onLoopBlocked: (
    callback: (payload: {
      type: 'loop:blocked'
      correlationId: string
      step: string
      reason: string
      message: string
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on('loop:blocked', handler)
    return () => { ipcRenderer.off('loop:blocked', handler) }
  },

  // ===== Phase 6 Task 6.5：调度器扁平化（定时任务自动化）=====
  // 通道与主进程 ipc/scheduler.ts 一一对应；UI 调用方式：
  //   const tasks = await window.electronAPI.schedulerList()
  //   await window.electronAPI.schedulerToggle('daily-health-check', false)
  //   const result = await window.electronAPI.schedulerTrigger('daily-health-check')
  //   const off = window.electronAPI.onSchedulerStatusChange((status) => { ... })
  schedulerList: scheduler.list,
  schedulerToggle: scheduler.toggle,
  schedulerTrigger: scheduler.trigger,
  // 事件监听：scheduler:status — 任务状态变更推送
  onSchedulerStatusChange: on.schedulerStatus,

  // ===== v2.0 Phase C 扁平化：SFTP 文件搜索 + grep + 文件监听 =====
  // 通道与主进程 ipc/sftp-search.ts / ipc/file-watcher.ts 一一对应；UI 调用方式：
  //   const { files } = await window.electronAPI.sftpSearch(sessionId, '/etc', 'nginx')
  //   const { results } = await window.electronAPI.sftpGrep({ sessionId, path, pattern, ... })
  //   const { watchId } = await window.electronAPI.fileWatchStart(sessionId, '/var/log')
  //   const off = window.electronAPI.onFileChanged((payload) => { ... })
  //   await window.electronAPI.fileWatchStop(watchId)
  sftpSearch: sftpSearch.search,
  sftpGrep: sftpSearch.grep,
  fileWatchStart: fileWatch.start,
  fileWatchStop: fileWatch.stop,
  // 事件监听：file:changed — 文件变更推送
  onFileChanged: on.fileChanged,
} as unknown as ElectronAPI)

// ============================================================================
// v1.5 多 Sidecar 共享类型（提取到顶层避免 TS 解析歧义）
// ============================================================================

type SidecarListStatusResponse = {
  ok: boolean
  data?: Record<
    string,
    {
      id: string
      name: string
      port: number
      status: 'stopped' | 'starting' | 'ready' | 'degraded' | 'crashed'
      lastError: string | null
    }
  >
  error?: string
}

type SidecarHealthOneResponse = {
  ok: boolean
  error?: string
  status?: string
  version?: string
  adapters?: Record<string, { ready: boolean; note?: string }>
  uptime_seconds?: number
}

// 导出类型供 preload/index.d.ts 使用
// 注意：类型定义需要同步更新为扁平化接口
export type ElectronAPI = {
  // SSH
  sshConnect: typeof ssh.connect
  sshDisconnect: typeof ssh.disconnect
  sshExec: typeof ssh.exec
  sshShellStart: typeof ssh.shell.start
  sshShellWrite: typeof ssh.shell.write
  sshShellResize: typeof ssh.shell.resize
  /** 响应主机密钥确认弹窗（Phase L） */
  sshRespondHostKey: typeof ssh.respondHostKey
  // Phase M：SSH 密钥管理（删除 / 上传 / 生成 / 列表）
  /** 删除 SSH 密钥对（幂等） */
  sshDeleteKeyring: typeof ssh.deleteKeyring
  /** 上传 SSH 私钥（文件对话框 + 复制 + chmod 600 + derive 公钥） */
  sshUploadKeypair: typeof ssh.uploadKeypair
  /** 生成 SSH 密钥对（ssh-keygen ed25519/rsa） */
  sshGenerateKeypair: typeof ssh.generateKeypair
  /** 列出 ~/.ssh/ 目录下所有密钥对 */
  sshListKeypairs: typeof ssh.listKeypairs
  // SFTP
  sftpList: typeof sftp.list
  sftpUpload: typeof sftp.upload
  sftpDownload: typeof sftp.download
  sftpDelete: typeof sftp.delete
  sftpRename: typeof sftp.rename
  sftpChmod: typeof sftp.chmod
  // v0.8 IDE 工作台新增
  sftpReadFile: typeof sftp.readFile
  sftpWriteFile: typeof sftp.writeFile
  sftpStat: typeof sftp.stat
  sftpMkdir: typeof sftp.mkdir
  // Monitor
  monitorStart: typeof monitor.start
  monitorStop: typeof monitor.stop
  monitorGetSystemInfo: typeof monitor.getSystemInfo
  // Storage
  storageSaveApiKey: typeof storage.saveApiKey
  storageGetApiKey: typeof storage.getApiKey
  storageDeleteApiKey: typeof storage.deleteApiKey
  // Config
  configGet: typeof config.get
  configSet: typeof config.set
  // LLM
  llmChat: typeof llm.chat
  llmTest: typeof llm.test
  llmAnalyze: typeof llm.analyze
  llmValidate: typeof llm.validate
  llmChatWithContext: typeof llm.chatWithContext
  // Server
  serverList: typeof server.list
  serverSave: typeof server.save
  serverExport: typeof server.export
  serverImport: typeof server.import
  serverDeleteCred: typeof server.deleteCred
  // Profiler
  profilerRun: typeof profiler.run
  profilerExportMd: typeof profiler.exportMd
  profilerExportPdf: typeof profiler.exportPdf
  profilerDefaultFileName: typeof profiler.defaultFileName
  // Events - 每个方法返回一个取消监听函数
  onTerminalData: (callback: (sessionId: string, data: string) => void) => () => void
  /** 监听 SSH 心跳保活状态变更（K.2） */
  onSshStateChanged: (callback: (event: SshStateEvent) => void) => () => void
  /** 监听主机密钥确认弹窗推送（Phase L） */
  onSshHostKeyPrompt: (callback: (prompt: SshHostKeyPromptEvent) => void) => () => void
  onMonitorData: (callback: (sessionId: string, data: MonitorData) => void) => () => void
  onMonitorSystemInfo: (callback: (sessionId: string, info: SystemInfo) => void) => () => void
  onLlmToken: (callback: (token: string) => void) => () => void
  onLlmChunk: (callback: (chunk: LlmStreamChunk) => void) => () => void
  onLlmDone: (callback: (fullText: string) => void) => () => void
  onLlmError: (callback: (error: LlmError) => void) => () => void
  onAgentStep: (callback: (state: AgentWorkflowState) => void) => () => void
  // v0.9 Supervisor chat 流式事件
  onAgentChunk: (callback: (payload: AgentChunkPayload) => void) => () => void
  onAgentDone: (callback: (payload: AgentDonePayload) => void) => () => void
  onAgentError: (callback: (payload: AgentErrorPayload) => void) => () => void
  // v0.9 Claude Agent SDK 流式事件（独立于 Supervisor）
  onClaudeSdkChunk: (callback: (payload: AgentChunkPayload) => void) => () => void
  onClaudeSdkDone: (callback: (payload: AgentDonePayload) => void) => () => void
  onClaudeSdkError: (callback: (payload: AgentErrorPayload) => void) => () => void
  // Agent（旧 AgentWorkflow，v0.8 及之前）
  agentStart: (sessionId: string, problem: string) => Promise<boolean>
  agentConfirm: (sessionId: string, approved: boolean) => Promise<boolean>
  // v0.9.4 新增：通过 sessionId 统一取消 agent:chat / claude-sdk 两类会话
  // 注意：v0.8 旧 agentCancel（调用 agent:cancel 通道）已被新签名覆盖
  agentCancel: typeof system.cancel
  // v0.9 Agent Runtime（Supervisor chat + Provider + Token）
  agentChat: typeof agentRuntime.chat
  agentChatCancel: typeof agentRuntime.cancel
  // v0.9.4 新增：系统级 IPC（协议版本 + 心跳保活 + 通用取消）
  getProtocolVersion: typeof system.getProtocolVersion
  systemPing: typeof system.ping
  providerList: typeof provider.list
  providerGet: typeof provider.get
  providerSave: typeof provider.save
  providerSetDefault: typeof provider.setDefault
  tokenStats: typeof token.stats
  tokenReset: typeof token.reset
  // P-5 新增：token 使用明细记录
  tokenRecords: typeof token.records
  // v0.9 Claude Agent SDK（claude-sdk:generate / stream / cancel）
  claudeSdkGenerate: typeof claudeSdk.generate
  claudeSdkStream: typeof claudeSdk.stream
  claudeSdkCancel: typeof claudeSdk.cancel
  // v2.0 Phase B：内联补全 + Diff 应用（llm:inline-completion / cancel / apply-diff / diff-preview）
  llmInlineCompletion: typeof llmInline.inlineCompletion
  llmInlineCompletionCancel: typeof llmInline.inlineCompletionCancel
  llmApplyDiff: typeof llmInline.applyDiff
  llmDiffPreview: typeof llmInline.diffPreview
  // v0.9 OpenHands 沙箱集成
  sandboxDetectDocker: typeof sandbox.detectDocker
  sandboxStart: typeof sandbox.start
  sandboxStop: typeof sandbox.stop
  sandboxStatus: typeof sandbox.status
  sandboxCreate: typeof sandbox.create
  sandboxList: typeof sandbox.list
  sandboxExecute: typeof sandbox.execute
  sandboxDelete: typeof sandbox.delete
  // v0.9 @命令 8 类（log/cmd/file/metric/decision/kb/skill/server）
  atList: typeof atCommands.list
  atResolve: typeof atCommands.resolve
  atParse: typeof atCommands.parse
  // Knowledge
  kbSearch: (query: string, type: string, limit: number) => Promise<unknown[]>
  kbAdd: (entry: unknown) => Promise<boolean>
  kbUpdate: (id: string, entry: unknown) => Promise<boolean>
  kbDelete: (id: string) => Promise<boolean>
  kbExport: (type: string) => Promise<string>
  kbImport: (data: string) => Promise<number>
  // History
  historyList: (offset: number, limit: number) => Promise<unknown[]>
  historyGet: (id: string) => Promise<unknown>
  // P-8 修复：补充 historySave 类型声明
  historySave: (card: DecisionCard) => Promise<boolean>
  // Tutorial
  tutorialList: (category?: TutorialCategory) => Promise<TutorialEntry[]>
  tutorialGet: (id: string) => Promise<TutorialEntry | null>
  tutorialSearch: (query: string, limit?: number) => Promise<TutorialEntry[]>
  tutorialCategories: () => Promise<TutorialCategorySummary[]>
  tutorialSeedVersion: () => Promise<string>
  tutorialSeedReload: () => Promise<number>
  // Tutorial Crawler (v0.6.0)
  tutorialListSources: () => Promise<TutorialSourceSpec[]>
  tutorialCrawlStart: (args?: { sourceIds?: string[]; force?: boolean }) => Promise<{
    success: boolean
    error?: string
    results: CrawlResult[]
  }>
  tutorialCrawlStatus: () => Promise<CrawlStatus>
  tutorialCrawlCancel: () => Promise<{ success: boolean }>
  onTutorialCrawlProgress: (callback: (progress: CrawlProgress) => void) => () => void
  onTutorialCrawlDone: (callback: (result: CrawlResult) => void) => () => void
  // v0.9.6 Sprint 7 任务 E：混合检索 + embedding 回填 + 检索状态
  // 通道与主进程 ipc/tutorial.ts 一一对应；UI 调用方式：
  //   const results = await window.electronAPI.tutorialHybridSearch('nginx 502', { limit: 5 })
  //   const stats = await window.electronAPI.tutorialBackfillEmbeddings({ batchSize: 16 })
  //   const status = await window.electronAPI.tutorialSearchStatus()
  tutorialHybridSearch: (
    query: string,
    options?: TutorialHybridSearchOptions
  ) => Promise<HybridSearchResult[]>
  tutorialBackfillEmbeddings: (
    options?: TutorialBackfillOptions
  ) => Promise<TutorialBackfillResult>
  tutorialSearchStatus: () => Promise<TutorialSearchStatus>
  // Deploy
  deployListTemplates: () => Promise<DeployTemplateModel[]>
  deployGetTemplate: (id: string) => Promise<DeployTemplateModel | null>
  deployValidate: (templateId: string, values: Record<string, string>) => Promise<string[]>
  deployBuild: (
    templateId: string,
    values: Record<string, string>,
    targetHost: string
  ) => Promise<{ plan?: DeployPlanModel; errors: string[] }>
  deployExecute: (plan: DeployPlanModel, sessionId: string) => Promise<DeployResultModel>
  deployCancel: (planId: string) => Promise<boolean>
  deployGetStatus: (planId: string) => Promise<{ status: string; currentIndex: number; total: number } | null>
  onDeployLog: (callback: (event: DeployLogEventModel) => void) => () => void
  onDeployStepUpdate: (callback: (payload: { planId: string; step: DeployStepResultModel }) => void) => () => void
  onDeployDone: (callback: (result: DeployResultModel) => void) => () => void
  // LLM Tool Calling (v0.5.0)
  llmChatWithTools: (messages: ChatMessage[]) => Promise<string>
  llmToolApprove: (response: ToolApprovalResponse) => Promise<boolean>
  onLlmToolProgress: (callback: (progress: ToolCallProgress) => void) => () => void
  onLlmToolApproval: (callback: (request: ToolApprovalRequest) => void) => () => void
  // Logging (v0.7.0)
  logRead: (filter?: { level?: string; category?: string; categoryPrefix?: string; keyword?: string; since?: string; limit?: number }) => Promise<unknown[]>
  logStats: () => Promise<{ total: number; byLevel: Record<string, number>; byCategory: Record<string, number>; oldestTs: string | null; newestTs: string | null }>
  logClearBuffer: () => Promise<boolean>
  logSetMinLevel: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL') => Promise<boolean>
  logFlush: () => Promise<boolean>
  logRenderer: (payload: { level: string; category: string; message: string; meta?: Record<string, unknown>; correlationId?: string }) => Promise<boolean>
  // v0.9.5 P0 新增：5 组缺失 IPC 通道（17 个方法）
  // 组 1：Token 成本透明（1 个）
  tokenCostStats: typeof tokenCostStats.costStats
  // 组 2：Mode 五模式切换（3 个）
  modeList: typeof mode.list
  modeSetDefault: typeof mode.setDefault
  modeGetCurrent: typeof mode.getCurrent
  // 组 3：Attention 注意力跟踪（7 个）
  attentionCurrent: typeof attention.current
  attentionHistory: typeof attention.history
  attentionTrackFiles: typeof attention.trackFiles
  attentionTrackCommands: typeof attention.trackCommands
  attentionTrackErrors: typeof attention.trackErrors
  attentionTrackKeywords: typeof attention.trackKeywords
  attentionReset: typeof attention.reset
  // v0.9.4 批次 4 - 任务 5 P2-E：预期回显监控（2 个）
  expectationCheck: typeof expectation.check
  expectationFormat: typeof expectation.format
  // 组 4：Subagent 自定义 Agent 加载器（2 个）
  subagentList: typeof subagent.list
  subagentReload: typeof subagent.reload
  // 组 5：Provider Info 能力 + 定价透明（4 个）
  providerCapabilities: typeof providerInfo.capabilities
  providerCapabilitiesAll: typeof providerInfo.capabilitiesAll
  providerPricing: typeof providerInfo.pricing
  providerPricingAll: typeof providerInfo.pricingAll
  // v1.0 新增：Sidecar-A 进程管理 + 端到端 Pipeline
  // 通道与主进程 ipc/sidecar.ts 一一对应
  sidecarStart: () => Promise<{ ok: boolean; status: string; error?: string }>
  sidecarStop: () => Promise<{ ok: boolean }>
  sidecarStatus: () => Promise<{ status: string; lastError: string | null; restartCount: number }>
  sidecarHealth: () => Promise<{
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
  sidecarPipeline: (
    logLines: string[],
    serviceName?: string,
    llmConfig?: { apiKey: string; baseUrl: string; model: string },
  ) => Promise<
    | {
        ok: true
        data: {
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
          diagnose: {
            root_cause: string
            confidence: number
            severity: string
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

  // ===== v1.5 新增：多 Sidecar 状态查询（v1.5 多 Sidecar 架构）=====
  // 通道：sidecar:list-status → 返回所有 sidecar（A/B/C）的状态
  // 使用场景：UI 状态条 / SidecarStatusPanel 展示
  sidecarListStatus: () => Promise<SidecarListStatusResponse>

  // 通道：sidecar:start-one → 启动指定 sidecar（sre/analytics/agent）
  sidecarStartOne: (
    sidecarId: 'sre' | 'analytics' | 'agent',
  ) => Promise<{ ok: boolean; status: string; error?: string }>

  // 通道：sidecar:stop-one → 停止指定 sidecar
  sidecarStopOne: (
    sidecarId: 'sre' | 'analytics' | 'agent',
  ) => Promise<{ ok: boolean }>

  // 通道：sidecar:health-one → 单个 sidecar 的健康检查
  sidecarHealthOne: (
    sidecarId: 'sre' | 'analytics' | 'agent',
  ) => Promise<SidecarHealthOneResponse>

  // 通道：sidecar:tool-call → 通用 Sidecar 工具调用（用于 Sidecar-B/C 的占位端点）
  // 例如：sidecar:tool-call('analytics', '/analytics/dowhy', { treatment, outcome, ... })
  sidecarToolCall: (
    sidecarId: 'sre' | 'analytics' | 'agent',
    endpoint: string,
    payload: unknown,
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>

  // 通道：sidecar:parse-logs → 单独调用 Drain3 解析（不调 OpenDerisk）
  sidecarParseLogs: (
    logLines: string[],
    maxClusters?: number,
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>

  // ===== v1.5 新增：Promptfoo 红队 / Prompt 评估 =====
  promptfooRunRedTeam: (
    modelProvider?: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>

  promptfooRunEval: (
    modelProvider?: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>

  promptfooListTests: () => Promise<{ ok: boolean; data?: unknown; error?: string }>

  // ===== v1.5 新增：诊断服务（后端日志检测）=====
  diagnosticsGetReport: () => Promise<{ ok: boolean; data?: unknown; error?: string }>

  diagnosticsGetLogs: (
    options?: { source?: string; level?: string; limit?: number },
  ) => Promise<{ ok: boolean; data?: unknown; total?: number; error?: string }>

  diagnosticsGetFindings: (
    options?: { severity?: string; limit?: number },
  ) => Promise<{ ok: boolean; data?: unknown; total?: number; error?: string }>

  diagnosticsGetStats: () => Promise<{ ok: boolean; data?: unknown; error?: string }>

  diagnosticsClear: () => Promise<{ ok: boolean; error?: string }>

  diagnosticsSetEnabled: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>

  diagnosticsIngestTest: (
    event: { source: string; level: string; raw: string },
  ) => Promise<{ ok: boolean; error?: string }>

  onDiagnosticsLogBatch: (
    callback: (events: Array<{
      event: { timestamp: string; source: string; level: string; raw: string; pid?: number }
      hasFinding: boolean
      finding?: unknown
    }>) => void,
  ) => () => void

  // ===== v1.5 新增：循环工程子 Agent（loop:* 通道）=====
  loopStart: (input: {
    problem: string
    connId: string
    providerId?: string
    strength?: 'fast' | 'standard' | 'deep'
  }) => Promise<{ correlationId: string; status: string; error?: string }>

  loopConfirm: (correlationId: string, approved: boolean) => Promise<boolean>

  loopCancel: (correlationId: string) => Promise<boolean>

  onLoopLlmStart: (
    callback: (payload: { type: 'loop:llm-start'; correlationId: string; problem: string }) => void,
  ) => () => void

  onLoopLlmDone: (
    callback: (payload: {
      type: 'loop:llm-done'
      correlationId: string
      hypothesis: { hypothesis: string; fixCommand: string; confidence: number }
    }) => void,
  ) => () => void

  onLoopStep: (
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
  ) => () => void

  onLoopDecision: (
    callback: (payload: {
      type: 'loop:decision'
      correlationId: string
      state: unknown
      decisionCard: {
        id: string
        problem: string
        hypothesis: string
        evidences: unknown[]
        confidence: number
        risk: { level: string; score: number; description: string; requireConfirmation: boolean; blocked: boolean }
        fixCommand: string
        fixDescription: string
        rollbackCommand?: string
        status: string
        timestamp: number
      }
    }) => void,
  ) => () => void

  onLoopDone: (
    callback: (payload: {
      type: 'loop:done'
      correlationId: string
      state: unknown
      decisionCard: unknown | null
    }) => void,
  ) => () => void

  onLoopError: (
    callback: (payload: { type: 'loop:error'; correlationId: string; error: string; state?: unknown }) => void,
  ) => () => void

  /** 监听 loop:blocked — 工作流被阻止（如 SSH 未连接） */
  onLoopBlocked: (
    callback: (payload: {
      type: 'loop:blocked'
      correlationId: string
      step: string
      reason: string
      message: string
    }) => void,
  ) => () => void

  // ===== Phase 6 Task 6.5：调度器（定时任务自动化）=====
  // 通道与主进程 ipc/scheduler.ts 一一对应
  /** 查询所有定时任务状态（scheduler:list） */
  schedulerList: typeof scheduler.list
  /** 启用/禁用指定任务（scheduler:toggle），任务不存在时返回 null */
  schedulerToggle: typeof scheduler.toggle
  /** 立即触发指定任务（scheduler:trigger），返回 TaskResult */
  schedulerTrigger: typeof scheduler.trigger
  /** 监听任务状态变更推送（scheduler:status），返回取消监听函数 */
  onSchedulerStatusChange: (callback: (status: SchedulerTaskStatus) => void) => () => void

  // ===== v2.0 Phase C：SFTP 文件搜索 + grep + 文件监听 =====
  /** 模糊查找远程文件（sftp:search），返回 { files, error? } */
  sftpSearch: typeof sftpSearch.search
  /** 远程内容 grep（sftp:grep），返回 { results, error? } */
  sftpGrep: typeof sftpSearch.grep
  /** 开始监听远程路径文件变更（file:watch:start），返回 { watchId } */
  fileWatchStart: typeof fileWatch.start
  /** 停止监听（file:watch:stop），返回 { success } */
  fileWatchStop: typeof fileWatch.stop
  /** 监听文件变更推送（file:changed），返回取消监听函数 */
  onFileChanged: (callback: (payload: FileChangedPayload) => void) => () => void
}
