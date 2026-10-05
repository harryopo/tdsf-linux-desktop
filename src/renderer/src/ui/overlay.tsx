/**
 * 浮层原语：Tooltip / Dialog / Menu / Toaster
 *
 * 行为全部交给 radix（焦点陷阱、Esc、aria、portal），我们只负责 IDE 外观。
 * 层级用 ui-tokens 的六档：dropdown 1000、modal 1100、toast 9999、审批 10000。
 */
import { forwardRef, useState, type ReactNode } from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import * as RadixDialog from '@radix-ui/react-dialog'
import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { Toaster as SonnerToaster } from 'sonner'
import { X } from 'lucide-react'
import { cn } from '@/components/trae/utils'
import { IconButton } from './button'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={400}>{children}</RadixTooltip.Provider>
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  // 空提示=这条提示不该出现（沿用 antd title='' 的语义），不包一层空气泡
  if (content === null || content === undefined || content === '') return <>{children}</>
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          className={cn(
            'z-(--ui-z-dropdown) rounded-(--ui-radius-control) border border-line-strong',
            'bg-raised px-2 py-1 text-caption text-ink shadow-(--shadow-md)',
            'select-none'
          )}
        >
          {content}
          <RadixTooltip.Arrow className="fill-raised" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger

/** 居中对话框：面板底 + 1px 边 + 中阴影，不做毛玻璃（IDE 里半透明只会让文字难读） */
export function DialogContent({
  title,
  description,
  footer,
  children,
  className,
  dismissible = true,
  closeOnOverlayClick = true,
}: {
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  className?: string
  /** 为 false 时 Esc 与关闭按钮都不放行——用于必须做选择的弹窗（如主机密钥确认） */
  dismissible?: boolean
  /** 点遮罩是否关闭；已填过内容的弹窗应设为 false，误点外部不该丢弃输入 */
  closeOnOverlayClick?: boolean
}) {
  const blockEscape = (e: { preventDefault: () => void }) => {
    if (!dismissible) e.preventDefault()
  }
  const blockOutside = (e: { preventDefault: () => void }) => {
    if (!dismissible || !closeOnOverlayClick) e.preventDefault()
  }
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-(--ui-z-modal) bg-black/55 data-[state=open]:animate-in" />
      <RadixDialog.Content
        onEscapeKeyDown={blockEscape}
        onInteractOutside={blockOutside}
        onPointerDownOutside={blockOutside}
        className={cn(
          'fixed left-1/2 top-1/2 z-(--ui-z-modal) w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2',
          'rounded-(--ui-radius-panel) border border-line-strong bg-raised shadow-(--shadow-lg)',
          'focus:outline-none',
          className
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <RadixDialog.Title className="text-title font-semibold text-ink-strong">
              {title}
            </RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-1 text-sm text-ink-dim">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          {dismissible ? (
            <RadixDialog.Close asChild>
              <IconButton label="关闭" size="sm">
                <X className="size-4" />
              </IconButton>
            </RadixDialog.Close>
          ) : null}
        </div>
        {children ? <div className="px-4 py-3">{children}</div> : null}
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </div>
        ) : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}

export const Menu = RadixMenu.Root
export const MenuTrigger = RadixMenu.Trigger

const menuListClass = cn(
  'z-(--ui-z-dropdown) min-w-[180px] overflow-hidden rounded-(--ui-radius-panel) border border-line-strong',
  'bg-raised p-1 shadow-(--shadow-md)'
)

const menuItemClass = cn(
  'flex cursor-pointer items-center gap-2 rounded-(--ui-radius-control) px-2 py-1.5',
  'text-md text-ink outline-none data-[highlighted]:bg-hover'
)

export function MenuContent({
  children,
  className,
  side,
  align = 'start',
  sideOffset,
}: {
  children: ReactNode
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'center' | 'end' | 'start'
  sideOffset?: number
}) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(menuListClass, className)}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  )
}

export const MenuItem = forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RadixMenu.Item>
>(({ className, ...props }, ref) => (
  <RadixMenu.Item ref={ref} className={cn(menuItemClass, className)} {...props} />
))
MenuItem.displayName = 'MenuItem'

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <RadixMenu.Label className="px-2 py-1 text-caption font-semibold tracking-wide text-ink-mute uppercase">
    {children}
  </RadixMenu.Label>
)

export const MenuSeparator = () => <RadixMenu.Separator className="my-1 h-px bg-line" />

/** 右键菜单的一项；divider 是分隔线的占位类型 */
export type ContextMenuEntry =
  | {
      key: string
      label: ReactNode
      icon?: ReactNode
      danger?: boolean
      disabled?: boolean
      onSelect?: () => void
    }
  | { key: string; divider: true }

const isDivider = (it: ContextMenuEntry): it is { key: string; divider: true } =>
  'divider' in it && it.divider === true

/**
 * 右键菜单：包住任意子元素，右键在光标位置弹出菜单。
 *
 * 包装层用 display:contents，不改父级 flex/grid 布局；contextmenu 事件从子元素冒泡上来，
 * 所以不需要 cloneElement 去改子元素 props。
 * 定位靠一根 0 尺寸、不吃指针事件的 fixed trigger 钉在光标处——本仓库的
 * @radix-ui/react-dropdown-menu 没有导出 Anchor，用 trigger 当锚点是现成的等效做法。
 */
export function ContextMenu({
  items,
  children,
}: {
  items: ContextMenuEntry[]
  children: ReactNode
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)

  return (
    <span
      className="contents"
      onContextMenu={(e) => {
        e.preventDefault()
        setPoint({ x: e.clientX, y: e.clientY })
      }}
    >
      {children}
      <Menu open={point !== null} onOpenChange={(next) => !next && setPoint(null)}>
        <MenuTrigger asChild>
          <span
            aria-hidden
            style={{
              position: 'fixed',
              left: point?.x ?? 0,
              top: point?.y ?? 0,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </MenuTrigger>
        <MenuContent side="right" align="start">
          {items.map((it) =>
            isDivider(it) ? (
              <MenuSeparator key={it.key} />
            ) : (
              <MenuItem
                key={it.key}
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={cn(it.danger && 'text-error data-[highlighted]:bg-error/10')}
              >
                {it.icon}
                <span className="min-w-0 truncate">{it.label}</span>
              </MenuItem>
            )
          )}
        </MenuContent>
      </Menu>
    </span>
  )
}

/** 全局 toast 出口：右下角，深色面板底，不用彩色大底条 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-secondary)',
          borderRadius: 'var(--ui-radius-panel)',
          fontSize: 'var(--ui-font-sm)',
        },
      }}
    />
  )
}
