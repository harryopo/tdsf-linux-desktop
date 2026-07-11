/**
 * 应用根组件 - App
 *
 * 职责：
 * - 配置路由（HashRouter，兼容 Electron file:// 协议）
 * - MainLayout 作为布局容器，包裹所有页面
 * - 4 个路由：
 *   - /          → HomePage（工作台：终端 + 监控）
 *   - /history   → HistoryPage（历史决策）
 *   - /knowledge → KnowledgePage（知识库）
 *   - /settings  → SettingsPage（设置）
 *
 * 注意：
 * - 使用 HashRouter 而非 BrowserRouter，因为 Electron 加载本地 HTML 文件，
 *   使用 hash 路由可避免文件路径与 URL 路径冲突。
 * - MainLayout 内部通过 <Outlet /> 渲染子路由页面。
 */
import { HashRouter, Routes, Route } from 'react-router-dom'
import MainLayout from './components/layout/MainLayout'
import HomePage from './components/home/HomePage'
import HistoryPage from './components/history/HistoryPage'
import KnowledgePage from './components/knowledge/KnowledgePage'
import SettingsPage from './components/settings/SettingsPage'

/** App 应用根组件 */
const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        {/* MainLayout 作为父路由，内部通过 <Outlet /> 渲染子路由 */}
        <Route path="/" element={<MainLayout />}>
          {/* 首页：工作台（终端 + 监控） */}
          <Route index element={<HomePage />} />
          {/* 历史决策页 */}
          <Route path="history" element={<HistoryPage />} />
          {/* 知识库页 */}
          <Route path="knowledge" element={<KnowledgePage />} />
          {/* 设置页 */}
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
