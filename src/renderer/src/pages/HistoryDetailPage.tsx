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
import { useNavigate, useParams } from 'react-router-dom'
import {
  Activity, ArrowLeft, ArrowRight, Book, Check, CheckCircle2,
  Clock, List, ScrollText, Shield, Sparkles, Terminal,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

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
  { time: '14:32:22', icon: 'terminal', desc: <>执行 <span className="font-mono" style={{ color: 'var(--trae-text-default)' }}>nginx -s reload</span></> },
  { time: '14:32:24', icon: 'activity', desc: '开始效果监控' },
  { time: '14:33:24', icon: 'check-circle', desc: '验证通过，决策完成' },
]

// ==================== 样式常量 ====================

const CARD_STYLE: CSSProperties = {
  background: 'var(--trae-bg-base-secondary)',
  border: '1px solid var(--trae-border-neutral-l1)',
  borderRadius: 'var(--trae-radius-8)',
  padding: '24px',
  boxShadow: 'var(--trae-shadow-card)',
}

const HEADER_BTN_STYLE: CSSProperties = {
  height: 32,
  padding: '0 12px',
  fontSize: 'var(--trae-body-sm-font-size)',
  fontWeight: 'var(--trae-font-weight-medium)',
  color: 'var(--trae-text-default)',
  background: 'var(--trae-bg-overlay-l2)',
  border: '1px solid var(--trae-border-neutral-l2)',
  borderRadius: 'var(--trae-radius-6)',
}

const MONO_STYLE: CSSProperties = { fontFamily: 'var(--trae-font-family-mono)', fontVariantNumeric: 'tabular-nums' }

const LOG_ICON_PROPS: Record<LogIconName, { color: string; Icon: typeof Sparkles }> = {
  sparkles: { color: 'var(--trae-text-brand)', Icon: Sparkles },
  shield: { color: 'var(--trae-icon-secondary)', Icon: Shield },
  check: { color: 'var(--trae-status-success-default)', Icon: Check },
  terminal: { color: 'var(--trae-text-brand)', Icon: Terminal },
  activity: { color: 'var(--trae-icon-secondary)', Icon: Activity },
  'check-circle': { color: 'var(--trae-status-success-default)', Icon: CheckCircle2 },
}

// ==================== 辅助子组件 ====================

/** 卡片头部条（1:1 对齐 .hd-section-head） */
function SectionHead({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div
      className="flex items-center"
      style={{
        gap: '8px',
        padding: '12px 16px',
        background: 'var(--trae-bg-overlay-l2)',
        borderBottom: '1px solid var(--trae-border-neutral-l1)',
        borderRadius: 'var(--trae-radius-8) var(--trae-radius-8) 0 0',
        margin: 'calc(-1 * 24px) calc(-1 * 24px) 16px',
        ...(right ? { justifyContent: 'space-between' } : {}),
      }}
    >
      <div className="flex items-center" style={{ gap: '8px' }}>
        {icon}
        <span style={{ fontSize: 'var(--trae-heading-xs-font-size)', lineHeight: 'var(--trae-heading-xs-line-height)', fontWeight: 'var(--trae-heading-xs-font-weight)', color: 'var(--trae-text-default)' }}>{title}</span>
      </div>
      {right}
    </div>
  )
}

/** 摘要行（label + value） */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start" style={{ gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--trae-border-neutral-l1)' }}>
      <span className="shrink-0" style={{ width: 84, fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-tertiary)', fontWeight: 'var(--trae-font-weight-medium)', letterSpacing: '0.04em' }}>{label}</span>
      <div className="flex-1 min-w-0" style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-default)' }}>{children}</div>
    </div>
  )
}

