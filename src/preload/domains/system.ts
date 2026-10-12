/** system 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { DbStatus } from '@shared/db-types'
import type { ProfilerRunResponse, ServerListItem, SshConfig, SystemInfo } from '@shared/models'
import type { SchedulerTaskStatus, TaskResult } from '@shared/scheduler-types'
import type { SystemPingResponse } from '@shared/agent-types'
import { AGENT, APP, CONFIG, DB, FS, MONITOR, PROFILER, SCHEDULER, SERVER, STORAGE, SYSTEM } from '@shared/ipc-channels'
import { IPC_PROTOCOL_VERSION } from '@shared/agent-types'
import { ipcRenderer } from 'electron'

/**
 * 服务器监控 invoke 调用
 */
const monitor = {
  /** 启动监控 */
  start: (sessionId: string, interval: number): Promise<boolean> =>
    ipcRenderer.invoke(MONITOR.START, sessionId, interval),

  /** 停止监控 */
  stop: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(MONITOR.STOP, sessionId),

  /** 获取系统静态信息 */
  getSystemInfo: (sessionId: string): Promise<SystemInfo> =>
    ipcRenderer.invoke(MONITOR.GET_SYSTEM_INFO, sessionId),
}

/**
 * 安全存储 invoke 调用
 */
const storage = {
  /** 加密保存 API Key */
  saveApiKey: (provider: string, key: string): Promise<boolean> =>
    ipcRenderer.invoke(STORAGE.SAVE_API_KEY, provider, key),

  /**
   * 是否存有该 provider 的 API Key
   *
   * 取代原 `getApiKey`：那条通道把解密后的 key 原文递给渲染层，
   * 设置页只需要知道"存过没有"来显示占位提示（2026-10-09 安全审查 P0-3）。
   */
  hasApiKey: (provider: string): Promise<boolean> =>
    ipcRenderer.invoke(STORAGE.HAS_API_KEY, provider),

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

  /** 写入配置（只允许非权限性键；llmConfig/sshServers 等会被主进程拒） */
  set: (key: string, value: unknown): Promise<boolean> =>
    ipcRenderer.invoke(CONFIG.SET, key, value),

  /** 保存 LLM 配置（主进程校验 baseUrl，不合规整条拒写） */
  saveLlm: (config: unknown): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(CONFIG.SAVE_LLM, config),
}

/**
 * 服务器列表管理 invoke 调用
 */
const server = {
  /** 加载服务器列表（**不含凭据**，只有 hasCredential 标记；连接走 sshConnectById） */
  list: (): Promise<ServerListItem[]> =>
    ipcRenderer.invoke(SERVER.LIST),

  /** 保存服务器列表（敏感信息加密存储） */
  save: (servers: SshConfig[]): Promise<boolean> =>
    ipcRenderer.invoke(SERVER.SAVE, servers),

  /** 导出服务器列表为 JSON（脱敏，不含密码/私钥） */
  export: (): Promise<string> =>
    ipcRenderer.invoke(SERVER.EXPORT),

  /** 导入服务器列表（生成新 ID，敏感信息留空） */
  import: (json: string): Promise<SshConfig[]> =>
    ipcRenderer.invoke(SERVER.IMPORT, json),

  /** 删除服务器凭证 */
  deleteCred: (serverId: string): Promise<boolean> =>
    ipcRenderer.invoke(SERVER.DELETE_CRED, serverId),
}

/**
 * 系统架构感知 invoke 调用
 */
const profiler = {
  /** 执行系统架构感知（27 项探查 + 风险检测 + md 渲染） */
  run: (sessionId: string, host: string): Promise<ProfilerRunResponse> =>
    ipcRenderer.invoke(PROFILER.RUN, sessionId, host),

  /** 导出 md 文件 */
  exportMd: (md: string, outputPath: string): Promise<{ filePath: string; size: number }> =>
    ipcRenderer.invoke(PROFILER.EXPORT_MD, md, outputPath),

  /** 导出 PDF 文件 */
  exportPdf: (md: string, outputPath: string): Promise<{ filePath: string; size: number }> =>
    ipcRenderer.invoke(PROFILER.EXPORT_PDF, md, outputPath),

  /** 生成默认文件名 */
  defaultFileName: (host: string, ext: 'md' | 'pdf'): Promise<string> =>
    ipcRenderer.invoke(PROFILER.DEFAULT_FILE_NAME, host, ext),
}

