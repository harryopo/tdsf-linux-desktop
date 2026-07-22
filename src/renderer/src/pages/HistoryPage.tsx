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
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Clock, Cpu, Filter, Inbox, Search, Sparkles, UserCircle } from 'lucide-react'
import { Empty } from '@/components/trae/Empty'

type DecisionStatus = '成功' | '失败' | '已拦截'
type RiskLevel = '低风险' | '中风险' | '高风险'
type ActorType = 'root' | 'ai-agent'

interface StatItem { label: string; value: string; color: string; sparkline: string }
interface DecisionRecord {
  id: number; time: string; title: string; status: DecisionStatus; risk: RiskLevel
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

// ===== 静态示例数据（1:1 来自设计稿 history.html） =====

const STATS: StatItem[] = [
  { label: '总决策数', value: '247', color: 'var(--trae-bg-brand)', sparkline: '0,18 14,14 28,16 42,10 56,12 70,7 84,9 100,5' },
  { label: '成功率', value: '94.3%', color: 'var(--trae-status-success-default)', sparkline: '0,16 14,18 28,12 42,14 56,9 70,11 84,6 100,8' },
  { label: '平均置信度', value: '0.82', color: 'var(--trae-bg-brand)', sparkline: '0,14 14,12 28,15 42,9 56,11 70,8 84,10 100,6' },
  { label: '平均响应时间', value: '12s', color: 'var(--trae-text-secondary)', sparkline: '0,8 14,12 28,10 42,14 56,11 70,16 84,13 100,15' },
]
const TIME_RANGES: string[] = ['近7天', '近30天', '全部']
const SERVERS: string[] = ['全部服务器', 'prod-web-01', 'prod-db-02', 'backup-01', 'staging-web']
const STATUSES: string[] = ['全部状态', '成功', '失败', '已拦截']
const PAGINATION: (number | null)[] = [1, 2, 3, null, 25]
const TOTAL_RECORDS = 247

const RECORDS: DecisionRecord[] = [
  { id: 1, time: '14:23', title: '重启 nginx 服务', status: '成功', risk: '低风险', server: 'prod-web-01', actor: 'root', confidence: 0.87, command: 'sudo systemctl restart nginx', desc: 'nginx P99延迟升高，重启后恢复', durationSec: 8, isDanger: false, timestamp: daysAgoTs(0, 14, 23) },
  { id: 2, time: '13:45', title: '清理 MySQL 长查询', status: '成功', risk: '中风险', server: 'prod-db-02', actor: 'root', confidence: 0.91, command: "mysql -e 'KILL 9800'", desc: 'MySQL连接数过多，清理长查询', durationSec: 3, isDanger: false, timestamp: daysAgoTs(0, 13, 45) },
  { id: 3, time: '12:30', title: '高危命令拦截', status: '已拦截', risk: '高风险', server: 'backup-01', actor: 'ai-agent', confidence: 0.45, command: 'rm -rf /var/log/*', desc: '高危命令被四层风险控制拦截', durationSec: 1, isDanger: true, timestamp: daysAgoTs(2, 12, 30) },
  { id: 4, time: '11:15', title: '平滑重载 nginx 配置', status: '成功', risk: '低风险', server: 'prod-web-01', actor: 'root', confidence: 0.93, command: 'nginx -s reload', desc: '配置变更后平滑重载', durationSec: 2, isDanger: false, timestamp: daysAgoTs(3, 11, 15) },
  { id: 5, time: '10:08', title: '重启 Docker 服务', status: '失败', risk: '中风险', server: 'staging-web', actor: 'root', confidence: 0.62, command: 'systemctl restart docker', desc: 'Docker重启失败，容器异常退出', durationSec: 15, isDanger: false, timestamp: daysAgoTs(8, 10, 8) },
  { id: 6, time: '09:30', title: '调整 swap 倾向参数', status: '成功', risk: '低风险', server: 'prod-db-02', actor: 'root', confidence: 0.88, command: 'sysctl -w vm.swappiness=10', desc: '调整swap倾向参数优化内存', durationSec: 1, isDanger: false, timestamp: daysAgoTs(15, 9, 30) },
]

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

// ===== 主组件 =====

export function HistoryPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string>('全部状态')
  const [serverFilter, setServerFilter] = useState<string>('全部服务器')
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>(TIME_RANGES[0])
  const [keyword, setKeyword] = useState<string>('')
  const [currentPage, setCurrentPage] = useState<number>(1)

  const filteredRecords = useMemo(() => {
    let result: DecisionRecord[] = RECORDS
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
  }, [statusFilter, serverFilter, timeRangeFilter, keyword])

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
        {STATS.map((stat) => (
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
                {SERVERS.map((s) => (<option key={s} style={optStyle}>{s}</option>))}
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
          {filteredRecords.map((record, idx) => {
            const isLast = idx === filteredRecords.length - 1
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
          共 <span className="hist-total-records-val">{TOTAL_RECORDS}</span> 条记录
        </span>
        <div className="hist-pagination">
          <button type="button" aria-label="上一页" disabled className="hist-pagination-item is-disabled">
            <ArrowLeft className="w-3 h-3" />
          </button>
          {PAGINATION.map((page, idx) => {
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
          <button type="button" aria-label="下一页" onClick={() => setCurrentPage((p) => Math.min(p + 1, 25))} className="hist-pagination-item">
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </footer>
    </main>
  )
}
