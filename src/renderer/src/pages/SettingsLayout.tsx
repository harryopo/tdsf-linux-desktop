/**
 * SettingsLayout — 设置布局（嵌套路由父级）
 *
 * 设计稿：settings.html 的 ds-layout + ds-nav 部分（最新版 tdsf-linux-redesign）
 * - 无顶部"设置"大标题栏（设计稿设置子页顶部为各子页标题 + 返回设置）
 * - 左侧 NavList 220px：6 项导航（通用/SSH/AI引擎/告警阈值/外观/关于）
 * - 每个 nav 项 36px 高，激活时左侧 2px 品牌色指示条
 * - 右侧 Outlet 子路由出口（/settings 根路径渲染 SettingsPage 快捷入口）
 *
 * 6 项导航（data-dom-id）— 严格按设计稿 settings.html 1994-2016 行：
 * - nav-general(通用) / nav-ssh(SSH连接) / nav-model-config(AI引擎)
 * - nav-alerts(告警阈值) / nav-appearance(外观) / nav-about(关于)
 * - 终端设置/决策控制/风险控制/知识库 移至 SettingsPage 卡片入口
 *
 * 无障碍：NavLink(<a>) 自带 aria-current="page"（激活态）+ 键盘可访问；
 *         button type + aria-label；prefers-reduced-motion 禁用按压动画
 */
import { NavLink, Outlet } from 'react-router-dom'
import {
  Settings, KeySquare, Sparkles, Bell, Palette, Info, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import './Settings.css'

interface SettingsNavItem {
  to: string
  label: string
  icon: LucideIcon
  domId: string
}

/** 6 项核心导航 — 严格按设计稿 settings.html ds-nav__item 顺序 */
const SETTINGS_NAV: SettingsNavItem[] = [
  { to: '/settings/general', label: '通用', icon: Settings, domId: 'nav-general' },
  { to: '/settings/ssh', label: 'SSH 连接', icon: KeySquare, domId: 'nav-ssh' },
  { to: '/settings/model', label: 'AI 引擎', icon: Sparkles, domId: 'nav-model-config' },
  { to: '/settings/alerts', label: '告警阈值', icon: Bell, domId: 'nav-alerts' },
  { to: '/settings/appearance', label: '外观', icon: Palette, domId: 'nav-appearance' },
  { to: '/settings/about', label: '关于', icon: Info, domId: 'nav-about' },
]

export function SettingsLayout() {
  return (
    <main className="set-page" style={{ height: '100%', overflowY: 'auto' }}>
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
