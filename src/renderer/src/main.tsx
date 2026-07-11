/**
 * React 渲染进程入口
 *
 * 职责：
 * 1. createRoot 挂载 App 根组件
 * 2. ConfigProvider 配置 Ant Design 5 主题（苹果极简风格）
 * 3. 导入全局样式
 * 4. 动态切换亮色/暗黑主题
 *
 * 设计说明：
 * - 使用 HashRouter（Electron 文件协议兼容）
 * - Ant Design 主题 token 对齐苹果官网配色
 * - 中文语言包 zhCN
 * - 通过 useThemeStore 响应式切换主题算法与 CSS 变量
 */
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { useThemeStore } from './stores/theme-store'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/global.css'

/** 亮色主题 token 配置 - 苹果极简风格 */
const lightToken = {
  // 主色 - 苹果链接蓝
  colorPrimary: '#0071e3',
  // 主文字色
  colorText: '#1d1d1f',
  // 次要文字色
  colorTextSecondary: '#86868b',
  // 背景色
  colorBgContainer: '#ffffff',
  colorBgLayout: '#f5f5f7',
  // 分割线色
  colorBorder: '#e5e5e7',
  colorBorderSecondary: '#e5e5e7',
  // 圆角 - 8px
  borderRadius: 8,
  borderRadiusSM: 6,
  borderRadiusLG: 12,
  // 字体
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  fontSize: 13,
  // 线条宽度
  lineWidth: 1,
  // 阴影 - 极简风格几乎不用阴影
  boxShadow: 'none',
  boxShadowSecondary: 'none',
  // 控件高度
  controlHeight: 32,
  controlHeightSM: 24,
  controlHeightLG: 40,
}

/** 暗黑主题 token 配置 - 苹果暗黑风格 */
const darkToken = {
  // 主色 - 暗黑模式下更亮的链接蓝
  colorPrimary: '#0a84ff',
  // 主文字色 - 浅色
  colorText: '#f5f5f7',
  // 次要文字色
  colorTextSecondary: '#86868b',
  // 背景色 - 深色
  colorBgContainer: '#2c2c2e',
  colorBgLayout: '#1d1d1f',
  // 分割线色
  colorBorder: '#3a3a3c',
  colorBorderSecondary: '#3a3a3c',
  // 圆角保持一致
  borderRadius: 8,
  borderRadiusSM: 6,
  borderRadiusLG: 12,
  // 字体保持一致
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  fontSize: 13,
  lineWidth: 1,
  boxShadow: 'none',
  boxShadowSecondary: 'none',
  controlHeight: 32,
  controlHeightSM: 24,
  controlHeightLG: 40,
}

/** 组件级主题配置（亮暗色共用，仅 token 不同） */
const componentsConfig = {
  // Modal 组件圆角
  Modal: {
    borderRadiusLG: 12,
  },
  // Card 组件 - 无阴影，细线条
  Card: {
    boxShadowTertiary: 'none',
    headerHeight: 48,
  },
  // Menu 组件
  Menu: {
    itemBorderRadius: 8,
    itemHeight: 36,
  },
  // Input 组件
  Input: {
    borderRadius: 8,
  },
  // Button 组件
  Button: {
    borderRadius: 8,
    controlHeight: 32,
  },
  // Tabs 组件
  Tabs: {
    horizontalItemPadding: '12px 0',
  },
  // Tag 组件
  Tag: {
    borderRadiusSM: 6,
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

  // 主题变化时同步 <html> 的 data-theme 属性（让 CSS 变量生效）
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  /** 当前主题的算法和 token */
  const algorithm = theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm
  const token = theme === 'dark' ? darkToken : lightToken

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
  </React.StrictMode>
)
