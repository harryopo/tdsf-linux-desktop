/**
 * EmptyMonitorState — MonitorPage 空状态
 *
 * 用途：
 * - 未连接 SSH 服务器 / 无实时监控数据 / IPC 不可用时显示
 * - 符合 spec REMOVED Requirements：运行时不再加载 mock 数据，改用 EmptyState 提示
 *
 * Spec: build-runnable-tdsf-from-design · Task 2.4
 */
import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor } from 'lucide-react'
import { Empty } from '@/components/trae/Empty'

export interface EmptyMonitorStateProps {
  /** 自定义图标（默认 Monitor） */
  icon?: ComponentType<{ className?: string }>
  /** 自定义标题 */
  title?: string
  /** 自定义描述 */
  description?: string
  /** 是否显示「前往工作台」按钮（默认显示） */
  showAction?: boolean
  /** 自定义外层 className */
  className?: string
}

/** MonitorPage 空状态组件 */
export function EmptyMonitorState({
  icon: Icon = Monitor,
  title = '暂无监控数据',
  description = '未连接 SSH 服务器，请先在工作台连接服务器后查看实时监控数据',
  showAction = true,
  className,
}: EmptyMonitorStateProps) {
  const navigate = useNavigate()
  const action = showAction ? (
    <button
      type="button"
      onClick={() => navigate('/workbench')}
      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] font-medium text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
    >
      前往工作台
    </button>
  ) : undefined

  return (
    <div
      className={`flex w-full items-center justify-center rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] ${className ?? ''}`}
    >
      <Empty
        icon={Icon}
        title={title}
        description={description}
        action={action}
      />
    </div>
  )
}
