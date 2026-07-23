/**
 * ModelSettingsHeader — 模型配置页专属顶部 Header（v2.3.3 视觉重构）
 *
 * 设计稿：settings-model.html 顶部 header（三列布局，与其他设置页不同）
 * - 左列：返回设置按钮（h-8，outline 风格）
 * - 中列：居中标题区（5×5 品牌色 sparkles 图标 + h1 标题 + 副标题）
 * - 右列：保存配置按钮（h-8，品牌蓝填充）
 *
 * 与通用 SettingsPageHeader（左大图标盒+标题，右返回按钮）布局不同，
 * ModelSettings 设计稿采用"中央对齐标题 + 左右按钮"对称式布局，
 * 因此独立组件，避免影响其他设置页。
 *
 * 视觉规范：
 * - 容器：py-4 mb-6，border-bottom 1px var(--trae-border-neutral-l1)
 * - 三列：flex items-center justify-between gap-6
 * - 中列：flex-1 flex flex-col items-center gap-0.5 min-w-0
 * - 标题：var(--trae-heading-md-font-size) + var(--trae-font-weight-strong)
 * - 副标题：var(--trae-body-xs-font-size) + var(--trae-text-tertiary)
 */
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, Check, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export interface ModelSettingsHeaderProps {
  /** 页面主标题 */
  title: string
  /** 页面副标题描述 */
  desc: string
  /** 标题前图标（默认 Sparkles，对齐设计稿 sparkles.svg） */
  icon?: LucideIcon
  /** 点击"保存配置"回调（不传则不显示右侧按钮） */
  onSave?: () => void
  /** 保存按钮禁用状态 */
  saveDisabled?: boolean
  /** 保存按钮文本（默认"保存配置"） */
  saveLabel?: string
}

export function ModelSettingsHeader({
  title,
  desc,
  icon: Icon = Sparkles,
  onSave,
  saveDisabled = false,
  saveLabel = '保存配置',
}: ModelSettingsHeaderProps) {
  const navigate = useNavigate()

  return (
    <header className="set-model-header">
      {/* 左列：返回设置按钮 */}
      <div className="set-model-header__left">
        <button
          type="button"
          data-dom-id="back-settings"
          aria-label="返回设置"
          onClick={() => navigate('/settings')}
          className="set-model-header__backbtn btn-press"
        >
          <ArrowLeft className="di-14" />
          <span>返回设置</span>
        </button>
      </div>

      {/* 中列：居中标题区（图标 + h1 + 副标题） */}
      <div className="set-model-header__center">
        <div className="set-model-header__title-row">
          <Icon className="di-20 set-model-header__title-icon" />
          <h1 className="set-model-header__title">
            {title}
          </h1>
        </div>
        <span className="set-model-header__desc">
          {desc}
        </span>
      </div>

      {/* 右列：保存配置按钮 */}
      <div className="set-model-header__right">
        {onSave != null && (
          <button
            type="button"
            onClick={onSave}
            disabled={saveDisabled}
            aria-label={saveLabel}
            className="set-model-header__savebtn btn-press"
          >
            <Check className="di-14" />
            <span>{saveLabel}</span>
          </button>
        )}
      </div>
    </header>
  )
}
