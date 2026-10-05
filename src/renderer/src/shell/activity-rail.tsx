/**
 * 活动栏（IDE 外壳左侧 38px）
 *
 * 对齐 VS Code / cc-gui 宿主的语言：图标默认弱前景，选中项靠
 * "左侧 2px 亮条 + 提亮图标 + 轻微底色"表达，不做整块圆角色板（那是营销页的写法）。
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
        className="wb-activity-rail flex w-(--ui-size-rail) shrink-0 flex-col items-center border-r border-line bg-panel py-2"
        aria-label="主导航"
      >
        {PRIMARY_NAV.map((item) => (
          <RailButton key={item.id} item={item} active={item.id === activeId} onClick={() => go(item.id)} />
        ))}

        <span aria-hidden className="my-2 h-px w-6 bg-line-strong opacity-60" />

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
          'wb-nav-btn relative flex size-8 items-center justify-center rounded-none',
          'text-ink-mute transition-colors duration-[var(--ui-dur-fast)]',
          'hover:text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          active && 'text-ink-strong'
        )}
      >
        {active && (
          <span aria-hidden className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-ink-strong" />
        )}
        <Icon className="size-[18px]" strokeWidth={active ? 2 : 1.6} />
      </button>
    </Tooltip>
  )
}
