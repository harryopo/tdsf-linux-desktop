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
import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Clock, Cpu, Filter, Search, Sparkles, UserCircle } from 'lucide-react'

type DecisionStatus = '成功' | '失败' | '已拦截'
type RiskLevel = '低风险' | '中风险' | '高风险'
type ActorType = 'root' | 'ai-agent'

interface StatItem { label: string; value: string; color: string; sparkline: string }
interface DecisionRecord {
  id: number; time: string; title: string; status: DecisionStatus; risk: RiskLevel
  server: string; actor: ActorType; confidence: number; command: string
  desc: string; durationSec: number; isDanger: boolean
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
  { id: 1, time: '14:23', title: '重启 nginx 服务', status: '成功', risk: '低风险', server: 'prod-web-01', actor: 'root', confidence: 0.87, command: 'sudo systemctl restart nginx', desc: 'nginx P99延迟升高，重启后恢复', durationSec: 8, isDanger: false },
  { id: 2, time: '13:45', title: '清理 MySQL 长查询', status: '成功', risk: '中风险', server: 'prod-db-02', actor: 'root', confidence: 0.91, command: "mysql -e 'KILL 9800'", desc: 'MySQL连接数过多，清理长查询', durationSec: 3, isDanger: false },
  { id: 3, time: '12:30', title: '高危命令拦截', status: '已拦截', risk: '高风险', server: 'backup-01', actor: 'ai-agent', confidence: 0.45, command: 'rm -rf /var/log/*', desc: '高危命令被四层风险控制拦截', durationSec: 1, isDanger: true },
  { id: 4, time: '11:15', title: '平滑重载 nginx 配置', status: '成功', risk: '低风险', server: 'prod-web-01', actor: 'root', confidence: 0.93, command: 'nginx -s reload', desc: '配置变更后平滑重载', durationSec: 2, isDanger: false },
  { id: 5, time: '10:08', title: '重启 Docker 服务', status: '失败', risk: '中风险', server: 'staging-web', actor: 'root', confidence: 0.62, command: 'systemctl restart docker', desc: 'Docker重启失败，容器异常退出', durationSec: 15, isDanger: false },
  { id: 6, time: '09:30', title: '调整 swap 倾向参数', status: '成功', risk: '低风险', server: 'prod-db-02', actor: 'root', confidence: 0.88, command: 'sysctl -w vm.swappiness=10', desc: '调整swap倾向参数优化内存', durationSec: 1, isDanger: false },
]

// ===== 辅助函数 =====

function dotColor(status: DecisionStatus): string {
  if (status === '成功') return 'var(--trae-status-success-default)'
  if (status === '失败') return 'var(--trae-status-error-default)'
  return 'var(--trae-status-warning-default)'
}

function statusBadgeStyle(status: DecisionStatus): CSSProperties {
  if (status === '成功') return { color: 'var(--trae-status-success-default)', background: 'var(--trae-status-success-surface-l1)' }
  if (status === '失败') return { color: 'var(--trae-status-error-default)', background: 'var(--trae-status-error-surface-l1)' }
  return { color: 'var(--trae-status-warning-default)', background: 'var(--trae-status-warning-surface-l1)' }
}

function riskBadgeStyle(risk: RiskLevel): CSSProperties {
  if (risk === '低风险') return { color: 'var(--trae-bg-brand)', background: 'var(--trae-bg-brand-disabled)' }
  if (risk === '中风险') return { color: 'var(--trae-status-warning-default)', background: 'var(--trae-status-warning-surface-l1)' }
  return { color: 'var(--trae-status-error-default)', background: 'var(--trae-status-error-surface-l1)' }
}

// ===== 主组件 =====

