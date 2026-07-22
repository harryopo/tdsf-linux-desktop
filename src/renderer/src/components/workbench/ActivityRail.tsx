/**
 * ActivityRail — 工作台左侧导航栏（48px）
 *
 * 设计稿：workbench-ai.html 第 2208-2237 行
 *
 * 结构：
 * - 宽 48px，bg-base-secondary，border-right
 * - 8 个导航按钮（36×36）：工作台/教程/决策/监控/知识库/历史/日志/设置
 * - 激活态：左侧 3px 蓝色指示条 + bg-overlay-l3 + icon-brand
 * - 非激活态：icon-secondary，hover 时 bg-overlay-l2
 * - 中间有 1px 分隔线（24×1）
 * - 底部 flex-1 撑开，设置按钮固定底部
 *
 * 交互：
 * - 点击切换激活项（用 useState）
 * - v2.0 Phase C Task C.5：默认 useNavigate 路由跳转；父组件可传入 onNavigate 覆盖
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/components/trae/utils'
import {
  TraeHomeIcon,
  TraeScrollTextIcon,
  TraeShieldIcon,
  TraeDashboardIcon,
  TraeLayersIcon,
  TraeClockIcon,
  TraeFileTextIcon,
  TraeSettingsIcon,
} from './TraeIcons'

/** 导航项 ID */
export type NavId = 'home' | 'tutorial' | 'decision' | 'monitor' | 'knowledge' | 'history' | 'logs' | 'settings'

/** NavId → 路由路径映射（与 router.tsx MainLayout 子路由对应）
 * - decision 没有独立列表页，跳转到 /history（决策历史列表） */
const NAV_ROUTES: Record<NavId, string> = {
  home: '/workbench',
  tutorial: '/tutorial',
  decision: '/history',
  monitor: '/monitor',
  knowledge: '/knowledge',
  history: '/history',
  logs: '/logs',
  settings: '/settings',
}

/** 导航项配置 */
interface NavItem {
  id: NavId
  label: string
  icon: React.FC<{ className?: string }>
  /** data-dom-id 标识（用于 E2E 测试 / 自动化接入；home 项跳过，工作台自身无需标识） */
  domId?: string
}

/** 顶部主导航（7 项） */
const TOP_NAV_ITEMS: NavItem[] = [
  { id: 'home', label: '工作台', icon: TraeHomeIcon },
  { id: 'tutorial', label: '教程', icon: TraeScrollTextIcon, domId: 'nav-tutorial' },
  { id: 'decision', label: '决策', icon: TraeShieldIcon, domId: 'nav-decision' },
  { id: 'monitor', label: '监控', icon: TraeDashboardIcon, domId: 'nav-monitor' },
  { id: 'knowledge', label: '知识库', icon: TraeLayersIcon, domId: 'nav-knowledge' },
  { id: 'history', label: '历史', icon: TraeClockIcon, domId: 'nav-history' },
  { id: 'logs', label: '系统日志', icon: TraeFileTextIcon, domId: 'nav-logs' },
]

/** 底部设置导航 */
const BOTTOM_NAV_ITEMS: NavItem[] = [{ id: 'settings', label: '设置', icon: TraeSettingsIcon, domId: 'nav-settings' }]

/** ActivityRail 属性 */
export interface ActivityRailProps {
  /** 当前激活项 */
  activeId?: NavId
  /** 导航回调（可选；未传则默认走 useNavigate 路由跳转） */
  onNavigate?: (id: NavId) => void
}

/** ActivityRail 左侧导航栏 */
export function ActivityRail({ activeId: activeIdProp, onNavigate }: ActivityRailProps) {
  const [internalActive, setInternalActive] = useState<NavId>('home')
  const activeId = activeIdProp ?? internalActive
  const navigate = useNavigate()

  const handleClick = (id: NavId) => {
    setInternalActive(id)
    // 父组件传 onNavigate 则优先使用（向后兼容）；否则默认走 useNavigate 路由跳转
    if (onNavigate) {
      onNavigate(id)
    } else {
      const route = NAV_ROUTES[id]
      if (route) navigate(route)
    }
  }

  return (
    <nav
      className="wb-activity-rail"
      aria-label="主导航"
    >
      {TOP_NAV_ITEMS.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          active={item.id === activeId}
          onClick={() => handleClick(item.id)}
        />
      ))}

      <div className="wb-rail-divider" />

      <div className="wb-rail-spacer" />

      {BOTTOM_NAV_ITEMS.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          active={item.id === activeId}
          onClick={() => handleClick(item.id)}
        />
      ))}
    </nav>
  )
}

/** 导航按钮 */
interface NavButtonProps {
  item: NavItem
  active: boolean
  onClick: () => void
}

function NavButton({ item, active, onClick }: NavButtonProps) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      data-dom-id={item.domId}
      className={cn(
        'wb-nav-btn',
        active && 'is-active',
      )}
    >
      {active && <span className="wb-nav-indicator" />}
      <Icon className="size-[18px]" />
    </button>
  )
}
