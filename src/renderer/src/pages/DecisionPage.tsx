/**
 * DecisionPage — 可信决策内核的历史入口页
 *
 * 路由：/decision
 *
 * 数据来源：
 * - window.electronAPI.historyList(offset, limit) — 最近 20 条决策卡片，点开进 /decision/:id
 *
 * 这里以前还有一半"活跃决策态"（订阅工作流事件、置信度仪表、七步时间线、审批三键），
 * 2026-10-25 随那条链一起整删（#222）：它的 correlationId 只能从循环工程的推送里来，
 * 而渲染层没有任何一处能启动那条链——推送永不到来，于是那三颗审批按钮按下去直接在第一行 return。
 * 活跃期的审批不在这一页：高危命令的决策卡由主进程推到全局审批条（dock/permission-bar），
 * 应答出口是 paorApprove；这条判据钉在 tests/unit/loop-engineering-surface.test.ts 第 4 条。
 *
 * 复用组件：HistoryCard / LoadingState / ErrorState（与详情页共用同一批读数形状）
 *
 * Token 合规：所有颜色使用 var(--trae-*) 或 var(--trae-bg-brand)，无硬编码。
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, ArrowLeft, AlertTriangle, History } from 'lucide-react'
import { Button, PageHeader } from '@/ui'
import { LoadingState } from '@/components/decision/LoadingState'
import { ErrorState } from '@/components/decision/ErrorState'
import { HistoryCard } from '@/components/decision/HistoryCard'
import type { DecisionCard } from '@shared/models'

export function DecisionPage() {
  const navigate = useNavigate()

  const [historyCards, setHistoryCards] = useState<DecisionCard[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)

  /** 加载历史决策列表 */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    if (!window.electronAPI?.historyList) {
      setHistoryCards([])
      setHistoryLoading(false)
      return
    }
    try {
      const cards = await window.electronAPI.historyList(0, 20)
      setHistoryCards(cards)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载决策历史失败'
      setHistoryError(msg)
      console.warn('[DecisionPage] historyList failed:', err)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  return (
    <main className="flex h-full w-full flex-col bg-[var(--trae-bg-base-default)]">
      {/* ===== 页头（全站唯一 PageHeader，八个模块左上角对齐）===== */}
      <PageHeader
        icon={Sparkles}
        title="可信决策内核"
        subtitle={<>Human-in-the-Loop · 可解释 · 可审计</>}
        actions={
          <Button
            variant="outline"
            size="md"
            onClick={() => navigate('/workbench')}
            data-dom-id="back-workbench"
            aria-label="返回工作台"
          >
            <ArrowLeft className="size-4" />
            <span>返回工作台</span>
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {historyLoading ? (
          <LoadingState />
        ) : historyError ? (
          <ErrorState message={historyError} onRetry={() => void loadHistory()} />
        ) : historyCards.length === 0 ? (
          <div className="flex h-[400px] flex-col items-center justify-center gap-4">
            <AlertTriangle className="h-8 w-8 text-ink-mute" />
            <span className="text-md text-ink-dim">暂无决策记录</span>
            <button
              type="button"
              onClick={() => navigate('/workbench')}
              className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-sm text-ink-dim transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回工作台触发首次决策
            </button>
          </div>
        ) : (
          <section className="px-8 pt-4 pb-8">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-4 w-4 text-(--accent-text)" />
              <span className="text-title font-semibold text-ink">最近决策</span>
              <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2 text-micro text-ink-dim">
                {historyCards.length} 条
              </span>
              <span className="text-micro text-ink-mute">点击卡片查看完整决策详情</span>
            </div>
            {/* v2.6：自适应列宽（每列 320-460px），超宽屏不再把 3 张卡拉成满屏宽 */}
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,460px))]">
              {historyCards.map((card) => (
                <HistoryCard
                  key={card.id}
                  card={card}
                  onClick={() => navigate(`/decision/${card.id}`)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
