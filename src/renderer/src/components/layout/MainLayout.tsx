/**
 * MainLayout — v3.0 极简主布局（纯 Outlet 容器）
 *
 * 设计稿每个页面都是自包含的完整布局（含自己的 Titlebar + ActivityRail + StatusBar），
 * 因此 MainLayout 只需提供 <Outlet />，不要包裹任何外层栏，避免与页面内部栏重复。
 *
 * 之前版本（v1.0/v2.0）在这里加了 Header + ActivityRail + StatusBar，
 * 导致 WorkbenchPage 内部已有的 ActivityRail 出现"双层侧边栏"，违反设计稿。
 *
 * v3.0 修复策略：
 * - MainLayout 退化为纯 Outlet 容器，让每个页面自己管理布局
 * - 引入 MainLayout.css（仅 .wb-main-layout 容器样式，删除弃用 .main-layout-* 样式）
 * - 仍引入 Workbench.css 以兼容旧 .wb-* 类名引用（其他设置页可能依赖）
 *
 * 视觉对齐：tdsf-linux-redesign/pages/workbench-disconnected.html
 *
 * 暗色模式默认开启（在 main.tsx 中 document.documentElement.classList.add('dark')）。
 */
import { Outlet, useLocation } from 'react-router-dom'
import '@/components/layout/MainLayout.css'
import '@/components/workbench/Workbench.css'

/** MainLayout 极简主布局（纯 Outlet 容器 + 路由切换入场动画） */
const MainLayout: React.FC = () => {
  const location = useLocation()
  return (
    <div className="wb-main-layout">
      {/* key 驱动路由切换时重新触发 .page-enter 入场动画（fade-in-up 0.22s） */}
      <div key={location.pathname} className="page-enter" style={{ height: '100%', width: '100%' }}>
        <Outlet />
      </div>
    </div>
  )
}

export default MainLayout
