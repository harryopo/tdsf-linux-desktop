/**
 * HistoryPage — 历史决策页（1:1 复刻 history.html 设计稿）
 *
 * 路由：/history · 设计稿：history.html 第 1883-2253 行
 *
 * 结构：Page header + 统计概览 4 列（含 sparkline）+ 筛选栏（3 下拉 + 1 搜索）
 *       + 决策时间线 6 卡片 + 分页栏（共 247 条 / 1·2·3·…·25）
 *
 * 数据：静态示例数据 1:1 来自设计稿，无 IPC / 无 mock 随机数据。
 * 筛选搜索为客户端真实过滤（useMemo 作用于 6 条静态记录）。
 *
 * data-dom-id：back-workbench / filter-status / search-history / goto-history-detail-{id}
 * 无障碍：button type="button" + aria-label/aria-pressed；button 原生支持 Enter/Space 键盘激活。
 * 动效：btn-press 按压反馈；prefers-reduced-motion 禁用按压动画与卡片过渡。
 */
import './HistoryPage.css'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Clock, Cpu, Filter, Inbox, Search, Sparkles, UserCircle } from 'lucide-react'
import { Empty } from '@/components/trae/Empty'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { DecisionCard, HistoryStats } from '@shared/models'

type DecisionStatus = '成功' | '失败' | '已拦截'
type RiskLevel = '低风险' | '中风险' | '高风险'
type ActorType = 'root' | 'ai-agent'

interface StatItem { label: string; value: string; color: string; sparkline: string }
interface DecisionRecord {
  id: string; time: string; title: string; status: DecisionStatus; risk: RiskLevel
  server: string; actor: ActorType; confidence: number; command: string
  desc: string; durationSec: number; isDanger: boolean
  /** 记录时间戳（ms），用于时间范围筛选 */
  timestamp: number
}

