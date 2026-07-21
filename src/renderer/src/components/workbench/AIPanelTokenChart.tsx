/**
 * AIPanelTokenChart — AI 面板 Token 消耗曲线浮层
 *
 * 设计稿：workbench-ai.html 第 2536-2596 行（Token 曲线按钮点击后弹出）
 *
 * 结构：
 * - 浮层定位（绝对定位，从 Token 按钮下方弹出）
 * - 顶部标题 + 关闭
 * - 时间范围 tab：日 / 周 / 月
 * - SVG 折线图（240×80，含网格 + 渐变填充 + 数据点）
 * - 统计：今日 / 本周 / 本月 三列
 * - 输入 / 输出 / 比例 一行
 *
 * 交互：
 * - 点击外部关闭（useEffect + document 监听）
 * - tab 切换更新统计数据
 * - Esc 键关闭
 */
import { useState, useEffect, useRef, useMemo, type FC } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/components/trae/utils'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { TokenStats, TokenUsageRecord } from '@shared/agent-types'

/** 时间范围 tab */
type TokenRange = 'day' | 'week' | 'month'

/** 时间范围标签 */
const RANGE_LABELS: Record<TokenRange, string> = {
  day: '日',
  week: '周',
  month: '月',
}

/** 将 token 数值数组映射为 SVG polyline points 字符串（240×55 区域，y 轴翻转） */
function buildChartPoints(values: number[]): string {
  if (values.length === 0) return '0,55 240,55'
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? 240 / (values.length - 1) : 240
  return values
    .map((v, i) => {
      const x = (i * step).toFixed(0)
      const y = (55 - (v / max) * 45).toFixed(0) // 55→10 范围
      return `${x},${y}`
    })
    .join(' ')
}

/** 从 TokenUsageRecord[] 汇总 inputTokens / outputTokens */
function sumTokens(records: TokenUsageRecord[]): { input: number; output: number } {
  return records.reduce(
    (acc, r) => ({ input: acc.input + r.inputTokens, output: acc.output + r.outputTokens }),
    { input: 0, output: 0 },
  )
}

/** AIPanelTokenChart props */
export interface AIPanelTokenChartProps {
  /** 关闭回调 */
  onClose: () => void
}

