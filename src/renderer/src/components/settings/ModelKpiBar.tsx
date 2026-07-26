/**
 * ModelKpiBar — 模型配置页 KPI 统计行
 *
 * 设计稿：settings-model.html 区块 "KPI 统计行"
 * - 4 个 KPI 卡片横向排列（本月Token总量 / 本月成本 / 对话次数 / 成功率）
 * - 每张卡片：label + trend（绿色上升） + 大数字（品牌蓝/绿色） + mini sparkline
 * - hover 上移 + 阴影加深
 *
 * 数据来源（v1.5 改造：接入真实 IPC，不再写死）：
 * - 本月Token总量 ← tokenStats().month
 * - 本月成本      ← tokenCostStats().monthCost（USD）
 * - 对话次数      ← tokenRecords(1000).length
 * - 成功率        ← historyStats().successRate（[0,1] 小数）
 *
 * v2.3.3 修复：
 * - 删掉 DEFAULT_KPIS 静态假数据（45.6K/$0.68/127次/89.3%）
 * - 真实数据加载完成前显示骨架占位（"—"），不显示假数字误导用户
 * - 失败时仍 fallback 到 0/0/0/0%（不显示设计示意）
 */
import { useEffect, useState } from 'react'
import type { TokenStats, CostStats } from '@shared/agent-types'
import type { HistoryStats } from '@shared/models'
import { isElectronAPIAvailable } from '@/utils/electron-api'

interface KpiCardData {
  label: string
  /** 主数值 */
  value: string
  /** 主数值颜色（CSS 变量名，如 --trae-bg-brand） */
  valueColor?: string
  /** 趋势文案（如 "+12%"） */
  trend: string
  /** 单位后缀（如 "K" / "次" / "%"） */
  unit?: string
  /** mini sparkline 折线点（0-24 范围） */
  points: string
  /** sparkline 颜色 */
  strokeColor: string
}

/** 真实数据加载前的骨架占位（4 个 KPI 全部 —，无 sparkline） */
const LOADING_KPIS: KpiCardData[] = [
  { label: '本月Token总量', value: '—', trend: '', points: '', strokeColor: 'var(--trae-bg-brand)' },
  { label: '本月成本', value: '—', trend: '', points: '', strokeColor: 'var(--trae-status-success-default)' },
  { label: '对话次数', value: '—', trend: '', points: '', strokeColor: 'var(--trae-bg-brand)' },
  { label: '成功率', value: '—', trend: '', points: '', strokeColor: 'var(--trae-status-success-default)' },
]

/** 空数据骨架（IPC 返回全 0，无趋势） */
function buildEmptyKpis(): KpiCardData[] {
  return [
    { label: '本月Token总量', value: '0.0', unit: 'K', trend: '—', points: '', strokeColor: 'var(--trae-bg-brand)' },
    { label: '本月成本', value: '$0.00', trend: '—', points: '', strokeColor: 'var(--trae-status-success-default)' },
    { label: '对话次数', value: '0', unit: '次', trend: '—', points: '', strokeColor: 'var(--trae-bg-brand)' },
    { label: '成功率', value: '0.0', unit: '%', trend: '—', points: '', strokeColor: 'var(--trae-status-success-default)' },
  ]
}

/** 将 token 数格式化为 "K" 单位字符串（保留 1 位小数） */
function formatTokenK(tokens: number): string {
  return (tokens / 1000).toFixed(1)
}

