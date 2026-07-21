/**
 * KnowledgeDetailPage — 知识详情页（1:1 复刻 knowledge-detail.html 设计稿）
 *
 * 路由：/knowledge/:id
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html
 * Spec: build-runnable-tdsf-from-design · Task 2.9
 *
 * 结构（1:1 对齐设计稿）：
 *   1. 紧凑 Header（3 行）：返回工作台 + 返回知识库 + 标题 + 编辑按钮 / 6 chips / 5 meta
 *   2. 两栏布局：
 *      - 主内容 6 section：问题描述 / 根因分析 / 诊断步骤(4 步) / 解决方案(配置对比) / 验证方法 / 反馈
 *      - 右侧 sticky 侧栏 4 卡片：目录 / 置信度 / 元信息 / 关联知识
 *
 * data-dom-id 接入：
 *   - back-workbench / back-knowledge（返回）
 *   - edit-knowledge（编辑按钮）
 *   - copy-cmd-{1..4}（诊断步骤代码块）+ copy-cmd-reload（重载命令）+ copy-cmd-verify（验证命令）
 *   - feedback-helpful / feedback-unhelpful（反馈按钮）
 *   - goto-section-{1..6}（目录跳转，子组件接入）
 *   - goto-related-{1..3}（关联知识跳转，子组件接入）
 *
 * 数据：严格使用设计稿 knowledge-detail.html 示例数据（KB-NGINX-014 Nginx worker_connections 调优）
 * 视觉：全部 var(--trae-*) token，全实色 hex 边框（背景 rgba 允许），shadow 用 var(--trae-shadow-card)
 * 无障碍：button type="button" + aria-label，prefers-reduced-motion 禁用按压动画
 */
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Modal } from 'antd'
import {
  Activity, AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock,
  Edit3, Eye, FileText, MessageSquare, ThumbsDown, ThumbsUp,
  Wrench, Zap,
} from 'lucide-react'
import {
  CardHead,
  CodeBlock,
  DIAGNOSE_STEPS,
  FIX_AFTER,
  FIX_BEFORE,
  FIX_RELOAD_CMD,
  KnowledgeDetailSidebar,
  VERIFY_CMD,
} from '@/components/knowledge-detail/v1'

// ==================== 卡片容器样式（1:1 对齐设计稿 .kd-card） ====================

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--trae-bg-base-secondary)',
  border: '1px solid var(--trae-border-neutral-l1)',
  borderRadius: 'var(--trae-radius-8)',
  boxShadow: 'var(--trae-shadow-card)',
  overflow: 'hidden',
}

const CODE_INLINE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--trae-font-family-mono)',
  fontSize: '12px',
  background: 'var(--trae-bg-base-tertiary)',
  border: '1px solid var(--trae-border-neutral-l1)',
  borderRadius: 'var(--trae-radius-4)',
  padding: '1px 5px',
  color: 'var(--trae-code-constant)',
}

// ==================== 主组件 ====================