/** AIPanelTokenChart Token 消耗曲线浮层 */
export const AIPanelTokenChart: FC<AIPanelTokenChartProps> = ({ onClose }) => {
  const [range, setRange] = useState<TokenRange>('day')
  const containerRef = useRef<HTMLDivElement>(null)
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null)
  const [records, setRecords] = useState<TokenUsageRecord[]>([])
  const [loading, setLoading] = useState(true)

  /** 加载真实 Token 统计数据 */
  useEffect(() => {
    let cancelled = false
    if (!isElectronAPIAvailable()) {
      setLoading(false)
      return
    }
    Promise.all([
      window.electronAPI.tokenStats(),
      window.electronAPI.tokenRecords(100),
    ])
      .then(([stats, recs]) => {
        if (cancelled) return
        setTokenStats(stats)
        setRecords(recs)
      })
      .catch(() => {
        /* 静默降级：无数据时显示空态 */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** 点击外部关闭 */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  /** Esc 键关闭 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  /** 从 records 计算图表数据点和 input/output 汇总 */
  const { points, input, output, ratio } = useMemo(() => {
    const totals = records.map((r) => r.totalTokens)
    const { input: inp, output: out } = sumTokens(records)
    const r = out > 0 ? `${(inp / out).toFixed(1)}:1` : '—'
    return { points: buildChartPoints(totals), input: inp, output: out, ratio: r }
  }, [records])

  /** X 轴标签（根据 range 显示） */
  const xLabels: [string, string, string] =
    range === 'day' ? ['早', '午', '晚'] : range === 'week' ? ['周一', '周三', '周日'] : ['1', '15', '30']

  /** 是否有真实数据可展示 */
  const hasData = tokenStats !== null && (tokenStats.today > 0 || tokenStats.week > 0 || tokenStats.month > 0 || records.length > 0)

  return (
    <div
      ref={containerRef}
      className="absolute right-2 top-11 z-50 w-[280px] rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-secondary)] p-3 shadow-xl"
      role="dialog"
      aria-label="Token 消耗统计"
    >
      {/* 标题栏 */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-[var(--trae-text-default)]">Token消耗</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="flex size-5 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-tertiary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* 时间范围 tab */}
      <div className="mb-2 flex gap-0.5">
        {(Object.keys(RANGE_LABELS) as TokenRange[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={cn(
              'inline-flex h-7 items-center rounded-[var(--trae-radius-2)] px-2 text-[11px] transition-colors',
              range === r
                ? 'bg-[var(--trae-bg-brand)] font-medium text-[var(--trae-text-onbrand)]'
                : 'bg-transparent text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)]',
            )}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      {/* 内容区：加载 / 空态 / 正常 */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <span className="text-[11px] text-[var(--trae-text-tertiary)]">加载中…</span>
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
          <span className="text-[11px] text-[var(--trae-text-tertiary)]">暂无用量数据</span>
          <span className="text-[10px] text-[var(--trae-text-tertiary)] opacity-70">
            发送消息后将自动统计 Token 消耗
          </span>
        </div>
      ) : (
        <>
          {/* SVG 折线图 */}
          <div className="mb-2">
            <svg
              width="240"
              height="80"
              viewBox="0 0 240 80"
              className="w-full"
              aria-label="Token 趋势图"
            >
              <defs>
                <linearGradient id="tokenChartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--trae-bg-brand)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--trae-bg-brand)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* 网格 */}
              <line x1="0" y1="20" x2="240" y2="20" stroke="var(--trae-border-neutral-l1)" strokeWidth="1" />
              <line x1="0" y1="40" x2="240" y2="40" stroke="var(--trae-border-neutral-l1)" strokeWidth="1" />
              <line x1="0" y1="60" x2="240" y2="60" stroke="var(--trae-border-neutral-l1)" strokeWidth="1" />
              {/* 渐变填充 */}
              <polygon
                points={`0,55 ${points} 240,80 0,80`}
                fill="url(#tokenChartGradient)"
              />
              {/* 折线 */}
              <polyline
                points={points}
                fill="none"
                stroke="var(--trae-bg-brand)"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* 终点数据点 */}
              {points.split(' ').slice(-1).map((pt, i) => {
                const [x, y] = pt.split(',')
                return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--trae-bg-brand)" />
              })}
              {/* X 轴标签 */}
              {xLabels.map((label, i) => (
                <text
                  key={label}
                  x={i === 0 ? 0 : i === 1 ? 100 : 210}
                  y="76"
                  fontSize="8"
                  fill="var(--trae-text-tertiary)"
                  fontFamily="var(--trae-font-family-mono)"
                >
                  {label}
                </text>
              ))}
            </svg>
          </div>

          {/* 今日/本周/本月 统计 */}
          <div className="mb-2 grid grid-cols-3 gap-1 border-b border-[var(--trae-border-neutral-l1)] pb-2">
            <div className="text-center">
              <div className="text-[11px] text-[var(--trae-text-tertiary)]">今日</div>
              <div className="font-mono text-[11px] tabular-nums text-[var(--trae-text-default)]">
                {(tokenStats?.today ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="border-l border-r border-[var(--trae-border-neutral-l1)] text-center">
              <div className="text-[11px] text-[var(--trae-text-tertiary)]">本周</div>
              <div className="font-mono text-[11px] tabular-nums text-[var(--trae-text-default)]">
                {(tokenStats?.week ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-[var(--trae-text-tertiary)]">本月</div>
              <div className="font-mono text-[11px] tabular-nums text-[var(--trae-text-default)]">
                {(tokenStats?.month ?? 0).toLocaleString()}
              </div>
            </div>
          </div>

          {/* 输入 / 输出 / 比例 */}
          <div className="flex items-center justify-between border-t border-[var(--trae-border-neutral-l1)] pt-1.5 text-[10px] tabular-nums">
            <span className="text-[var(--trae-text-brand)]">输入 {input.toLocaleString()}</span>
            <span className="text-[var(--trae-text-tertiary)]">/</span>
            <span className="text-[var(--trae-accent-cyan)]">输出 {output.toLocaleString()}</span>
            <span className="text-[var(--trae-text-tertiary)]">·</span>
            <span className="text-[var(--trae-text-secondary)]">比例 {ratio}</span>
          </div>
        </>
      )}
    </div>
  )
}

export default AIPanelTokenChart
