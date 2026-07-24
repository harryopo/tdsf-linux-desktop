/**
 * 应用入口
 *
 * Electron 主进程入口点，负责：
 * 1. app.whenReady() 后创建主窗口、注册 IPC handlers
 * 2. 处理窗口全部关闭事件（macOS 除外，macOS 应用常驻）
 * 3. 处理应用激活（macOS 点击 dock 图标时重建窗口）
 * 4. 应用退出时清理 SSH 连接和监控定时器
 *
 * 安全说明：
 * - 主进程持有所有敏感资源（SSH 凭据、API Key）
 * - 渲染进程只能通过 IPC 白名单访问受控接口
 */

import { app, BrowserWindow, crashReporter } from 'electron'
import * as path from 'node:path'
import { createMainWindow, destroyMainWindow } from './windows/main-window'
import { registerAllIpcHandlers } from './ipc'
import { SshConnectionManager } from './services/ssh/connection-manager'
import { stopAllMonitoring } from './ipc/monitor'
import { LangfuseService } from './services/observability/langfuse'
import { ConfigStore } from './services/storage/config-store'
import { McpServerService } from './services/mcp/server'
import { DatabaseManager, resolveDbPath } from './services/db/database'
import { loadTutorialSeeds } from './services/tutorial/seed-loader'
// P-4 恢复方案 A：主进程启动时预热 sessionKeyMap 缓存（恢复主进程重启前活跃的沙箱 key）
import { warmupSessionKeyCache } from './ipc/sandbox'
// Phase 6 Task 6.5：调度器初始化（定时任务自动化：每日巡检 / 归档 / 周报）
import { initScheduler, cleanupScheduler } from './ipc/scheduler'
import { initLogger, logger } from './services/log/logger'
import { redactSecrets } from './services/security/redact'
// v0.9.4 IPC 协议版本号（主进程启动时输出日志，便于诊断版本不匹配问题）
import { IPC_PROTOCOL_VERSION } from '@shared/agent-types'

// 0. -1 最早初始化日志（其他模块才能用 logger）
initLogger(app.getPath('userData'))
logger.info('APP', 'TDSF-Linux Desktop 启动', {
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  platform: process.platform,
  arch: process.arch,
})

// v0.9.4 新增：输出 IPC 协议版本号日志
// 用于诊断 preload 与 main 版本不匹配问题（如渲染进程加载了旧版 preload）
// 日志格式：[ipc] protocol version: x.y.z
logger.info('IPC', `protocol version: ${IPC_PROTOCOL_VERSION}`)

// 启动本地崩溃收集（不上传服务器），便于排查 renderer/native 崩溃
app.setPath('crashDumps', path.join(app.getPath('userData'), 'crashes'))
crashReporter.start({
  productName: 'TDSF-Linux-Desktop',
  companyName: 'TDSF',
  submitURL: '',
  uploadToServer: false,
})

/**
 * 应用启动入口
 *
 * app.whenReady() 返回的 Promise 在 Electron 完成初始化后 resolve，
 * 此时才能创建 BrowserWindow 和使用主进程 API。
 */
