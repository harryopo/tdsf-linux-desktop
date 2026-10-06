/**
 * SettingsPageHeader — 设置区 9 个子页共用的顶部标题区
 *
 * 只是 PageHeader 的一层薄封装：让设置区各页沿用同一个标题（字号、位置、高度
 * 与其余模块完全一致），同时保留 .set-pageheader 这个类名给自动化脚本当钩子。
 *
 * 没有"返回设置"按钮：左栏导航在设置区常驻，页面内再放一个返回口就是重复出口。
 */
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { PageHeader } from '@/ui'

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
  icon,
  title,
  desc,
  actions,
}: SettingsPageHeaderProps) {
  return (
    <PageHeader
      className="set-pageheader"
      icon={icon}
      title={title}
      subtitle={desc}
      actions={actions}
    />
  )
}
