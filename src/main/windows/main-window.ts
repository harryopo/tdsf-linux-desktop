/**
 * 主窗口创建
 *
 * 创建 Electron BrowserWindow，配置安全相关的选项：
 * - contextIsolation: true — 启用上下文隔离，防止渲染进程污染 preload 上下文
 * - nodeIntegration: false — 禁用 Node.js 集成，渲染进程无法直接访问 Node API
 * - sandbox: true — 启用沙箱，进一步限制渲染进程权限
 * - preload — 指定 preload 脚本路径，通过 contextBridge 暴露安全 API
 *
 * 开发/生产模式自动切换加载 URL：
 * - dev: electron-vite dev 启动时设置 ELECTRON_RENDERER_URL 环境变量
 * - prod: 加载打包后的 renderer/index.html
 */

import { BrowserWindow, shell } from 'electron'
import * as path from 'node:path'
import * as url from 'node:url'

/** 主窗口单例引用（避免被垃圾回收） */
let mainWindow: BrowserWindow | null = null

/**
 * 创建主窗口
 *
 * 创建一个 1280x800 的窗口，加载渲染进程入口页面。
 * 开发模式下打开 DevTools 便于调试。
 *
 * @returns 主窗口实例
 */
export function createMainWindow(): BrowserWindow {
  // 创建浏览器窗口（v1.0：调大尺寸 + 支持全屏，适配 IDE 风格设计稿）
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1440,
    minHeight: 768,
    show: false, // 等渲染进程 ready-to-show 后再显示，避免白屏
    title: 'TDSF-Linux Desktop',
    backgroundColor: '#1f1f1f',
    // 允许用户全屏（设计稿是 IDE 风格，全屏后体验更好）
    simpleFullscreen: true,
    fullscreenable: true,
    // 启用原生 Windows 最大化按钮
    maximizable: true,
    webPreferences: {
      // 安全配置
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // preload 脚本（相对于编译后的 out/main 目录）
      preload: path.join(__dirname, '../preload/index.js'),
      // 启用 spellcheck 关闭（避免控制台拼写检查警告）
      spellcheck: false,
    },
  })

  // 渲染进程就绪后再显示窗口，避免初始白屏
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 拦截外部链接，用系统默认浏览器打开（而非在应用内打开新窗口）
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl)
    return { action: 'deny' }
  })

  // 阻止应用内导航到外部 URL（仅允许同源导航）
  mainWindow.webContents.on('will-navigate', (event, navigateUrl) => {
    const parsed = url.parse(navigateUrl)
    // 允许 localhost（开发模式 HMR）
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      event.preventDefault()
    }
  })

  // 根据环境加载入口页面
  loadEntry(mainWindow)

  // 监听渲染进程无响应（hang），打印日志用于排查
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[Main] 渲染进程无响应')
  })

  // 监听渲染进程崩溃/退出
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] 渲染进程退出:', details)
  })

  return mainWindow
}

/**
 * 获取主窗口实例
 * @returns 主窗口（未创建返回 null）
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * 销毁主窗口引用（应用退出时调用）
 */
export function destroyMainWindow(): void {
  mainWindow = null
}

/**
 * 根据环境加载渲染进程入口
 *
 * - 开发模式：从 ELECTRON_RENDERER_URL 加载（electron-vite dev 启动的 dev server）
 * - 生产模式：加载打包后的 renderer/index.html
 *
 * @param window 目标窗口
 */
function loadEntry(window: BrowserWindow): void {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    // 开发模式：加载 dev server URL
    window.loadURL(rendererUrl)
    // 开发模式自动打开 DevTools
    window.webContents.openDevTools()
  } else {
    // 生产模式：加载打包后的 HTML 文件
    window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}
