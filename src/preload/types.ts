/**
 * preload 内部共用的结构体与类型别名（从 index.ts 搬出）。
 * 拆前：类型、域实现、暴露面挤在同一个 3400 行文件；拆后：域文件与 index.ts 都从这里 import。
 */
import type { AtCommandType } from '@shared/at-command-types'
import type { TutorialCategory, TutorialDifficulty } from '@shared/tutorial-types'

export interface HybridSearchResult {
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
// v0.9.6 Sprint 9 任务：学习路径推荐类型（内联定义，与主进程 path-recommender.ts 保持一致）
// ============================================================================
// 注意：这里不直接从主进程导入（preload 不能依赖主进程模块），
//      也不放到 @shared/path-recommender-types.ts（避免新增 shared 文件）。
//      类型结构与主进程保持一致。

/** 学习路径步骤 */
export interface PathStep {
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
export interface TutorialPath {
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
export interface RecommendPathOptions {
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

/** 沙箱 IPC 失败响应（与主进程 ErrorResponse 对应） */
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
 * PAOR 审批请求载荷（v0.9.5 新增）
 *
 * PAOR 循环中遇到 HIGH/CRITICAL 风险命令时主进程推送 paor:approval-request 事件，
 * 渲染进程弹窗显示命令 + 风险等级，用户通过 paorApprove(callId, approved) 响应。
 *
 * 注意：60 秒未响应主进程会自动拒绝。
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

/**
 * Task Protocol 审批请求载荷（v0.9.3 §11 遗留项 2 P2-H 新增）
 *
 * 主进程在 task-protocol step 2 check-permission 推送 task:permission-approval-request 事件，
 * 渲染进程弹窗显示 taskId / subagentName / inputSummary，用户通过 taskPermissionApprove(callId, decision) 响应。
 *
 * 三态权限审批（R12，参考 AgentScope Permission）：
 * - mode='always'：每次都询问用户（默认）
 * - mode='auto'：自动允许（不推送审批请求）
 * - mode='never'：自动拒绝（不推送审批请求）
 *
 * 注意：30 秒未响应主进程会自动拒绝。
 */
export interface TaskPermissionApprovalRequest {
  /** 审批调用 ID（与 taskPermissionApprove 的 callId 参数对应） */
  callId: string
  /** 任务 ID（来自 TaskProtocolContext.taskId） */
  taskId: string
  /** 目标 Subagent 名称 */
  subagentName: string
  /** 任务输入摘要（可选，前 200 字符） */
  inputSummary?: string
  /** 父会话 ID（可选） */
  parentSessionId?: string
  /** 关联 ID（可选，用于日志追踪） */
  correlationId?: string
  /** 时间戳（ms） */
  timestamp: number
  /** 权限模式（always/auto/never，告诉 UI 当前是哪种模式触发了询问） */
  mode: 'always' | 'auto' | 'never'
}

/**
 * Task Protocol 审批决策（v0.9.3 §11 遗留项 2 P2-H 新增）
 *
 * 渲染进程通过 taskPermissionApprove(callId, decision) 响应审批请求。
 */
export interface TaskPermissionDecision {
  /** 是否批准 */
  approved: boolean
  /** 拒绝原因（approved=false 时填充，可选） */
  rejectReason?: string
  /** 是否记住决策（可选，默认 false；v1.6 实现持久化规则表） */
  remember?: boolean
}

// ============================================================================
// v0.9 @命令元信息类型（与主进程 ipc/at-commands.ts 的 AtCommandInfo 对应）
// ============================================================================

/** @命令元信息（at:list 返回的单项，UI 选择器渲染用） */
export interface AtCommandInfo {
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

// ============================================================================
// v1.5 多 Sidecar 共享类型（提取到顶层避免 TS 解析歧义）
// ============================================================================
export type SidecarListStatusResponse = {
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

export type SidecarHealthOneResponse = {
  ok: boolean
  error?: string
  status?: string
  version?: string
  adapters?: Record<string, { ready: boolean; note?: string }>
  uptime_seconds?: number
}
