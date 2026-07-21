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

/** AntD 主题 token — TRAE 设计 token 覆盖（暗色模式） */
const traeDarkToken = {
  // 主色 - TRAE 科技蓝 #387BFF
  colorPrimary: '#387BFF',
  colorPrimaryHover: '#4C88FF',
  colorPrimaryActive: '#1759DD',
  // 主文字色 - TRAE 浅色
  colorText: '#D1D3DB',
  colorTextSecondary: '#9599A6',
  colorTextTertiary: '#666B75',
  colorTextQuaternary: '#666B75',
  // 背景色 - TRAE 暗色
  colorBgContainer: '#222427',
  colorBgLayout: '#1A1B1D',
  colorBgElevated: '#2A2D31',
  colorBgSpotlight: '#252629',
  // 分割线色 - TRAE 边框
  colorBorder: '#3A3D42',
  colorBorderSecondary: '#4A4D52',
  // 圆角 - TRAE 紧凑（4px 默认）
  borderRadius: 4,
  borderRadiusSM: 4,
  borderRadiusLG: 8,
  // 字体 - TRAE 字体栈
  fontFamily:
    '"SF Pro Text", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  fontSize: 13,
  // 线条宽度
  lineWidth: 1,
  // 阴影 - TRAE 单层阴影
  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  boxShadowSecondary: '0 1px 3px rgba(0,0,0,0.3)',
  // 控件高度 - TRAE 紧凑
  controlHeight: 28,
  controlHeightSM: 24,
  controlHeightLG: 32,
}

/** AntD 主题 token — TRAE 设计 token 覆盖（亮色模式，v1.1 扩展） */
const traeLightToken = {
  colorPrimary: '#387BFF',
  colorPrimaryHover: '#4C88FF',
  colorPrimaryActive: '#1759DD',
  colorText: '#1A1B1D',
  colorTextSecondary: '#52525B',
  colorTextTertiary: '#A1A1AA',
  colorTextQuaternary: '#D4D4D8',
  colorBgContainer: '#FFFFFF',
  colorBgLayout: '#F5F5F7',
  colorBgElevated: '#FFFFFF',
  colorBgSpotlight: '#F0F0F2',
  colorBorder: '#E8E8EA',
  colorBorderSecondary: '#D4D4D8',
  borderRadius: 4,
  borderRadiusSM: 4,
  borderRadiusLG: 8,
  fontFamily:
    '"SF Pro Text", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  fontSize: 13,
  lineWidth: 1,
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  boxShadowSecondary: '0 1px 3px rgba(0,0,0,0.1)',
  controlHeight: 28,
  controlHeightSM: 24,
  controlHeightLG: 32,
}

/** 组件级主题配置（TRAE 风格统一） */
const componentsConfig = {
  // Modal 组件圆角
  Modal: {
    borderRadiusLG: 8,
  },
  // Card 组件 - TRAE 阴影
  Card: {
    boxShadowTertiary: '0 1px 3px rgba(0,0,0,0.3)',
    headerHeight: 44,
  },
  // Menu 组件
  Menu: {
    itemBorderRadius: 4,
    itemHeight: 32,
  },
  // Input 组件
  Input: {
    borderRadius: 4,
  },
  // Button 组件
  Button: {
    borderRadius: 4,
    controlHeight: 28,
  },
  // Tabs 组件
  Tabs: {
    horizontalItemPadding: '8px 12px',
  },
  // Tag 组件
  Tag: {
    borderRadiusSM: 2,
  },
}

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

  /** 当前主题的算法和 token */
  const algorithm = theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm
  const token = theme === 'dark' ? traeDarkToken : traeLightToken

  return (
    <ConfigProvider locale={zhCN} theme={{ algorithm, token, components: componentsConfig }}>
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
