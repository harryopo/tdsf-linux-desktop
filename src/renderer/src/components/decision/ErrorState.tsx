/**
 * ErrorState — 通用错误状态组件
 *
 * 抽离自 DecisionDetailPage.tsx（M2 Task 1），供 DecisionDetailPage / DecisionPage /
 * HistoryDetailPage 等页面复用。
 *
 * 视觉：全屏居中 AlertTriangle 图标 + 错误消息 + 重试按钮。
 *
 * Token 合规：所有颜色使用 var(--trae-*) 或 var(--bg-brand)，无硬编码。
 */
import { AlertTriangle } from 'lucide-react'

interface ErrorStateProps {
  /** 错误消息 */
  message: string
  /** 重试回调 */
  onRetry: () => void
}

/** 通用错误状态：全屏居中 AlertTriangle + 错误消息 + 重试按钮 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--trae-bg-base-default)]">
      <AlertTriangle className="h-8 w-8 text-[var(--trae-status-alert-default)]" />
      <span className="text-[13px] text-[var(--trae-text-secondary)]">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)] active:bg-[var(--trae-bg-overlay-l3)] active:text-[var(--trae-text-default)]"
      >
        重试
      </button>
    </main>
  )
}
