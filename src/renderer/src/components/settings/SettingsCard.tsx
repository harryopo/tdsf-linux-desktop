/**
 * SettingsCard — 设置卡片
 *
 * 设计稿：ds-card（头部图标+标题+标签 + 内容区）
 * - 背景 var(--trae-bg-base-secondary)
 * - 边框 var(--trae-border-neutral-l1)
 * - 圆角 var(--trae-radius-8)
 * - 头部底边分隔线
 * - hover 阴影加深（仅阴影变化）
 *
 * v2.3.3 新增可选 prop（向后兼容）：
 * - hideTag: 隐藏右侧标签（设计稿 settings-model.html 卡片头部无 tag）
 * - noHeadBorder: 移除头部底边分隔线（设计稿 settings-model.html 卡片头部无 border-bottom）
 * - iconColor: 头部图标颜色（默认品牌蓝；预算告警卡片用 status-alert-default）
 * - headMb: 头部下间距（设计稿 mb-4 = 16px）
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SettingsCardProps {
  /** 头部图标（Lucide） */
  icon: LucideIcon
  /** 卡片标题 */
  title: string
  /** 卡片右侧标签（如 "shell.defaults"） */
  tag?: string
  /** 卡片内容 */
  children: ReactNode
  /** 卡片根 className（用于自定义 padding 等） */
  className?: string
  /** 隐藏右侧标签（设计稿 settings-model.html 卡片头部无 tag） */
  hideTag?: boolean
  /** 移除头部底边分隔线（设计稿 settings-model.html 卡片头部无 border-bottom） */
  noHeadBorder?: boolean
  /** 头部图标颜色 CSS 变量（默认 var(--trae-bg-brand)；告警类用 var(--trae-status-alert-default)） */
  iconColor?: string
  /** 头部下间距（默认 'default'；'lg' = 16px 对齐设计稿 mb-4） */
  headMb?: 'default' | 'lg'
}

export function SettingsCard({
  icon: Icon,
  title,
  tag,
  children,
  className,
  hideTag = false,
  noHeadBorder = false,
  iconColor,
  headMb = 'default',
}: SettingsCardProps) {
  const headClass =
    'set-card__head' +
    (noHeadBorder ? ' set-card__head--no-border' : '') +
    (headMb === 'lg' ? ' set-card__head--mb-lg' : '')
  const iconStyle = iconColor != null ? { color: iconColor } : undefined
  return (
    <div className={'set-card ' + (className ?? '')}>
      <div className={headClass}>
        <Icon className="di-16" style={iconStyle} />
        <span className="set-card__title">
          {title}
        </span>
        {!hideTag && tag != null && tag !== '' && (
          <span className="set-card__tag">
            {tag}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
