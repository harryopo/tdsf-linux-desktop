/**
 * 三栏主布局组件 - MainLayout
 *
 * 布局结构（苹果极简风格）：
 * ┌─────────────────────────────────────────────────────────┐
 * │                    顶部导航栏 (48px)                       │
 * ├──────────┬───────────────────────────┬──────────────────┤
 * │ 左栏      │     中栏（Outlet 路由出口）  │   右栏            │
 * │ 240px    │     flex-1                 │   360px          │
 * │ 服务器    │  终端/监控/设置/历史/知识库  │   AI助手对话      │
 * │ 列表      │                           │                  │
 * └──────────┴───────────────────────────┴──────────────────┘
 *
 * 设计要点：
 * - 细线条分割（1px #e5e5e7）
 * - 大量留白
 * - 8px 圆角
 * - 无阴影装饰
 */
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Tabs } from 'antd'
import {
  HomeOutlined,
  SettingOutlined,
  HistoryOutlined,
  BookOutlined,
} from '@ant-design/icons'
import ServerList from './ServerList'
import ChatPanel from '../ai/ChatPanel'
import './MainLayout.css'

/** 顶部导航标签配置 */
const NAV_ITEMS = [
  { key: '/', label: '工作台', icon: <HomeOutlined /> },
  { key: '/history', label: '历史决策', icon: <HistoryOutlined /> },
  { key: '/knowledge', label: '知识库', icon: <BookOutlined /> },
  { key: '/settings', label: '设置', icon: <SettingOutlined /> },
]

/** MainLayout 主布局组件 */
const MainLayout: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()

  /** 当前激活的导航 key */
  const activeKey = location.pathname

  return (
    <div className="main-layout">
      {/* ===== 顶部导航栏 ===== */}
      <header className="main-layout-header">
        <div className="main-layout-logo">
          <span className="logo-text">TDSF</span>
          <span className="logo-subtitle">Linux Desktop</span>
        </div>
        <Tabs
          activeKey={activeKey}
          onChange={navigate}
          items={NAV_ITEMS.map((item) => ({
            key: item.key,
            label: (
              <span className="nav-tab-label">
                {item.icon}
                <span>{item.label}</span>
              </span>
            ),
          }))}
          className="main-layout-nav"
        />
      </header>

      {/* ===== 三栏内容区 ===== */}
      <div className="main-layout-body">
        {/* 左栏：服务器列表 */}
        <aside className="main-layout-left">
          <ServerList />
        </aside>

        {/* 中栏：路由页面出口 */}
        <main className="main-layout-center">
          <Outlet />
        </main>

        {/* 右栏：AI 助手对话面板 */}
        <aside className="main-layout-right">
          <ChatPanel />
        </aside>
      </div>
    </div>
  )
}

export default MainLayout
