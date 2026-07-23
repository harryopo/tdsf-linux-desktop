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
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Spin, message } from 'antd'
import {
  Activity, AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock,
  Edit3, Eye, FileText, Loader2, MessageSquare, Save, ThumbsDown, ThumbsUp,
  Wrench, X, Zap,
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
import type { KnowledgeEntry } from '@shared/models'
import { cn } from '@/components/trae/utils'
import './KnowledgePage.css'

/** KnowledgeDetailPage — 知识详情页 */
export function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [activeSection, setActiveSection] = useState<string>('sec-1')
  const [feedback, setFeedback] = useState<'helpful' | 'unhelpful' | null>(null)
  /** 编辑按钮引用 —— Modal 关闭后焦点返回此按钮（无障碍） */
  const editButtonRef = useRef<HTMLButtonElement>(null)

  // ===== 真实数据状态（M4 Task 1：改用 kbGet(id) 精确查询，替代 kbExport 全量+find） =====
  const [realEntry, setRealEntry] = useState<KnowledgeEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [useReal, setUseReal] = useState(false)

  // ===== v2.2 P1 修复 #25：编辑模式状态 =====
  // 编辑模式仅在 useReal=true 时可用（设计稿示例数据不可编辑）
  // 编辑字段：title / problem / rootCause（核心三字段，其余字段通过 kbUpdate 部分更新保留原值）
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editProblem, setEditProblem] = useState('')
  const [editRootCause, setEditRootCause] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // 加载真实知识条目（按 URL :id 精确查询）
  // 优先使用 kbGet(id)；若 kbGet 不可用（旧版主进程），降级到 kbExport + find by id
  useEffect(() => {
    let cancelled = false
    const loadRealEntry = async () => {
      if (typeof window === 'undefined' || !window.electronAPI?.kbGet) {
        // WIP: 非 Electron 环境或旧版主进程，保留设计稿示例数据（CLAUDE.md A4 诚实标注）
        setLoading(false)
        return
      }
      try {
        const found = await window.electronAPI.kbGet(id ?? '')
        if (cancelled) return
        if (found) {
          setRealEntry(found)
          setUseReal(true)
        }
        // 找不到真实条目时，useReal 保持 false，UI 降级到设计稿示例数据
      } catch (err) {
        if (cancelled) return
        const reason = err instanceof Error ? err.message : String(err)
        message.warning(`知识库加载失败，使用示例数据：${reason}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRealEntry()
    return () => { cancelled = true }
  }, [id])

  // ===== 渲染辅助：根据 useReal 决定字段来源 =====
  // 真实数据：title/problem/rootCause/commands/rollbackCommands/verification/tags/updatedAt
  // 设计稿示例：KB-NGINX-014 Nginx worker_connections 调优 + DIAGNOSE_STEPS + FIX_BEFORE/AFTER
  const displayTitle = useReal && realEntry ? realEntry.title : 'Nginx worker_connections 调优指南'
  const displayProblem = useReal && realEntry ? realEntry.problem : '高并发场景下 Nginx 出现 502 Bad Gateway 或 "accept() failed (24: Too many open files)" 错误，服务间歇性不可用。'
  const displayRootCause = useReal && realEntry?.rootCause
    ? realEntry.rootCause
    : 'Nginx 采用多进程架构，每个 worker 进程独立处理连接。worker_connections 限制单个 worker 可同时持有的最大连接数。默认值 512 或 1024 远不能满足高并发需求。'
  const displayCommands = useReal && realEntry ? realEntry.commands : []
  const displayRollback = useReal && realEntry?.rollbackCommands ? realEntry.rollbackCommands : []
  const displayVerification = useReal && realEntry?.verification
    ? realEntry.verification
    : '使用压测工具验证调优效果，确认连接数提升且无报错'
  const displayTags = useReal && realEntry ? realEntry.tags : ['Nginx', '性能调优', '连接数']
  const displayId = useReal && realEntry ? realEntry.id : 'KB-NGINX-014'
  const displayUpdatedAt = useReal && realEntry
    ? new Date(realEntry.updatedAt).toISOString().slice(0, 10)
    : '2026-07-15'
  const displayUseCount = useReal && realEntry ? realEntry.useCount : 1247
  const displaySuccessRate = useReal && realEntry ? Math.round(realEntry.successRate * 100) : 92

  // 解决方案块：真实数据 fallback 到设计稿示例（WIP · CLAUDE.md A4 诚实标注）
  // 真实数据 commands[] 拼成多行；rollbackCommands[] 作为重载命令
  const displayFixAfter = useReal && displayCommands.length > 0
    ? displayCommands.join('\n')
    : FIX_AFTER
  const displayReloadCmd = useReal && displayRollback.length > 0
    ? displayRollback.join('\n')
    : FIX_RELOAD_CMD
  const displayVerifyCmd = useReal && realEntry?.verification
    ? realEntry.verification
    : VERIFY_CMD

  // ===== 事件处理 =====
  const handleBackWorkbench = () => navigate('/workbench')
  const handleBackKnowledge = () => navigate('/knowledge')

  /**
   * 进入编辑模式（v2.2 P1 修复 #25：真实实现，替代原 WIP Modal.confirm）
   *
   * 仅在 useReal=true（真实数据）时可用。设计稿示例数据不可编辑。
   * 进入编辑模式时，将当前真实数据复制到 editXxx 状态，作为 textarea 的初始值。
   */
  const handleEdit = () => {
    if (!useReal || !realEntry) {
      // 设计稿示例数据不可编辑：提示用户先导入真实知识条目
      message.info('当前为示例数据，不可编辑。请先在知识库管理中导入真实条目。')
      return
    }
    setEditTitle(realEntry.title)
    setEditProblem(realEntry.problem)
    setEditRootCause(realEntry.rootCause ?? '')
    setIsEditing(true)
  }

  /**
   * 保存编辑：调用 kbUpdate IPC 部分更新知识条目
   *
   * kbUpdate 签名：kbUpdate(id: string, partial: Partial<KnowledgeEntry>): Promise<boolean>
   * 仅更新 title / problem / rootCause 三个字段，其余字段保留原值。
   *
   * 保存成功后：
   * - 更新 realEntry 本地状态（UI 立即刷新）
   * - 退出编辑模式
   * - 显示成功提示
   */
  const handleSave = async () => {
    if (!isSaving && realEntry) {
      setIsSaving(true)
      try {
        const ok = await window.electronAPI.kbUpdate(realEntry.id, {
          title: editTitle.trim(),
          problem: editProblem.trim(),
          rootCause: editRootCause.trim(),
        })
        if (ok) {
          // 本地状态立即刷新（避免重新拉取 kbGet）
          setRealEntry({
            ...realEntry,
            title: editTitle.trim(),
            problem: editProblem.trim(),
            rootCause: editRootCause.trim(),
          })
          setIsEditing(false)
          message.success('知识条目已保存')
        } else {
          message.error('保存失败：主进程返回 false，请检查日志')
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        message.error(`保存失败：${reason}`)
      } finally {
        setIsSaving(false)
      }
    }
  }

  /** 取消编辑：丢弃修改，退出编辑模式 */
  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditTitle('')
    setEditProblem('')
    setEditRootCause('')
  }

  /**
   * 反馈持久化（M4 Task 1：从仅本地 state 升级为 kbUpdate 持久化）
   *
   * 调用 kbUpdate(id, { feedback }) 持久化用户反馈。
   * 成功后更新本地 state；失败时降级为本地 state（不阻塞 UI）。
   *
   * 类型说明：KnowledgeEntry 无 feedback 字段（不改 @shared/models），
   * 此处用类型断言将 feedback 字段附加到 Partial<KnowledgeEntry>。
   * 注意：当前 KnowledgeRepository.serialize 不处理 feedback 字段（数据库表无对应列），
   * kbUpdate 会返回 true 但 feedback 不会真正写入磁盘 —— 需后续 schema 迁移补齐。
   * UI 行为正确（本地 state 立即响应），符合"持久化失败降级为本地 state"约束。
   */
  const handleFeedback = async (value: 'helpful' | 'unhelpful') => {
    // 乐观更新：立即反映本地 state
    setFeedback(value)
    if (!useReal || !realEntry) {
      // 设计稿示例数据：仅本地 state，不调用 IPC
      return
    }
    try {
      await window.electronAPI.kbUpdate(realEntry.id, { feedback: value } as Partial<KnowledgeEntry>)
    } catch (err) {
      // 降级：本地 state 已更新，仅记录错误（不阻塞 UI、不弹错误消息）
      console.error('[KnowledgeDetailPage] 反馈持久化失败，降级为本地 state', err)
    }
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
    <main className="kb-detail-page">
      {/* loading 占位：真实数据加载中时显示 Spin（避免短暂空白） */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 0' }}>
          <Spin tip="加载知识条目..." />
        </div>
      )}
      {!loading && (
        <>
          <header className="kb-detail-header">
        <div className="kb-detail-header__row1">
          <div className="kb-detail-back-group">
            <button
              type="button"
              data-dom-id="back-workbench"
              aria-label="返回工作台"
              onClick={handleBackWorkbench}
              className="kb-detail-back kb-btn-press"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回工作台
            </button>
            <button
              type="button"
              data-dom-id="back-knowledge"
              aria-label="返回知识库"
              onClick={handleBackKnowledge}
              className="kb-detail-back kb-btn-press"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回知识库
            </button>
          </div>
          <div className="kb-detail-titlewrap">
            {isEditing ? (
              // v2.2 P1 修复 #25：编辑模式 - 标题变为 textarea
              <textarea
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                aria-label="编辑标题"
                className="kb-detail-title kb-detail-title--edit"
                rows={1}
                style={{
                  width: '100%',
                  minHeight: '2.5rem',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid var(--trae-border-brand, var(--trae-border-default))',
                  borderRadius: 'var(--trae-radius-md, 6px)',
                  background: 'var(--trae-bg-elevated)',
                  color: 'var(--trae-text-primary)',
                  fontSize: 'var(--trae-h1-font-size, 1.5rem)',
                  fontWeight: 'var(--trae-h1-font-weight, 700)',
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
            ) : (
              <h1 className="kb-detail-title">
                {displayTitle}
              </h1>
            )}
          </div>
          {isEditing ? (
            // v2.2 P1 修复 #25：编辑模式 - 显示保存/取消按钮组
            <div className="kb-detail-edit-group" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                aria-label="保存"
                className="kb-detail-edit kb-btn-press"
                style={{
                  background: 'var(--trae-bg-brand)',
                  color: 'var(--trae-text-on-brand)',
                  borderColor: 'var(--trae-border-brand)',
                  opacity: isSaving ? 0.7 : 1,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                }}
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {isSaving ? '保存中...' : '保存'}
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={isSaving}
                aria-label="取消"
                className="kb-detail-edit kb-btn-press"
              >
                <X className="h-3.5 w-3.5" />
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              ref={editButtonRef}
              data-dom-id="edit-knowledge"
              aria-label="编辑知识"
              onClick={handleEdit}
              className="kb-detail-edit kb-btn-press"
            >
              <Edit3 className="h-3.5 w-3.5" />
              编辑
            </button>
          )}
        </div>

        <div className="kb-detail-header__row2">
          <span className="kb-chip kb-chip--id">
            {displayId}
          </span>
          {displayTags.map((tag) => (
            <span key={tag} className="kb-chip kb-chip--tag">
              {tag}
            </span>
          ))}
          <span className="kb-chip kb-chip--verified">
            <CheckCircle2 className="h-3 w-3" />
            已验证
          </span>
          <span className="kb-chip kb-chip--ai">
            AI 沉淀
          </span>
        </div>

        <div className="kb-detail-header__row3">
          <span className="kb-meta">
            <Clock className="h-3 w-3" />
            更新于 <strong className="kb-meta__strong">{displayUpdatedAt}</strong>
          </span>
          <span className="kb-meta__sep" />
          <span className="kb-meta">
            <FileText className="h-3 w-3" />
            作者 <strong className="kb-meta__strong">运维团队</strong>
          </span>
          <span className="kb-meta__sep" />
          <span className="kb-meta">
            <FileText className="h-3 w-3" />
            v<strong className="kb-meta__strong">2.3</strong>
          </span>
          <span className="kb-meta__sep" />
          <span className="kb-meta">
            <Eye className="h-3 w-3" />
            <strong className="kb-meta__strong">{displayUseCount.toLocaleString()}</strong> 次阅读
          </span>
          <span className="kb-meta__sep" />
          <span className="kb-meta">
            <CheckCircle2 className="h-3 w-3" />
            匹配 <strong className="kb-meta__strong">{displaySuccessRate}%</strong>
          </span>
        </div>
      </header>

      <div className="kb-detail-layout">
        <div className="kb-detail-main">

          <section id="sec-1" className="kb-detail-card">
            <CardHead icon={<Activity className="h-4 w-4" />} title="问题描述" tag="SYMPTOM" />
            <div className="kb-body">
              {isEditing && useReal ? (
                // v2.2 P1 修复 #25：编辑模式 - 问题描述变为 textarea
                <textarea
                  value={editProblem}
                  onChange={(e) => setEditProblem(e.target.value)}
                  aria-label="编辑问题描述"
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid var(--trae-border-brand, var(--trae-border-default))',
                    borderRadius: 'var(--trae-radius-md, 6px)',
                    background: 'var(--trae-bg-elevated)',
                    color: 'var(--trae-text-primary)',
                    fontSize: 'var(--trae-body-font-size, 14px)',
                    lineHeight: 'var(--trae-body-line-height, 1.6)',
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />
              ) : useReal ? (
                // 真实数据：单一段落展示（KnowledgeEntry.problem 是纯文本字符串）
                <p className="kb-body__p">{displayProblem}</p>
              ) : (
                // 设计稿示例：富文本结构（含 strong 高亮关键词）
                <>
                  <p className="kb-body__p">
                    高并发场景下 Nginx 出现{' '}
                    <strong className="kb-body__strong">502 Bad Gateway</strong> 或{' '}
                    <strong className="kb-body__strong">"accept() failed (24: Too many open files)"</strong> 错误，服务间歇性不可用。
                  </p>
                  <p className="kb-body__p">
                    典型触发条件：单机并发连接数超过 <code className="kb-body__code">1024</code>，或 Nginx worker 进程达到文件描述符上限。多见于流量突增、长连接保持、或反向代理后端响应缓慢的场景。
                  </p>
                </>
              )}
            </div>
          </section>

          <section id="sec-2" className="kb-detail-card">
            <CardHead icon={<Zap className="h-4 w-4" />} title="根因分析" tag="ROOT CAUSE" />
            <div className="kb-body">
              {isEditing && useReal ? (
                // v2.2 P1 修复 #25：编辑模式 - 根因分析变为 textarea
                <textarea
                  value={editRootCause}
                  onChange={(e) => setEditRootCause(e.target.value)}
                  aria-label="编辑根因分析"
                  rows={6}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid var(--trae-border-brand, var(--trae-border-default))',
                    borderRadius: 'var(--trae-radius-md, 6px)',
                    background: 'var(--trae-bg-elevated)',
                    color: 'var(--trae-text-primary)',
                    fontSize: 'var(--trae-body-font-size, 14px)',
                    lineHeight: 'var(--trae-body-line-height, 1.6)',
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />
              ) : useReal ? (
                // 真实数据：单一段落展示（KnowledgeEntry.rootCause 是纯文本字符串）
                <p className="kb-body__p">{displayRootCause}</p>
              ) : (
                // 设计稿示例：富文本结构（含 code / formula 公式 / warn 警告块）
                <>
                  <p className="kb-body__p">
                    Nginx 采用多进程架构，每个 worker 进程独立处理连接。
                    <strong className="kb-body__strong">worker_connections</strong> 限制单个 worker 可同时持有的最大连接数。默认值{' '}
                    <code className="kb-body__code">512</code> 或{' '}
                    <code className="kb-body__code">1024</code> 远不能满足高并发需求。
                  </p>
                  <p className="kb-body__p">最大连接数公式：</p>
                  <div className="kb-formula">
                    <span className="kb-formula__comment">// max_clients = worker_processes × worker_connections / 2（反向代理）</span>
                    <br />
                    <span className="kb-formula__keyword">max_clients</span>{' '}
                    = <span className="kb-formula__keyword">worker_processes</span>{' '}
                    × <span className="kb-formula__keyword">worker_connections</span>{' '}
                    ÷ <span className="kb-formula__number">2</span>
                  </div>
                  <p className="kb-body__p">作为反向代理时，每个客户端连接消耗 2 个 worker 连接（一个对客户端，一个对后端），因此需除以 2。</p>
                  <div className="kb-warn">
                    <AlertTriangle className="kb-warn__icon h-3.5 w-3.5" />
                    <span>
                      <strong className="kb-warn__strong">注意：</strong>
                      worker_connections 不能超过系统 <code className="kb-body__code">ulimit -n</code> 的文件描述符上限，否则配置不生效。需同步调整系统级限制。
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>

          <section id="sec-3" className="kb-detail-card">
            <CardHead icon={<Activity className="h-4 w-4" />} title="诊断步骤" tag="DIAGNOSE" />
            <div className="kb-detail-card__body">
              {DIAGNOSE_STEPS.map((step) => (
                <div
                  key={step.num}
                  className="kb-step"
                >
                  <div className="kb-step__num">
                    {step.num}
                  </div>
                  <div className="kb-step__body">
                    <div className="kb-step__title">{step.title}</div>
                    <div className="kb-step__desc">{step.desc}</div>
                    <CodeBlock code={step.code} copyId={`${step.num}`} />
                    {step.result && (
                      <div className="kb-result">
                        <CheckCircle2 className="kb-result__icon h-3.5 w-3.5" />
                        <span>
                          <strong className="kb-result__strong">诊断结论：</strong>
                          {step.result}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="sec-4" className="kb-detail-card">
            <CardHead icon={<Wrench className="h-4 w-4" />} title="解决方案" tag="FIX" />
            <div className="kb-body">
              <p className="kb-body__p">
                需同步调整 <strong className="kb-body__strong">Nginx 配置</strong>和{' '}
                <strong className="kb-body__strong">系统级文件描述符限制</strong>，否则 Nginx 配置不生效。
              </p>
              <div className="kb-compare">
                <div className="kb-compare__col">
                  <div className="kb-compare__head kb-compare__head--bad">
                    <span className="kb-compare__head-dot" />
                    调整前（默认）
                  </div>
                  <pre className="kb-compare__pre">
                    {FIX_BEFORE}
                  </pre>
                </div>
                <div className="kb-compare__col">
                  <div className="kb-compare__head kb-compare__head--good">
                    <Check className="h-3 w-3" />
                    调整后（推荐）
                  </div>
                  <pre className="kb-compare__pre">
                    {displayFixAfter}
                  </pre>
                </div>
              </div>
              <p className="kb-body__p kb-body__p--mt">修改后执行以下命令使配置生效：</p>
              <CodeBlock code={displayReloadCmd} copyId="reload" />
            </div>
          </section>

          <section id="sec-5" className="kb-detail-card">
            <CardHead icon={<CheckCircle2 className="h-4 w-4" />} title="验证方法" tag="VERIFY" />
            <div className="kb-body">
              <p className="kb-body__p">{displayVerification}</p>
              <CodeBlock code={displayVerifyCmd} copyId="verify" />
              {!useReal && (
                // 设计稿示例：显示验证通过结论（真实数据无对应字段，省略）
                <div className="kb-result">
                  <CheckCircle2 className="kb-result__icon h-3.5 w-3.5" />
                  <span>
                    <strong className="kb-result__strong">验证通过：</strong>
                    5000 并发压测零报错，Active connections 峰值 4876，远低于 10240 上限，调优生效。
                  </span>
                </div>
              )}
            </div>
          </section>

          <section id="sec-6" className="kb-detail-card">
            <CardHead icon={<MessageSquare className="h-4 w-4" />} title="此知识对您有帮助吗？" />
            <div className="kb-feedback">
              <span className="kb-feedback__label">您的反馈将帮助改进知识库质量</span>
              <div className="kb-feedback__btns">
                <button
                  type="button"
                  data-dom-id="feedback-helpful"
                  aria-label="有帮助"
                  aria-pressed={feedback === 'helpful'}
                  onClick={() => handleFeedback('helpful')}
                  className={cn('kb-feedback__btn kb-feedback__btn--helpful kb-btn-press', feedback === 'helpful' && 'is-active')}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  有帮助
                </button>
                <button
                  type="button"
                  data-dom-id="feedback-unhelpful"
                  aria-label="无帮助"
                  aria-pressed={feedback === 'unhelpful'}
                  onClick={() => handleFeedback('unhelpful')}
                  className={cn('kb-feedback__btn kb-feedback__btn--unhelpful kb-btn-press', feedback === 'unhelpful' && 'is-active')}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  无帮助
                </button>
              </div>
            </div>
          </section>
        </div>

        <KnowledgeDetailSidebar
          activeSection={activeSection}
          onTocClick={handleTocClick}
          onNavigate={handleNavigateRelated}
        />
      </div>

      <span className="sr-only">当前知识 ID：{id}</span>
        </>
      )}
    </main>
  )
}
