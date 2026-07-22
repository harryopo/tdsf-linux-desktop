/**
 * SettingsActionBar — 设置页底部操作栏
 *
 * 设计稿：ds-actionbar（保存按钮 + 恢复默认按钮）
 * - 顶部 1px 分隔线
 * - 主按钮：品牌蓝
 * - 次按钮：outline 风格
 *
 * 内置 toast 反馈：点击保存/恢复后显示 2s 提示，无需调用方处理。
 * 调用方传入 onSave/onReset 回调以执行实际逻辑（如持久化）。
 */
import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Check, RotateCcw } from 'lucide-react'

export interface SettingsActionBarProps {
  /** 保存按钮文本（默认"保存设置"） */
  saveLabel?: string
  /** 恢复默认按钮文本（默认"恢复默认"） */
  resetLabel?: string
  /** 保存回调（可选；不传也会显示"已保存"反馈） */
  onSave?: () => void
  /** 恢复默认回调（可选；不传也会显示"已恢复"反馈） */
  onReset?: () => void
  /** 自定义额外按钮（插入到右侧） */
  extra?: ReactNode
}

type FeedbackKind = 'saved' | 'reset' | null

export function SettingsActionBar({
  saveLabel = '保存设置',
  resetLabel = '恢复默认',
  onSave,
  onReset,
  extra,
}: SettingsActionBarProps) {
  const [feedback, setFeedback] = useState<FeedbackKind>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [])

  const triggerFeedback = (kind: FeedbackKind) => {
    setFeedback(kind)
    if (timerRef.current != null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setFeedback(null), 2000)
  }

  const handleSave = () => {
    onSave?.()
    triggerFeedback('saved')
  }

  const handleReset = () => {
    onReset?.()
    triggerFeedback('reset')
  }

  return (
    <div className="set-actionbar">
      <button
        type="button"
        onClick={handleSave}
        className="set-btn-primary btn-press"
      >
        <Check className="di-14" />
        {saveLabel}
      </button>
      <button
        type="button"
        onClick={handleReset}
        className="set-btn-secondary btn-press"
      >
        <RotateCcw className="di-14" />
        {resetLabel}
      </button>

      {/* 内置 toast 反馈（2s 自动消失） */}
      {feedback != null && (
        <span
          role="status"
          aria-live="polite"
          className={
            'inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border px-3 text-[12px] font-medium ' +
            (feedback === 'saved'
              ? 'border-[var(--trae-status-success-default)] bg-[var(--trae-status-success-surface-l1)] text-[var(--trae-status-success-default)]'
              : 'border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] text-[var(--trae-text-secondary)]')
          }
        >
          {feedback === 'saved' ? (
            <>
              <Check className="di-14" />
              设置已保存
            </>
          ) : (
            <>
              <RotateCcw className="di-14" />
              已恢复默认设置
            </>
          )}
        </span>
      )}

      {extra != null && <div className="ml-auto flex items-center gap-2">{extra}</div>}
    </div>
  )
}
