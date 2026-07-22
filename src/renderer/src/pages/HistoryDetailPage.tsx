/**
 * HistoryDetailPage — 历史决策详情页（1:1 复刻 history-detail.html 设计稿）
 *
 * 路由：/history/:id · 设计稿：tdsf-linux-redesign/pages/history-detail.html
 * Spec: build-runnable-tdsf-from-design · Task 2.11
 *
 * 结构（5 张卡片 1:1 对齐设计稿）：
 *   Header（返回工作台 + 返回历史决策 / 已执行 + 时间戳）
 *   Title（决策记录 #DEC-2024-0718-001）
 *   Card 1 决策摘要 · Card 2 证据溯源链 7步HITL · Card 3 执行结果表
 *   Card 4 知识库更新（关联知识跳转入口）· Card 5 操作日志
 *
 * data-dom-id：back-workbench / back-history / goto-knowledge-detail
 * 视觉：全部 var(--trae-*) token；代码块背景 var(--trae-bg-code-block)
 * 无障碍：button type="button" + aria-label；prefers-reduced-motion 禁用按压动画
 */
import './HistoryPage.css'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Activity, ArrowLeft, ArrowRight, Book, Check, CheckCircle2,
  Clock, List, ScrollText, Shield, Sparkles, Terminal,
} from 'lucide-react'
import type { ReactNode } from 'react'

// ==================== 静态示例数据（1:1 来自设计稿 history-detail.html） ====================

const DECISION_ID = 'DEC-2024-0718-001'
const DECISION_TIMESTAMP = '2024-07-18 14:32:15'
const KNOWLEDGE_ID = 'KB-021'
const CONFIDENCE = 0.87

interface EvidenceStep { num: number; title: string; desc: string; time: string }

const EVIDENCE_STEPS: EvidenceStep[] = [
  { num: 1, title: '数据采集', desc: '采集 32 项指标：CPU 68%、内存 4.2G、worker_connections 达上限 10240、P99 延迟 1.2s。Nginx access.log 显示 502 错误率 12%。', time: '14:32:15' },
  { num: 2, title: '异常分析', desc: '连接数耗尽 + 502 激增。根因定位：worker_connections 设为 10240，但实际并发达 15360，超出上限 50%。', time: '14:32:16' },
  { num: 3, title: '推理归因', desc: 'worker_connections 低于实际并发需求。建议提升至 20480 并热加载 nginx，预计可消除 502 错误。', time: '14:32:17' },
  { num: 4, title: '交叉校验', desc: '沙箱环境验证通过，知识库 KB-021 匹配一致。历史 7 天内 3 次相似事件均通过此方案解决。', time: '14:32:18' },
  { num: 5, title: '人工确认', desc: '工程师审核通过命令。已拦截 8 项高危命令（rm -rf、dd、mkfs 等），仅保留 nginx -s reload 安全命令。', time: '14:32:20' },
  { num: 6, title: '执行变更', desc: '热加载 nginx 配置：worker_connections 10240 → 20480。零停机，2 秒完成。', time: '14:32:22' },
  { num: 7, title: '效果验证', desc: '60 秒后回采指标，确认 502 错误率降至 0%、P99 延迟恢复正常。', time: '14:33:24' },
]

interface ResultRow { metric: string; before: string; after: string; delta: string }

const RESULT_ROWS: ResultRow[] = [
  { metric: '502错误率', before: '12%', after: '0%', delta: '-12%' },
  { metric: 'P99延迟', before: '1.2s', after: '180ms', delta: '-85%' },
  { metric: '并发连接数', before: '15360', after: '8200', delta: '-47%' },
  { metric: 'CPU使用率', before: '68%', after: '45%', delta: '-23%' },
]

type LogIconName = 'sparkles' | 'shield' | 'check' | 'terminal' | 'activity' | 'check-circle'

interface LogEntry { time: string; icon: LogIconName; desc: ReactNode }

const ACTION_LOGS: LogEntry[] = [
  { time: '14:32:15', icon: 'sparkles', desc: 'AI 提出决策建议' },
  { time: '14:32:18', icon: 'shield', desc: '系统自动校验安全性' },
  { time: '14:32:20', icon: 'check', desc: '工程师审核通过' },
  { time: '14:32:22', icon: 'terminal', desc: <>执行 <span style={{ fontFamily: 'var(--trae-font-family-mono)', color: 'var(--trae-text-default)' }}>nginx -s reload</span></> },
  { time: '14:32:24', icon: 'activity', desc: '开始效果监控' },
  { time: '14:33:24', icon: 'check-circle', desc: '验证通过，决策完成' },
]

