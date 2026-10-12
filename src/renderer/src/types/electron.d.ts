/**
 * electronAPI 全局类型声明
 *
 * preload 脚本通过 contextBridge 暴露的 IPC 桥接接口类型定义。
 * 渲染进程通过 window.electronAPI 调用主进程能力，所有方法返回 Promise。
 *
 * 事件监听方法（onXxx）用于接收主进程推送的实时数据。
 */
import type { ContractedEventApi, ContractedInvokeApi } from './generated/ipc-contract'
import type { ElectronAPI as PreloadElectronAPI } from '../../../preload'
import type {
  Evidence,
} from '@shared/models'

// 拦截规则只读快照（risk:rules）——与主进程 COMMAND_RULES_SNAPSHOT 同形，
// 类型定义只有一份，在 src/shared/ipc-channels.ts


// 部署助手类型（来自共享层 @shared/deploy-types）


// LLM Tool Calling 类型（v0.5.0）


// 教程爬虫类型（v0.6.0）


// P0-3：PAOR 自动循环共享类型（agent:paor + agent:paor:iteration + paor:approve）


// v0.9 Agent Runtime 共享类型（Provider 抽象 + Token 统计 + Supervisor chat 载荷）


// v0.9.4 IPC 协议优化（sessionId + abort signal + protocolVersion + ping/pong）


// v0.9 @命令共享类型（8 类 @命令：log/cmd/file/metric/decision/kb/skill/server）
import type { AtCommandType } from '@shared/at-command-types'

// A4 新增：数据库状态（db:status，SQLite 降级可见化）



// v0.9.5 P0 新增：5 组缺失 IPC 通道共享类型（成本透明 / 模式切换 / 注意力 / Subagent / Provider 信息）

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

// ============================================================================
// v2.2 P1 修复 #24：应用更新类型声明（与 main/ipc/app-update.ts 对齐）
//
// 简化方案：HTTP GET GitHub Releases API 比对版本号，不引入 electron-updater。
// 类型在渲染层独立声明（避免从 main/ import 造成构建依赖）。
// ============================================================================

/**
 * 应用信息（app:get-info 返回，T.8）
 *
 * 字段与 main/ipc/app-update.ts AppInfo 完全对齐。
 */
export interface AppInfo {
  /** 应用版本号（含 v 前缀，如 'v1.0.0'） */
  version: string
  /** 应用安装/资源路径 */
  installPath: string
  /** 构建时间（ISO 8601 字符串） */
  buildTime: string
  /** 构建时间展示文本（Build YYYY.MM.DD） */
  buildBadge: string
  /** 应用数据目录（app.getPath('userData')） */
  dataPath: string
  /** 应用日志目录（userData/logs） */
  logPath: string
}

/**
 * 应用更新信息（检查成功时返回）
 *
 * 字段与 main/ipc/app-update.ts AppUpdateInfo 完全对齐。
 */
export interface AppUpdateInfo {
  /** 是否有新版本 */
  hasUpdate: boolean
  /** 最新版本号（含 v 前缀，如 'v1.0.1'） */
  latestVersion: string
  /** 当前版本号（含 v 前缀，如 'v1.0.0'） */
  currentVersion: string
  /** Release 页面 URL（用户可手动下载） */
  releaseUrl: string
  /** 更新日志（Markdown 格式，来自 Release body） */
  releaseNotes: string
  /** Release 发布时间（ISO 8601 字符串） */
  publishedAt: string
}

/**
 * 应用更新错误信息（检查失败时返回，已脱敏）
 *
 * 字段与 main/ipc/app-update.ts AppUpdateError 完全对齐。
 */
export interface AppUpdateError {
  /** 是否有新版本（出错时为 false） */
  hasUpdate: false
  /** 错误信息（已脱敏） */
  error: string
}

// ============================================================================
// v2.2 P1 修复 #22：图片上传类型声明（与 main/ipc/fs-upload.ts 对齐）
//
// 简化方案：dialog.showOpenDialog + 读取文件转 base64 data URL，不引入图片压缩库。
// 类型在渲染层独立声明（避免从 main/ import 造成构建依赖）。
// ============================================================================