app.whenReady().then(() => {
  // 0. 初始化 SQLite 数据库（知识库、决策历史、审计日志都依赖它）
  // 必须在窗口创建前完成，否则 knowledge/history IPC 会拿到内存数据库
  const dbPath = resolveDbPath(app.getPath('userData'))
  const db = DatabaseManager.getInstance(dbPath)
  // v2.2 修复问题 #46：不输出 dbPath（含用户目录路径，可能泄漏用户名）
  logger.info('DB', '数据库已初始化', {
    available: db.isAvailable(),
    vector: db.isVectorEnabled(),
  })

  // 0.0a 加载教程种子（v0.7.0 Sprint 5：保证 knowledge_entries 有 10 篇内置教程）
  //    如果数据库已有教程则跳过，避免覆盖
  try {
    const seedCount = loadTutorialSeeds(db)
    logger.info('TUTORIAL', '种子加载完成', { seedCount })
  } catch (err) {
    logger.warn('TUTORIAL', '种子加载失败', { error: redactSecrets((err as Error).message) })
  }

  // 0.0 初始化可观测性服务（Langfuse），未配置 Key 时静默降级
  LangfuseService.getInstance().init()

  // 0.1 启动 MCP Server（仅在 MCP_SERVER_ENABLED=true 时启用）
  const mcpConfig = ConfigStore.getMcpConfig() ?? {
    enabled: process.env.MCP_SERVER_ENABLED === 'true',
    port: 3107
  }
  void McpServerService.getInstance(mcpConfig).start().catch((err) => {
    logger.error('MCP', '启动失败', {
      error: redactSecrets((err as Error).message ?? String(err)),
    })
  })

  // 1. 创建主窗口
  const mainWindow: BrowserWindow = createMainWindow()

  // 2. 注册所有 IPC handlers（需要 mainWindow 用于事件推送 + db 用于教程/知识库）
  registerAllIpcHandlers(mainWindow, db)

  // 2.1 Phase 6 Task 6.5：初始化调度器（注册 3 个定时任务 + 启动引擎 + 设置状态推送）
  //     必须在 IPC handlers 注册之后调用（scheduler:status push 通道依赖 BrowserWindow 已创建）
  //     必须在 app.whenReady() 之后调用（Scheduler 内部使用 setInterval，Electron API 可用）
  // P0-1 修复：传入 db，让每日决策归档任务注入真实 repository。
  initScheduler(db)

  // 3. P-4 恢复方案 A：异步预热 sessionKeyMap 缓存
  //    不 await（不阻塞应用启动），后台执行即可
  //    OpenHands 未启动时静默失败，下次 sandbox:list 时再尝试缓存
  void warmupSessionKeyCache()

  // 4. macOS 激活时重建窗口
  app.on('activate', handleActivate)

  // 5. 应用退出前清理资源
  app.on('before-quit', handleBeforeQuit)
})

/**
 * 窗口全部关闭事件处理
 *
 * macOS 应用通常在窗口关闭后仍驻留（用户点击 dock 图标可重新打开），
 * 其他平台直接退出应用。
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ------------------------------------------------------------------------
// 事件处理函数
// ------------------------------------------------------------------------

/**
 * macOS 激活事件处理
 *
 * 在 macOS 上，点击 dock 图标时如果没有打开的窗口，则重建一个。
 */
function handleActivate(): void {
  // BrowserWindow.getAllWindows() 在 macOS 上返回空数组时需要重建
  if (BrowserWindow.getAllWindows().length === 0) {
    const mainWindow = createMainWindow()
    // 重新激活时也需传入 db（教程 IPC 依赖）
    const db = DatabaseManager.getInstance(resolveDbPath(app.getPath('userData')))
    registerAllIpcHandlers(mainWindow, db)
  }
}

/**
 * 应用退出前清理
 *
 * 同步清理资源，避免进程被强制终止时丢失数据或留下僵尸连接：
 * - 断开所有 SSH 会话
 * - 停止所有监控定时器
 */
async function handleBeforeQuit(): Promise<void> {
  try {
    // 停止所有监控（避免定时器在退出时报错）
    await stopAllMonitoring()
  } catch {
    // 忽略清理异常
  }
  try {
    // 断开所有 SSH 连接
    await SshConnectionManager.getInstance().disconnectAll()
  } catch {
    // 忽略清理异常
  }
  try {
    // 停止 MCP Server
    await McpServerService.getInstance().stop()
  } catch {
    // 忽略清理异常
  }
  try {
    // 关闭 Langfuse 客户端（确保 trace 落盘）
    await LangfuseService.getInstance().shutdown()
  } catch {
    // 忽略清理异常
  }
  try {
    // Phase 6 Task 6.5：清理调度器（停止轮询 + 清空任务 + 移除监听）
    cleanupScheduler()
  } catch {
    // 忽略清理异常
  }
  // 清理主窗口引用
  destroyMainWindow()
}
