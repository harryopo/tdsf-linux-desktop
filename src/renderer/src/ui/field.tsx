/**
 * 表单原语：Field / TextInput / TextArea
 *
 * 只管外观与无障碍（label 关联控件、必填星号不入朗读），不做校验——
 * 每个对话框的校验规则都不同，交给调用方判断。
 */
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/components/trae/utils'

const controlClass = cn(
  'w-full rounded-(--ui-radius-control) border border-line-strong bg-sunken px-2 py-1.5',
  'text-md text-ink outline-none placeholder:text-ink-placeholder',
  'transition-[border-color,box-shadow] duration-[var(--ui-dur-fast)] ease-out',
  'focus:border-accent focus:ring-2 focus:ring-accent/30',
  'disabled:pointer-events-none disabled:opacity-50'
)

export function Field({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: ReactNode
  /** 必填只在样式上标记，朗读交给 aria-label，避免屏幕阅读器念出孤立的星号 */
  required?: boolean
  hint?: ReactNode
  children: (id: string) => ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="flex items-center gap-1 text-caption font-medium text-ink-dim">
        {label}
        {required ? <span aria-hidden className="text-error-text">*</span> : null}
      </label>
      {children(id)}
      {hint ? <span className="text-caption text-ink-mute">{hint}</span> : null}
    </div>
  )
}

export function TextInput({
  className,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(controlClass, invalid && 'border-error focus:border-error focus:ring-error/30', className)}
      {...props}
    />
  )
}

export function TextArea({
  className,
  rows = 4,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(controlClass, 'resize-y', className)} {...props} />
}
