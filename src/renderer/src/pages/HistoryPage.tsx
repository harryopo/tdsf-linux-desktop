/**
 * HistoryPage — 历史决策页（1:1 复刻 history.html 设计稿）
 *
 * 路由：/history · 设计稿：history.html 第 1883-2253 行
 *
 * 结构：PageHeader（全站统一页头原语）+ 统计概览 4 列（含 sparkline）+ 筛选栏（3 下拉 + 1 搜索）
 *       + 决策时间线 6 卡片 + 分页栏（共 247 条 / 1·2·3·…·25）
 *       页头 full-bleed 直挂页面根，正文在 min-h-0 flex-1 overflow-y-auto 容器里滚动。
 *
 * 数据：只渲染 historyList IPC 取回的真实决策记录；取不到（非 Electron / 拉空）就是空态，不补示例。
 * 筛选与搜索是客户端真实过滤（useMemo 作用于已取回的记录）。
 *
 * data-dom-id：back-workbench / filter-status / search-history / goto-history-detail-{id}
 * 无障碍：button type="button" + aria-label/aria-pressed；button 原生支持 Enter/Space 键盘激活。
 * 动效：btn-press 按压反馈；prefers-reduced-motion 禁用按压动画与卡片过渡。
 */
import './HistoryPage.css'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Clock, Cpu, Filter, Inbox, Search, Sparkles, UserCircle } from 'lucide-react'
import { Button, PageHeader } from '@/ui'
import { Empty } from '@/components/trae/Empty'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { buildSparklinePoints, baselineSparkline, type SparklineMetric } from '@/utils/history-sparkline'
import { buildHistoryStats, deriveFromRecords } from '@/lib/history-stats'
import type { DecisionCard, HistoryStats } from '@shared/models'
import type { BlockedCommandRecord } from '@shared/audit-types'

type DecisionStatus = '成功' | '失败' | '已拦截' | '待处理'
type RiskLevel = '低风险' | '中风险' | '高风险'
type ActorType = 'root' | 'ai-agent'

interface StatItem { label: string; value: string; color: string; sparkline: string }
interface DecisionRecord {
  id: string; time: string; title: string; status: DecisionStatus; risk: RiskLevel
  server: string; actor: ActorType; confidence: number; command: string
  /** 执行耗时（秒）；null 表示真实数据未记录耗时（UI 显示 —，不伪造） */
  desc: string; durationSec: number | null; isDanger: boolean
  /** 记录时间戳（ms），用于时间范围筛选 */
  timestamp: number
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
      // v2.6 去假：pending/未知状态不再冒充“成功”
      return '待处理'
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
    // P1 修复：耗时只用真实 durationMs；未记录时为 null（UI 显示 —），
    // 不再用 timestamp % 60000 取模伪造假耗时
    durationSec: card.durationMs != null ? Math.max(1, Math.round(card.durationMs / 1000)) : null,
    isDanger,
    timestamp: card.timestamp,
  }
}

// ===== 筛选选项 =====
const TIME_RANGES: string[] = ['近7天', '近30天', '全部']
const STATUSES: string[] = ['全部状态', '成功', '失败', '已拦截', '待处理']

// ===== 辅助函数 =====

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

