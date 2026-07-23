/**
 * LoadingState — 通用加载状态组件
 *
 * 抽离自 DecisionDetailPage.tsx（M2 Task 1），供 DecisionDetailPage / DecisionPage /
 * HistoryDetailPage 等页面复用。
 *
 * 视觉：全屏居中 Loader2 旋转图标 + 提示文案。
 *
 * Token 合规：所有颜色使用 var(--trae-*) 或 var(--bg-brand)，无硬编码。
 */
import { Loader2 } from 'lucide-react'

/** 通用加载状态：全屏居中 Loader2 旋转 + 提示文案 */
export function LoadingState() {
  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--trae-bg-base-default)]">
      <Loader2 className="h-8 w-8 animate-spin text-[var(--trae-bg-brand)]" />
      <span className="text-[13px] text-[var(--trae-text-secondary)]">正在加载决策详情...</span>
    </main>
  )
}
