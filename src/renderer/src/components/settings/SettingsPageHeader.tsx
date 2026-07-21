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

const BACK_BTN_CLASS =
  'inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-overlay-l1)] motion-safe:active:scale-95'

export function SettingsPageHeader({ icon: Icon, title, desc }: SettingsPageHeaderProps) {
  const navigate = useNavigate()
  return (
    <header className="flex items-start justify-between gap-6 border-b border-[var(--trae-border-neutral-l1)] px-6 pb-[18px] pt-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-[var(--trae-radius-10)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand-popup)]">
          <Icon className="size-5 text-[var(--trae-bg-brand)]" />
        </span>
        <div>
          <h1
            className="font-semibold text-[var(--trae-text-default)]"
            style={{
              fontFamily: '"SF Pro", "Microsoft YaHei", system-ui, sans-serif',
              fontSize: '28px',
              lineHeight: '36px',
              letterSpacing: '-0.012em',
            }}
          >
            {title}
          </h1>
          <p className="mt-0.5 text-[10px] leading-[14px] text-[var(--trae-text-secondary)]">
            {desc}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-dom-id="back-workbench"
          aria-label="返回工作台"
          onClick={() => navigate('/workbench')}
          className={BACK_BTN_CLASS}
        >
          <ArrowLeft className="size-3.5" />
          返回工作台
        </button>
        <button
          type="button"
          data-dom-id="back-settings"
          aria-label="返回设置"
          onClick={() => navigate('/settings')}
          className={BACK_BTN_CLASS}
        >
          <ArrowLeft className="size-3.5" />
          返回设置
        </button>
      </div>
    </header>
  )
}
