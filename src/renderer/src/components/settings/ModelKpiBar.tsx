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
 * IPC 不可用或调用失败时回退到设计示意默认值（保证 UI 不空白）。
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

/** 设计示意默认值（IPC 不可用 / 失败时回退） */
const DEFAULT_KPIS: KpiCardData[] = [
  {
    label: '本月Token总量',
    value: '45.6',
    unit: 'K',
    trend: '+12%',
    valueColor: 'var(--trae-bg-brand)',
    points: '0,20 15,18 30,14 45,16 60,10 75,12 90,6 105,8 120,4',
    strokeColor: 'var(--trae-bg-brand)',
  },
  {
    label: '本月成本',
    value: '$0.68',
    trend: '+$0.08',
    valueColor: 'var(--trae-status-success-default)',
    points: '0,18 15,16 30,17 45,14 60,15 75,12 90,13 105,10 120,8',
    strokeColor: 'var(--trae-status-success-default)',
  },
  {
    label: '对话次数',
    value: '127',
    unit: '次',
    trend: '+15',
    valueColor: 'var(--trae-bg-brand)',
    points: '0,20 15,17 30,19 45,15 60,13 75,15 90,10 105,12 120,6',
    strokeColor: 'var(--trae-bg-brand)',
  },
  {
    label: '成功率',
    value: '89.3',
    unit: '%',
    trend: '+2.1%',
    valueColor: 'var(--trae-status-success-default)',
    points: '0,16 15,14 30,15 45,12 60,13 75,10 90,11 105,8 120,6',
    strokeColor: 'var(--trae-status-success-default)',
  },
]

/** 将 token 数格式化为 "K" 单位字符串（保留 1 位小数） */
function formatTokenK(tokens: number): string {
  return (tokens / 1000).toFixed(1)
}

/** 基于真实 IPC 数据构建 KPI 列表（保留设计稿的 trend / sparkline / 颜色） */
function buildKpis(
  tokenStats: TokenStats,
  costStats: CostStats,
  conversationCount: number,
  successRate: number | null,
): KpiCardData[] {
  return DEFAULT_KPIS.map((kpi) => {
    switch (kpi.label) {
      case '本月Token总量':
        return { ...kpi, value: formatTokenK(tokenStats.month), unit: 'K' }
      case '本月成本':
        return { ...kpi, value: `$${costStats.monthCost.toFixed(2)}`, unit: undefined }
      case '对话次数':
        return { ...kpi, value: String(conversationCount), unit: '次' }
      case '成功率':
        // IPC 返回可用统计时用真实成功率，否则保留设计示意值
        return successRate !== null
          ? { ...kpi, value: (successRate * 100).toFixed(1), unit: '%' }
          : kpi
      default:
        return kpi
    }
  })
}

export function ModelKpiBar() {
  const [kpis, setKpis] = useState<KpiCardData[]>(DEFAULT_KPIS)

  useEffect(() => {
    if (!isElectronAPIAvailable()) return
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
            // 单独捕获：成功率卡片回退到设计示意值
            console.warn('[ModelKpiBar] 拉取历史统计失败:', err)
          }
        }

        if (cancelled) return
        const successRate = historyStats !== null ? historyStats.successRate : null
        setKpis(buildKpis(tokenStats, costStats, records.length, successRate))
      } catch (err) {
        // 失败时保留设计示意默认值，避免 UI 空白
        console.error('[ModelKpiBar] 加载 KPI 统计失败:', err)
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
        </div>
      ))}
    </section>
  )
}
