/**
 * 标签与分段控件
 *
 * Segmented 对齐 cc-gui 的 StatusPanel 条：相邻按钮用负边距拼成连体分段控件，
 * 首尾才有圆角，选中项换底色而不是加下划线——IDE 里下划线属于链接。
 * SessionTabs 是 AI 停靠格的会话条（cc-gui 的标签条由 IntelliJ 画，DOM 里没有，
 * 所以这里按同一套视觉自绘，不抄宿主）。
 */
import { type ReactNode } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'
import { X } from 'lucide-react'
import { cn } from '@/components/trae/utils'

export interface SegmentedItem<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

export function Segmented<T extends string>({
  value,
  onValueChange,
  items,
  ariaLabel,
  className,
}: {
  value: T
  onValueChange: (v: T) => void
  items: SegmentedItem<T>[]
  ariaLabel: string
  className?: string
}) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      aria-label={ariaLabel}
      className={cn('inline-flex items-stretch', className)}
    >
      <RadixTabs.List className="flex items-stretch">
        {items.map((item, i) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn(
              'flex items-center gap-1.5 border border-line-strong bg-transparent px-2 py-1',
              'text-caption font-medium text-ink-dim outline-none',
              'transition-colors duration-[var(--ui-dur-fast)]',
              'hover:bg-hover hover:text-ink',
              'data-[state=active]:bg-active data-[state=active]:text-ink',
              'focus-visible:ring-2 focus-visible:ring-accent',
              i === 0 ? 'rounded-l-(--ui-radius-control)' : '-ml-px',
              i === items.length - 1 && 'rounded-r-(--ui-radius-control)'
            )}
          >
            {item.icon}
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  )
}

export interface SessionTab {
  id: string
  title: string
  dirty?: boolean
}

/** 会话标签条：选中项顶部 1px 亮线 + 面板底，未选中沉到背景里 */
export function SessionTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  className,
}: {
  tabs: SessionTab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose?: (id: string) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      aria-label="会话"
      className={cn('flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel', className)}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={cn(
              'group flex max-w-[200px] shrink-0 items-center gap-1.5 border-r border-line px-3',
              'text-md cursor-pointer select-none',
              active
                ? 'border-t-2 border-t-accent bg-canvas text-ink'
                : 'border-t-2 border-t-transparent text-ink-dim hover:bg-hover'
            )}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(tab.id)
              }
            }}
            tabIndex={active ? 0 : -1}
          >
            <span className="truncate">{tab.title}</span>
            {tab.dirty ? <span aria-label="未保存" className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
            {onClose ? (
              <button
                type="button"
                aria-label={`关闭 ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
                className="ml-auto rounded-(--ui-radius-control) p-0.5 text-ink-mute opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
