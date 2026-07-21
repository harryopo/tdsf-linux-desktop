/**
 * SettingsLayout — 设置布局（嵌套路由父级）
 *
 * 设计稿：settings.html / settings-*.html 的 ds-layout + ds-nav 部分
 * - 左侧 NavList 220px：独立卡片（带边框/圆角/padding 8px）
 * - 每个 nav 项 36px 高，激活时左侧 2px 蓝色指示条
 * - 右侧 Outlet 子路由出口
 *
 * 子路由：
 * - /settings/general       通用
 * - /settings/ssh           SSH 连接
 * - /settings/model         模型配置
 * - /settings/risk          风险控制
 * - /settings/terminal      终端
 * - /settings/appearance    外观
 * - /settings/decision      决策控制
 * - /settings/about         关于
 */
import { NavLink, Outlet } from 'react-router-dom'
import {
  Settings,
  Palette,
  Cpu,
  Shield,
  Terminal,
  KeySquare,
  GitBranch,
  Info,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'

interface SettingsNavItem {
  to: string
  label: string
  icon: LucideIcon
}

const SETTINGS_NAV: SettingsNavItem[] = [
  { to: '/settings/general', label: '通用', icon: Settings },
  { to: '/settings/ssh', label: 'SSH 连接', icon: KeySquare },
  { to: '/settings/model', label: 'AI 引擎', icon: Cpu },
  { to: '/settings/risk', label: '风险控制', icon: Shield },
  { to: '/settings/terminal', label: '终端设置', icon: Terminal },
  { to: '/settings/appearance', label: '外观', icon: Palette },
  { to: '/settings/decision', label: '决策控制', icon: GitBranch },
  { to: '/settings/about', label: '关于', icon: Info },
]

export function SettingsLayout() {
  return (
    <div className="flex h-full flex-col bg-[var(--trae-bg-base-default)]">
      {/* 两栏布局：左侧 NavList 220px 卡片 + 右侧 Outlet 滚动区
          gap 20px / padding 20px 24px 96px 对齐设计稿 ds-layout */}
      <div className="flex flex-1 items-start gap-5 overflow-hidden p-5 pb-24">
        {/* 左侧导航卡片（独立边框 + 圆角 + 阴影，sticky 跟随滚动） */}
        <aside
          className="sticky top-5 flex h-fit w-[220px] shrink-0 flex-col gap-[2px] rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-2 shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
        >
          {SETTINGS_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'relative flex h-9 items-center gap-2.5 rounded-[var(--trae-radius-6)] px-3 text-[11px] transition-colors',
                  isActive
                    ? 'bg-[var(--trae-bg-overlay-l2)] font-medium text-[var(--trae-text-default)]'
                    : 'font-normal text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-[var(--trae-text-default)]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* 激活态左侧 2px 蓝色指示条（设计稿 ::before，left:-8px） */}
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute -left-2 top-2 bottom-2 w-0.5 rounded-full bg-[var(--trae-bg-brand)]"
                    />
                  )}
                  <item.icon
                    className={cn(
                      'size-4 shrink-0',
                      isActive
                        ? 'text-[var(--trae-bg-brand)]'
                        : 'text-[var(--trae-text-secondary)]',
                    )}
                  />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </aside>

        {/* 右侧 Outlet：子页面自带 pageheader + 内容 */}
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
