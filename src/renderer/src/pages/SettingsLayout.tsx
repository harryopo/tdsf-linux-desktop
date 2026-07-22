/**
 * SettingsLayout — 设置布局（嵌套路由父级）
 *
 * 设计稿：settings.html 的 ds-pageheader + ds-layout + ds-nav 部分
 * - Page Header：设置图标 + "设置"标题 + 副标题 + 返回工作台按钮
 * - 左侧 NavList 220px：9 项导航（统一 data-dom-id）
 * - 每个 nav 项 36px 高，激活时左侧 2px 品牌色指示条
 * - 右侧 Outlet 子路由出口（/settings 根路径渲染 SettingsPage 快捷入口）
 *
 * 9 项导航（data-dom-id）：
 * - nav-general / nav-ssh / nav-model-config / nav-terminal-settings
 * - nav-decision-control / nav-risk-control / nav-alerts / nav-appearance / nav-about
 *
 * 无障碍：NavLink(<a>) 自带 aria-current="page"（激活态）+ 键盘可访问；
 *         button type + aria-label；prefers-reduced-motion 禁用按压动画
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Settings, KeySquare, Cpu, Terminal, GitBranch, Shield, Bell,
  Palette, Info, ArrowLeft, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import './Settings.css'

interface SettingsNavItem {
  to: string
  label: string
  icon: LucideIcon
  domId: string
}

/** 9 项导航（统一 data-dom-id，顺序对齐任务要求） */
const SETTINGS_NAV: SettingsNavItem[] = [
  { to: '/settings/general', label: '通用', icon: Settings, domId: 'nav-general' },
  { to: '/settings/ssh', label: 'SSH 连接', icon: KeySquare, domId: 'nav-ssh' },
  { to: '/settings/model', label: 'AI 引擎', icon: Cpu, domId: 'nav-model-config' },
  { to: '/settings/terminal', label: '终端设置', icon: Terminal, domId: 'nav-terminal-settings' },
  { to: '/settings/decision', label: '决策控制', icon: GitBranch, domId: 'nav-decision-control' },
  { to: '/settings/risk', label: '风险控制', icon: Shield, domId: 'nav-risk-control' },
  { to: '/settings/alerts', label: '告警阈值', icon: Bell, domId: 'nav-alerts' },
  { to: '/settings/appearance', label: '外观', icon: Palette, domId: 'nav-appearance' },
  { to: '/settings/about', label: '关于', icon: Info, domId: 'nav-about' },
]

export function SettingsLayout() {
  const navigate = useNavigate()
  const handleBack = () => navigate('/workbench')

  return (
    <main className="set-page" style={{ height: '100%', overflowY: 'auto' }}>
      {/* ====== Page Header（设置标题 + 返回工作台）====== */}
      <header className="set-pageheader">
        <div className="set-pageheader__left">
          <span className="set-pageheader__iconwrap">
            <Settings size={20} />
          </span>
          <div className="set-pageheader__title">
            <h1>设置</h1>
            <p>系统配置与偏好管理</p>
          </div>
        </div>
        <button
          type="button"
          data-dom-id="back-workbench"
          aria-label="返回工作台"
          onClick={handleBack}
          className="set-backbtn btn-press"
        >
          <ArrowLeft size={14} />
          <span>返回工作台</span>
        </button>
      </header>

      {/* ====== Two Column Layout（左 nav 220px + 右 Outlet）====== */}
      <div className="set-layout">
        {/* Left Nav：独立卡片（边框 + 圆角 + padding 8px），sticky 跟随滚动 */}
        <aside className="set-nav">
          {SETTINGS_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-dom-id={item.domId}
              className={({ isActive }) =>
                cn('set-nav__item btn-press', isActive && 'is-active')
              }
            >
              <>
                <item.icon className="di-16" />
                <span>{item.label}</span>
              </>
            </NavLink>
          ))}
        </aside>

        {/* Right Panel：子路由出口（/settings 根路径渲染 SettingsPage 快捷入口） */}
        <main className="set-panel">
          <Outlet />
        </main>
      </div>
    </main>
  )
}
