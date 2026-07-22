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
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { useThemeStore } from './stores/theme-store'
import { ErrorBoundary } from './components/ErrorBoundary'
// v2.3 P3-B3: Antd 主题 token 从独立常量文件 import，消除 main.tsx 28 处硬编码颜色（B2 红线）
import { traeAntdDarkToken, traeAntdLightToken, traeAntdComponentsConfig } from './styles/antd-tokens'
import './styles/tailwind.css'
import './styles/global.css'

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

  /** 当前主题的算法和 token（从 styles/antd-tokens.ts 引用，消除硬编码颜色） */
  const algorithm = theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm
  const token = theme === 'dark' ? traeAntdDarkToken : traeAntdLightToken

  return (
    <ConfigProvider locale={zhCN} theme={{ algorithm, token, components: traeAntdComponentsConfig }}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ConfigProvider>
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
