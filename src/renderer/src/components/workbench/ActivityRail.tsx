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
 * - 提供 onNavigate 回调（可选，由父组件传入实际路由跳转）
 */
import { useState } from 'react'
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

/** 导航项配置 */
interface NavItem {
  id: NavId
  label: string
  icon: React.FC<{ className?: string }>
}

/** 顶部主导航（7 项） */
const TOP_NAV_ITEMS: NavItem[] = [
  { id: 'home', label: '工作台', icon: TraeHomeIcon },
  { id: 'tutorial', label: '教程', icon: TraeScrollTextIcon },
  { id: 'decision', label: '决策', icon: TraeShieldIcon },
  { id: 'monitor', label: '监控', icon: TraeDashboardIcon },
  { id: 'knowledge', label: '知识库', icon: TraeLayersIcon },
  { id: 'history', label: '历史', icon: TraeClockIcon },
  { id: 'logs', label: '系统日志', icon: TraeFileTextIcon },
]

/** 底部设置导航 */
const BOTTOM_NAV_ITEMS: NavItem[] = [{ id: 'settings', label: '设置', icon: TraeSettingsIcon }]

/** ActivityRail 属性 */
export interface ActivityRailProps {
  /** 当前激活项 */
  activeId?: NavId
  /** 导航回调 */
  onNavigate?: (id: NavId) => void
}

/** ActivityRail 左侧导航栏 */
export function ActivityRail({ activeId: activeIdProp, onNavigate }: ActivityRailProps) {
  const [internalActive, setInternalActive] = useState<NavId>('home')
  const activeId = activeIdProp ?? internalActive

  const handleClick = (id: NavId) => {
    setInternalActive(id)
    onNavigate?.(id)
  }

  return (
    <nav
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] py-2"
      aria-label="主导航"
    >
      {/* 顶部主导航 */}
      {TOP_NAV_ITEMS.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          active={item.id === activeId}
          onClick={() => handleClick(item.id)}
        />
      ))}

      {/* 分隔线 */}
      <div className="my-1 h-px w-6 bg-[var(--trae-border-neutral-l2)]" />

      {/* 底部 flex-1 撑开 */}
      <div className="flex-1" />

      {/* 底部设置 */}
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
      className={cn(
        'wb-nav-btn relative flex size-9 items-center justify-center rounded-[var(--trae-radius-4)] transition-colors',
        active
          ? 'bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-icon-brand)]'
          : 'text-[var(--trae-icon-secondary)] hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]',
      )}
    >
      {/* 激活态左侧蓝色指示条（3px × 20px） */}
      {active && (
        <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--trae-bg-brand)]" />
      )}
      <Icon className="size-[18px]" />
    </button>
  )
}
