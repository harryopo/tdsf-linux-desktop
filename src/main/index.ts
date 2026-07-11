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

import { app, BrowserWindow } from 'electron'
import { createMainWindow, destroyMainWindow } from './windows/main-window'
import { registerAllIpcHandlers } from './ipc'
import { SshConnectionManager } from './services/ssh/connection-manager'
import { stopAllMonitoring } from './ipc/monitor'

/**
 * 应用启动入口
 *
 * app.whenReady() 返回的 Promise 在 Electron 完成初始化后 resolve，
 * 此时才能创建 BrowserWindow 和使用主进程 API。
 */
app.whenReady().then(() => {
  // 1. 创建主窗口
  const mainWindow: BrowserWindow = createMainWindow()

  // 2. 注册所有 IPC handlers（需要 mainWindow 用于事件推送）
  registerAllIpcHandlers(mainWindow)

  // 3. macOS 激活时重建窗口
  app.on('activate', handleActivate)

  // 4. 应用退出前清理资源
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
    registerAllIpcHandlers(mainWindow)
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
  // 清理主窗口引用
  destroyMainWindow()
}