/**
 * 图片上传结果（成功时返回）
 *
 * 字段与 main/ipc/fs-upload.ts ImageUploadResult 完全对齐。
 */
export interface ImageUploadResult {
  /** 是否成功 */
  success: true
  /** base64 data URL（可直接用于 <img src>） */
  dataUrl: string
  /** 文件名（含扩展名，不含路径） */
  fileName: string
  /** 文件大小（字节） */
  fileSize: number
  /** MIME 类型（如 'image/png'） */
  mimeType: string
}

/**
 * 图片上传错误（失败时返回，已脱敏）
 *
 * 字段与 main/ipc/fs-upload.ts ImageUploadError 完全对齐。
 */
export interface ImageUploadError {
  /** 是否成功（失败时为 false） */
  success: false
  /** 错误信息（已脱敏） */
  error: string
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
  /** 会话 ID（v0.9.4 新增，可选） */
  sessionId?: string
  /**
   * 可能的副作用（v0.9.3 §11 改进点 4 P2-C 新增，可选）
   *
   * 根据 risk 和 reasons 推导，告诉用户"执行后会发生什么"。
   */
  sideEffects?: string[]
  /**
   * 推荐的回滚命令（v0.9.3 §11 改进点 4 P2-C 新增，可选）
   *
   * 命令执行失败或结果不符合预期时，用户可执行的回滚命令。
   */
  rollbackCommand?: string
  /**
   * 建议的更安全替代方案（v0.9.3 §11 改进点 4 P2-C 新增，可选）
   *
   * 如果存在更安全的等价命令，给出建议。
   */
  saferAlternative?: string
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

/**
 * Task Protocol 审批请求载荷（v0.9.3 §11 遗留项 2 P2-H 新增）
 *
 * 主进程在 task-protocol step 2 check-permission 推送 task:permission-approval-request 事件，
 * 渲染进程弹窗显示 taskId / subagentName / inputSummary，用户通过 taskPermissionApprove(callId, decision) 响应。
 *
 * 30 秒未响应主进程自动拒绝。
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
  /** 权限模式（always/auto/never） */
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
// ContractedInvokeApi / ContractedEventApi 由 src/shared/ipc-contract.ts 生成：
// 已纳入契约的通道签名以那里为准，其余方法仍在这里手写，逐步搬过去（刻度见 tests/unit/ipc-contract.test.ts）
export interface ElectronAPI extends PreloadElectronAPI, ContractedInvokeApi, ContractedEventApi {
  /**
   * 按已保存的服务器 ID 连接，返回 sessionId（通道 ssh:connectById）
   *
   * 2026-10-09 安全审查 P0-3：`server:list` 不再下发解密后的凭据，
   * 存好的密码/私钥由主进程自己从 SecureStore 取，永不跨进程边界。
   *
   * @param serverId 服务器 ID（来自 ServerListItem.id）
   * @param password 用户此刻手输的一次性口令（可选）。留空表示"用主进程存好的凭据"；
   *                 传进来的口令只用于这一次连接，渲染层不会把它显示到任何地方。
   */
  sshConnectById(serverId: string, password?: string): Promise<string>
  /**
   * 测试 LLM 连接
   * v2.3.4 改造：返回详细诊断信息，便于 UI 定位失败原因
   * - ok=true: 连接成功
  /** LLM 分析（结合证据） */
  llmAnalyze(question: string, evidences: Evidence[]): Promise<string>

  // ===== Agent 工作流（v0.8 旧 AgentWorkflow，保留） =====
  /** 启动 Agent 工作流 */
  agentStart(sessionId: string, question: string): Promise<boolean>

