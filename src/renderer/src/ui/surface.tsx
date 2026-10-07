/**
 * 面与原语：页头、面板、面板头、分隔、chip、状态点、折叠区、提示条
 *
 * 页头尺寸对齐 Apple HIG 的 Headline（17pt Semibold）与 8pt 栅格；图标走
 * "强调色淡底圆角方块"而不是裸图标，这样六个模块的左上角看起来是同一套东西。
 * 其余形状对齐 cc-gui 实测值：面板头 8px 12px、chip 1px 6px / 11px、
 * 状态点 8px（pending 换 12px 旋转环，避免被读成"卡住的静态点"）、
 * 折叠一律用 grid-template-rows 0fr↔1fr（不用 max-height 猜高度）。
 */
import { type HTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, Info, Loader2, type LucideIcon } from 'lucide-react'
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

/**
 * 页头：每个模块左上角那一大字。全站唯一入口，页面不得自写标题栏。
 *
 * 尺寸/字号/位置由这里定死，页内正文另用容器控制留白：
 * 高 56px（--ui-size-page-header）、左右 20px、标题 20px Semibold、副标题 12px。
 * 页内小节标题低一级用 17px Semibold，不能和模块标题同大。
 * 必须是页面根的第一个子节点（full-bleed），塞进带 padding 的容器里会破坏对齐。
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: LucideIcon
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex h-(--ui-size-page-header) shrink-0 items-center gap-3 border-b border-line bg-panel px-5',
        className
      )}
    >
      {Icon && (
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-(--ui-radius-control) bg-accent/12 text-accent-ink"
        >
          <Icon className="size-5" strokeWidth={1.8} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 data-dom-id="page-title" className="truncate text-head font-semibold text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="truncate text-caption leading-tight text-ink-mute">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
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
        success: 'bg-success/15 text-success-text',
        warning: 'bg-warning/15 text-warning-text',
        error: 'bg-error/15 text-error-text',
        outline: 'border border-line-strong bg-transparent text-ink-dim',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
)

export type ChipProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof chip>

export function Chip({ className, tone, ...props }: ChipProps) {
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

/**
 * 进行中指示：旋转环 + 文案，role=status 让读屏念得出"加载中"。
 * 页面里凡是"转圈 + 提示文字"都用它，不要再各自引 antd Spin。
 */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? '加载中'}
      className={cn('inline-flex items-center gap-2 text-caption text-ink-mute', className)}
    >
      <Loader2 aria-hidden className="size-4 animate-spin" />
      {label ? <span>{label}</span> : null}
    </span>
  )
}

/** 折叠区：grid 0fr↔1fr，DOM 常驻，展开高度自适应，不需要 JS 量高 */export function Collapse({
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

/**
 * 提示条：区域内需要一直看得见的一次性说明（信息 / 警告 / 错误）。
 *
 * 分工：要用户当场做选择的用 Dialog 或 confirmDialog()，一闪而过的用 sonner toast，
 * "有个情况但你不必现在动手"才用 Notice。配色只取 --notice-* / --status-* 令牌
 * （浅色主题按对比度校准过），组件里不出现色值字面量。
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'warning' | 'error'
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const toneClass = {
    info: 'border-(--notice-info-border) bg-(--notice-info-bg) text-(--status-info-text)',
    warning: 'border-(--notice-warning-border) bg-(--notice-warning-bg) text-(--notice-warning-text)',
    error: 'border-error/30 bg-error/10 text-(--status-error-text)',
  }[tone]
  const Icon: LucideIcon = tone === 'info' ? Info : AlertTriangle
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-(--ui-radius-control) border px-3 py-2.5',
        toneClass,
        className
      )}
    >
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-md font-medium">{title}</p> : null}
        {children ? (
          <div className="mt-0.5 text-caption leading-relaxed whitespace-pre-wrap">{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
