/**
 * SettingsRow — 设置行布局
 *
 * 设计稿：ds-row（左侧 label+desc，右侧 control，底部 1px 分隔线）
 * - 最后一行不显示分隔线
 * - label：12px medium 强调色
 * - desc：10px 次要色
 */
import type { ReactNode } from 'react'

export interface SettingsRowProps {
  /** 行标题（可包含徽章等富文本） */
  label: ReactNode
  /** 行描述说明 */
  desc?: string
  /** 右侧控件（Switch / Select / Slider / Input 等） */
  control: ReactNode
  /** 是否为最后一行（不显示底部分隔线） */
  isLast?: boolean
}

export function SettingsRow({ label, desc, control, isLast }: SettingsRowProps) {
  return (
    <div className={isLast ? 'set-row set-row--last' : 'set-row'}>
      <div className="set-row__text">
        <div className="set-row__label">
          {label}
        </div>
        {desc != null && desc !== '' && (
          <div className="set-row__desc">
            {desc}
          </div>
        )}
      </div>
      <div className="set-row__control">{control}</div>
    </div>
  )
}
