/**
 * 面与原语：面板、面板头、分隔、chip、状态点、折叠区
 *
 * 这些形状直接对齐 cc-gui 实测值：面板头 8px 12px、chip 1px 6px / 11px、
 * 状态点 8px（pending 换 12px 旋转环，避免被读成"卡住的静态点"）、
 * 折叠一律用 grid-template-rows 0fr↔1fr（不用 max-height 猜高度）。
 */
import { type HTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/components/trae/utils'

/** 一个可停靠的面板（终端格、AI 格、文件树格的最外层） */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex min-h-0 min-w-0 flex-col bg-canvas text-ink', className)}
      {...props}
    />
  )
}

/** 面板头：左侧标题/动作，右侧图标动作，高度由内容决定（IDE 里靠 1px 下边线分区） */
export function PanelHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-3 py-2',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-caption font-semibold tracking-wide text-ink-dim uppercase">
        {title}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  )
}

export function Divider({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(vertical ? 'mx-1 h-4 w-px bg-line-strong opacity-50' : 'my-1 h-px w-full bg-line', className)}
    />
  )
}

const chip = cva(
  'inline-flex max-w-[200px] items-center gap-1 truncate rounded-(--ui-radius-control) ' +
    'px-1.5 py-px text-caption leading-none font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-hover text-ink-dim',
        accent: 'bg-accent/15 text-accent-ink',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        error: 'bg-error/15 text-error',
        outline: 'border border-line-strong bg-transparent text-ink-dim',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
)

export function Chip({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof chip>) {
  return <span className={cn(chip({ tone }), className)} {...props} />
}

/**
 * 状态点：8px 圆点表示终态，12px 旋转环表示进行中。
 * 用形状而不是只换颜色，是为了色盲用户也能区分"在跑"和"跑完"。
 */
export function StatusDot({
  status,
  className,
}: {
  status: 'pending' | 'success' | 'error' | 'muted'
  className?: string
}) {
  if (status === 'pending') {
    return (
      <span
        role="status"
        aria-label="进行中"
        className={cn(
          'size-3 shrink-0 animate-spin rounded-full border-2 border-warning border-t-transparent',
          className
        )}
      />
    )
  }
  const tone =
    status === 'success' ? 'bg-success' : status === 'error' ? 'bg-error' : 'bg-ink-mute'
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', tone, className)}
    />
  )
}

/** 折叠区：grid 0fr↔1fr，DOM 常驻，展开高度自适应，不需要 JS 量高 */
export function Collapse({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('grid transition-[grid-template-rows] duration-[var(--ui-dur-base)] ease-out', className)}
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
