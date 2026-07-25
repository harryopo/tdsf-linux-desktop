/**
 * MainLayout — v4.0 全局持久布局（ActivityRail + Outlet）
 *
 * 设计稿要求：左侧 IDE 侧边栏（ActivityRail 48px）在任何页面切换时始终保持可见。
 * 参考：tdsf-design-app/src/layouts/AppLayout.tsx
 *
 * v4.0 变更（2026-07-25）：
 * - 将 ActivityRail 从 WorkbenchPage 提升至 MainLayout，实现全局持久导航
 * - 通过 useLocation 自动推导当前激活的导航项（无需各页面手动传 activeId）
 * - Outlet 区域保留 page-enter 入场动画
 *
 * 暗色模式默认开启（在 main.tsx 中 document.documentElement.classList.add('dark')）。
 */
import { Outlet, useLocation } from 'react-router-dom'
import { ActivityRail, type NavId } from '@/components/workbench/ActivityRail'
import '@/components/layout/MainLayout.css'
import '@/components/workbench/Workbench.css'

/** 路由路径 → NavId 反向映射（用于从 URL 推导激活态） */
const PATH_TO_NAV: [string, NavId][] = [
  ['/workbench', 'home'],
  ['/tutorial', 'tutorial'],
  ['/decision', 'decision'],
  ['/monitor', 'monitor'],
  ['/knowledge', 'knowledge'],
  ['/history', 'history'],
  ['/logs', 'logs'],
  ['/settings', 'settings'],
]

/** 根据当前 pathname 推导激活的导航项 */
function deriveActiveNav(pathname: string): NavId {
  for (const [prefix, navId] of PATH_TO_NAV) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return navId
    }
  }
  return 'home'
}

/** MainLayout 全局持久布局（ActivityRail + Outlet） */
const MainLayout: React.FC = () => {
  const location = useLocation()
  const activeNav = deriveActiveNav(location.pathname)

  return (
    <div className="wb-main-layout">
      {/* 全局持久侧边栏：任何路由切换都保持可见 */}
      <ActivityRail activeId={activeNav} />

      {/* 主内容区：key 驱动路由切换时重新触发 .page-enter 入场动画 */}
      <div key={location.pathname} className="page-enter" style={{ height: '100%', width: '100%', minWidth: 0, flex: 1 }}>
        <Outlet />
      </div>
    </div>
  )
}

export default MainLayout
