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
  { to: '/monitor', label: '告警阈值', icon: Bell, domId: 'nav-alerts' },
  { to: '/settings/appearance', label: '外观', icon: Palette, domId: 'nav-appearance' },
  { to: '/settings/about', label: '关于', icon: Info, domId: 'nav-about' },
]

export function SettingsLayout() {
  const navigate = useNavigate()
  const handleBack = () => navigate('/workbench')

  return (
    <main style={{ background: 'var(--trae-bg-base-default)', color: 'var(--trae-text-default)', minHeight: '100%' }}>
      {/* ====== Page Header（设置标题 + 返回工作台）====== */}
      <header
        className="flex items-start justify-between"
        style={{ padding: '20px 24px 18px', borderBottom: '1px solid var(--trae-border-neutral-l1)' }}
      >
        <div className="flex items-center" style={{ gap: 12 }}>
          <span
            className="inline-flex items-center justify-center"
            style={{
              width: 40,
              height: 40,
              background: 'var(--trae-bg-brand-popup)',
              border: '1px solid var(--trae-border-brand)',
              borderRadius: 'var(--trae-radius-10)',
            }}
          >
            <Settings size={20} style={{ color: 'var(--trae-icon-brand)' }} />
          </span>
          <div className="flex flex-col" style={{ gap: 2 }}>
            <h1
              style={{
                fontFamily: 'var(--trae-heading-2xl-font-family)',
                fontSize: 'var(--trae-heading-2xl-font-size)',
                fontWeight: 'var(--trae-font-weight-strong)',
                lineHeight: 'var(--trae-heading-2xl-line-height)',
                color: 'var(--trae-text-default)',
                margin: 0,
                letterSpacing: '-0.012em',
              }}
            >
              设置
            </h1>
            <p
              style={{
                fontSize: 'var(--trae-body-xs-font-size)',
                lineHeight: 'var(--trae-body-xs-line-height)',
                color: 'var(--trae-text-secondary)',
                margin: 0,
              }}
            >
              系统配置与偏好管理
            </p>
          </div>
        </div>
        <button
          type="button"
          data-dom-id="back-workbench"
          aria-label="返回工作台"
          onClick={handleBack}
          className="btn-press inline-flex shrink-0 cursor-pointer items-center transition-colors"
          style={{
            gap: 6,
            height: 32,
            padding: '0 12px',
            border: '1px solid var(--trae-border-neutral-l2)',
            borderRadius: 'var(--trae-radius-6)',
            background: 'transparent',
            color: 'var(--trae-text-default)',
            fontSize: 'var(--trae-body-sm-font-size)',
            fontWeight: 'var(--trae-font-weight-medium)',
          }}
        >
          <ArrowLeft size={14} style={{ color: 'var(--trae-icon-secondary)' }} />
          <span>返回工作台</span>
        </button>
      </header>

      {/* ====== Two Column Layout（左 nav 220px + 右 Outlet）====== */}
      <div className="flex items-start" style={{ gap: 20, padding: '20px 24px 96px' }}>
        {/* Left Nav：独立卡片（边框 + 圆角 + padding 8px），sticky 跟随滚动 */}
        <aside
          className="sticky top-5 flex h-fit w-[220px] shrink-0 flex-col"
          style={{
            gap: 2,
            padding: 8,
            background: 'var(--trae-bg-base-secondary)',
            border: '1px solid var(--trae-border-neutral-l1)',
            borderRadius: 'var(--trae-radius-8)',
          }}
        >
          {SETTINGS_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-dom-id={item.domId}
              className={({ isActive }) =>
                cn(
                  'btn-press relative flex h-9 cursor-pointer items-center gap-2.5 rounded-[var(--trae-radius-6)] px-3 text-[11px] transition-colors',
                  isActive
                    ? 'bg-[var(--trae-bg-overlay-l2)] font-medium text-[var(--trae-text-default)]'
                    : 'font-normal text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-[var(--trae-text-default)]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* 激活态左侧 2px 品牌色指示条（设计稿 ::before，left:-8px） */}
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

        {/* Right Panel：子路由出口（/settings 根路径渲染 SettingsPage 快捷入口） */}
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* ====== 按压动画 + 无障碍降级 ====== */}
      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        @media (prefers-reduced-motion: reduce) {
          .btn-press:active { transform: none !important; }
        }
      `}</style>
    </main>
  )
}