// ==================== 样式常量 ====================

const MONO_STYLE = { fontFamily: 'var(--trae-font-family-mono)', fontVariantNumeric: 'tabular-nums' as const }

const LOG_ICON_PROPS: Record<LogIconName, { color: string; Icon: typeof Sparkles }> = {
  sparkles: { color: 'var(--trae-text-brand)', Icon: Sparkles },
  shield: { color: 'var(--trae-icon-secondary)', Icon: Shield },
  check: { color: 'var(--trae-status-success-default)', Icon: Check },
  terminal: { color: 'var(--trae-text-brand)', Icon: Terminal },
  activity: { color: 'var(--trae-icon-secondary)', Icon: Activity },
  'check-circle': { color: 'var(--trae-status-success-default)', Icon: CheckCircle2 },
}

// ==================== 辅助子组件 ====================

/** 卡片头部条（1:1 对齐 .hist-section-head） */
function SectionHead({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className={right ? 'hist-section-head is-between' : 'hist-section-head'}>
      <div className="hist-section-head-left">
        {icon}
        <span className="hist-section-head-title">{title}</span>
      </div>
      {right}
    </div>
  )
}

/** 摘要行（label + value） */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hist-row">
      <span className="hist-row-label">{label}</span>
      <div className="hist-row-value">{children}</div>
    </div>
  )
}

/** 执行人/审核人徽章 */
function ActorBadge({ type, icon, label }: { type: 'ai' | 'approve'; icon: ReactNode; label: string }) {
  return (
    <span className={type === 'ai' ? 'hist-actor hist-actor--ai' : 'hist-actor hist-actor--approve'}>
      {icon}
      {label}
    </span>
  )
}

/** 日志行图标 */
function LogIcon({ name }: { name: LogIconName }) {
  const { color, Icon } = LOG_ICON_PROPS[name]
  return <Icon className="shrink-0" style={{ width: 14, height: 14, color }} />
}

// ==================== 主组件 ====================