/** 执行人/审核人徽章 */
function ActorBadge({ type, icon, label }: { type: 'ai' | 'approve'; icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center" style={{ gap: '6px', padding: '2px 8px', borderRadius: 'var(--trae-radius-4)', fontSize: 'var(--trae-body-xs-font-size)', ...(type === 'ai' ? { background: 'var(--trae-bg-brand-popup)', color: 'var(--trae-text-brand)' } : { background: 'var(--trae-status-success-surface-l1)', color: 'var(--trae-status-success-default)' }) }}>
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
  void id // 设计稿为静态示例数据，路由参数仅用于 URL 一致性

  const handleBackWorkbench = () => navigate('/workbench')
  const handleBackHistory = () => navigate('/history')
  const handleGotoKnowledge = () => navigate(`/knowledge/${KNOWLEDGE_ID}`)

  return (
    <main className="min-h-full flex flex-col bg-[var(--trae-bg-base-default)]">
      {/* 1. Page header */}
      <header className="flex items-center justify-between" style={{ padding: '16px 24px', gap: '16px', maxWidth: '900px', margin: '0 auto', width: '100%' }}>
        <div className="flex items-center" style={{ gap: '8px' }}>
          <button type="button" data-dom-id="back-workbench" aria-label="返回工作台" onClick={handleBackWorkbench} className="btn-press inline-flex items-center" style={{ gap: '6px', ...HEADER_BTN_STYLE, cursor: 'pointer' }}>
            <ArrowLeft className="shrink-0" style={{ width: 14, height: 14 }} />
            返回工作台
          </button>
          <button type="button" data-dom-id="back-history" aria-label="返回历史决策" onClick={handleBackHistory} className="btn-press inline-flex items-center" style={{ gap: '6px', ...HEADER_BTN_STYLE, cursor: 'pointer' }}>
            <ArrowLeft className="shrink-0" style={{ width: 14, height: 14 }} />
            返回历史决策
          </button>
        </div>
        <div className="flex items-center justify-end flex-1" style={{ gap: '12px' }}>
          <span className="inline-flex items-center" style={{ padding: '0 6px', height: 18, borderRadius: 'var(--trae-radius-2)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, background: 'var(--trae-status-success-surface-l1)', color: 'var(--trae-status-success-default)' }}>已执行</span>
          <span className="inline-flex items-center" style={{ gap: '6px', fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>
            <Clock className="shrink-0" style={{ width: 12, height: 12, color: 'var(--trae-text-tertiary)' }} />
            <span style={MONO_STYLE}>{DECISION_TIMESTAMP}</span>
          </span>
        </div>
      </header>

      {/* 2. Title block */}
      <div style={{ maxWidth: '900px', margin: '0 auto', width: '100%', padding: '16px 24px 0' }}>
        <h1 className="m-0" style={{ fontSize: 'var(--trae-heading-xl-font-size)', lineHeight: 'var(--trae-heading-xl-line-height)', fontWeight: 'var(--trae-font-weight-strong)', color: 'var(--trae-text-default)', textWrap: 'balance', wordBreak: 'keep-all' }}>
          决策记录 <span style={{ ...MONO_STYLE, color: 'var(--trae-text-brand)' }}>#{DECISION_ID}</span>
        </h1>
      </div>

      {/* 3. Content cards */}
      <div className="flex flex-col" style={{ maxWidth: '900px', margin: '0 auto', width: '100%', padding: '16px 24px 32px', gap: '16px' }}>
        {/* Card 1: 决策摘要 */}
        <section style={CARD_STYLE}>
          <SectionHead icon={<ScrollText className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />} title="决策摘要" />
          <SummaryRow label="问题">Nginx 502 错误率激增至 <span style={{ ...MONO_STYLE, color: 'var(--trae-status-error-default)', fontWeight: 'var(--trae-font-weight-medium)' }}>12%</span></SummaryRow>
          <SummaryRow label="根因">worker_connections 配置不足（<span style={MONO_STYLE}>10240</span> &lt; 实际并发 <span style={MONO_STYLE}>15360</span>）</SummaryRow>
          <SummaryRow label="决策">将 worker_connections 从 <span style={MONO_STYLE}>10240</span> 提升至 <span style={{ ...MONO_STYLE, color: 'var(--trae-text-brand)', fontWeight: 'var(--trae-font-weight-medium)' }}>20480</span></SummaryRow>
          <SummaryRow label="执行命令">
            <div style={{ background: 'var(--trae-bg-code-block)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-6)', padding: '8px 12px', fontFamily: 'var(--trae-font-family-mono)', fontSize: 'var(--trae-body-md-font-size)', lineHeight: 1.6 }}>
              <span style={{ color: 'var(--trae-text-brand)' }}>nginx</span> <span style={{ color: 'var(--trae-text-default)' }}>-s reload</span> <span style={{ color: 'var(--trae-text-tertiary)' }}># 热加载 nginx 配置</span>
            </div>
          </SummaryRow>
          <SummaryRow label="置信度">
            <div className="flex items-center" style={{ gap: '8px' }}>
              <span style={{ ...MONO_STYLE, fontSize: 'var(--trae-body-md-font-size)', fontWeight: 'var(--trae-font-weight-strong)', color: 'var(--trae-text-brand)' }}>{CONFIDENCE.toFixed(2)}</span>
              <div style={{ flex: 1, maxWidth: 200, height: 4, background: 'var(--trae-bg-overlay-l3)', borderRadius: 'var(--trae-radius-full)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${CONFIDENCE * 100}%`, background: 'var(--trae-bg-brand)', borderRadius: 'var(--trae-radius-full)' }} />
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
        <section style={CARD_STYLE}>
          <SectionHead
            icon={<ScrollText className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />}
            title="证据溯源链"
            right={
              <div className="flex items-center" style={{ gap: '8px' }}>
                <span className="inline-flex items-center" style={{ padding: '0 6px', height: 18, borderRadius: 'var(--trae-radius-2)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, background: 'var(--trae-bg-overlay-l2)', color: 'var(--trae-text-secondary)', border: '1px solid var(--trae-border-neutral-l1)' }}>7步 · HITL</span>
                <span className="inline-flex items-center" style={{ padding: '0 6px', height: 18, borderRadius: 'var(--trae-radius-2)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, background: 'var(--trae-status-success-surface-l1)', color: 'var(--trae-status-success-default)' }}>全部完成</span>
              </div>
            }
          />
          <div className="flex flex-col">
            {EVIDENCE_STEPS.map((step, idx) => {
              const isLast = idx === EVIDENCE_STEPS.length - 1
              return (
                <div key={step.num} className="flex" style={{ gap: '8px', paddingBottom: isLast ? 0 : '8px' }}>
                  <div className="flex flex-col items-center shrink-0">
                    <div className="flex items-center justify-center shrink-0" style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--trae-bg-brand)' }}>
                      <Check style={{ width: 12, height: 12, color: 'var(--trae-text-onbrand)' }} />
                    </div>
                    {!isLast && <div style={{ width: 2, minHeight: 24, background: 'var(--trae-bg-brand)', marginTop: 4, flex: 1 }} />}
                  </div>
                  <div className="flex-1 min-w-0" style={{ paddingBottom: isLast ? 0 : '8px' }}>
                    <div className="flex items-center" style={{ gap: '6px', marginBottom: 2 }}>
                      <span style={{ fontSize: 'var(--trae-body-xs-font-size)', fontWeight: 'var(--trae-font-weight-strong)' as const, color: 'var(--trae-text-default)' }}>Step {step.num} · {step.title}</span>
                      <span className="inline-flex items-center" style={{ padding: '0 6px', height: 18, borderRadius: 'var(--trae-radius-2)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, background: 'var(--trae-status-success-surface-l1)', color: 'var(--trae-status-success-default)' }}>已完成</span>
                    </div>
                    <p className="m-0" style={{ fontSize: 'var(--trae-body-sm-font-size)', color: 'var(--trae-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>{step.desc}</p>
                    <p className="m-0" style={{ ...MONO_STYLE, fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)', marginTop: 4 }}>{step.time}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Card 3: 执行结果 */}
        <section style={CARD_STYLE}>
          <SectionHead
            icon={<Activity className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />}
            title="执行结果"
            right={
              <span className="inline-flex items-center" style={{ gap: '6px', fontSize: 'var(--trae-body-sm-font-size)', color: 'var(--trae-status-success-default)', fontWeight: 'var(--trae-font-weight-medium)' }}>
                <CheckCircle2 className="shrink-0" style={{ width: 14, height: 14, color: 'var(--trae-status-success-default)' }} />
                执行成功
              </span>
            }
          />
          <div style={{ border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', overflow: 'hidden' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['指标', '执行前', '执行后', '变化'].map((h) => (
                    <th key={h} style={{ background: 'var(--trae-bg-overlay-l2)', padding: '10px 16px', textAlign: 'left', fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-secondary)', borderBottom: '1px solid var(--trae-border-neutral-l1)', fontWeight: 'var(--trae-font-weight-medium)', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RESULT_ROWS.map((row, idx) => (
                  <tr key={row.metric}>
                    <td style={{ padding: '10px 16px', fontSize: 'var(--trae-body-md-font-size)', borderBottom: idx === RESULT_ROWS.length - 1 ? 'none' : '1px solid var(--trae-border-neutral-l1)', color: 'var(--trae-text-default)' }}>{row.metric}</td>
                    <td style={{ padding: '10px 16px', fontSize: 'var(--trae-body-md-font-size)', borderBottom: idx === RESULT_ROWS.length - 1 ? 'none' : '1px solid var(--trae-border-neutral-l1)', color: 'var(--trae-text-default)', ...MONO_STYLE }}>{row.before}</td>
                    <td style={{ padding: '10px 16px', fontSize: 'var(--trae-body-md-font-size)', borderBottom: idx === RESULT_ROWS.length - 1 ? 'none' : '1px solid var(--trae-border-neutral-l1)', color: 'var(--trae-text-default)', ...MONO_STYLE }}>{row.after}</td>
                    <td style={{ padding: '10px 16px', fontSize: 'var(--trae-body-md-font-size)', borderBottom: idx === RESULT_ROWS.length - 1 ? 'none' : '1px solid var(--trae-border-neutral-l1)', color: 'var(--trae-status-success-default)', fontWeight: 'var(--trae-font-weight-medium)', ...MONO_STYLE }}>{row.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Card 4: 知识库更新（关联知识跳转入口） */}
        <section style={CARD_STYLE}>
          <SectionHead icon={<Book className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />} title="知识库更新" />
          <div className="flex items-center justify-between flex-wrap" style={{ gap: '12px' }}>
            <div className="flex items-center" style={{ gap: '8px' }}>
              <CheckCircle2 className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-status-success-default)' }} />
              <span style={{ fontSize: 'var(--trae-body-sm-font-size)', color: 'var(--trae-text-default)' }}>本次决策已更新至知识库</span>
              <span style={{ ...MONO_STYLE, color: 'var(--trae-text-brand)', fontSize: 'var(--trae-body-sm-font-size)' }}>{KNOWLEDGE_ID}</span>
            </div>
            <button
              type="button"
              data-dom-id="goto-knowledge-detail"
              aria-label={`查看知识 ${KNOWLEDGE_ID} 的详情`}
              onClick={handleGotoKnowledge}
              className="btn-press inline-flex items-center"
              style={{ gap: '6px', height: 28, padding: '0 12px', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-text-default)', background: 'var(--trae-bg-overlay-l2)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-4)', cursor: 'pointer' }}
            >
              查看知识详情
              <ArrowRight className="shrink-0" style={{ width: 12, height: 12 }} />
            </button>
          </div>
        </section>

        {/* Card 5: 操作日志 */}
        <section style={CARD_STYLE}>
          <SectionHead icon={<List className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />} title="操作日志" />
          <div className="flex flex-col">
            {ACTION_LOGS.map((log, idx) => (
              <div key={idx} className="flex items-start" style={{ gap: '12px', padding: '8px 0', borderBottom: idx === ACTION_LOGS.length - 1 ? 'none' : '1px solid var(--trae-border-neutral-l1)' }}>
                <span className="shrink-0" style={{ width: 64, ...MONO_STYLE, fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>{log.time}</span>
                <span className="shrink-0 inline-flex" style={{ paddingTop: 1 }}>
                  <LogIcon name={log.icon} />
                </span>
                <span className="flex-1 min-w-0" style={{ fontSize: 'var(--trae-body-sm-font-size)', color: 'var(--trae-text-default)', lineHeight: 'var(--trae-body-sm-line-height)' }}>{log.desc}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        .btn-press:focus-visible, button[data-dom-id]:focus-visible { outline: 2px solid var(--trae-bg-brand); outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) {
          .btn-press { transition: none; }
          .btn-press:active { transform: none; }
        }
      `}</style>
    </main>
  )
}