/** 以当前时间为基准，生成 N 天前某时刻的时间戳（ms） */
function daysAgoTs(days: number, hour: number, minute: number): number {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

/** 将 DecisionCard 状态映射为 UI 状态 */
function mapCardStatus(status: DecisionCard['status']): DecisionStatus {
  switch (status) {
    case 'verified':
    case 'executed':
    case 'approved':
      return '成功'
    case 'failed':
      return '失败'
    case 'rejected':
      return '已拦截'
    case 'pending':
    default:
      return '成功'
  }
}

/** 将 RiskAssessment.level 映射为 UI 风险等级 */
function mapRiskLevel(level: DecisionCard['risk']['level']): RiskLevel {
  switch (level) {
    case 'SAFE':
    case 'LOW':
      return '低风险'
    case 'MEDIUM':
      return '中风险'
    case 'HIGH':
    case 'CRITICAL':
    default:
      return '高风险'
  }
}

/** 将 DecisionCard 转换为页面展示记录 */
function decisionCardToRecord(card: DecisionCard): DecisionRecord {
  const date = new Date(card.timestamp)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const isDanger = card.risk?.level === 'HIGH' || card.risk?.level === 'CRITICAL' || card.risk?.blocked === true
  return {
    id: card.id,
    time: `${hh}:${mm}`,
    title: card.problem.slice(0, 40) || `决策 #${card.id}`,
    status: mapCardStatus(card.status),
    risk: mapRiskLevel(card.risk?.level),
    server: card.sessionId ? `会话 ${card.sessionId.slice(0, 8)}` : 'local',
    actor: 'ai-agent',
    confidence: card.confidence,
    command: card.fixCommand || '无执行命令',
    desc: card.fixDescription || card.hypothesis || '',
    durationSec: Math.max(1, Math.round((card.timestamp % 60000) / 1000)),
    isDanger,
    timestamp: card.timestamp,
  }
}

// ===== 静态示例数据（1:1 来自设计稿 history.html，仅非 Electron / 空库 fallback 使用） =====

const DEFAULT_STATS: StatItem[] = [
  { label: '总决策数', value: '247', color: 'var(--trae-bg-brand)', sparkline: '0,18 14,14 28,16 42,10 56,12 70,7 84,9 100,5' },
  { label: '成功率', value: '94.3%', color: 'var(--trae-status-success-default)', sparkline: '0,16 14,18 28,12 42,14 56,9 70,11 84,6 100,8' },
  { label: '平均置信度', value: '0.82', color: 'var(--trae-bg-brand)', sparkline: '0,14 14,12 28,15 42,9 56,11 70,8 84,10 100,6' },
  { label: '平均响应时间', value: '12s', color: 'var(--trae-text-secondary)', sparkline: '0,8 14,12 28,10 42,14 56,11 70,16 84,13 100,15' },
]
const TIME_RANGES: string[] = ['近7天', '近30天', '全部']
const STATUSES: string[] = ['全部状态', '成功', '失败', '已拦截']

const DEFAULT_RECORDS: DecisionRecord[] = [
  { id: '1', time: '14:23', title: '重启 nginx 服务', status: '成功', risk: '低风险', server: 'prod-web-01', actor: 'root', confidence: 0.87, command: 'sudo systemctl restart nginx', desc: 'nginx P99延迟升高，重启后恢复', durationSec: 8, isDanger: false, timestamp: daysAgoTs(0, 14, 23) },
  { id: '2', time: '13:45', title: '清理 MySQL 长查询', status: '成功', risk: '中风险', server: 'prod-db-02', actor: 'root', confidence: 0.91, command: "mysql -e 'KILL 9800'", desc: 'MySQL连接数过多，清理长查询', durationSec: 3, isDanger: false, timestamp: daysAgoTs(0, 13, 45) },
  { id: '3', time: '12:30', title: '高危命令拦截', status: '已拦截', risk: '高风险', server: 'backup-01', actor: 'ai-agent', confidence: 0.45, command: 'rm -rf /var/log/*', desc: '高危命令被四层风险控制拦截', durationSec: 1, isDanger: true, timestamp: daysAgoTs(2, 12, 30) },
  { id: '4', time: '11:15', title: '平滑重载 nginx 配置', status: '成功', risk: '低风险', server: 'prod-web-01', actor: 'root', confidence: 0.93, command: 'nginx -s reload', desc: '配置变更后平滑重载', durationSec: 2, isDanger: false, timestamp: daysAgoTs(3, 11, 15) },
  { id: '5', time: '10:08', title: '重启 Docker 服务', status: '失败', risk: '中风险', server: 'staging-web', actor: 'root', confidence: 0.62, command: 'systemctl restart docker', desc: 'Docker重启失败，容器异常退出', durationSec: 15, isDanger: false, timestamp: daysAgoTs(8, 10, 8) },
  { id: '6', time: '09:30', title: '调整 swap 倾向参数', status: '成功', risk: '低风险', server: 'prod-db-02', actor: 'root', confidence: 0.88, command: 'sysctl -w vm.swappiness=10', desc: '调整swap倾向参数优化内存', durationSec: 1, isDanger: false, timestamp: daysAgoTs(15, 9, 30) },
]

// ===== 辅助函数 =====

/**
 * 基于决策记录数组按时间序列派生 sparkline 数据点。
 *
 * x 坐标范围 0-100，y 坐标范围 0-24（SVG viewBox="0 0 100 24"）。
 * 默认分桶数 8（与原硬编码数据点数量一致）。
 *
 * 边界：
 * - records 为空时返回空字符串 ''
 * - 仅有 1 条记录时返回水平线 '0,12 100,12'
 * - 所有桶值都为 0 时返回基线 '0,24 100,24'
 *
 * metric 计算：
 * - count：每个时间桶内的记录数（归一化到 0-24，max 为所有桶最大值）
 * - successRate：每个桶内 status==='成功' 的比例（0-1 映射到 0-24）
 * - avgConfidence：每个桶内 confidence 平均值（0-1 映射到 0-24）
 * - avgDuration：每个桶内 durationSec 平均值（归一化到 0-24）
 */
function buildSparklinePoints(
  records: DecisionRecord[],
  metric: 'count' | 'successRate' | 'avgConfidence' | 'avgDuration',
  options?: { buckets?: number },
): string {
  if (records.length === 0) return ''
  if (records.length === 1) return '0,12 100,12'

  const buckets = options?.buckets ?? 8

  // 按时间排序，计算时间范围
  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp)
  const minTime = sorted[0].timestamp
  const maxTime = sorted[sorted.length - 1].timestamp
  const timeRange = maxTime - minTime

  // 所有记录时间相同 → 水平线
  if (timeRange === 0) return '0,12 100,12'

  const bucketSize = timeRange / buckets

  // 累加每个桶的值与计数
  const sums = new Array<number>(buckets).fill(0)
  const counts = new Array<number>(buckets).fill(0)

  for (const r of sorted) {
    const idx = Math.min(buckets - 1, Math.floor((r.timestamp - minTime) / bucketSize))
    let v = 0
    if (metric === 'count') {
      v = 1
    } else if (metric === 'successRate') {
      v = r.status === '成功' ? 1 : 0
    } else if (metric === 'avgConfidence') {
      v = r.confidence
    } else {
      // avgDuration
      v = r.durationSec
    }
    sums[idx] += v
    counts[idx] += 1
  }

  // 计算每个桶的最终值
  const values: number[] = new Array(buckets)
  let maxVal = 0
  for (let i = 0; i < buckets; i++) {
    let v: number
    if (metric === 'count') {
      v = sums[i]
    } else if (counts[i] === 0) {
      v = 0
    } else {
      // successRate: 0-1；avgConfidence: 0-1；avgDuration: 秒
      v = sums[i] / counts[i]
    }
    values[i] = v
    if (v > maxVal) maxVal = v
  }

  // 所有桶值为 0 → 基线
  if (maxVal === 0) return '0,24 100,24'

  // 归一化到 0-24 范围，生成 points 字符串
  const points: string[] = []
  for (let i = 0; i < buckets; i++) {
    const x = (i / (buckets - 1)) * 100
    const y = 24 - (values[i] / maxVal) * 24
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return points.join(' ')
}

function dotColor(status: DecisionStatus): string {
  if (status === '成功') return 'var(--trae-status-success-default)'
  if (status === '失败') return 'var(--trae-status-error-default)'
  return 'var(--trae-status-warning-default)'
}

function statusBadgeClass(status: DecisionStatus): string {
  if (status === '成功') return 'hist-tag hist-tag--success'
  if (status === '失败') return 'hist-tag hist-tag--danger'
  return 'hist-tag hist-tag--warning'
}

function riskBadgeClass(risk: RiskLevel): string {
  if (risk === '低风险') return 'hist-tag hist-tag--brand'
  if (risk === '中风险') return 'hist-tag hist-tag--warning'
  return 'hist-tag hist-tag--danger'
}

// ===== 主组件 =====

export function HistoryPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string>('全部状态')
  const [serverFilter, setServerFilter] = useState<string>('全部服务器')
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>(TIME_RANGES[0])
  const [keyword, setKeyword] = useState<string>('')
  const [currentPage, setCurrentPage] = useState<number>(1)

  // ===== 真实决策历史状态（v2.3 活功能转换：接入 historyList / historyStats IPC） =====
  const [records, setRecords] = useState<DecisionRecord[]>(DEFAULT_RECORDS)
  const [useReal, setUseReal] = useState(false)
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null)

  // 挂载时拉取真实决策历史与统计数据
  useEffect(() => {
    if (!isElectronAPIAvailable() || !window.electronAPI?.historyList) return
    let cancelled = false

    window.electronAPI
      .historyList(0, 1000)
      .then((cards) => {
        if (cancelled) return
        if (Array.isArray(cards) && cards.length > 0) {
          setRecords(cards.map(decisionCardToRecord))
          setUseReal(true)
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[HistoryPage] 拉取决策历史失败', err)
      })
      .finally(() => {
        // no-op：保留 finally 钩子便于后续接入加载态
      })

    // 拉取历史统计数据（成功率 / 平均置信度 / 平均耗时 / 服务器列表）
    if (window.electronAPI?.historyStats) {
      window.electronAPI
        .historyStats()
        .then((stats) => {
          if (cancelled) return
          if (stats && stats.total > 0) {
            setHistoryStats(stats)
          }
        })
        .catch((err) => {
          if (cancelled) return
          console.warn('[HistoryPage] 拉取历史统计失败', err)
        })
    }

    return () => { cancelled = true }
  }, [])

  // 服务器列表优先使用 stats.servers；IPC 不可用或 total=0 时回退到 records 派生
  const servers = useMemo(() => {
    if (historyStats && historyStats.servers.length > 0) {
      return ['全部服务器', ...historyStats.servers]
    }
    const set = new Set(records.map((r) => r.server))
    return ['全部服务器', ...Array.from(set)]
  }, [records, historyStats])

  // 统计数字：优先使用真实 stats；不可用时回退到 records 派生 / DEFAULT_STATS
  const stats = useMemo<StatItem[]>(() => {
    // records 为空时使用基线（不是空 SVG），保证视觉占位
    const baselineSparkline = '0,24 100,24'
    const sparkFor = (metric: 'count' | 'successRate' | 'avgConfidence' | 'avgDuration'): string =>
      records.length === 0 ? baselineSparkline : buildSparklinePoints(records, metric)

    if (historyStats) {
      return [
        { label: '总决策数', value: String(historyStats.total), color: 'var(--trae-bg-brand)', sparkline: sparkFor('count') },
        { label: '成功率', value: `${(historyStats.successRate * 100).toFixed(1)}%`, color: 'var(--trae-status-success-default)', sparkline: sparkFor('successRate') },
        { label: '平均置信度', value: historyStats.avgConfidence.toFixed(2), color: 'var(--trae-bg-brand)', sparkline: sparkFor('avgConfidence') },
        { label: '平均响应时间', value: `${Math.round(historyStats.avgDurationMs / 1000)}s`, color: 'var(--trae-text-secondary)', sparkline: sparkFor('avgDuration') },
      ]
    }
    if (!useReal) return DEFAULT_STATS
    const total = records.length
    const success = records.filter((r) => r.status === '成功').length
    const successRate = total > 0 ? `${((success / total) * 100).toFixed(1)}%` : '0%'
    const avgConfidence = total > 0
      ? (records.reduce((sum, r) => sum + r.confidence, 0) / total).toFixed(2)
      : '0.00'
    const avgDuration = total > 0
      ? `${Math.round(records.reduce((sum, r) => sum + r.durationSec, 0) / total)}s`
      : '0s'
    return [
      { label: '总决策数', value: String(total), color: 'var(--trae-bg-brand)', sparkline: sparkFor('count') },
      { label: '成功率', value: successRate, color: 'var(--trae-status-success-default)', sparkline: sparkFor('successRate') },
      { label: '平均置信度', value: avgConfidence, color: 'var(--trae-bg-brand)', sparkline: sparkFor('avgConfidence') },
      { label: '平均响应时间', value: avgDuration, color: 'var(--trae-text-secondary)', sparkline: sparkFor('avgDuration') },
    ]
  }, [records, useReal, historyStats])

  const filteredRecords = useMemo(() => {
    let result: DecisionRecord[] = records
    if (statusFilter !== '全部状态') result = result.filter((r) => r.status === statusFilter)
    if (serverFilter !== '全部服务器') result = result.filter((r) => r.server === serverFilter)
    if (timeRangeFilter !== '全部') {
      const now = Date.now()
      const cutoffMs = timeRangeFilter === '近7天' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
      const cutoff = now - cutoffMs
      result = result.filter((r) => r.timestamp >= cutoff)
    }
    const kw = keyword.trim().toLowerCase()
    if (kw) {
      result = result.filter((r) =>
        r.title.toLowerCase().includes(kw) ||
        r.command.toLowerCase().includes(kw) ||
        r.server.toLowerCase().includes(kw),
      )
    }
    return result
  }, [records, statusFilter, serverFilter, timeRangeFilter, keyword])

  // 简单分页：固定每页 6 条，根据过滤后记录数动态生成页码
  const pageSize = 6
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize))
  const pagedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredRecords.slice(start, start + pageSize)
  }, [filteredRecords, currentPage])

  // 页码数组：小于等于 7 页连续显示；超过 7 页显示首页 + 省略 + 当前页附近 + 省略 + 末页
  const paginationPages = useMemo<(number | null)[]>(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    if (currentPage <= 3) return [1, 2, 3, 4, 5, null, totalPages]
    if (currentPage >= totalPages - 2) return [1, null, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [1, null, currentPage - 1, currentPage, currentPage + 1, null, totalPages]
  }, [currentPage, totalPages])

  const optStyle = { background: 'var(--trae-bg-base-secondary)', color: 'var(--trae-text-default)' }

  return (
    <main className="hist-page">
      {/* 1. Page header */}
      <header className="hist-header">
        <div className="hist-header-main">
          <Clock className="shrink-0 w-[22px] h-[22px]" style={{ color: 'var(--trae-bg-brand)' }} />
          <div className="hist-header-text">
            <span className="hist-header-title">历史决策</span>
            <span className="hist-header-subtitle">AI运维决策的完整审计追溯</span>
          </div>
        </div>
        <button
          type="button" data-dom-id="back-workbench" aria-label="返回工作台"
          onClick={() => navigate('/workbench')}
          className="hist-back-btn hist-btn-press"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> 返回工作台
        </button>
      </header>

      {/* 2. 统计概览 4 列 */}
      <section className="hist-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="hist-stat-card">
            <span className="hist-stat-label">{stat.label}</span>
            <span className="hist-stat-value" style={{ color: stat.color }}>{stat.value}</span>
            <svg className="hist-stat-spark" width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none">
              <polyline points={stat.sparkline} fill="none" stroke={stat.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ))}
      </section>

      {/* 3. 筛选栏 */}
      <section className="hist-filter-section">
        <div className="hist-filter-bar">
          <div className="hist-filter-left">
            <label className="hist-select-wrap">
              <Clock className="shrink-0 w-3 h-3" style={{ color: 'var(--trae-text-tertiary)' }} />
              <select aria-label="时间范围筛选" value={timeRangeFilter} onChange={(e) => setTimeRangeFilter(e.target.value)} className="hist-select">
                {TIME_RANGES.map((t) => (<option key={t} style={optStyle}>{t}</option>))}
              </select>
            </label>
            <label className="hist-select-wrap">
              <Cpu className="shrink-0 w-3 h-3" style={{ color: 'var(--trae-text-tertiary)' }} />
              <select aria-label="服务器筛选" value={serverFilter} onChange={(e) => setServerFilter(e.target.value)} className="hist-select">
                {servers.map((s) => (<option key={s} style={optStyle}>{s}</option>))}
              </select>
            </label>
            <label className="hist-select-wrap">
              <Filter className="shrink-0 w-3 h-3" style={{ color: 'var(--trae-text-tertiary)' }} />
              <select data-dom-id="filter-status" aria-label="状态筛选" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="hist-select">
                {STATUSES.map((s) => (<option key={s} style={optStyle}>{s}</option>))}
              </select>
            </label>
          </div>
          <div className="hist-search-box">
            <Search className="shrink-0 w-3 h-3" style={{ color: 'var(--trae-text-tertiary)' }} />
            <input type="text" data-dom-id="search-history" aria-label="搜索历史决策" placeholder="搜索决策..." value={keyword} onChange={(e) => setKeyword(e.target.value)} className="hist-search-input" />
          </div>
        </div>
      </section>

      {/* 4. 决策记录时间线 */}
      <section className="hist-timeline-section">
        <div className="hist-timeline">
          {filteredRecords.length === 0 && (
            <Empty
              icon={Inbox}
              title="未匹配到任何决策记录"
              description="当前筛选条件下没有历史决策数据，请尝试调整时间范围、服务器或状态筛选。"
              className="hist-timeline-empty"
            />
          )}
          {pagedRecords.map((record, idx) => {
            const isLast = idx === pagedRecords.length - 1
            return (
              <div key={record.id} className="hist-timeline-row">
                <div className="hist-timeline-rail">
                  <span className="hist-timeline-time">{record.time}</span>
                  <span className="hist-timeline-dot" style={{ background: dotColor(record.status) }} />
                  {!isLast && <div className="hist-timeline-connector" />}
                </div>
                <div className={isLast ? 'hist-timeline-card-wrap is-last' : 'hist-timeline-card-wrap'}>
                  <div className="hist-decision-card">
                    <div className="hist-decision-head">
                      <span className="hist-decision-title">{record.title}</span>
                      <span className={statusBadgeClass(record.status)}>{record.status}</span>
                      <span className={riskBadgeClass(record.risk)}>{record.risk}</span>
                    </div>
                    <div className="hist-decision-meta">
                      <span className="hist-decision-meta-item">
                        <Cpu className="shrink-0 w-3 h-3" style={{ color: 'var(--trae-text-tertiary)' }} />{record.server}
                      </span>
                      <span className="hist-decision-meta-item">
                        {record.actor === 'ai-agent' ? <Sparkles className="shrink-0 w-3 h-3" style={{ color: 'var(--trae-text-tertiary)' }} /> : <UserCircle className="shrink-0 w-3 h-3" style={{ color: 'var(--trae-text-tertiary)' }} />}
                        {record.actor}
                      </span>
                      <span className="hist-decision-confidence">
                        置信度 <span className="hist-decision-confidence-val">{record.confidence.toFixed(2)}</span>
                      </span>
                      <code className={record.isDanger ? 'hist-decision-command is-danger' : 'hist-decision-command'}>
                        {record.command}
                      </code>
                    </div>
                    <p className="hist-decision-desc">{record.desc}</p>
                    <div className="hist-decision-footer">
                      <span className="hist-decision-duration">
                        <Clock className="shrink-0 w-3 h-3" style={{ color: 'var(--trae-text-tertiary)' }} />
                        耗时 <span className="hist-decision-duration-val">{record.durationSec}s</span>
                      </span>
                      <button
                        type="button" data-dom-id={`goto-history-detail-${record.id}`}
                        aria-label={`查看决策 ${record.title} 的详情`}
                        onClick={() => navigate(`/history/${record.id}`)}
                        className="hist-decision-detail-link hist-btn-press"
                      >
                        查看详情 <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 5. 底部分页栏 */}
      <footer className="hist-footer">
        <span className="hist-total-records">
          共 <span className="hist-total-records-val">{filteredRecords.length}</span> 条记录
        </span>
        <div className="hist-pagination">
          <button
            type="button"
            aria-label="上一页"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            className={currentPage <= 1 ? 'hist-pagination-item is-disabled' : 'hist-pagination-item'}
          >
            <ArrowLeft className="w-3 h-3" />
          </button>
          {paginationPages.map((page, idx) => {
            if (page === null) {
              return (
                <button key={`ellipsis-${idx}`} type="button" disabled className="hist-pagination-item is-disabled">…</button>
              )
            }
            const isActive = page === currentPage
            return (
              <button
                key={page} type="button" aria-label={`第 ${page} 页`} aria-pressed={isActive}
                onClick={() => setCurrentPage(page)}
                className={isActive ? 'hist-pagination-item is-active' : 'hist-pagination-item'}
              >
                {page}
              </button>
            )
          })}
          <button
            type="button"
            aria-label="下一页"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
            className={currentPage >= totalPages ? 'hist-pagination-item is-disabled' : 'hist-pagination-item'}
          >
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </footer>
    </main>
  )
}
