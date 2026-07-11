/**
 * React 渲染进程入口
 *
 * 职责：
 * 1. createRoot 挂载 App 根组件
 * 2. ConfigProvider 配置 Ant Design 5 主题（苹果极简风格）
 * 3. 导入全局样式
 *
 * 设计说明：
 * - 使用 HashRouter（Electron 文件协议兼容）
 * - Ant Design 主题 token 对齐苹果官网配色
 * - 中文语言包 zhCN
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles/global.css'

/** Ant Design 5 主题配置 - 苹果极简风格 */
const appleThemeConfig = {
  // 使用默认算法（亮色主题）
  algorithm: antdTheme.defaultAlgorithm,
  token: {
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
  },
  components: {
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
  },
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
    {/* Ant Design 全局配置Provider */}
    <ConfigProvider locale={zhCN} theme={appleThemeConfig}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
)
