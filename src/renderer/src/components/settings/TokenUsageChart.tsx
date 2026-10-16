/**
 * TokenUsageChart — Token 使用统计（真 IPC）
 *
 * // @ai-session: ai-claude-20260721-overnight-c
 * // @ai-task: token-chart-real
 *
 * 数据：window.electronAPI.tokenStats() → today/week/month/total + split + byProvider
 *
 * 2026-10-16 去假（用户："假的UI都检查一下，做成真功能"）。这里原来有两块不是数据：
 * - 那条"输入/输出趋势"折线：28 个点由 sin/cos 合成，输入只有累计标量。
 *   文件头自己写着"示意折线"，可界面上没有任何地方说它是示意——
 *   用户读到的就是一段真实发生过的用量曲线。现在换成今日/本周/本月三根真柱子。
 * - 输入/输出拆分用 55/45 猜，再拿猜出来的两个数算"输入/输出比"当第三张卡。
 *   2026-10-17 换成真拆分：TokenStats.split 由同一批记录、同一套窗口起点算出来，
 *   每个窗口都满足 input + output + unknown = 该窗口合计数（判据见
 *   tests/unit/token-stats-split.test.ts）。
 * - 老记录可能没有方向字段（从 store 恢复时只校验 totalTokens/timestamp），
 *   这部分单列成 unknown 并在界面上写明"未记方向"，不摊进输入或输出里凑数。
 */
import { useEffect, useState } from 'react'
import { Star, Loader2 } from 'lucide-react'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { emptyTokenStats, type TokenStats } from '@shared/agent-types'

const EMPTY: TokenStats = emptyTokenStats()

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function TokenUsageChart() {
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

  const windows = [
    { label: '今日', value: stats.today, split: stats.split.today },
    { label: '本周', value: stats.week, split: stats.split.week },
    { label: '本月', value: stats.month, split: stats.split.month },
  ]
  const maxWindow = Math.max(1, ...windows.map((w) => w.value))

  const providerRows = Object.entries(stats.byProvider || {})
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({
      provider: id,
      tokens: fmt(n),
      share: stats.total > 0 ? `${Math.round((n / stats.total) * 100)}%` : '—',
    }))

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-md text-ink-mute">
        <Loader2 className="size-4 animate-spin" />
        加载 Token 统计…
      </div>
    )
  }

  return (
    <div>
      {/*
        三个真实时间窗口的用量对比：柱子长度按同一刻度，
        柱子里两段分别是输入与输出（老数据里没方向的第三段另色标出），数字就是 tokenStats 的原始值。
      */}
      <div className="flex flex-col gap-2.5">
        {windows.map((w) => (
          <div key={w.label} className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-sm text-ink-mute">{w.label}</span>
              <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--trae-bg-overlay-l2)]">
                <div
                  className="h-full bg-accent-solid"
                  style={{ width: `${(w.split.input / maxWindow) * 100}%` }}
                />
                <div
                  className="h-full bg-[var(--trae-status-success-default)]"
                  style={{ width: `${(w.split.output / maxWindow) * 100}%` }}
                />
                {w.split.unknown > 0 && (
                  <div
                    className="h-full bg-[var(--trae-border-neutral-l2)]"
                    data-dom-id={`token-unknown-${w.label}`}
                    style={{ width: `${(w.split.unknown / maxWindow) * 100}%` }}
                  />
                )}
              </div>
              <span className="w-24 shrink-0 text-right font-mono text-md tabular-nums text-ink">
                {fmt(w.value)}
              </span>
            </div>
            <div className="pl-[52px] font-mono text-micro tabular-nums text-ink-dim">
              输入 {fmt(w.split.input)} · 输出 {fmt(w.split.output)}
              {w.split.unknown > 0 && ` · 未记方向 ${fmt(w.split.unknown)}`}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-micro text-ink-mute">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-accent-solid" />
          输入
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[var(--trae-status-success-default)]" />
          输出
        </span>
        {stats.split.total.unknown > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[var(--trae-border-neutral-l2)]" />
            未记方向（早期记录没带这个字段）
          </span>
        )}
      </div>

      <div className="mt-4 mb-3 flex flex-wrap items-center gap-4 rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-overlay-l1)] p-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-dim">
          <Star className="size-3.5" />
          历史累计
          <span className="font-mono font-semibold tabular-nums text-ink">
            {fmt(stats.total)}
          </span>
          tokens
        </span>
        {stats.total === 0 && (
          <span className="text-sm text-ink-mute">还没有一次调用被记到这里</span>
        )}
      </div>

      <div className="overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
        <div className="border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-3 py-2">
          <span className="text-caption font-medium uppercase tracking-[0.04em] text-ink-mute">
            按 Provider 分布
          </span>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--trae-border-neutral-l1)]">
              <th className="px-3 py-2 text-left text-caption font-normal text-ink-mute">
                Provider
              </th>
              <th className="px-3 py-2 text-right text-caption font-normal text-ink-mute">
                Tokens
              </th>
              <th className="px-3 py-2 text-right text-caption font-normal text-ink-mute">
                占比
              </th>
            </tr>
          </thead>
          <tbody>
            {providerRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-center text-sm text-ink-mute">
                  暂无调用
                </td>
              </tr>
            ) : (
              providerRows.map((row) => (
                <tr
                  key={row.provider}
                  className="border-b border-[var(--trae-border-neutral-l1)] last:border-0"
                >
                  <td className="px-3 py-2 font-medium text-ink">{row.provider}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                    {row.tokens}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-(--accent-text)">
                    {row.share}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default TokenUsageChart