export function HistoryPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string>('全部状态')
  const [serverFilter, setServerFilter] = useState<string>('全部服务器')
  const [keyword, setKeyword] = useState<string>('')
  const [currentPage, setCurrentPage] = useState<number>(1)

  const filteredRecords = useMemo(() => {
    let result: DecisionRecord[] = RECORDS
    if (statusFilter !== '全部状态') result = result.filter((r) => r.status === statusFilter)
    if (serverFilter !== '全部服务器') result = result.filter((r) => r.server === serverFilter)
    const kw = keyword.trim().toLowerCase()
    if (kw) {
      result = result.filter((r) =>
        r.title.toLowerCase().includes(kw) ||
        r.command.toLowerCase().includes(kw) ||
        r.server.toLowerCase().includes(kw),
      )
    }
    return result
  }, [statusFilter, serverFilter, keyword])

  const selectStyle: CSSProperties = {
    height: '28px', padding: '0 8px 0 12px', background: 'var(--trae-bg-base-tertiary)',
    border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-4)',
    gap: '6px', cursor: 'pointer',
  }
  const selectCls = 'appearance-none bg-transparent border-none text-[11px] text-[var(--trae-text-default)] cursor-pointer outline-none pr-4'
  const optStyle: CSSProperties = { background: 'var(--trae-bg-base-secondary)', color: 'var(--trae-text-default)' }

  return (
    <main className="min-h-full flex flex-col bg-[var(--trae-bg-base-default)]">
      {/* 1. Page header */}
      <header className="flex items-center justify-between" style={{ padding: '16px 24px', gap: '16px' }}>
        <div className="flex flex-row items-center gap-3 min-w-0">
          <Clock className="shrink-0 w-[22px] h-[22px]" style={{ color: 'var(--trae-bg-brand)' }} />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-semibold text-[var(--trae-text-default)]" style={{ fontSize: '28px', lineHeight: '36px' }}>历史决策</span>
            <span className="text-[11px] text-[var(--trae-text-secondary)]">AI运维决策的完整审计追溯</span>
          </div>
        </div>
        <button
          type="button" data-dom-id="back-workbench" aria-label="返回工作台"
          onClick={() => navigate('/workbench')}
          className="btn-press inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium text-[var(--trae-text-default)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] transition-colors duration-150"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> 返回工作台
        </button>
      </header>

      {/* 2. 统计概览 4 列 */}
      <section className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: '16px', padding: '24px 24px 0' }}>
        {STATS.map((stat) => (
          <div key={stat.label} className="flex flex-col" style={{ gap: '8px', padding: '16px', background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', minWidth: 0 }}>
            <span className="font-medium text-[var(--trae-text-tertiary)]" style={{ fontSize: '10px', lineHeight: '14px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{stat.label}</span>
            <span className="font-semibold" style={{ fontSize: '24px', lineHeight: '1.1', color: stat.color, fontFamily: 'var(--trae-font-family-mono)' }}>{stat.value}</span>
            <svg width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none" style={{ marginTop: 'auto', display: 'block' }}>
              <polyline points={stat.sparkline} fill="none" stroke={stat.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ))}
      </section>

      {/* 3. 筛选栏 */}
      <section style={{ padding: '24px' }}>
        <div className="flex flex-wrap items-center" style={{ gap: '12px', padding: '12px', background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)' }}>
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <label className="relative inline-flex items-center" style={selectStyle}>
              <Clock className="shrink-0 w-3 h-3 text-[var(--trae-text-tertiary)]" />
              <select aria-label="时间范围筛选" value={TIME_RANGES[0]} className={selectCls}>
                {TIME_RANGES.map((t) => (<option key={t} style={optStyle}>{t}</option>))}
              </select>
            </label>
            <label className="relative inline-flex items-center" style={selectStyle}>
              <Cpu className="shrink-0 w-3 h-3 text-[var(--trae-text-tertiary)]" />
              <select aria-label="服务器筛选" value={serverFilter} onChange={(e) => setServerFilter(e.target.value)} className={selectCls}>
                {SERVERS.map((s) => (<option key={s} style={optStyle}>{s}</option>))}
              </select>
            </label>
            <label className="relative inline-flex items-center" style={selectStyle}>
              <Filter className="shrink-0 w-3 h-3 text-[var(--trae-text-tertiary)]" />
              <select data-dom-id="filter-status" aria-label="状态筛选" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
                {STATUSES.map((s) => (<option key={s} style={optStyle}>{s}</option>))}
              </select>
            </label>
          </div>
          <div className="inline-flex items-center shrink-0" style={{ height: '28px', minWidth: '220px', padding: '0 12px', background: 'var(--trae-bg-base-tertiary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-4)', gap: '6px', flex: '0 1 280px' }}>
            <Search className="shrink-0 w-3 h-3 text-[var(--trae-text-tertiary)]" />
            <input type="text" data-dom-id="search-history" aria-label="搜索历史决策" placeholder="搜索决策..." value={keyword} onChange={(e) => setKeyword(e.target.value)} className="flex-1 min-w-0 bg-transparent border-none outline-none text-[11px] text-[var(--trae-text-default)]" />
          </div>
        </div>
      </section>

      {/* 4. 决策记录时间线 */}
      <section className="flex-1" style={{ padding: '0 24px 24px' }}>
        <div className="flex flex-col">
          {filteredRecords.length === 0 && (
            <div className="flex items-center justify-center h-32 text-[11px] text-[var(--trae-text-tertiary)]">未匹配到任何决策记录</div>
          )}
          {filteredRecords.map((record, idx) => {
            const isLast = idx === filteredRecords.length - 1
            return (
              <div key={record.id} className="flex" style={{ gap: '16px' }}>
                <div className="flex flex-col items-center" style={{ width: '56px', flexShrink: 0, paddingTop: '2px' }}>
                  <span className="text-[var(--trae-text-tertiary)]" style={{ fontSize: '10px', lineHeight: '1', fontFamily: 'var(--trae-font-family-mono)', whiteSpace: 'nowrap' }}>{record.time}</span>
                  <span style={{ marginTop: '6px', width: '10px', height: '10px', borderRadius: '50%', background: dotColor(record.status), border: '2px solid var(--trae-bg-base-default)', boxSizing: 'border-box', flexShrink: 0, zIndex: 1 }} />
                  {!isLast && <div style={{ flex: '1', width: '2px', background: 'var(--trae-border-neutral-l1)', marginTop: '4px', minHeight: '24px' }} />}
                </div>
                <div className="flex-1 min-w-0" style={{ marginBottom: isLast ? '0' : '16px' }}>
                  <div className="history-card" style={{ padding: '16px', background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', transition: 'background .15s ease, border-color .15s ease' }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--trae-text-default)]" style={{ fontSize: '16px', lineHeight: '1.3' }}>{record.title}</span>
                      <span className="inline-flex items-center font-medium" style={{ padding: '2px 8px', borderRadius: 'var(--trae-radius-4)', fontSize: '10px', lineHeight: '14px', ...statusBadgeStyle(record.status) }}>{record.status}</span>
                      <span className="inline-flex items-center font-medium" style={{ padding: '2px 8px', borderRadius: 'var(--trae-radius-4)', fontSize: '10px', lineHeight: '14px', ...riskBadgeStyle(record.risk) }}>{record.risk}</span>
                    </div>
                    <div className="flex flex-wrap items-center" style={{ gap: '8px 16px', marginTop: '8px' }}>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--trae-text-secondary)]">
                        <Cpu className="shrink-0 w-3 h-3 text-[var(--trae-text-tertiary)]" />{record.server}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--trae-text-secondary)]">
                        {record.actor === 'ai-agent' ? <Sparkles className="shrink-0 w-3 h-3 text-[var(--trae-text-tertiary)]" /> : <UserCircle className="shrink-0 w-3 h-3 text-[var(--trae-text-tertiary)]" />}
                        {record.actor}
                      </span>
                      <span className="text-[11px] text-[var(--trae-text-secondary)]">
                        置信度 <span className="font-medium" style={{ color: 'var(--trae-bg-brand)', fontFamily: 'var(--trae-font-family-mono)' }}>{record.confidence.toFixed(2)}</span>
                      </span>
                      <code className="font-mono" style={{ fontSize: '10px', lineHeight: '14px', color: record.isDanger ? 'var(--trae-status-error-default)' : 'var(--trae-code-text)', background: record.isDanger ? 'var(--trae-status-error-surface-l1)' : 'var(--trae-bg-base-default)', padding: '2px 6px', borderRadius: 'var(--trae-radius-2)', border: '1px solid var(--trae-border-neutral-l1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', display: 'inline-block' }}>
                        {record.command}
                      </code>
                    </div>
                    <p className="text-[var(--trae-text-tertiary)]" style={{ marginTop: '8px', fontSize: '10px', lineHeight: '14px' }}>{record.desc}</p>
                    <div className="flex items-center justify-between" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--trae-border-neutral-l1)', gap: '12px' }}>
                      <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--trae-text-tertiary)]">
                        <Clock className="shrink-0 w-3 h-3 text-[var(--trae-text-tertiary)]" />
                        耗时 <span className="text-[var(--trae-text-secondary)]" style={{ fontFamily: 'var(--trae-font-family-mono)' }}>{record.durationSec}s</span>
                      </span>
                      <button
                        type="button" data-dom-id={`goto-history-detail-${record.id}`}
                        aria-label={`查看决策 ${record.title} 的详情`}
                        onClick={() => navigate(`/history/${record.id}`)}
                        className="btn-press inline-flex items-center shrink-0 gap-1 text-[10px] text-[var(--trae-bg-brand)] bg-transparent border-none cursor-pointer hover:underline"
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
      <footer className="flex flex-wrap items-center justify-between" style={{ gap: '12px', padding: '16px 24px', borderTop: '1px solid var(--trae-border-neutral-l1)', background: 'var(--trae-bg-base-secondary)' }}>
        <span className="text-[10px] text-[var(--trae-text-tertiary)]">
          共 <span className="text-[var(--trae-text-secondary)]" style={{ fontFamily: 'var(--trae-font-family-mono)' }}>{TOTAL_RECORDS}</span> 条记录
        </span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="上一页" disabled className="btn-press inline-flex items-center justify-center cursor-not-allowed" style={{ width: '28px', height: '28px', background: 'transparent', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-4)', color: 'var(--trae-text-tertiary)', opacity: 0.5 }}>
            <ArrowLeft className="w-3 h-3" />
          </button>
          {PAGINATION.map((page, idx) => {
            if (page === null) {
              return (
                <button key={`ellipsis-${idx}`} type="button" disabled className="btn-press inline-flex items-center justify-center cursor-not-allowed" style={{ minWidth: '28px', height: '28px', padding: '0 4px', background: 'transparent', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-4)', color: 'var(--trae-text-tertiary)', fontSize: '11px' }}>…</button>
              )
            }
            const isActive = page === currentPage
            return (
              <button
                key={page} type="button" aria-label={`第 ${page} 页`} aria-pressed={isActive}
                onClick={() => setCurrentPage(page)}
                className="btn-press inline-flex items-center justify-center cursor-pointer"
                style={{ minWidth: '28px', height: '28px', padding: '0 8px', background: isActive ? 'var(--trae-bg-brand)' : 'transparent', color: isActive ? 'var(--trae-text-onbrand)' : 'var(--trae-text-secondary)', border: isActive ? '1px solid var(--trae-bg-brand)' : '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-4)', fontSize: '11px', fontFamily: 'var(--trae-font-family-mono)' }}
              >
                {page}
              </button>
            )
          })}
          <button type="button" aria-label="下一页" onClick={() => setCurrentPage((p) => Math.min(p + 1, 25))} className="btn-press inline-flex items-center justify-center cursor-pointer" style={{ width: '28px', height: '28px', background: 'transparent', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-4)', color: 'var(--trae-text-secondary)' }}>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </footer>

      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        .history-card:hover { background: var(--trae-bg-base-tertiary); border-color: var(--trae-border-neutral-l2); }
        .btn-press:focus-visible, button[data-dom-id]:focus-visible { outline: 2px solid var(--trae-bg-brand); outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) {
          .btn-press { transition: none; }
          .btn-press:active { transform: none; }
          .history-card { transition: none; }
        }
      `}</style>
    </main>
  )
}
