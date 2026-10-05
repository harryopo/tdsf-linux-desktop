/**
 * SettingsPageHeader — 设置页顶部标题区（整个设置区共用的唯一 Header）
 *
 * - 左侧：40×40 品牌色图标盒 + 标题(h1) + 副标题
 * - 右侧：页面自己的动作按钮（如"保存配置"），由 actions 传入
 *
 * 没有"返回设置"按钮：左栏导航在设置区常驻，页面内再放一个返回口就是重复出口。
 */
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface SettingsPageHeaderProps {
  /** 页面标题图标（Lucide） */
  icon: LucideIcon
  /** 页面主标题 */
  title: string
  /** 页面副标题描述 */
  desc: string
  /** 右侧动作区（保存/测试等按钮），不传则只留标题 */
  actions?: ReactNode
}

export function SettingsPageHeader({
  icon: Icon,
  title,
  desc,
  actions,
}: SettingsPageHeaderProps) {
  return (
    <header className="set-pageheader">
      <div className="set-pageheader__left">
        <span className="set-pageheader__iconwrap">
          <Icon className="di-20" />
        </span>
        <div className="set-pageheader__title">
          <h1>{title}</h1>
          <p>{desc}</p>
        </div>
      </div>
      {actions != null && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
