/**
 * TokenUsageChart — Token 使用统计（真 IPC）
 *
 * // @ai-session: ai-claude-20260721-overnight-c
 * // @ai-task: token-chart-real
 *
 * 数据：window.electronAPI.tokenStats() → today/week/month/total + byProvider
 * 图表：按总量生成示意折线（无明细历史时用累计值近似）
 */
import { useEffect, useMemo, useState } from 'react'
import { Star, Loader2 } from 'lucide-react'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { TokenStats } from '@shared/agent-types'

type TimeRange = 'day' | 'week' | 'month'

const EMPTY: TokenStats = {
  today: 0,
  week: 0,
  month: 0,
  total: 0,
  bySubagent: {},
  byProvider: {},
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** 由标量生成平滑折线 points（viewBox 800×200） */
function buildPolyline(total: number, seed: number): string {
  const pts: string[] = []
  const base = Math.max(total, 1)
  for (let i = 0; i < 28; i++) {
    const x = 40 + (i / 27) * 728
    const wave = Math.sin(i * 0.45 + seed) * 0.15 + Math.cos(i * 0.2) * 0.08
    const ratio = 0.25 + (i / 27) * 0.55 + wave
    const y = 180 - Math.min(0.95, Math.max(0.05, ratio)) * (120 * Math.min(1, base / 50000))
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return pts.join(' ')
}

export function TokenUsageChart() {
  const [timeRange, setTimeRange] = useState<TimeRange>('month')
  const [stats, setStats] = useState<TokenStats>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!isElectronAPIAvailable() || !window.electronAPI.tokenStats) {
        setLoading(false)
        return
      }
      try {
        const s = await window.electronAPI.tokenStats()
        if (!cancelled && s) setStats(s)
      } catch (e) {
        console.error('[TokenUsageChart] tokenStats failed', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const t = window.setInterval(() => void load(), 15000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])

  const activeTotal =
    timeRange === 'day' ? stats.today : timeRange === 'week' ? stats.week : stats.month

  // 无输入输出拆分时，用 55/45 近似
  const inputTokens = Math.round(activeTotal * 0.55)
  const outputTokens = Math.max(0, activeTotal - inputTokens)
  const sum = inputTokens + outputTokens || 1
  const inPct = Math.round((inputTokens / sum) * 100)
  const outPct = 100 - inPct
  const ratio = outputTokens > 0 ? (inputTokens / outputTokens).toFixed(2) : '—'

  const providerRows = useMemo(() => {
    const entries = Object.entries(stats.byProvider || {})
    if (entries.length === 0) {
      return [{ model: '（暂无调用）', tokens: '0', share: '—' }]
    }
    const total = entries.reduce((a, [, v]) => a + v, 0) || 1
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({
        model: id,
        tokens: fmt(n),
        share: `${Math.round((n / total) * 100)}%`,
      }))
  }, [stats.byProvider])

  const lineIn = buildPolyline(inputTokens || stats.total, 0.2)
  const lineOut = buildPolyline(outputTokens || stats.total * 0.4, 1.1)

  const rangeLabel =
    timeRange === 'day' ? '今日' : timeRange === 'week' ? '本周' : '本月'

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--trae-text-tertiary)]">
        <Loader2 className="size-4 animate-spin" />
        加载 Token 统计…
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-overlay-l2)] p-0.5">
            {(['day', 'week', 'month'] as TimeRange[]).map((r) => {
              const label = r === 'day' ? '日' : r === 'week' ? '周' : '月'
              const active = timeRange === r
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setTimeRange(r)}
                  className={
                    'inline-flex h-8 items-center justify-center rounded-[var(--trae-radius-4)] px-3 text-[12px] font-medium transition-colors ' +
                    (active
                      ? 'bg-[var(--trae-bg-brand)] text-[var(--trae-text-onbrand)]'
                      : 'text-[var(--trae-text-secondary)] hover:text-[var(--trae-text-default)]')
                  }
                >
                  {label}
                </button>
              )
            })}
          </div>
          <span className="text-[12px] text-[var(--trae-text-tertiary)]">
            {rangeLabel} · 累计 {fmt(stats.total)} tokens
          </span>
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-2 flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--trae-text-secondary)]">
            <span className="inline-block h-0.5 w-3 bg-[var(--trae-bg-brand)]" />
            输入（估）
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--trae-text-secondary)]">
            <span className="inline-block h-0.5 w-3 bg-[var(--trae-accent-cyan,#04CBE5)]" />
            输出（估）
          </span>
        </div>
        <svg
          width="100%"
          height="200"
          viewBox="0 0 800 200"
          preserveAspectRatio="none"
          role="img"
          aria-label="Token使用趋势"
        >
          <g stroke="var(--trae-bg-overlay-l2)" strokeWidth="1">
            <line x1="0" y1="40" x2="800" y2="40" />
            <line x1="0" y1="80" x2="800" y2="80" />
            <line x1="0" y1="120" x2="800" y2="120" />
            <line x1="0" y1="160" x2="800" y2="160" />
          </g>
          <polyline
            points={lineIn}
            fill="none"
            stroke="var(--trae-bg-brand)"
            strokeWidth="2"
          />
          <polyline
            points={lineOut}
            fill="none"
            stroke="var(--trae-accent-cyan, #04CBE5)"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          <line
            x1="40"
            y1="180"
            x2="780"
            y2="180"
            stroke="var(--trae-border-neutral-l1)"
            strokeWidth="1"
          />
        </svg>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-4 border-t border-[var(--trae-border-neutral-l1)] py-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-[var(--trae-text-tertiary)]">
            {rangeLabel}输入 Token（估）
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[16px] font-semibold tabular-nums text-[var(--trae-text-default)]">
              {fmt(inputTokens)}
            </span>
            <span className="text-[12px] text-[var(--trae-text-secondary)]">{inPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--trae-bg-overlay-l2)]">
            <div
              className="h-full rounded-full bg-[var(--trae-bg-brand)]"
              style={{ width: `${inPct}%` }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-[var(--trae-text-tertiary)]">
            {rangeLabel}输出 Token（估）
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[16px] font-semibold tabular-nums text-[var(--trae-text-default)]">
              {fmt(outputTokens)}
            </span>
            <span className="text-[12px] text-[var(--trae-text-secondary)]">{outPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--trae-bg-overlay-l2)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${outPct}%`,
                backgroundColor: 'var(--trae-accent-cyan, #04CBE5)',
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-[var(--trae-text-tertiary)]">输入 / 输出比</span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[16px] font-semibold tabular-nums text-[var(--trae-text-default)]">
              {ratio}
            </span>
            <span className="text-[12px] text-[var(--trae-text-secondary)]">: 1</span>
          </div>
          <span className="text-[12px] text-[var(--trae-text-tertiary)]">
            今日 {fmt(stats.today)} · 本周 {fmt(stats.week)}
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-overlay-l1)] p-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--trae-text-secondary)]">
          <Star className="size-3.5" />
          {rangeLabel}用量
          <span className="font-mono font-semibold tabular-nums text-[var(--trae-text-default)]">
            {fmt(activeTotal)}
          </span>
          tokens
        </span>
        <span className="font-mono text-[12px] tabular-nums text-[var(--trae-text-tertiary)]">
          历史累计 {fmt(stats.total)}
        </span>
      </div>

      <div className="overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
        <div className="border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--trae-text-tertiary)]">
            按 Provider 分布
          </span>
        </div>
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[var(--trae-border-neutral-l1)]">
              <th className="px-3 py-2 text-left text-[11px] font-normal text-[var(--trae-text-tertiary)]">
                Provider
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-normal text-[var(--trae-text-tertiary)]">
                Tokens
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-normal text-[var(--trae-text-tertiary)]">
                占比
              </th>
            </tr>
          </thead>
          <tbody>
            {providerRows.map((row) => (
              <tr
                key={row.model}
                className="border-b border-[var(--trae-border-neutral-l1)] last:border-0"
              >
                <td className="px-3 py-2 font-medium text-[var(--trae-text-default)]">
                  {row.model}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--trae-text-default)]">
                  {row.tokens}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--trae-text-brand)]">
                  {row.share}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default TokenUsageChart
