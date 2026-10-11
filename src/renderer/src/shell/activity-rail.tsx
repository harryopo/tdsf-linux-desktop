/**
 * 活动栏（IDE 外壳左侧 64px，图标 + 文字标签）
 *
 * 2026-10-06 按用户"左侧 IDE 的 UI 太小了"重做：
 * 原来 38px 宽、18px 图标、无文字，选中态只有一根 2px 亮条——看不清也认不出。
 * 现在按 Apple 侧栏语言：52×52 的圆角块（radius 12）承载 22px 图标 + 12px 标签，
 * 选中态用整块圆角底色（macOS 侧栏选中就是圆角矩形，不是一根线），
 * 图标与文字同时提亮，鼠标悬停再给一次底色。
 * 标签字档 2026-10-11 由 11px（micro）提到 12px（caption）：micro 按 DESIGN.md
 * 只用于注释性文字，导航标签是控件标签，不该借注释档省钱。
 *
 * 保留 wb-activity-rail / wb-nav-btn 这两个类名当钩子：
 * 真机验证脚本 scripts/design/verify-theme.mjs 与 E2E 按它们取节点。
 */
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Gauge,
  GraduationCap,
  History,
  Home,
  ScrollText,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import { Tooltip, TooltipProvider } from '@/ui'

export type NavId =
  | 'home'
  | 'tutorial'
  | 'decision'
  | 'monitor'
  | 'knowledge'
  | 'history'
  | 'logs'
  | 'settings'

const NAV_ROUTES: Record<NavId, string> = {
  home: '/workbench',
  tutorial: '/tutorial',
  decision: '/decision',
  monitor: '/monitor',
  knowledge: '/knowledge',
  history: '/history',
  logs: '/logs',
  settings: '/settings',
}

interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  /** E2E 与自动化接入用的稳定标识 */
  domId?: string
}

const PRIMARY_NAV: NavItem[] = [
  { id: 'home', label: '工作台', icon: Home },
  { id: 'tutorial', label: '教程', icon: GraduationCap, domId: 'nav-tutorial' },
  { id: 'decision', label: '决策', icon: ShieldCheck, domId: 'nav-decision' },
  { id: 'monitor', label: '监控', icon: Gauge, domId: 'nav-monitor' },
  { id: 'knowledge', label: '知识库', icon: BookOpen, domId: 'nav-knowledge' },
  { id: 'history', label: '历史', icon: History, domId: 'nav-history' },
  { id: 'logs', label: '系统日志', icon: ScrollText, domId: 'nav-logs' },
]

const FOOTER_NAV: NavItem[] = [
  { id: 'settings', label: '设置', icon: Settings, domId: 'nav-settings' },
]

export interface ActivityRailProps {
  activeId?: NavId
  onNavigate?: (id: NavId) => void
}

export function ActivityRail({ activeId: activeIdProp, onNavigate }: ActivityRailProps) {
  const navigate = useNavigate()
  const activeId = activeIdProp ?? 'home'

  const go = (id: NavId) => {
    if (onNavigate) onNavigate(id)
    else navigate(NAV_ROUTES[id])
  }

  return (
    <TooltipProvider>
      <nav
        className="wb-activity-rail flex w-(--ui-size-rail) shrink-0 flex-col items-center gap-1 bg-panel px-1.5 py-3"
        aria-label="主导航"
      >
        {PRIMARY_NAV.map((item) => (
          <RailButton key={item.id} item={item} active={item.id === activeId} onClick={() => go(item.id)} />
        ))}

        <div className="flex-1" />

        {FOOTER_NAV.map((item) => (
          <RailButton key={item.id} item={item} active={item.id === activeId} onClick={() => go(item.id)} />
        ))}
      </nav>
    </TooltipProvider>
  )
}

function RailButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <Tooltip content={item.label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        data-dom-id={item.domId}
        className={cn(
          'wb-nav-btn flex w-full flex-col items-center justify-center gap-1',
          'h-(--ui-size-rail-item) rounded-(--ui-radius-control)',
          'transition-colors duration-[var(--ui-dur-fast)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          active
            ? 'bg-active text-ink-strong'
            : 'text-ink-mute hover:bg-hover hover:text-ink-strong'
        )}
      >
        <Icon className="size-(--ui-size-glyph)" strokeWidth={active ? 2 : 1.7} />
        <span className="text-caption leading-none">{item.label}</span>
      </button>
    </Tooltip>
  )
}
