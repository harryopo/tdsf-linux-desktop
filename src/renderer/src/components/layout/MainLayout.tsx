/**
 * MainLayout — v1.0 极简主布局
 *
 * 设计稿每个页面都是自包含的完整布局（含自己的顶部栏 + 侧边栏 + 状态栏），
 * 因此 MainLayout 只需提供 <Outlet />，不要包裹任何外层栏，避免与页面内部栏重复。
 *
 * 之前版本（v1.0 批次 1）在这里加了 Header + ActivityRail + StatusBar，
 * 导致 WorkbenchPage 内部已有的 ActivityRail 出现"双层侧边栏"，违反设计稿。
 *
 * 修复策略：MainLayout 退化为纯 Outlet 容器，让每个页面自己管理布局。
 *
 * 暗色模式默认开启（在 main.tsx 中 document.documentElement.classList.add('dark')）。
 */
import { Outlet } from 'react-router-dom'
import '@/components/workbench/Workbench.css'

/** MainLayout 极简主布局（纯 Outlet 容器） */
const MainLayout: React.FC = () => {
  return (
    <div className="wb-main-layout">
      <Outlet />
    </div>
  )
}

export default MainLayout
