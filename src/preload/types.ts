/**
 * preload 内部共用的结构体与类型别名（从 index.ts 搬出）。
 * 拆前：类型、域实现、暴露面挤在同一个 3400 行文件；拆后：域文件与 index.ts 都从这里 import。
 */
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
 * 审批载荷的唯一声明在 @shared/approval-types（#111）。
 *
 * 这里只转发。以前 main / preload / renderer 各抄一份，preload 那份比 main 少了
 * sessionId、sideEffects、rollbackCommand、saferAlternative 四个字段——主进程把这几样
 * 算好了却没人能取，沙箱审批弹窗上因此只剩一条光命令。
 */
export type {
  SandboxCommandRiskLevel,
  SandboxApprovalRequest,
  PaorApprovalOrigin,
  PaorApprovalRequest,
} from '@shared/approval-types'

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
