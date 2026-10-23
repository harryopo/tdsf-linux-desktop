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
import { FileWatcherAdapter } from './services/ssh/file-watcher'
import { McpGateway } from './core/agent/mcp-gateway'
import { LangfuseService } from './services/observability/langfuse'
import { ConfigStore } from './services/storage/config-store'
import { McpServerService } from './services/mcp/server'
import { DatabaseManager, resolveDbPath } from './services/db/database'
import { AuditRepo } from './services/db/audit-repo'
import { installCommandBlockTrace } from './core/command-block-trace'
import { loadTutorialSeeds } from './services/tutorial/seed-loader'
import { loadKnowledgeSeeds } from './services/db/knowledge-seeds'
// P-4 恢复方案 A：主进程启动时预热 sessionKeyMap 缓存（恢复主进程重启前活跃的沙箱 key）
import { warmupSessionKeyCache } from './ipc/sandbox'
// Phase 6 Task 6.5：调度器初始化（定时任务自动化：每日巡检 / 归档 / 周报）
import { initScheduler, cleanupScheduler } from './ipc/scheduler'
// D3：退出时清理 sidecar 与循环工程（以前只挂 global 从未被调用）
import { cleanupSidecar } from './ipc/sidecar'
import { cleanupLoopEngineering } from './ipc/loop-engineering'
import { localPtyManager } from './services/terminal/local-pty'
// 退出收尾补的两条（2026-10-15 全维度审查）：两个 dispose 早就写好了，只是没进退出步骤表
import { disposeTerminalCompletionEngine } from './ipc/terminal-completion'
import { resetSessionRegistry } from './core/agent/session-registry'
import { persist as persistTokenStats } from './core/agent/providers/token-stats'
// S4：MCP 生命周期的 1 秒轮询、应用自己起的 OpenHands 容器，退出时都要有人收
import { McpLifecycleManager } from './core/agent/mcp-lifecycle'
import { stopCachedRunner } from './ipc/sandbox-config'
// R0：启动阶段推送。此前只有 ipc-ready 被推过，done 从来没人发，
//     渲染层的"就绪"完全依赖动画节拍，窗口被遮挡时就卡死在启动页。
import { pushBootLoadingStage } from './ipc/boot'
import { initLogger, logger } from './services/log/logger'
import { buildQuitSteps, createQuitCleanup } from './core/quit-cleanup'
import { redactSecrets } from './services/security/redact'
// S3：路径 confinement 的受管根（渲染层传来的绝对路径只有落在这里才可用）
import { configurePathConfinement } from './services/security/path-confinement'
import { installCrashGuard } from './core/crash-guard'
import { installPreviewProtocol, registerPreviewScheme } from './services/preview/preview-protocol'
import { getPreviewTransport } from './services/preview/preview-service'
// v0.9.4 IPC 协议版本号（主进程启动时输出日志，便于诊断版本不匹配问题）
import { IPC_PROTOCOL_VERSION } from '@shared/agent-types'

// 0. -1 最早初始化日志（其他模块才能用 logger）
initLogger(app.getPath('userData'))
// P0-3：崩溃兜底必须紧跟 logger 装上——在那之前的异步异常也没人接，
// 而它自己一旦坏了就只能退回 console，所以顺序是"logger → 兜底 → 其余一切"。
installCrashGuard()
// S3：受管根 = userData。写日志/导报告/落配置都往这里走；
// 渲染层传来的绝对路径只有落在它下面（或被主进程对话框授权过）才被接受。
configurePathConfinement(() => [app.getPath('userData')])
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