/** KnowledgeDetailPage — 知识详情页 */
export function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [activeSection, setActiveSection] = useState<string>('sec-1')
  const [feedback, setFeedback] = useState<'helpful' | 'unhelpful' | null>(null)
  /** 编辑按钮引用 —— Modal 关闭后焦点返回此按钮（无障碍） */
  const editButtonRef = useRef<HTMLButtonElement>(null)

  // ===== 事件处理 =====
  const handleBackWorkbench = () => navigate('/workbench')
  const handleBackKnowledge = () => navigate('/knowledge')
  const handleEdit = () => {
    // 使用 AntD Modal.confirm 替代 window.alert（无障碍 + 焦点管理）
    // Modal.confirm 默认包含 role="dialog" + aria-modal="true" + aria-labelledby（title）
    // 默认支持 ESC 关闭，且 autoFocusButton="ok" 使 OK 按钮在打开时获得焦点
    Modal.confirm({
      title: '编辑知识条目',
      content: '编辑功能暂未上线，是否跳转到知识库管理？',
      okText: '前往管理',
      cancelText: '取消',
      autoFocusButton: 'ok',
      onOk: () => navigate('/knowledge'),
      afterClose: () => {
        // 关闭后焦点返回触发按钮（无障碍）
        editButtonRef.current?.focus()
      },
    })
  }
  const handleTocClick = (target: string) => {
    setActiveSection(target)
    const el = document.getElementById(target)
    if (!el) return
    // prefers-reduced-motion 时禁用 smooth scroll（无障碍）
    const prefersReducedMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }
  const handleNavigateRelated = (targetId: string) => navigate(`/knowledge/${targetId}`)

  return (
    <main className="flex h-full w-full flex-col bg-[var(--trae-bg-base-default)]">
      {/* ===== Header（3 rows，1:1 对齐设计稿 .kd-header） ===== */}
      <header
        className="border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
        style={{ padding: '16px 24px' }}
      >
        {/* row1: 返回按钮组 + 标题 + 编辑按钮 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-dom-id="back-workbench"
              aria-label="返回工作台"
              onClick={handleBackWorkbench}
              className="btn-press inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-base-tertiary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回工作台
            </button>
            <button
              type="button"
              data-dom-id="back-knowledge"
              aria-label="返回知识库"
              onClick={handleBackKnowledge}
              className="btn-press inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-base-tertiary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回知识库
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold leading-[26px] tracking-[-0.01em] text-[var(--trae-text-default)]">
              Nginx worker_connections 调优指南
            </h1>
          </div>
          <button
            type="button"
            ref={editButtonRef}
            data-dom-id="edit-knowledge"
            aria-label="编辑知识"
            onClick={handleEdit}
            className="btn-press inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-3.5 text-[12px] font-medium text-[var(--trae-special-white)] transition-colors hover:bg-[var(--trae-bg-brand-hover)] hover:border-[var(--trae-bg-brand-hover)]"
          >
            <Edit3 className="h-3.5 w-3.5" />
            编辑
          </button>
        </div>

        {/* row2: 6 chips（ID + 3 tag + verified + AI） */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 font-mono text-[11px] font-medium text-[var(--trae-text-brand)]">
            KB-NGINX-014
          </span>
          <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-2 text-[11px] font-medium text-[var(--trae-text-secondary)]">
            Nginx
          </span>
          <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-2 text-[11px] font-medium text-[var(--trae-text-secondary)]">
            性能调优
          </span>
          <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-2 text-[11px] font-medium text-[var(--trae-text-secondary)]">
            连接数
          </span>
          <span className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-status-success-default)] bg-[var(--trae-status-success-surface-l1)] px-2 text-[11px] font-medium text-[var(--trae-status-success-default)]">
            <CheckCircle2 className="h-3 w-3" />
            已验证
          </span>
          <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[11px] font-medium text-[var(--trae-text-brand)]">
            AI 沉淀
          </span>
        </div>

        {/* row3: 5 meta（更新时间 / 作者 / 版本 / 阅读量 / 匹配度） */}
        <div className="mt-2.5 flex flex-wrap items-center gap-4 border-t border-[var(--trae-border-neutral-l1)] pt-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--trae-text-tertiary)]">
            <Clock className="h-3 w-3" />
            更新于 <strong className="font-medium text-[var(--trae-text-secondary)]">2026-07-15</strong>
          </span>
          <span className="h-2.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--trae-text-tertiary)]">
            <FileText className="h-3 w-3" />
            作者 <strong className="font-medium text-[var(--trae-text-secondary)]">运维团队</strong>
          </span>
          <span className="h-2.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--trae-text-tertiary)]">
            <FileText className="h-3 w-3" />
            v<strong className="font-medium text-[var(--trae-text-secondary)]">2.3</strong>
          </span>
          <span className="h-2.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--trae-text-tertiary)]">
            <Eye className="h-3 w-3" />
            <strong className="font-medium text-[var(--trae-text-secondary)]">1,247</strong> 次阅读
          </span>
          <span className="h-2.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--trae-text-tertiary)]">
            <CheckCircle2 className="h-3 w-3" />
            匹配 <strong className="font-medium text-[var(--trae-text-secondary)]">92%</strong>
          </span>
        </div>
      </header>

      {/* ===== Two-column layout（1:1 对齐设计稿 .kd-layout） ===== */}
      <div className="flex flex-1 gap-5 overflow-y-auto px-6 py-5">
        {/* ===== Main content（6 section） ===== */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">

          {/* 1. 问题描述（SYMPTOM） */}
          <section id="sec-1" className="scroll-mt-4" style={CARD_STYLE}>
            <CardHead icon={<Activity className="h-4 w-4" />} title="问题描述" tag="SYMPTOM" />
            <div className="space-y-2 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
              <p>
                高并发场景下 Nginx 出现{' '}
                <strong className="font-medium text-[var(--trae-text-default)]">502 Bad Gateway</strong> 或{' '}
                <strong className="font-medium text-[var(--trae-text-default)]">"accept() failed (24: Too many open files)"</strong> 错误，服务间歇性不可用。
              </p>
              <p>
                典型触发条件：单机并发连接数超过 <code style={CODE_INLINE_STYLE}>1024</code>，或 Nginx worker 进程达到文件描述符上限。多见于流量突增、长连接保持、或反向代理后端响应缓慢的场景。
              </p>
            </div>
          </section>

          {/* 2. 根因分析（ROOT CAUSE）— 含公式 + warning callout */}
          <section id="sec-2" className="scroll-mt-4" style={CARD_STYLE}>
            <CardHead icon={<Zap className="h-4 w-4" />} title="根因分析" tag="ROOT CAUSE" />
            <div className="space-y-2 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
              <p>
                Nginx 采用多进程架构，每个 worker 进程独立处理连接。
                <strong className="font-medium text-[var(--trae-text-default)]">worker_connections</strong> 限制单个 worker 可同时持有的最大连接数。默认值{' '}
                <code style={CODE_INLINE_STYLE}>512</code> 或{' '}
                <code style={CODE_INLINE_STYLE}>1024</code> 远不能满足高并发需求。
              </p>
              <p>最大连接数公式：</p>
              <div
                className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)] px-4 py-3 text-center font-mono text-[12px] leading-[20px] text-[var(--trae-code-text)]"
              >
                <span className="text-[var(--trae-code-doc)]">// max_clients = worker_processes × worker_connections / 2（反向代理）</span>
                <br />
                <span className="text-[var(--trae-code-parameter)]">max_clients</span>{' '}
                = <span className="text-[var(--trae-code-parameter)]">worker_processes</span>{' '}
                × <span className="text-[var(--trae-code-parameter)]">worker_connections</span>{' '}
                ÷ <span className="text-[var(--trae-code-number)]">2</span>
              </div>
              <p>作为反向代理时，每个客户端连接消耗 2 个 worker 连接（一个对客户端，一个对后端），因此需除以 2。</p>
              {/* warning callout（1:1 对齐 .kd-warn） */}
              <div
                className="flex items-start gap-2 rounded-[0_var(--trae-radius-4)_var(--trae-radius-4)_0] border border-[var(--trae-status-alert-default)] bg-[var(--trae-status-alert-surface-l1)] px-3 py-2.5"
                style={{ borderLeft: '3px solid var(--trae-status-alert-default)' }}
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--trae-status-alert-default)]" />
                <span className="text-[12px] leading-[19px] text-[var(--trae-text-secondary)]">
                  <strong className="font-medium text-[var(--trae-status-alert-default)]">注意：</strong>
                  worker_connections 不能超过系统 <code style={CODE_INLINE_STYLE}>ulimit -n</code> 的文件描述符上限，否则配置不生效。需同步调整系统级限制。
                </span>
              </div>
            </div>
          </section>

          {/* 3. 诊断步骤（DIAGNOSE）— 4 步骤 + 命令块 + 结果 callout */}
          <section id="sec-3" className="scroll-mt-4" style={CARD_STYLE}>
            <CardHead icon={<Activity className="h-4 w-4" />} title="诊断步骤" tag="DIAGNOSE" />
            <div className="px-4 py-3.5">
              {DIAGNOSE_STEPS.map((step, idx) => (
                <div
                  key={step.num}
                  className={`flex gap-3 ${idx > 0 ? 'border-t border-[var(--trae-border-neutral-l1)] pt-3' : ''} ${idx < DIAGNOSE_STEPS.length - 1 ? 'pb-3' : ''}`}
                >
                  <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[var(--trae-radius-full)] bg-[var(--trae-bg-brand)] text-[11px] font-semibold text-[var(--trae-special-white)]">
                    {step.num}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[13px] font-medium text-[var(--trae-text-default)]">{step.title}</div>
                    <div className="mb-1.5 text-[12px] leading-[19px] text-[var(--trae-text-tertiary)]">{step.desc}</div>
                    <CodeBlock code={step.code} copyId={`${step.num}`} />
                    {step.result && (
                      <div
                        className="mt-2 flex items-start gap-2 rounded-[0_var(--trae-radius-4)_var(--trae-radius-4)_0] border border-[var(--trae-status-success-default)] bg-[var(--trae-status-success-surface-l1)] px-3 py-2"
                        style={{ borderLeft: '3px solid var(--trae-status-success-default)' }}
                      >
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--trae-status-success-default)]" />
                        <span className="text-[12px] leading-[19px] text-[var(--trae-text-secondary)]">
                          <strong className="font-medium text-[var(--trae-status-success-default)]">诊断结论：</strong>
                          {step.result}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 4. 解决方案（FIX）— 配置对比 + 重载命令 */}
          <section id="sec-4" className="scroll-mt-4" style={CARD_STYLE}>
            <CardHead icon={<Wrench className="h-4 w-4" />} title="解决方案" tag="FIX" />
            <div className="space-y-3 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
              <p>
                需同步调整 <strong className="font-medium text-[var(--trae-text-default)]">Nginx 配置</strong>和{' '}
                <strong className="font-medium text-[var(--trae-text-default)]">系统级文件描述符限制</strong>，否则 Nginx 配置不生效。
              </p>
              {/* 配置对比（1:1 对齐 .kd-compare） */}
              <div className="grid grid-cols-2 gap-3">
                <div className="overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
                  <div className="flex items-center gap-1.5 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-status-error-surface-l1)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--trae-status-error-default)]">
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-error-default)]" />
                    调整前（默认）
                  </div>
                  <pre className="overflow-x-auto bg-[var(--trae-bg-base-default)] px-3 py-2.5 font-mono text-[11px] leading-[18px] text-[var(--trae-code-text)]">
                    {FIX_BEFORE}
                  </pre>
                </div>
                <div className="overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
                  <div className="flex items-center gap-1.5 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-status-success-surface-l1)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--trae-status-success-default)]">
                    <Check className="h-3 w-3" />
                    调整后（推荐）
                  </div>
                  <pre className="overflow-x-auto bg-[var(--trae-bg-base-default)] px-3 py-2.5 font-mono text-[11px] leading-[18px] text-[var(--trae-code-text)]">
                    {FIX_AFTER}
                  </pre>
                </div>
              </div>
              <p className="mt-3">修改后执行以下命令使配置生效：</p>
              <CodeBlock code={FIX_RELOAD_CMD} copyId="reload" />
            </div>
          </section>

          {/* 5. 验证方法（VERIFY）— 命令块 + 结果 callout */}
          <section id="sec-5" className="scroll-mt-4" style={CARD_STYLE}>
            <CardHead icon={<CheckCircle2 className="h-4 w-4" />} title="验证方法" tag="VERIFY" />
            <div className="space-y-2 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
              <p>使用压测工具验证调优效果，确认连接数提升且无报错：</p>
              <CodeBlock code={VERIFY_CMD} copyId="verify" />
              <div
                className="mt-2 flex items-start gap-2 rounded-[0_var(--trae-radius-4)_var(--trae-radius-4)_0] border border-[var(--trae-status-success-default)] bg-[var(--trae-status-success-surface-l1)] px-3 py-2"
                style={{ borderLeft: '3px solid var(--trae-status-success-default)' }}
              >
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--trae-status-success-default)]" />
                <span className="text-[12px] leading-[19px] text-[var(--trae-text-secondary)]">
                  <strong className="font-medium text-[var(--trae-status-success-default)]">验证通过：</strong>
                  5000 并发压测零报错，Active connections 峰值 4876，远低于 10240 上限，调优生效。
                </span>
              </div>
            </div>
          </section>

          {/* 6. 反馈区（1:1 对齐 .kd-feedback） */}
          <section id="sec-6" className="scroll-mt-4" style={CARD_STYLE}>
            <CardHead icon={<MessageSquare className="h-4 w-4" />} title="此知识对您有帮助吗？" />
            <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
              <span className="text-[12px] text-[var(--trae-text-secondary)]">您的反馈将帮助改进知识库质量</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-dom-id="feedback-helpful"
                  aria-label="有帮助"
                  aria-pressed={feedback === 'helpful'}
                  onClick={() => setFeedback('helpful')}
                  className={`btn-press inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[var(--trae-radius-6)] border px-3.5 text-[12px] font-medium transition-colors ${
                    feedback === 'helpful'
                      ? 'border-[var(--trae-status-success-default)] bg-[var(--trae-status-success-surface-l1)] text-[var(--trae-status-success-default)]'
                      : 'border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] hover:border-[var(--trae-status-success-default)] hover:bg-[var(--trae-status-success-surface-l1)] hover:text-[var(--trae-status-success-default)]'
                  }`}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  有帮助
                </button>
                <button
                  type="button"
                  data-dom-id="feedback-unhelpful"
                  aria-label="无帮助"
                  aria-pressed={feedback === 'unhelpful'}
                  onClick={() => setFeedback('unhelpful')}
                  className={`btn-press inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[var(--trae-radius-6)] border px-3.5 text-[12px] font-medium transition-colors ${
                    feedback === 'unhelpful'
                      ? 'border-[var(--trae-status-error-default)] bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)]'
                      : 'border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] hover:border-[var(--trae-status-error-default)] hover:bg-[var(--trae-status-error-surface-l1)] hover:text-[var(--trae-status-error-default)]'
                  }`}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  无帮助
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* ===== Sidebar（4 卡片，子组件） ===== */}
        <KnowledgeDetailSidebar
          activeSection={activeSection}
          onTocClick={handleTocClick}
          onNavigate={handleNavigateRelated}
        />
      </div>

      {/* id 提示（用于 useParams，sr-only） */}
      <span className="sr-only">当前知识 ID：{id}</span>

      {/* ===== 按压动画 + 无障碍降级 ===== */}
      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.96); }
        @media (prefers-reduced-motion: reduce) {
          .btn-press:active { transform: none !important; }
        }
      `}</style>
    </main>
  )
}
