/**
 * SettingsPageHeader — 设置页顶部标题区
 *
 * 设计稿：ds-pageheader（标题 + 描述 + 双返回按钮）
 * - 左侧：40×40 品牌色图标盒 + 标题(h1) + 副标题(p)
 * - 右侧：返回工作台 + 返回设置 双按钮（outline 风格）
 *   - data-dom-id="back-workbench" → /workbench
 *   - data-dom-id="back-settings"  → /settings（9 项卡片入口）
 *
 * 用法：
 * ```tsx
 * <SettingsPageHeader icon={Settings} title="通用" desc="语言、时区与启动行为" />
 * ```
 */
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export interface SettingsPageHeaderProps {
  /** 页面标题图标（Lucide） */
  icon: LucideIcon
  /** 页面主标题 */
  title: string
  /** 页面副标题描述 */
  desc: string
}

export function SettingsPageHeader({ icon: Icon, title, desc }: SettingsPageHeaderProps) {
  const navigate = useNavigate()
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
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-dom-id="back-workbench"
          aria-label="返回工作台"
          onClick={() => navigate('/workbench')}
          className="set-backbtn btn-press"
        >
          <ArrowLeft className="di-14" />
          返回工作台
        </button>
        <button
          type="button"
          data-dom-id="back-settings"
          aria-label="返回设置"
          onClick={() => navigate('/settings')}
          className="set-backbtn btn-press"
        >
          <ArrowLeft className="di-14" />
          返回设置
        </button>
      </div>
    </header>
  )
}
