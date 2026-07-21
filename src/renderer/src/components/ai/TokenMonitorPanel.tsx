/**
 * TokenMonitorPanel - Token 监控面板（CCSwitch 风格）
 *
 * 职责：
 * - 总消耗大号显示（64px 等宽 + tabular-nums + 主色）
 * - 饼图：用纯 CSS conic-gradient 实现按 Provider 分布（圆环效果）
 * - 折线图：复用 recharts，显示最近 30 次调用的 token 消耗趋势
 *   （基于 onAgentDone 事件本地累积 history）
 * - 阈值告警：单次调用超过 50k token 显示警告 Tag
 * - 重置按钮：调用 tokenReset()
 * - 自动刷新：每 30 秒拉取一次 tokenStats()，或在 agentDone 事件后刷新
 * - Provider 分布列表：饼图旁显示 Provider ID + token 数 + 百分比
 * - Subagent 分布列表：折叠面板显示 8 类 Subagent 的 token 分布
 *
 * 暗系风格（深渊暗系）：
 * - 背景 var(--color-bg-primary) / var(--color-bg-card)
 * - 主色 var(--color-link)（项目蓝色，避免引入新色相）
 * - 柔和白文字 var(--color-text-primary)
 *
 * 方案书依据：v0.9 §5（Token 监控）
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Button, Tag, Tooltip, Collapse, message, Empty } from 'antd'
import {
  ReloadOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from 'recharts'
import type { TokenStats, AgentDonePayload } from '@shared/agent-types'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import './TokenMonitorPanel.css'

/** 单次调用历史记录（用于折线图） */
interface TokenHistoryEntry {
  /** 时间戳（ms） */
  timestamp: number
  /** 序号（用于 X 轴显示） */
  seq: number
  /** 总 token 数 */
  totalTokens: number
  /** Provider ID */
  providerId: string
}

/** 阈值告警阈值（单次调用 50k token） */
const TOKEN_ALERT_THRESHOLD = 50_000

/** 自动刷新间隔（30 秒） */
const AUTO_REFRESH_INTERVAL = 30_000

/** 历史记录最大长度 */
const MAX_HISTORY_LENGTH = 30

/** Provider 饼图颜色调色板（暗系友好，避免硬编码到 CSS 之外） */
const PROVIDER_COLORS = [
  '#3b82f6', // 蓝（主色）
  '#8b5cf6', // 紫
  '#ec4899', // 粉
  '#f59e0b', // 橙
  '#10b981', // 绿
  '#06b6d4', // 青
  '#ef4444', // 红
  '#a3a3a3', // 灰（兜底）
]

/** 格式化 token 数显示（>1000 用 k 单位） */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** 格式化时间戳为 HH:MM:SS */
function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/** TokenMonitorPanel Props */
export interface TokenMonitorPanelProps {
  /** 是否折叠（受控模式，可选） */
  defaultCollapsed?: boolean
}