// W5：预览协议必须在 app ready 之前登记为特权 scheme（Electron 的硬要求，
// ready 之后再登记不生效），处理器等到 whenReady 里再装。
registerPreviewScheme()

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
  // A4：状态同时送渲染层全局横幅，日志不再是降级的唯一落点
  const dbStatus = db.getStatus()
  logger.info('DB', '数据库已初始化', {
    available: dbStatus.available,
    vector: dbStatus.vectorEnabled,
    schemaVersion: dbStatus.schemaVersion,
    targetSchemaVersion: dbStatus.targetSchemaVersion,
    ...(dbStatus.degradedReason ? { degradedReason: dbStatus.degradedReason } : {}),
    ...(dbStatus.migrationError ? { migrationError: dbStatus.migrationError } : {}),
  })
  if (!dbStatus.available || dbStatus.migrationPending) {
    logger.warn('DB', '数据库处于降级状态，界面将显示全局横幅', {
      reason: dbStatus.degradedReason ?? dbStatus.migrationError,
    })
  }
  pushBootLoadingStage('sqlite-init', BrowserWindow.getAllWindows())

  // 0.0 拦截留痕接上审计表（审查 F1）：判定层不 import 数据库，注册在这里。
  //     以前 block 只在屏幕上印一行 notice，关掉窗口就查不到"什么时候拦了什么"。
  installCommandBlockTrace(new AuditRepo(db))

  // 0.0a 加载教程种子（v0.7.0 Sprint 5：保证 knowledge_entries 有 10 篇内置教程）
  //    如果数据库已有教程则跳过，避免覆盖
  try {
    const seedCount = loadTutorialSeeds(db)
    logger.info('TUTORIAL', '种子加载完成', { seedCount })
  } catch (err) {
    logger.warn('TUTORIAL', '种子加载失败', { error: redactSecrets((err as Error).message) })
  }

  // 0.0b v2.6：加载运维知识库种子（12 条真实案例/命令技能）
  //    已有案例/技能数据则跳过，不覆盖用户贡献与 AI 沉淀
  try {
    const kbSeedCount = loadKnowledgeSeeds(db)
    logger.info('KB', '知识库种子加载完成', { kbSeedCount })
  } catch (err) {
    logger.warn('KB', '知识库种子加载失败', { error: redactSecrets((err as Error).message) })
  }

  // 0.0a 审计日志按保留期清理（risk.auditRetention，脏值/缺省回 180 天）
  try {
    const pruned = new AuditRepo(db).pruneExpired()
    if (pruned > 0) logger.info('DB', '审计日志按保留期清理', { pruned })
  } catch (err) {
    logger.warn('DB', '审计日志清理失败', { error: redactSecrets((err as Error).message) })
  }

  // 0.0 初始化可观测性服务（Langfuse），未配置 Key 时静默降级
  LangfuseService.getInstance().init()
  pushBootLoadingStage('kb-indexed', BrowserWindow.getAllWindows())

  // 0.1 启动 MCP Server（仅在 MCP_SERVER_ENABLED=true 时启用）
  const mcpConfig = ConfigStore.getMcpConfigOrDefault()
  void McpServerService.getInstance(mcpConfig).start().catch((err) => {
    logger.error('MCP', '启动失败', {
      error: redactSecrets((err as Error).message ?? String(err)),
    })
  })

  // 0.1a 外部 MCP Server：把配置里登记的服务器交给 Client 侧
  //      没有这一步，mcpConfig.externalServers 就是"字段声明了、没人读"，
  //      mcp:external-status/tools/call 三条通道永远只会回空表。
  McpGateway.getInstance().registerExternalServers(mcpConfig.externalServers ?? [])

  // 1. 创建主窗口
  installPreviewProtocol(getPreviewTransport())
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

  // 启动序列走完了。这一步此前从未推送，渲染层只能靠动画自己猜"好了"。
  pushBootLoadingStage('done', BrowserWindow.getAllWindows())

  // 4. macOS 激活时重建窗口
  app.on('activate', handleActivate)
})

/**
 * 退出闸门注册在**模块作用域**，不在 app.whenReady().then() 里面。
 *
 * 原来它挂在 whenReady 链的最后一句：MCP 启动、registerAllIpcHandlers、initScheduler
 * 任何一句抛错，这一行就永远执行不到——退出时零清理，而且日志里连"没注册"的痕迹都没有。
 * before-quit 的监听器在 ready 之前注册完全合法，注册动作本身不依赖任何服务就绪。
 */