/** 拦截记录的时间：同一天只显示时分，跨天带月日 */
function formatBlockTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  return sameDay ? time : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
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
  // v2.3.4 起 IPC 拉空就显示空态；本轮删掉最后的非 Electron 假数据回退。
  // 原因：原实现在 IPC 拉取为空时仍保留 6 条设计稿示例，连接服务器后用户看到的是死代码。
  // 新策略：
  //   - Electron：records 来自 historyList IPC，拉空就是空态
  //   - 非 Electron（浏览器预览）：无本地库可读，noLocalStore 说明原因
  const [records, setRecords] = useState<DecisionRecord[]>([])
  /** 非 Electron 环境（无本地决策库）；用于把"没有数据"说成原因而不是留白 */
  const [noLocalStore, setNoLocalStore] = useState(false)
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null)
  /** 高危命令拦截记录：核心卖点「拦下了什么」必须能在界面上复盘 */
  const [blocked, setBlocked] = useState<BlockedCommandRecord[]>([])

  // 挂载时拉取真实决策历史与统计数据
  useEffect(() => {
    if (!isElectronAPIAvailable() || !window.electronAPI?.historyList) {
      // 非 Electron（浏览器预览）没有本地决策库可读：给空列表，让 Empty 状态说明清楚，
      // 不再回退到设计稿那 6 条示例——它们带 prod-web-01 这种假主机名，会被当成真记录
      setNoLocalStore(true)
      return
    }
    let cancelled = false

    window.electronAPI
      .historyList(0, 1000)
      .then((cards) => {
        if (cancelled) return
        // 拉到什么就显示什么：为空就是没有记录，不补任何示例
        if (Array.isArray(cards) && cards.length > 0) {
          setRecords(cards.map(decisionCardToRecord))
        } else {
          setRecords([])
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[HistoryPage] 拉取决策历史失败', err)
        // 拉取失败就显示空状态并说明失败，不显示任何编造记录
        setRecords([])
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

    // 拦截留痕：读不到就是没有（不补示例）；读到什么显示什么
    if (window.electronAPI?.historyBlocks) {
      window.electronAPI
        .historyBlocks(200)
        .then((rows) => {
          if (cancelled) return
          setBlocked(Array.isArray(rows) ? rows : [])
        })
        .catch((err) => {
          if (cancelled) return
          console.warn('[HistoryPage] 拉取拦截记录失败', err)
          setBlocked([])
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

  // 统计数字：优先主进程聚合的 stats，其次由当前记录派生。
  // 口径（含"分母为零就没有值"这条）在 lib/history-stats.ts，判据见 tests/unit/history-stats-empty.test.ts
  const stats = useMemo<StatItem[]>(() => {
    // records 为空时使用基线（不是空 SVG），保证视觉占位
    const sparkFor = (metric: SparklineMetric): string =>
      records.length === 0 ? baselineSparkline : buildSparklinePoints(records, metric)

    const src = historyStats
      ? {
          total: historyStats.total,
          successRate: historyStats.successRate,
          avgConfidence: historyStats.avgConfidence,
          avgDurationSec: Math.round(historyStats.avgDurationMs / 1000),
        }
      : deriveFromRecords(records)
    const metricOf: Record<string, SparklineMetric> = {
      总决策数: 'count',
      成功率: 'successRate',
      平均置信度: 'avgConfidence',
      平均响应时间: 'avgDuration',
    }
    return buildHistoryStats(src).map((c) => ({
      ...c,
      sparkline: sparkFor(metricOf[c.label] ?? 'count'),
    }))
  }, [records, historyStats])

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

  const optStyle = { background: 'var(--trae-bg-base-secondary)', color: 'var(--text-primary)' }

  return (
    <main className="hist-page">
      {/* 1. 页头：全站唯一 PageHeader（字号/位置/高度与其余模块一致） */}
      <PageHeader
        icon={Clock}
        title="历史决策"
        subtitle="AI运维决策的完整审计追溯"
        actions={
          <Button
            variant="outline"
            size="md"
            data-dom-id="back-workbench"
            aria-label="返回工作台"
            onClick={() => navigate('/workbench')}
          >
            <ArrowLeft className="size-4" />
            <span>返回工作台</span>
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
              <Clock className="shrink-0 w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              <select aria-label="时间范围筛选" value={timeRangeFilter} onChange={(e) => setTimeRangeFilter(e.target.value)} className="hist-select">
                {TIME_RANGES.map((t) => (<option key={t} style={optStyle}>{t}</option>))}
              </select>
            </label>
            <label className="hist-select-wrap">
              <Cpu className="shrink-0 w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              <select aria-label="服务器筛选" value={serverFilter} onChange={(e) => setServerFilter(e.target.value)} className="hist-select">
                {servers.map((s) => (<option key={s} style={optStyle}>{s}</option>))}
              </select>
            </label>
            <label className="hist-select-wrap">
              <Filter className="shrink-0 w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              <select data-dom-id="filter-status" aria-label="状态筛选" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="hist-select">
                {STATUSES.map((s) => (<option key={s} style={optStyle}>{s}</option>))}
              </select>
            </label>
          </div>
          <div className="hist-search-box">
            <Search className="shrink-0 w-3 h-3" style={{ color: 'var(--text-muted)' }} />
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
              title={
                noLocalStore
                  ? '浏览器预览环境读不到本机决策库'
                  : records.length === 0
                    ? '还没有决策记录'
                    : '未匹配到任何决策记录'
              }
              description={
                noLocalStore
                  ? '在桌面应用里运行即可读取本机的决策历史；这里不展示示例数据。'
                  : records.length === 0
                    ? '与 AI 对话并执行命令后，每一次决策会记录在这里。'
                    : '当前筛选条件下没有记录，请尝试调整时间范围、服务器或状态筛选。'
              }
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
                        <Cpu className="shrink-0 w-3 h-3" style={{ color: 'var(--text-muted)' }} />{record.server}
                      </span>
                      <span className="hist-decision-meta-item">
                        {record.actor === 'ai-agent' ? <Sparkles className="shrink-0 w-3 h-3" style={{ color: 'var(--text-muted)' }} /> : <UserCircle className="shrink-0 w-3 h-3" style={{ color: 'var(--text-muted)' }} />}
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
                        <Clock className="shrink-0 w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                        耗时 <span className="hist-decision-duration-val">{record.durationSec != null ? `${record.durationSec}s` : '—'}</span>
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

      {/* 4b. 高危命令拦截记录：产品最强的一次「救下」要能在这里复盘 */}
      {blocked.length > 0 && (
        <section className="hist-blocked-section" aria-labelledby="hist-blocked-heading">
          <div className="hist-blocked-head">
            <h2 id="hist-blocked-heading" className="hist-blocked-title">被拦截的高危命令</h2>
            <span className="hist-blocked-count">共 {blocked.length} 条</span>
          </div>
          <div className="hist-blocked-list">
            {blocked.slice(0, 20).map((item) => (
              <div key={item.id} className="hist-blocked-item">
                <div className="hist-blocked-meta">
                  <span className="hist-tag hist-tag--danger">已拦截</span>
                  <span className="hist-blocked-source">{item.source}</span>
                  <span className="hist-blocked-time">{formatBlockTime(item.timestamp)}</span>
                </div>
                <code className="hist-decision-command is-danger">{item.command}</code>
                <p className="hist-blocked-reason">
                  {item.reason || '命中高危规则'}
                  {item.matched ? `（命中：${item.matched}）` : ''}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

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
      </div>
    </main>
  )
}
