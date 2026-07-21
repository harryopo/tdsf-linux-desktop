/**
 * 路由配置 — v1.0 重构（20 条路由 + 守卫）
 *
 * 路由表（与设计稿 20 个 HTML 页面对应）：
 * | # | 路径                  | 页面组件              | 加载方式 |
 * |---|----------------------|----------------------|---------|
 * | 1 | /                    | BootPage（启动页）    | eager   |
 * | 2 | /boot                | BootPage（兼容入口）  | eager   |
 * | 3 | /workbench           | WorkbenchPage        | lazy    |
 * | 4 | /monitor             | MonitorPage          | lazy    |
 * | 5 | /history             | HistoryPage          | lazy    |
 * | 6 | /history/:id         | HistoryDetailPage    | lazy    |
 * | 7 | /knowledge           | KnowledgePage        | lazy    |
 * | 8 | /knowledge/:id       | KnowledgeDetailPage  | lazy    |
 * | 9 | /decision/:id        | DecisionDetailPage   | lazy    |
 * |10 | /tutorial            | TutorialPage         | lazy    |
 * |11 | /tutorial/:id        | TutorialDetailPage   | lazy    |
 * |12 | /logs                | LogsPage             | lazy    |
 * |13 | /settings            | SettingsLayout       | lazy    |
 * |14 | /settings/general    | GeneralSettings      | lazy    |
 * |15 | /settings/appearance | AppearanceSettings   | lazy    |
 * |16 | /settings/model      | ModelSettings        | lazy    |
 * |17 | /settings/risk       | RiskSettings         | lazy    |
 * |18 | /settings/ssh        | SshSettings          | lazy    |
 * |19 | /settings/terminal   | TerminalSettings     | lazy    |
 * |20 | /settings/decision   | DecisionSettings     | lazy    |
 * |21 | /settings/calibration| CalibrationSettings  | lazy    |  v0.9.6 P1 新增：ECE 校准器控制台
 * |22 | /settings/alerts     | AlertsSettingsStub   | lazy    |  spec DEC-4 统一 9 项 nav-alerts 占位
 * |23 | /settings/about      | AboutSettings        | lazy    |
 *
 * 守卫：
 * - BootPage 完成后才进入 Workbench（用 BootGuard 软守卫，批次 1 不强制）
 * - 现有 6 条路由兼容（/, /ide, /tutorial, /history, /knowledge, /settings）
 *
 * 注意：
 * - 用 HashRouter（Electron file:// 协议兼容）
 * - lazy 加载避免首屏加载所有页面
 * - Suspense fallback 用简单 Loading 占位
 */
import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import MainLayout from './components/layout/MainLayout'
import { Empty } from './components/trae/Empty'

// BootPage eager 加载（启动页必须立即可用）
import { BootPage } from './pages/BootPage'

// 其他页面 lazy 加载
const WorkbenchPage = lazy(() =>
  import('./pages/WorkbenchPage').then((m) => ({ default: m.WorkbenchPage })),
)
const MonitorPage = lazy(() =>
  import('./pages/MonitorPage').then((m) => ({ default: m.MonitorPage })),
)
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
)
const HistoryDetailPage = lazy(() =>
  import('./pages/HistoryDetailPage').then((m) => ({ default: m.HistoryDetailPage })),
)
const KnowledgePage = lazy(() =>
  import('./pages/KnowledgePage').then((m) => ({ default: m.KnowledgePage })),
)
const KnowledgeDetailPage = lazy(() =>
  import('./pages/KnowledgeDetailPage').then((m) => ({ default: m.KnowledgeDetailPage })),
)
const DecisionDetailPage = lazy(() =>
  import('./pages/DecisionDetailPage').then((m) => ({ default: m.DecisionDetailPage })),
)
const TutorialPage = lazy(() =>
  import('./pages/TutorialPage').then((m) => ({ default: m.TutorialPage })),
)
const TutorialDetailPage = lazy(() =>
  import('./pages/TutorialDetailPage').then((m) => ({ default: m.TutorialDetailPage })),
)
const LogsPage = lazy(() => import('./pages/LogsPage').then((m) => ({ default: m.LogsPage })))
const SettingsLayout = lazy(() =>
  import('./pages/SettingsLayout').then((m) => ({ default: m.SettingsLayout })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const GeneralSettings = lazy(() =>
  import('./pages/GeneralSettings').then((m) => ({ default: m.GeneralSettings })),
)
const AppearanceSettings = lazy(() =>
  import('./pages/AppearanceSettings').then((m) => ({ default: m.AppearanceSettings })),
)
const ModelSettings = lazy(() =>
  import('./pages/ModelSettings').then((m) => ({ default: m.ModelSettings })),
)
const RiskSettings = lazy(() =>
  import('./pages/RiskSettings').then((m) => ({ default: m.RiskSettings })),
)
const SshSettings = lazy(() =>
  import('./pages/SshSettings').then((m) => ({ default: m.SshSettings })),
)
const TerminalSettings = lazy(() =>
  import('./pages/TerminalSettings').then((m) => ({ default: m.TerminalSettings })),
)
const DecisionSettings = lazy(() =>
  import('./pages/DecisionSettings').then((m) => ({ default: m.DecisionSettings })),
)
const CalibrationSettings = lazy(() =>
  import('./pages/CalibrationSettings').then((m) => ({ default: m.CalibrationSettings })),
)
const AboutSettings = lazy(() =>
  import('./pages/AboutSettings').then((m) => ({ default: m.AboutSettings })),
)

/** Suspense 加载占位 */
function PageLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--trae-bg-base-default)] text-[var(--trae-text-tertiary)]">
      <span className="text-[13px]">加载中...</span>
    </div>
  )
}