app.on('before-quit', handleBeforeQuit)

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
 * 退出清理的预算（闸门语义与步骤顺序见 core/quit-cleanup.ts）
 *
 * 15 秒不是拍的：上一版设 8 秒，在并行 e2e（6 个 Electron 实例同跑）下被顶穿过，
 * 收尾记成 outcome=超时、行为测试随之变红——不是产品坏了，是预算太紧。
 * 单步另有 2.5 秒默认上限：一个挂住的清理不再能吃光整体预算，把后面的 sidecar 饿死。
 */
const QUIT_CLEANUP_CAP_MS = 15000
/** 单步默认超时：挂住的那一步不吃光整体预算（sidecar 自己排到 4 秒） */
const QUIT_STEP_TIMEOUT_MS = 2500

const quitCleanup = createQuitCleanup({
  capMs: QUIT_CLEANUP_CAP_MS,
  stepTimeoutMs: QUIT_STEP_TIMEOUT_MS,
  tailWaitMs: 150,
  log: logger,
  flush: () => logger.flush(),
  quit: () => app.quit(),
  steps: () =>
    buildQuitSteps({
      // 子进程留在机器上的代价最大，排在最前（顺序理由见 quit-cleanup.ts）
      cleanupSidecar: () => cleanupSidecar(),
      // 外部 MCP 服务器是 stdio 子进程：以前 McpServerService.stop() 只关服务端，
      // 客户端那批子进程没人断（disconnectAllExternalServers 零调用者）
      disconnectExternalMcp: () => McpGateway.getInstance().disconnectAllExternalServers(),
      // 文件监听骑在 SSH 会话上（inotify 流 / 轮询定时器），必须在断连之前停
      // ——它自己的注释就写着"应用退出时调用"，但一直没人调
      stopFileWatchers: () => FileWatcherAdapter.getInstance().stopAll(),
      stopMonitoring: () => stopAllMonitoring(),
      disconnectSsh: () => SshConnectionManager.getInstance().disconnectAll(),
      stopMcpServer: () => McpServerService.getInstance().stop(),
      // MCP 生命周期管理器自己挂着 1 秒的 backoff 轮询定时器，以前没人停它：
      // 退出之后事件循环上还有活干，等于白等（它的 dispose 就是为这一步加的）
      disposeMcpLifecycle: () => McpLifecycleManager.getInstance().dispose(),
      // OpenHands 容器是 `docker compose up -d` 起的后台进程，
      // 退出时不管它就留在机器上占端口，用户下次遇到的是"起不来"而不是"我关掉了"
      stopOpenHands: () => stopCachedRunner(),
      // 还开着的本机终端：不关的话退出后 shell 连同它跑着的命令留在机器上
      closeLocalPty: () => localPtyManager.closeAll(),
      shutdownLangfuse: () => LangfuseService.getInstance().shutdown(),
      cleanupScheduler: () => cleanupScheduler(),
      cleanupLoopEngineering: () => cleanupLoopEngineering(),
      // 下面三条 2026-10-15 全维度审查补上：收尾函数一直存在（前两条的注释就写着
      // "应用退出时关闭"），但退出步骤表里没有它们，于是等于从没跑过。
      disposeTerminalCompletion: () => disposeTerminalCompletionEngine(),
      disposeSessionRegistry: () => resetSessionRegistry(),
      // token 统计是 2 秒防抖写盘：退出时最后几条还在定时器里，不主动落盘就丢了
      persistTokenStats: () => persistTokenStats(),
      // 关库放最后：审计/调度/凭据那些步骤还可能在这时写库，先关池子会把它们打成"库不可用"
      closeDatabase: () => DatabaseManager.getInstance().close(),
      releaseMainWindow: () => destroyMainWindow(),
    }),
})

function handleBeforeQuit(event: Electron.Event): Promise<void> {
  return quitCleanup.onBeforeQuit(event)
}