/** TokenMonitorPanel 组件 */
const TokenMonitorPanel: React.FC<TokenMonitorPanelProps> = ({ defaultCollapsed = true }) => {
  /** Token 统计 */
  const [stats, setStats] = useState<TokenStats | null>(null)
  /** 加载中 */
  const [loading, setLoading] = useState(false)
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null)
  /** 单次调用历史记录（最近 30 次） */
  const [history, setHistory] = useState<TokenHistoryEntry[]>([])
  /** 序号计数器 */
  const seqRef = useRef(0)

  /** 拉取 token 统计 */
  const fetchStats = useCallback(async () => {
    if (!isElectronAPIAvailable()) {
      setError('electronAPI 不可用')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const s = await window.electronAPI.tokenStats()
      setStats(s)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`加载 Token 统计失败: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 首次挂载拉取 */
  useEffect(() => {
    void fetchStats()
  }, [fetchStats])

  /** 自动刷新：每 30 秒拉取一次 */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchStats()
    }, AUTO_REFRESH_INTERVAL)
    return () => {
      window.clearInterval(timer)
    }
  }, [fetchStats])

  /** 监听 agentDone 事件：刷新统计 + 追加历史 */
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    const off = window.electronAPI.onAgentDone((payload: AgentDonePayload) => {
      // 刷新统计
      void fetchStats()
      // 追加历史
      const seq = ++seqRef.current
      const entry: TokenHistoryEntry = {
        timestamp: Date.now(),
        seq,
        totalTokens: payload.result.usage?.totalTokens ?? 0,
        providerId: payload.result.providerId,
      }
      setHistory((prev) => {
        const next = [...prev, entry]
        // 保留最近 30 条
        return next.slice(-MAX_HISTORY_LENGTH)
      })
    })
    return off
  }, [fetchStats])

  /** 重置 token 统计 */
  const handleReset = useCallback(async () => {
    if (!isElectronAPIAvailable()) return
    try {
      const ok = await window.electronAPI.tokenReset()
      if (ok) {
        message.success('Token 统计已重置')
        setHistory([])
        seqRef.current = 0
        await fetchStats()
      } else {
        message.error('重置失败')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(`重置失败: ${msg}`)
    }
  }, [fetchStats])

  /** 手动刷新 */
  const handleRefresh = useCallback(() => {
    void fetchStats()
  }, [fetchStats])

  /** 饼图数据（按 Provider 分布） */
  const providerPieData = useMemo(() => {
    if (!stats || stats.total === 0) return []
    return Object.entries(stats.byProvider)
      .filter(([, count]) => count > 0)
      .map(([id, count], idx) => ({
        id,
        count,
        percent: count / stats.total,
        color: PROVIDER_COLORS[idx % PROVIDER_COLORS.length],
      }))
  }, [stats])

  /** conic-gradient 颜色串（饼图填充） */
  const pieGradient = useMemo(() => {
    if (providerPieData.length === 0) return 'none'
    let acc = 0
    const stops: string[] = []
    for (const item of providerPieData) {
      const start = acc
      acc += item.percent * 100
      stops.push(`${item.color} ${start}% ${acc}%`)
    }
    return `conic-gradient(${stops.join(', ')})`
  }, [providerPieData])

  /** Subagent 分布数据 */
  const subagentData = useMemo(() => {
    if (!stats) return []
    return Object.entries(stats.bySubagent)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        name,
        count,
        percent: stats.total > 0 ? count / stats.total : 0,
      }))
  }, [stats])

  /** 阈值告警条目（单次 > 50k） */
  const alertEntries = useMemo(() => {
    return history.filter((e) => e.totalTokens > TOKEN_ALERT_THRESHOLD)
  }, [history])

  /** 折线图数据 */
  const chartData = useMemo(() => {
    return history.map((e) => ({
      seq: e.seq,
      tokens: e.totalTokens,
      time: formatTime(e.timestamp),
      provider: e.providerId,
    }))
  }, [history])

  /** Collapse 活动项（默认折叠：空数组） */
  const [activeKeys, setActiveKeys] = useState<string[]>(defaultCollapsed ? [] : ['token-panel'])

  return (
    <div className="token-monitor-panel">
      <Collapse
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(keys as string[])}
        className="token-monitor-collapse"
        items={[
          {
            key: 'token-panel',
            label: (
              <div className="token-monitor-header">
                <DashboardOutlined className="token-monitor-header-icon" />
                <span className="token-monitor-header-title">Token 监控</span>
                {stats && (
                  <span className="token-monitor-header-summary">
                    今日 <strong>{formatTokens(stats.today)}</strong>
                  </span>
                )}
                {alertEntries.length > 0 && (
                  <Tag color="warning" className="token-monitor-alert-tag">
                    <WarningOutlined /> {alertEntries.length} 次超阈值
                  </Tag>
                )}
              </div>
            ),
            children: (
              <div className="token-monitor-body">
                {error && <div className="token-monitor-error">{error}</div>}

                {/* ===== 顶部：大号总数 + 重置按钮 ===== */}
                <div className="token-monitor-top">
                  <div className="token-monitor-total">
                    <span className="token-monitor-total-label">今日总消耗</span>
                    <div className="token-monitor-total-value">
                      {formatTokens(stats?.today ?? 0)}
                      <span className="token-monitor-total-unit">tokens</span>
                    </div>
                    <div className="token-monitor-total-meta">
                      <span>本周 {formatTokens(stats?.week ?? 0)}</span>
                      <span>本月 {formatTokens(stats?.month ?? 0)}</span>
                      <span>累计 {formatTokens(stats?.total ?? 0)}</span>
                    </div>
                  </div>
                  <div className="token-monitor-actions">
                    <Tooltip title="刷新">
                      <Button
                        type="text"
                        size="small"
                        icon={<ReloadOutlined spin={loading} />}
                        onClick={handleRefresh}
                        aria-label="刷新 Token 统计"
                      />
                    </Tooltip>
                    <Tooltip title="重置统计">
                      <Button
                        type="text"
                        size="small"
                        danger
                        onClick={handleReset}
                        aria-label="重置 Token 统计"
                      >
                        重置
                      </Button>
                    </Tooltip>
                  </div>
                </div>

                {/* ===== 中部：饼图 + Provider 分布列表 ===== */}
                <div className="token-monitor-middle">
                  <div className="token-monitor-pie-wrapper">
                    {providerPieData.length === 0 ? (
                      <div className="token-monitor-pie-empty">
                        <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      </div>
                    ) : (
                      <div
                        className="token-monitor-pie"
                        style={{ background: pieGradient }}
                        role="img"
                        aria-label="按 Provider 分布的 Token 饼图"
                      >
                        <div className="token-monitor-pie-center">
                          <span className="token-monitor-pie-center-label">今日</span>
                          <span className="token-monitor-pie-center-value">
                            {formatTokens(stats?.today ?? 0)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="token-monitor-provider-list">
                    <div className="token-monitor-list-title">
                      <ThunderboltOutlined /> Provider 分布
                    </div>
                    {providerPieData.length === 0 ? (
                      <div className="token-monitor-list-empty">暂无 Provider 数据</div>
                    ) : (
                      providerPieData.map((item) => (
                        <div key={item.id} className="token-monitor-provider-item">
                          <span
                            className="token-monitor-provider-dot"
                            style={{ background: item.color }}
                          />
                          <span className="token-monitor-provider-id" title={item.id}>
                            {item.id}
                          </span>
                          <span className="token-monitor-provider-count">
                            {formatTokens(item.count)}
                          </span>
                          <span className="token-monitor-provider-percent">
                            {(item.percent * 100).toFixed(1)}%
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* ===== 折线图：最近 30 次调用趋势 ===== */}
                <div className="token-monitor-chart">
                  <div className="token-monitor-chart-title">
                    <span>最近 {history.length} 次调用趋势</span>
                    {history.length === 0 && (
                      <span className="token-monitor-chart-hint">（等待 agent:done 事件）</span>
                    )}
                  </div>
                  {chartData.length === 0 ? (
                    <div className="token-monitor-chart-empty">
                      <Empty
                        description="暂无调用记录"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={140}>
                      <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis
                          dataKey="seq"
                          stroke="var(--color-text-tertiary)"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="var(--color-text-tertiary)"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => formatTokens(v)}
                          width={48}
                        />
                        <RTooltip
                          contentStyle={{
                            background: 'var(--color-bg-elevated)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '12px',
                            color: 'var(--color-text-primary)',
                          }}
                          labelFormatter={(_label: unknown, payload: Array<{ payload?: { time?: string; provider?: string } }>) => {
                            const p = payload?.[0]?.payload
                            return p ? `${p.time ?? ''} · ${p.provider ?? ''}` : ''
                          }}
                          formatter={(value: number) => [formatTokens(value), 'Tokens']}
                        />
                        <Line
                          type="monotone"
                          dataKey="tokens"
                          stroke="var(--color-link)"
                          strokeWidth={2}
                          dot={{ fill: 'var(--color-link)', r: 3 }}
                          activeDot={{ r: 5 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* ===== 阈值告警列表 ===== */}
                {alertEntries.length > 0 && (
                  <div className="token-monitor-alerts">
                    <div className="token-monitor-alerts-title">
                      <WarningOutlined /> 单次超 50k Token 调用（{alertEntries.length} 次）
                    </div>
                    <div className="token-monitor-alerts-list">
                      {alertEntries.map((e) => (
                        <div key={e.seq} className="token-monitor-alert-item">
                          <span className="token-monitor-alert-seq">#{e.seq}</span>
                          <span className="token-monitor-alert-time">{formatTime(e.timestamp)}</span>
                          <span className="token-monitor-alert-provider" title={e.providerId}>
                            {e.providerId}
                          </span>
                          <Tag color="warning" className="token-monitor-alert-count">
                            {formatTokens(e.totalTokens)}
                          </Tag>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ===== Subagent 分布（折叠） ===== */}
                <div className="token-monitor-subagent">
                  <div className="token-monitor-list-title">
                    <ThunderboltOutlined /> Subagent 分布
                  </div>
                  {subagentData.length === 0 ? (
                    <div className="token-monitor-list-empty">暂无 Subagent 数据</div>
                  ) : (
                    subagentData.map((item) => (
                      <div key={item.name} className="token-monitor-subagent-item">
                        <span className="token-monitor-subagent-name">{item.name}</span>
                        <div className="token-monitor-subagent-bar">
                          <div
                            className="token-monitor-subagent-bar-fill"
                            style={{ width: `${item.percent * 100}%` }}
                          />
                        </div>
                        <span className="token-monitor-subagent-count">
                          {formatTokens(item.count)}
                        </span>
                        <span className="token-monitor-subagent-percent">
                          {(item.percent * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}

export default TokenMonitorPanel