/**
 * AlertsSettingsStub — 告警阈值设置占位（spec DEC-4 / Task 2.13.4 H1 修复）
 *
 * Spec 要求所有设置子页面左导航统一为 9 项（含 nav-alerts），
 * 但 AlertSettings 完整页不在 Task 2.13 范围内。
 * 此处用 Empty 占位，符合 spec「IPC 不可用时使用 @/components/trae/Empty」约束。
 */
function AlertsSettingsStub() {
  return (
    <div className="flex h-full flex-col bg-[var(--trae-bg-base-default)]">
      <div className="flex flex-1 items-center justify-center p-12">
        <Empty
          icon={Bell}
          title="告警阈值设置即将上线"
          description="本模块用于配置监控告警的触发阈值与通知策略，敬请期待。"
        />
      </div>
    </div>
  )
}

/** 路由配置组件 */
const Router: React.FC = () => {
  return (
    <HashRouter>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          {/* 启动页：应用启动默认显示 */}
          <Route path="/" element={<BootPage />} />
          <Route path="/boot" element={<BootPage />} />

          {/* MainLayout 布局路由（含 ActivityRail + StatusBar） */}
          <Route element={<MainLayout />}>
            {/* 工作台（主页面） */}
            <Route path="workbench" element={<WorkbenchPage />} />

            {/* 监控 */}
            <Route path="monitor" element={<MonitorPage />} />

            {/* 历史决策 */}
            <Route path="history" element={<HistoryPage />} />
            <Route path="history/:id" element={<HistoryDetailPage />} />

            {/* 知识库 */}
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="knowledge/:id" element={<KnowledgeDetailPage />} />

            {/* 决策详情 */}
            <Route path="decision/:id" element={<DecisionDetailPage />} />

            {/* 教程 */}
            <Route path="tutorial" element={<TutorialPage />} />
            <Route path="tutorial/:id" element={<TutorialDetailPage />} />

            {/* 日志 */}
            <Route path="logs" element={<LogsPage />} />

            {/* 设置（嵌套路由）
                - /settings 根路径由 SettingsLayout 自身渲染 9 项卡片快捷入口
                - 子路由通过 Outlet 渲染对应设置子页面 */}
            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<SettingsPage />} />
              <Route path="general" element={<GeneralSettings />} />
              <Route path="appearance" element={<AppearanceSettings />} />
              <Route path="model" element={<ModelSettings />} />
              <Route path="risk" element={<RiskSettings />} />
              <Route path="ssh" element={<SshSettings />} />
              <Route path="terminal" element={<TerminalSettings />} />
              <Route path="decision" element={<DecisionSettings />} />
              {/* nav-alerts 占位（spec DEC-4 统一 9 项，AlertSettings 完整页待后续 Task） */}
              <Route path="alerts" element={<AlertsSettingsStub />} />
              <Route path="calibration" element={<CalibrationSettings />} />
            </Route>

            {/* 关于页：设计稿为独立居中布局，不使用 SettingsLayout 侧边栏 */}
            <Route path="settings/about" element={<AboutSettings />} />
          </Route>

          {/* 兜底：未匹配路由重定向到 / */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}

export default Router