/** 基于真实 IPC 数据构建 KPI 列表（删除 v2.3.3 前的 DEFAULT_KPIS fallback） */
function buildKpis(
  tokenStats: TokenStats,
  costStats: CostStats,
  conversationCount: number,
  successRate: number | null,
): KpiCardData[] {
  return [
    {
      label: '本月Token总量',
      value: formatTokenK(tokenStats.month),
      unit: 'K',
      trend: tokenStats.month > 0 ? `${tokenStats.month} tokens` : '—',
      valueColor: 'var(--trae-bg-brand)',
      points: '',
      strokeColor: 'var(--trae-bg-brand)',
    },
    {
      label: '本月成本',
      value: `$${costStats.monthCost.toFixed(2)}`,
      trend: costStats.monthCost > 0 ? `$${costStats.monthCost.toFixed(2)}` : '—',
      valueColor: 'var(--trae-status-success-default)',
      points: '',
      strokeColor: 'var(--trae-status-success-default)',
    },
    {
      label: '对话次数',
      value: String(conversationCount),
      unit: '次',
      trend: conversationCount > 0 ? `${conversationCount} 条` : '—',
      valueColor: 'var(--trae-bg-brand)',
      points: '',
      strokeColor: 'var(--trae-bg-brand)',
    },
    {
      label: '成功率',
      value: successRate !== null ? (successRate * 100).toFixed(1) : '0.0',
      unit: '%',
      trend: successRate !== null ? `${(successRate * 100).toFixed(1)}%` : '—',
      valueColor: 'var(--trae-status-success-default)',
      points: '',
      strokeColor: 'var(--trae-status-success-default)',
    },
  ]
}

export function ModelKpiBar() {
  // 初始骨架占位：4 个 "—"，避免 SSR/首屏出现假数字
  // 加载完成后由 setKpis 覆盖 LOADING_KPIS
  const [kpis, setKpis] = useState<KpiCardData[]>(LOADING_KPIS)

  useEffect(() => {
    if (!isElectronAPIAvailable()) {
      setKpis(buildEmptyKpis())
      return
    }
    let cancelled = false

    const load = async () => {
      try {
        const [tokenStats, costStats, records] = await Promise.all([
          window.electronAPI.tokenStats(),
          window.electronAPI.tokenCostStats(),
          window.electronAPI.tokenRecords(1000),
        ])

        // 尝试获取历史统计数据用于"成功率"卡片
        let historyStats: HistoryStats | null = null
        if (window.electronAPI?.historyStats) {
          try {
            const stats = await window.electronAPI.historyStats()
            if (stats && stats.total > 0) {
              historyStats = stats
            }
          } catch (err) {
            console.warn('[ModelKpiBar] 拉取历史统计失败:', err)
          }
        }

        if (cancelled) return
        const successRate = historyStats !== null ? historyStats.successRate : null
        setKpis(buildKpis(tokenStats, costStats, records.length, successRate))
      } catch (err) {
        console.error('[ModelKpiBar] 加载 KPI 统计失败:', err)
        // 失败时显示全 0 骨架（不再回退到设计示意值）
        if (!cancelled) {
          setKpis(buildEmptyKpis())
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section
      aria-label="本月概览"
      className="set-model-kpi-grid"
    >
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="set-model-kpi-card"
        >
          <div className="set-model-kpi-card__head">
            <span className="set-model-kpi-card__label">
              {kpi.label}
            </span>
            <span className="set-model-kpi-card__trend">
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
                className="inline-block"
              >
                <path
                  d="M2 7 L5 4 L8 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {kpi.trend}
            </span>
          </div>
          <div className="set-model-kpi-card__value-row">
            <span
              className="set-model-kpi-card__value"
              style={{ color: kpi.valueColor }}
            >
              {kpi.value}
            </span>
            {kpi.unit != null && kpi.unit !== '' && (
              <span className="set-model-kpi-card__unit">
                {kpi.unit}
              </span>
            )}
          </div>
          {kpi.points && (
            <svg
              width="100%"
              height="24"
              viewBox="0 0 120 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline
                points={kpi.points}
                fill="none"
                stroke={kpi.strokeColor}
                strokeWidth="1.5"
                opacity="0.8"
              />
              <polyline
                points={`${kpi.points} 120,24 0,24`}
                fill={kpi.strokeColor}
                opacity="0.08"
              />
            </svg>
          )}
        </div>
      ))}
    </section>
  )
}