export function HistoryDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  void id

  const handleBackWorkbench = () => navigate('/workbench')
  const handleBackHistory = () => navigate('/history')
  const handleGotoKnowledge = () => navigate(`/knowledge/${KNOWLEDGE_ID}`)

  return (
    <main className="hist-detail-page">
      {/* 1. Page header */}
      <header className="hist-detail-header">
        <div className="hist-detail-back-row">
          <button type="button" data-dom-id="back-workbench" aria-label="返回工作台" onClick={handleBackWorkbench} className="hist-back-btn hist-btn-press">
            <ArrowLeft className="shrink-0" style={{ width: 14, height: 14 }} />
            返回工作台
          </button>
          <button type="button" data-dom-id="back-history" aria-label="返回历史决策" onClick={handleBackHistory} className="hist-back-btn hist-btn-press">
            <ArrowLeft className="shrink-0" style={{ width: 14, height: 14 }} />
            返回历史决策
          </button>
        </div>
        <div className="hist-detail-actions">
          <span className="hist-tag hist-tag--success">已执行</span>
          <span className="hist-detail-timestamp">
            <Clock className="shrink-0" style={{ width: 12, height: 12, color: 'var(--trae-text-tertiary)' }} />
            <span className="hist-detail-timestamp-val">{DECISION_TIMESTAMP}</span>
          </span>
        </div>
      </header>

      {/* 2. Title block */}
      <div className="hist-detail-title-wrap">
        <h1 className="hist-detail-title">
          决策记录 <span className="hist-detail-id">#{DECISION_ID}</span>
        </h1>
      </div>

      {/* 3. Content cards */}
      <div className="hist-detail-content">
        {/* Card 1: 决策摘要 */}
        <section className="hist-card">
          <SectionHead icon={<ScrollText className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />} title="决策摘要" />
          <SummaryRow label="问题">Nginx 502 错误率激增至 <span style={{ ...MONO_STYLE, color: 'var(--trae-status-error-default)', fontWeight: 'var(--trae-font-weight-medium)' }}>12%</span></SummaryRow>
          <SummaryRow label="根因">worker_connections 配置不足（<span style={MONO_STYLE}>10240</span> &lt; 实际并发 <span style={MONO_STYLE}>15360</span>）</SummaryRow>
          <SummaryRow label="决策">将 worker_connections 从 <span style={MONO_STYLE}>10240</span> 提升至 <span style={{ ...MONO_STYLE, color: 'var(--trae-text-brand)', fontWeight: 'var(--trae-font-weight-medium)' }}>20480</span></SummaryRow>
          <SummaryRow label="执行命令">
            <div className="hist-cmd">
              <span style={{ color: 'var(--trae-text-brand)' }}>nginx</span> <span style={{ color: 'var(--trae-text-default)' }}>-s reload</span> <span style={{ color: 'var(--trae-text-tertiary)' }}># 热加载 nginx 配置</span>
            </div>
          </SummaryRow>
          <SummaryRow label="置信度">
            <div className="hist-conf-wrap">
              <span className="hist-conf-val">{CONFIDENCE.toFixed(2)}</span>
              <div className="hist-conf-bar">
                <div className="hist-conf-bar-fill" style={{ width: `${CONFIDENCE * 100}%` }} />
              </div>
            </div>
          </SummaryRow>
          <SummaryRow label="执行人">
            <ActorBadge type="ai" icon={<Sparkles style={{ width: 12, height: 12 }} />} label="AI Agent" />
          </SummaryRow>
          <SummaryRow label="审核人">
            <ActorBadge type="approve" icon={<Check style={{ width: 12, height: 12 }} />} label="Engineer Zhang" />
          </SummaryRow>
        </section>

        {/* Card 2: 证据溯源链 */}
        <section className="hist-card">
          <SectionHead
            icon={<ScrollText className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />}
            title="证据溯源链"
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="hist-tag">7步 · HITL</span>
                <span className="hist-tag hist-tag--success">全部完成</span>
              </div>
            }
          />
          <div className="hist-timeline">
            {EVIDENCE_STEPS.map((step, idx) => {
              const isLast = idx === EVIDENCE_STEPS.length - 1
              return (
                <div key={step.num} className={isLast ? 'hist-ev-step is-last' : 'hist-ev-step'}>
                  <div className="hist-ev-step-rail">
                    <div className="hist-ev-step-dot">
                      <Check style={{ width: 12, height: 12, color: 'var(--trae-text-onbrand)' }} />
                    </div>
                    {!isLast && <div className="hist-ev-step-connector" />}
                  </div>
                  <div className={isLast ? 'hist-ev-step-body is-last' : 'hist-ev-step-body'}>
                    <div className="hist-ev-step-title-row">
                      <span className="hist-ev-step-title">Step {step.num} · {step.title}</span>
                      <span className="hist-tag hist-tag--success">已完成</span>
                    </div>
                    <p className="hist-ev-step-desc">{step.desc}</p>
                    <p className="hist-ev-step-time">{step.time}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Card 3: 执行结果 */}
        <section className="hist-card">
          <SectionHead
            icon={<Activity className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />}
            title="执行结果"
            right={
              <span className="hist-result-success">
                <CheckCircle2 className="shrink-0" style={{ width: 14, height: 14, color: 'var(--trae-status-success-default)' }} />
                执行成功
              </span>
            }
          />
          <div className="hist-table-wrap">
            <table className="hist-table">
              <thead>
                <tr>
                  {['指标', '执行前', '执行后', '变化'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RESULT_ROWS.map((row) => (
                  <tr key={row.metric}>
                    <td>{row.metric}</td>
                    <td className="num">{row.before}</td>
                    <td className="num">{row.after}</td>
                    <td className="num delta-up">{row.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Card 4: 知识库更新（关联知识跳转入口） */}
        <section className="hist-card">
          <SectionHead icon={<Book className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />} title="知识库更新" />
          <div className="hist-kb-row">
            <div className="hist-kb-left">
              <CheckCircle2 className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-status-success-default)' }} />
              <span className="hist-kb-desc">本次决策已更新至知识库</span>
              <span className="hist-kb-link">{KNOWLEDGE_ID}</span>
            </div>
            <button
              type="button"
              data-dom-id="goto-knowledge-detail"
              aria-label={`查看知识 ${KNOWLEDGE_ID} 的详情`}
              onClick={handleGotoKnowledge}
              className="hist-kb-btn hist-btn-press"
            >
              查看知识详情
              <ArrowRight className="shrink-0" style={{ width: 12, height: 12 }} />
            </button>
          </div>
        </section>

        {/* Card 5: 操作日志 */}
        <section className="hist-card">
          <SectionHead icon={<List className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />} title="操作日志" />
          <div className="hist-timeline">
            {ACTION_LOGS.map((log, idx) => (
              <div key={idx} className="hist-log-row">
                <span className="hist-log-time">{log.time}</span>
                <span className="hist-log-icon">
                  <LogIcon name={log.icon} />
                </span>
                <span className="hist-log-desc">{log.desc}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