/**
 * v0.9.4 系统级 IPC 调用（协议版本 + 心跳保活 + 通用取消）
 *
 * 通道与主进程 ipc/index.ts 注册的 system:ping 一一对应。
 *
 * 设计原则：
 * - getProtocolVersion 同步返回常量（无需 IPC 调用，从 @shared 直接 import）
 * - systemPing 异步调用 system:ping IPC，用于心跳保活
 * - agentCancel 通过 sessionId 统一取消 agent:chat 会话
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
    ipcRenderer.invoke(SYSTEM.PING),

  /**
   * 通过 sessionId 统一取消进行中的会话（v0.9.4 新增）
   *
   * 主进程 handler 已兼容 sessionId 与 correlationId，会按 sessionId 查找
   * session-registry 中的 AbortController 并触发 abort。
   *
   * 使用场景：
   * - 用户点击"停止"按钮时取消 agent:chat 的流式请求
   * - 不需要区分会话类型（sessionId 是统一的）
   *
   * @param sessionId 会话 ID（agent:chat 启动时回传）
   * @returns 是否取消成功（false 表示该会话已结束或不存在）
   */
  cancel: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(AGENT.CHAT_CANCEL, sessionId),
}

/**
 * A4 新增：数据库状态 IPC（db:status，SQLite 降级可见化）
 *
 * 主进程的 better-sqlite3 加载失败 / 库文件打不开 / schema 迁移中断，
 * 过去只写进主进程日志，界面照常显示"已保存"。本通道把事实交给渲染层横幅。
 */
const dbStatus = {
  /**
   * 读取数据库运行状态
   *
   * @returns DbStatus（available=false 时数据不会持久化）
   */
  get: (): Promise<DbStatus> => ipcRenderer.invoke(DB.STATUS),
}

/**
 * v2.2 P1 修复 #24：应用更新 IPC（app:check-update / app:download-update）
 *
 * 简化方案：HTTP GET GitHub Releases API 比对版本号 + shell.openExternal 打开下载页面。
 * 不引入 electron-updater（A7 质量优先 + A8 避免重复造轮子）。
 *
 * 通道与主进程 ipc/app-update.ts 一一对应。
 *
 * 使用场景：AboutSettings 页面"检查更新"按钮
 */
const appUpdate = {
  /**
   * 检查 GitHub Releases 是否有新版本
   *
   * 主进程 fetch GitHub API（10 秒超时），比对 semver 版本号。
   * 返回 AppUpdateInfo（hasUpdate=true 表示有新版本）或 AppUpdateError（已脱敏）。
   */
  checkUpdate: async (): Promise<
    | {
        hasUpdate: boolean
        latestVersion: string
        currentVersion: string
        releaseUrl: string
        releaseNotes: string
        publishedAt: string
      }
    | { hasUpdate: false; error: string }
  > => ipcRenderer.invoke(APP.CHECK_UPDATE),

  /**
   * 打开浏览器到 Release 页面（让用户手动下载安装包）
   *
   * @param releaseUrl 可选，指定 Release URL；无参数时打开 Releases 列表页面
   */
  downloadUpdate: (releaseUrl?: string): Promise<boolean> =>
    ipcRenderer.invoke(APP.DOWNLOAD_UPDATE, releaseUrl),

  /**
   * 获取应用真实信息（T.8：版本/安装路径/构建时间）
   *
   * 返回 AppInfo，AboutSettings 用其替换设计稿示例值。
   */
  getInfo: (): Promise<{ version: string; installPath: string; buildTime: string; buildBadge: string }> =>
    ipcRenderer.invoke(APP.GET_INFO),

  /**
   * 导出模型配置与统计（v2.3 活功能转换）
   *
   * 将当前 ModelSettings 页面可见的模型配置、KPI、预算信息写入 userData/exports。
   * 文件名带时间戳，避免覆盖历史导出。
   */
  exportModelStats: (
    stats: unknown
  ): Promise<{ filePath: string; size: number }> =>
    ipcRenderer.invoke(APP.EXPORT_MODEL_STATS, stats),
}

/**
 * v2.2 P1 修复 #22：文件系统 IPC（fs:upload-image）
 *
 * AIPanel 图片附件基础版：弹出文件选择对话框 → 读取图片 → 返回 base64 data URL。
 * 简化方案：不引入图片压缩库，限制 4MB，支持 png/jpg/jpeg/gif/webp/bmp。
 *
 * 通道与主进程 ipc/fs-upload.ts 一一对应。
 *
 * 使用场景：AIPanel 图片附件按钮
 */
const fsUpload = {
  /**
   * 选择图片文件并返回 base64 data URL
   *
   * 主进程 dialog.showOpenDialog 弹出文件选择器，读取文件转 base64。
   * 返回 ImageUploadResult（success=true）或 ImageUploadError（success=false）。
   */
  uploadImage: async (): Promise<
    | {
        success: true
        dataUrl: string
        fileName: string
        fileSize: number
        mimeType: string
      }
    | { success: false; error: string }
  > => ipcRenderer.invoke(FS.UPLOAD_IMAGE),
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

export { monitor, storage, config, server, profiler, system, dbStatus, appUpdate, fsUpload, scheduler }
