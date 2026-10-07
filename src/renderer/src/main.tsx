/**
 * React 渲染进程入口（v1.0 重构）
 *
 * 职责：
 * 1. createRoot 挂载 App 根组件
 * 2. ConfigProvider 配置 Ant Design 5 主题（TRAE 设计 token 覆盖）
 * 3. 导入全局样式（global.css + tailwind.css + trae-tokens.css）
 * 4. 动态切换亮色/暗黑主题（暗色默认）
 *
 * v1.0 变更：
 * - 引入 Tailwind CSS v4（tailwind.css 内部 @import trae-tokens.css）
 * - AntD ConfigProvider token 对齐 TRAE 设计 token（#387BFF 主色 / 4px 圆角 / 13px 字号）
 * - 暗色模式默认开启（<html class="dark">）
 * - 保留 useThemeStore 主题响应逻辑
 *
 * 设计说明：
 * - 使用 HashRouter（Electron 文件协议兼容）
 * - AntD 5 与 Tailwind v4 共存：通过 @layer + important 调整优先级
 * - 中文语言包 zhCN
 */
// antd 已整体退出渲染层（2026-10-07）：React 19 的 ReactDOM.render 补丁、
// ConfigProvider 主题注入、zhCN 语言包一并摘掉。主题只走 ui-tokens.css 的
// data-theme 一套机制，不再有"第二套 token 源"。
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useThemeStore } from './stores/theme-store'
// v2.7 外观设置真实落地：字号/行高/字体/密度/主题模式的应用点
import { useAppearanceStore, CODE_FONT_STACKS } from './stores/appearance-store'
import { ErrorBoundary } from './components/ErrorBoundary'
// P0 修复：Agent 流式事件全局订阅（与 AIPanel 挂载解耦，防止流式中收起面板丢事件）
import { initAgentStreamSubscription } from './stores/agent-stream-subscription'
import './styles/tailwind.css'
import './styles/global.css'

// Web 字体引入（设计稿字体栈对齐）
// Inter 替代 SF Pro Text（视觉接近，开源免费，本地化无 CDN 依赖）
// JetBrains Mono 作为代码字体（设计稿一致）
// 仅引入所需字重，避免打包体积过大
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'

// 捕获 renderer 进程中未捕获的 JS 异常，输出到控制台便于调试
window.addEventListener('error', (event) => {
  console.error('[Renderer Error]', event.error)
  event.preventDefault()
})

// 防止未处理的 Promise rejection 导致应用崩溃
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]', event.reason)
  event.preventDefault()
})

// Agent 流式事件在应用启动时绑定一次，组件卸载不解绑（幂等）
initAgentStreamSubscription()

// 仅测试环境（TDSF_E2E=1）：把关键 store 挂到 window，供 Playwright E2E 验证真实链路。
// 生产环境不挂（import.meta.env.DEV 与 window 上无 __TDSF_E2E 标志时跳过）。
// 背景：SSH 连接成功后需写入 server-store 的 activeSessionId/sessionMap，
// 监控页才能读到会话；测试需能复制这一真实用户路径。
if (import.meta.env.DEV || (typeof navigator !== 'undefined' && navigator.webdriver)) {
  void Promise.all([
    import('./stores/server-store'),
    import('./stores/monitor-store'),
    import('./stores/agent-store'),
  ]).then(([server, monitor, agent]) => {
    ;(window as unknown as Record<string, unknown>).__tdsfStores = {
      server: server.useServerStore,
      monitor: monitor.useMonitorStore,
      agent: agent.useAgentStore,
    }
  })
}

/**
 * AntD 主题 token 与组件配置说明
 *
 * v2.3 P3-B3 修复问题 #57：
 * - 原 28 处硬编码颜色（traeDarkToken / traeLightToken / componentsConfig）
 *   已全部迁移到 styles/antd-tokens.ts，消除 B2 CSS 变量红线违规
 * - 此处直接引用导入的 traeAntdDarkToken / traeAntdLightToken / traeAntdComponentsConfig
 * - 颜色值的单一数据源为 styles/antd-tokens.ts
 */

/** 根组件 - 包含主题响应逻辑 */
const Root: React.FC = () => {
  const theme = useThemeStore((s) => s.theme)
  const initFromSystem = useThemeStore((s) => s.initFromSystem)

  // 首次挂载时初始化系统主题偏好
  useEffect(() => {
    initFromSystem()
  }, [initFromSystem])

  // 主题变化时同步 <html> 的 class 属性（dark 模式 + data-theme）
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  // ===== v2.7 外观设置真实落地（此前只存不用，设置页全部形同摆设） =====
  const fontSize = useAppearanceStore((s) => s.fontSize)
  const lineHeight = useAppearanceStore((s) => s.lineHeight)
  const density = useAppearanceStore((s) => s.density)
  const themeMode = useAppearanceStore((s) => s.themeMode)
  const codeFont = useAppearanceStore((s) => s.codeFont)

  // 字号/行高 → 覆盖 global.css body 消费的 --trae token（界面字体不可选，见 ui-tokens）
  useEffect(() => {
    const el = document.documentElement
    el.style.setProperty('--trae-body-base-font-size', `${fontSize}px`)
    el.style.setProperty('--trae-body-base-line-height', String(lineHeight))
    // 代码字体 → --app-code-font（global.css code/pre/kbd 与 xterm 消费）
    const codeStack = CODE_FONT_STACKS[codeFont]
    if (codeStack) el.style.setProperty('--app-code-font', codeStack)
  }, [fontSize, lineHeight, codeFont])

  // 界面密度 → html[data-density]（global.css 密度规则消费）
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
  }, [density])

  // 主题模式（深色/浅色/跟随系统）→ 接通 theme-store（真实主题机制）
  useEffect(() => {
    const applyMode = () => {
      const target =
        themeMode === 'system'
          ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : themeMode
      if (useThemeStore.getState().theme !== target) {
        useThemeStore.getState().setTheme(target)
      }
    }
    applyMode()
    // system 模式下监听系统偏好变化
    if (themeMode === 'system' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => applyMode()
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    return undefined
  }, [themeMode])

  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  )
}

/** React 根容器元素 */
const container = document.getElementById('root')
if (!container) {
  throw new Error('根容器 #root 未找到，请检查 index.html')
}

/** createRoot 渲染 */
const root = createRoot(container)
root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