  // ===== v2.2 P1 修复 #24：应用更新（app:check-update / app:download-update） =====
  // 简化方案：HTTP GET GitHub Releases API 比对版本号 + shell.openExternal 打开下载页面
  // 不引入 electron-updater（A7 质量优先 + A8 避免重复造轮子）
  /**
   * 检查 GitHub Releases 是否有新版本
   *
   * 主进程 HTTP GET GitHub Releases API（10 秒超时），比对 semver 版本号。
   * - 检查成功：返回 AppUpdateInfo（hasUpdate=true 表示有新版本）
   * - 检查失败：返回 AppUpdateError（error 字段已脱敏）
   * - GitHub API 速率限制（403）：返回 AppUpdateError 提示稍后重试
   *
   * 使用场景：AboutSettings 页面"检查更新"按钮
   */
  appCheckUpdate(): Promise<AppUpdateInfo | AppUpdateError>
  /**
   * 获取应用真实信息（版本 / 安装路径 / 构建时间 / 构建标识）
   *
   * 通道：app:get-info
   * 使用场景：AboutSettings 页面系统信息展示，替换设计稿示例占位值。
   *
   * @returns AppInfo（version 含 v 前缀，buildTime 为 ISO 8601 字符串，buildBadge 为 Build YYYY.MM.DD）
   */
  appGetInfo(): Promise<AppInfo>

  // ===== v2.2 P1 修复 #22：文件系统 IPC（fs:upload-image） =====
  // AIPanel 图片附件基础版：dialog.showOpenDialog + 读取文件转 base64 data URL
  // 简化方案：不引入图片压缩库，限制 4MB，支持 png/jpg/jpeg/gif/webp/bmp
  /**
   * 选择图片文件并返回 base64 data URL
   *
   * 主进程弹出文件选择对话框，用户选择图片后读取文件转 base64。
   * - 成功：返回 ImageUploadResult（含 dataUrl / fileName / fileSize / mimeType）
   * - 失败：返回 ImageUploadError（error 字段已脱敏）
   * - 用户取消：返回 ImageUploadError（error='用户取消选择'）
   *
   * 使用场景：AIPanel 图片附件按钮
   */
  fsUploadImage(): Promise<ImageUploadResult | ImageUploadError>
  /** 启动 OpenHands App Server 容器（首次启动需拉镜像，可能数分钟） */
  sandboxStart(): Promise<{ success: true } | SandboxErrorResponse>

  // ===== v0.9 可信度算法（D-S + PCR5 + 6 源证据 + DAG 可视化） =====

  // ========================================================================
  // v0.9.6 P2：审计报告（4 个新通道）
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

  // ===== 配置存储 =====
  /** 获取配置项 */
  configGet<T = unknown>(key: string): Promise<T>

  // ===== 知识库 =====

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
  /** 渲染进程日志上报（转发到主进程 logger，统一日志系统） */
  logRenderer(payload: {
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
    category: string
    message: string
    meta?: Record<string, unknown>
    correlationId?: string
  }): Promise<boolean>
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
   * 端到端 Pipeline（v1.0 核心，v1.5 增强）：日志输入 → Drain3 解析 → OpenDerisk 诊断
   * 通道：sidecar:pipeline
   *
   * 使用场景：
   * - ChatPanel 顶部"SRE 诊断"按钮 → 弹窗输入日志 → 调此函数 → 展示诊断结果
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

  // ===== v1.5 新增：Sidecar 状态管理 =====
  /**
   * 单个 Sidecar 状态项（v1.5）
   * - id: sre
   * - name: 中文显示名
   * - port: 监听端口（19000）
   * - status: 状态（stopped/starting/ready/degraded/crashed）
   * - lastError: 最近一次错误（crashed 时显示）
   */
  sidecarListStatus(): Promise<{
    ok: boolean
    data?: Record<
      string,
      {
        id: 'sre'
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
    sidecarId: 'sre',
  ): Promise<{ ok: boolean; status: string; error?: string }>
  /**
   * 停止指定 Sidecar（v1.5）
   * 通道：sidecar:stop-one
   */
  sidecarStopOne(
    sidecarId: 'sre',
  ): Promise<{ ok: boolean }>
  /**
   * 单个 Sidecar 健康检查（v1.5）
   * 通道：sidecar:health-one
   */
  sidecarHealthOne(
    sidecarId: 'sre',
  ): Promise<{
    ok: boolean
    error?: string
    status?: string
    version?: string
    adapters?: Record<string, { ready: boolean; note?: string }>
    uptime_seconds?: number
  }>
  /**
   * 通用 Sidecar 工具调用
   * 通道：sidecar:tool-call
   *
   * @example
   * window.electronAPI.sidecarToolCall('sre', '/some/endpoint', { ... })
   */
  sidecarToolCall(
    sidecarId: 'sre',
    endpoint: string,
    payload?: unknown,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }>

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
