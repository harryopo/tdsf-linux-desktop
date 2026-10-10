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

import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import * as path from 'node:path'
import { checkNavigation } from '../services/security/navigation-policy'
import { isSafeWebUrl } from '../services/security/url-policy'
import { fitRectToWorkArea } from './window-fit'

/** 主窗口单例引用（很多推送与对话框仍以它为目标；第二窗口靠 broadcastToWindows 覆盖） */
let mainWindow: BrowserWindow | null = null

/** 所有活着的应用窗口（含主窗口），按创建顺序 */
const appWindows: BrowserWindow[] = []

/** 第二及以后窗口的错位量：完全重叠会让人以为没开出来 */
const CASCADE_OFFSET = 36

/**
 * CSP 指令（渲染层不访问任何远程 API：LLM/SSH/爬虫全在主进程）
 *
 * style-src 保留 'unsafe-inline'：Antd 5 的 CSS-in-JS 运行时注入 <style>，
 * 去掉会让组件样式失效。script-src 不放 inline，这是防 XSS 升级的关键位。
 */
const CSP_DIRECTIVES: string[] = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
]

/** dev server 的 origin（打包后为 undefined） */
function devServerOrigin(): string | undefined {
  const url = process.env['ELECTRON_RENDERER_URL']
  if (!url || app.isPackaged) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/** 组装最终 CSP：开发模式需放行 Vite HMR 的内联脚本与 dev server 连接 */
function buildCsp(origin: string | undefined): string {
  const parts = [...CSP_DIRECTIVES]
  if (origin) {
    parts[1] = `script-src 'self' 'unsafe-inline' ${origin}`
    parts[5] = `connect-src 'self' ws: wss: ${origin}`
  }
  return parts.join('; ')
}

/**
 * 给窗口所属 session 注入 CSP 响应头
 *
 * 用响应头而非 <meta>：同一份策略要同时覆盖 dev（http）与打包（file），
 * 而 meta 无法按环境放宽，会让开发模式被自己的策略拦死。
 */
function applyCsp(win: BrowserWindow, origin: string | undefined): void {
  const policy = buildCsp(origin)
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

/**
 * 创建主窗口
 *
 * 尺寸取"工作区"（屏幕扣掉任务栏），最大 1600×1000，居中显示。
 * 开发模式下打开 DevTools 便于调试。
 *
 * @returns 主窗口实例
 */
export function createMainWindow(): BrowserWindow {
  const win = buildAppWindow({})
  mainWindow = win
  appWindows.push(win)
  win.on('closed', () => {
    const at = appWindows.indexOf(win)
    if (at >= 0) appWindows.splice(at, 1)
    if (mainWindow === win) mainWindow = appWindows[0] ?? null
  })
  return win
}

/**
 * 再开一个应用窗口（W4）
 *
 * 为什么值得单独开：终端是"一条连接一个屏"的东西，边看远端日志边改文件、
 * 或者两台机器并排敲，一个窗口放不下。第二窗口和主窗口是同一份渲染层、
 * 同一套 preload，终端标签靠 W2 那条对账自动出现，不需要另设同步协议。
 */
export function createSecondaryWindow(): BrowserWindow {
  const anchor = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const anchorBounds = anchor?.getBounds()
  const win = buildAppWindow({
    x: anchorBounds ? anchorBounds.x + CASCADE_OFFSET : undefined,
    y: anchorBounds ? anchorBounds.y + CASCADE_OFFSET : undefined,
    center: !anchorBounds,
  })
  appWindows.push(win)
  win.on('closed', () => {
    const at = appWindows.indexOf(win)
    if (at >= 0) appWindows.splice(at, 1)
  })
  return win
}

/** 当前活着的窗口（推送要发给每一个，不是只发给主窗口） */
export function getAppWindows(): BrowserWindow[] {
  return appWindows.filter((w) => !w.isDestroyed())
}

/** 向所有窗口广播一条事件（终端输出这类"每个窗口都该看到"的推送） */
export function broadcastToWindows(channel: string, ...args: unknown[]): void {
  for (const win of getAppWindows()) {
    if (win.webContents.isDestroyed()) continue
    win.webContents.send(channel, ...args)
  }
}

function buildAppWindow(pos: { x?: number; y?: number; center?: boolean }): BrowserWindow {
  // 尺寸不能按屏幕物理分辨率写死：BrowserWindow 的 width/height 是**外框**，
  // 之前 1920×1080 在 1080p 屏上被标题栏 + 任务栏顶掉约 70px，底部状态栏显示不全
  const { workArea } = screen.getPrimaryDisplay()
  // 最小尺寸也不能硬钉：小屏（如 1366×768 扣掉任务栏）上 720 的下限会让收口失效
  const minW = Math.min(1280, workArea.width)
  const minH = Math.min(720, workArea.height)
  const win = new BrowserWindow({
    width: Math.min(1600, workArea.width),
    height: Math.min(1000, workArea.height),
    minWidth: minW,
    minHeight: minH,
    x: pos.x,
    y: pos.y,
    center: pos.center ?? true,
    show: false, // 等渲染进程 ready-to-show 后再显示，避免白屏
    title: 'TDSF-Linux Desktop',
    // 与渲染层画布底色对齐，避免白屏闪烁
    backgroundColor: '#1e1e1e',
    // 允许用户全屏（设计稿是 IDE 风格，全屏后体验更好）
    simpleFullscreen: true,
    fullscreenable: true,
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

  // 整框收进工作区：外框尺寸按工作区给足时，系统标题栏会把窗口底边压到任务栏下面；
  // 级联出的第二窗口再右下移 36px，实测状态栏与 AI 输入框下沿被推到屏幕外。
  const bounds = win.getBounds()
  win.setBounds(
    fitRectToWorkArea(screen.getDisplayMatching(bounds).workArea, bounds, {
      width: minW,
      height: minH,
    }),
  )

  // 渲染进程就绪后再显示窗口，避免初始白屏
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  // 拦截外部链接，用系统默认浏览器打开（而非在应用内打开新窗口）
  // 只放行 http/https 且不带内嵌凭据：file:// 与自定义协议交给 shell 就是启动本地程序
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isSafeWebUrl(targetUrl)) {
      shell.openExternal(targetUrl)
    }
    return { action: 'deny' }
  })

  // v2.6 修复：右键上下文菜单（Electron 默认无右键菜单，用户在输入框右键无法粘贴）
  // - 可编辑区：剪切/复制/粘贴/全选（按 editFlags 置灰）
  // - 非编辑区有选中文本：复制
  win.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      template.push(
        { role: 'cut', label: '剪切', enabled: params.editFlags.canCut },
        { role: 'copy', label: '复制', enabled: params.editFlags.canCopy },
        { role: 'paste', label: '粘贴', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: '全选' },
      )
    } else if (params.selectionText.trim()) {
      template.push({ role: 'copy', label: '复制' })
    }
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup()
    }
  })

  // 阻止应用内导航到其它目的地（dev 的同源 HMR 仍可，跨端口/跨协议一律拒）
  //
  // 为什么不再是"比 origin"：打包态文档是 `file://`，而 `new URL('file://…').origin`
  // 就是字符串 'null'，两个 null 相等 → 任意本地 HTML 都算同源（旧实现的真实行为）。
  // 现在按协议分别判定，见 services/security/navigation-policy.ts。
  win.webContents.on('will-navigate', (event, navigateUrl) => {
    const verdict = checkNavigation(
      navigateUrl,
      win.webContents.getURL(),
      getAppPathSafe(),
    )
    if (!verdict.ok) {
      event.preventDefault()
    }
  })

  // 注入 CSP（必须在加载页面前挂好，否则首个文档拿不到策略）
  applyCsp(win, devServerOrigin())

  // 根据环境加载入口页面
  loadEntry(win)

  // 监听渲染进程无响应（hang），打印日志用于排查
  win.webContents.on('unresponsive', () => {
    console.error('[Main] 渲染进程无响应')
  })

  // 监听渲染进程崩溃/退出
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] 渲染进程退出:', details)
  })

  return win
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
 * `app.getAppPath()` 的安全取值
 *
 * app 未 ready 或被提前销毁时它会抛；导航判定的立场是"拿不到应用根就一律拒"，
 * 所以这里把异常折成 undefined，让策略层去做它该做的保守判断，而不是让窗口崩。
 */
function getAppPathSafe(): string | undefined {
  try {
    return app.getAppPath()
  } catch {
    return undefined
  }
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
  // 打包产物忽略外部环境变量：否则被设置 ELECTRON_RENDERER_URL 的机器上，
  // 安装版会加载任意远端 URL 并自动开 DevTools
  if (rendererUrl && !app.isPackaged) {
    // 开发模式：加载 dev server URL
    window.loadURL(rendererUrl)
    // 开发模式自动打开 DevTools
    window.webContents.openDevTools()
  } else {
    // 生产模式：加载打包后的 HTML 文件
    window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}
