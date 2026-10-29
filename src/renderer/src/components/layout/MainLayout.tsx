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
 *
 * 2026-10-23（#173）：审批条从 AIPanel 提到这里。原先它挂在面板下，而工作台之外的
 * 任何路由（设置、历史、知识库……）都不渲染那个面板——在这些页上发起的外部 MCP 调用
 * 照样推审批请求，却没有任何地方能应答，60 秒后被主进程自动拒绝。
 * 问了一句没人能答的审批不是把关，是静默失败，所以这一条必须常驻在整个应用框里。
 */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ActivityRail, type NavId } from '@/shell/activity-rail'
import { DbDegradedBanner } from '@/components/layout/DbDegradedBanner'
import { PermissionBar } from '@/dock/permission-bar'
import { useApprovalStore } from '@/stores/approval-store'
import '@/components/layout/MainLayout.css'
import '@/components/workbench/Workbench.css'

/**
 * 工作台常驻层（延迟加载，避免首屏把整页工作台塞进主 chunk）。
 *
 * 为什么挂在这里而不是继续走路由：2026-10-26 用户报"切换别的窗口，终端之前留着的内容
 * 就消失了"。取证结果是两条卸载路径，路由这条最直接——MainLayout 给 Outlet 套了
 * `key={location.pathname}`，切监控/知识库/设置时整棵 WorkbenchPage 被卸载，
 * TerminalView 的清理函数于是跑 `terminal.dispose()`，xterm 的回滚缓冲跟着没了；
 * 主进程那条 shell 还活着，回来时只是一只空的新终端接上同一个 shellId。
 * 把工作台提到路由子树之外、只用 CSS 藏起来，终端实例和缓冲就不用重建，
 * 也不需要拿序列化字符串回放（回放会丢颜色/光标/滚动位置）。
 */
const WorkbenchPage = lazy(() =>
  import('@/pages/WorkbenchPage').then((m) => ({ default: m.WorkbenchPage })),
)

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
  const approvalEntries = useApprovalStore((s) => s.entries)

  /**
   * 工作台常驻：第一次进入过工作台之后就不再卸载它，去别的路由只把它藏起来。
   * 首次进入之前不挂载——启动后直接落在监控/设置页的人不该白等工作台那一大块 chunk。
   */
  // 与 deriveActiveNav 同一口径：/workbench 与其带尾斜杠的形式都算工作台
  const onWorkbench =
    location.pathname === '/workbench' || location.pathname.startsWith('/workbench/')
  const [workbenchMounted, setWorkbenchMounted] = useState(onWorkbench)
  useEffect(() => {
    if (onWorkbench) setWorkbenchMounted(true)
  }, [onWorkbench])

  /**
   * 应答一条审批：主进程回了 false 就是"这条它已经不认了"（多半 60 秒到点自动拒绝），
   * 于是把卡标成已超时，而不是悄悄删掉——用户得知道这一步为什么停住。
   */
  const respond = useCallback(async (callId: string, approved: boolean) => {
    const api = window.electronAPI
    if (!api?.paorApprove) return
    const accepted = await api.paorApprove(callId, approved)
    if (accepted) useApprovalStore.getState().settle(callId)
    else useApprovalStore.getState().markExpired(callId)
  }, [])

  return (
    <div className="wb-app-frame">
      {/* A4：数据库降级横幅——主进程 db:status 不可用时全页面顶部常驻提示 */}
      <DbDegradedBanner />

      <div className="wb-main-layout">
        {/* 全局持久侧边栏：任何路由切换都保持可见 */}
        <ActivityRail activeId={activeNav} />

        {/* 主内容区：工作台之外的页面。key 驱动路由切换时重新触发 .page-enter 入场动画 */}
        <div
          className={onWorkbench ? 'wb-route-pane wb-route-pane-hidden' : 'wb-route-pane'}
        >
          <div
            key={location.pathname}
            className="page-enter"
            style={{ height: '100%', width: '100%', minWidth: 0 }}
          >
            <Outlet />
          </div>
        </div>

        {/*
          工作台常驻层：进过一次之后，切去监控/知识库/设置只把这里 display:none，
          不卸载。终端（xterm 实例 + 回滚缓冲）因此活过整次应用会话。
          首次进入前不挂载，避免启动后直接落在别的页面还要加载工作台那一大块。
        */}
        {workbenchMounted || onWorkbench ? (
          <div
            className={onWorkbench ? 'wb-route-pane' : 'wb-route-pane wb-route-pane-hidden'}
          >
            <Suspense fallback={null}>
              <WorkbenchPage active={onWorkbench} />
            </Suspense>
          </div>
        ) : null}
      </div>

      {/* 高危命令审批：贴底固定条，默认选中"拒绝"、Esc 即拒（详见 dock/permission-bar.tsx）。
          挂在这里而不是 AI 面板下：任何一页上发起的请求都要有地方能应答（#173）。 */}
      <PermissionBar
        entries={approvalEntries}
        onRespond={respond}
        onDismiss={(callId) => useApprovalStore.getState().settle(callId)}
      />
    </div>
  )
}

export default MainLayout
