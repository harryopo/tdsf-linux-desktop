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
 * |21 | /settings/alerts     | AlertsSettings       | lazy    |  告警阈值指引页（nav-alerts 统一 9 项）
 * |22 | /settings/about      | AboutSettings        | lazy    |
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
import MainLayout from './components/layout/MainLayout'

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
const AboutSettings = lazy(() =>
  import('./pages/AboutSettings').then((m) => ({ default: m.AboutSettings })),
)
const AlertsSettings = lazy(() =>
  import('./pages/AlertsSettings').then((m) => ({ default: m.AlertsSettings })),
)

/** Suspense 加载占位 */
function PageLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--trae-bg-base-default)] text-[var(--trae-text-tertiary)]">
      <span className="text-[13px]">加载中...</span>
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
                - /settings 根路径由 SettingsLayout 自身渲染 6 项卡片快捷入口
                - 子路由通过 Outlet 渲染对应设置子页面
                - model / about 按设计稿为独立页面，不嵌套在 SettingsLayout 中 */}
            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<SettingsPage />} />
              <Route path="general" element={<GeneralSettings />} />
              <Route path="appearance" element={<AppearanceSettings />} />
              <Route path="risk" element={<RiskSettings />} />
              <Route path="ssh" element={<SshSettings />} />
              <Route path="terminal" element={<TerminalSettings />} />
              <Route path="decision" element={<DecisionSettings />} />
              <Route path="alerts" element={<AlertsSettings />} />
            </Route>

            {/* 模型配置：设计稿为独立居中布局，无侧边栏 */}
            <Route path="settings/model" element={<ModelSettings />} />

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
