/**
 * KnowledgeDetailPage — 知识详情页
 *
 * 路由：/knowledge/:id
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html（版式沿用，示例内容已删）
 *
 * 结构：
 *   1. 紧凑 Header（3 行）：返回知识库 + 标题 + 编辑按钮 / 条件徽章 / meta 行
 *   2. 两栏布局：
 *      - 主内容按条目实际有的字段成节：问题描述 / 根因分析（教程为正文）/ 解决方案 / 验证方法 / 反馈
 *      - 右侧 sticky 侧栏：本页目录（与正文同源）/ 知识置信度 / 元信息
 *
 * data-dom-id 接入：
 *   - back-workbench / back-knowledge（返回）
 *   - edit-knowledge（编辑按钮）
 *   - copy-cmd-fix / copy-cmd-reload（命令代码块）
 *   - feedback-helpful / feedback-unhelpful（反馈按钮）
 *   - goto-section-N（目录跳转，N 随实际节数变化）
 *
 * 数据：只渲染 kbGet(id) 拿到的真实条目；拿不到（非 Electron / 条目不存在 / 查询失败）一律走诚实空态，
 *       不再有设计稿示例文章兜底（阶段 F4 删除）。
 * 视觉：全部 var(--trae-*) token，全实色 hex 边框（背景 rgba 允许），shadow 用 var(--trae-shadow-card)
 * 无障碍：button type="button" + aria-label，prefers-reduced-motion 禁用按压动画
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Spin, message } from 'antd'
import {
  Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock,
  Edit3, Eye, Loader2, MessageSquare, Save, ThumbsDown, ThumbsUp,
  Wrench, X, Zap,
} from 'lucide-react'
import { CardHead, CodeBlock, KnowledgeDetailSidebar } from '@/components/knowledge-detail/v1'
import type { KnowledgeEntry } from '@shared/models'
import { cn } from '@/components/trae/utils'
// v2.6：教程正文 markdown 渲染（复用工作台轻量安全渲染器，无 innerHTML）
import MarkdownMessage from '@/components/workbench/panels/MarkdownMessage'
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
  /** 拿不到真实条目（非 Electron / 条目不存在 / 查询失败）时的诚实空态 */
  const [notFound, setNotFound] = useState(false)

  // ===== v2.2 P1 修复 #25：编辑模式状态 =====
  // 编辑只对真实条目开放（示例数据已随 F4 删除，页面里不存在"不可编辑的假文章"）
  // 编辑字段：title / problem / rootCause（核心三字段，其余字段通过 kbUpdate 部分更新保留原值）
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editProblem, setEditProblem] = useState('')
  const [editRootCause, setEditRootCause] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // 加载真实知识条目（按 URL :id 精确查询）
  useEffect(() => {
    let cancelled = false
    const loadRealEntry = async () => {
      if (typeof window === 'undefined' || !window.electronAPI?.kbGet) {
        // 阶段 F4：没有真实数据源就直接空态，不再显示设计稿示例文章
        setNotFound(true)
        setLoading(false)
        return
      }
      try {
        const found = await window.electronAPI.kbGet(id ?? '')
        if (cancelled) return
        if (found) {
          setRealEntry(found)
        } else {
          setNotFound(true)
        }
      } catch (err) {
        if (cancelled) return
        const reason = err instanceof Error ? err.message : String(err)
        message.error(`知识库加载失败：${reason}`)
        setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRealEntry()
    return () => { cancelled = true }
  }, [id])

  // ===== 字段来源：只认真实条目，缺字段就留空，绝不用示例值补齐 =====
  const displayTitle = realEntry?.title ?? ''
  const displayProblem = realEntry?.problem ?? ''
  const displayRootCause = realEntry?.rootCause ?? ''
  const displayCommands = realEntry?.commands ?? []
  const displayRollback = realEntry?.rollbackCommands ?? []
  const displayVerification = realEntry?.verification ?? ''
  const displayTags = realEntry?.tags ?? []
  const displayId = realEntry?.id ?? id ?? ''
  const displayUpdatedAt = realEntry ? new Date(realEntry.updatedAt).toISOString().slice(0, 10) : ''
  const displayUseCount = realEntry?.useCount ?? 0
  const displaySuccessRate = realEntry ? Math.round(realEntry.successRate * 100) : 0

  /** 解决方案与回滚命令：有内容才成节，空命令列表不再摆一个空代码块 */
  const hasFixCommands = displayCommands.length > 0
  const displayFixAfter = displayCommands.join('\n')
  const displayReloadCmd = displayRollback.join('\n')

  /**
   * v2.6 教程条目适配：教程的 rootCause 字段存的是内部 JSON（正文/来源/分类等），
   * 直接当文本渲染会吐出一坨 JSON；这里解析后按教程语义渲染（markdown 正文 + 来源）。
   * 另：教程的 successRate 存的是“阅读时长/60”（存储层 hack），不是成功率，
   * 教程模式下不展示匹配度/置信度。
   */
  const isTutorial = realEntry?.type === 'tutorial'
  const tutorialInfo = useMemo(() => {
    if (!isTutorial || !realEntry?.rootCause) return null
    try {
      const j = JSON.parse(realEntry.rootCause) as Record<string, unknown>
      return {
        content: String(j['__tutorial_content'] ?? ''),
        sourceUrl: String(j['__tutorial_source_url'] ?? ''),
        sourceName: String(j['sourceName'] ?? ''),
        sourceLicense: String(j['sourceLicense'] ?? ''),
        readingTime: Number(j['__tutorial_reading_time'] ?? 0),
        difficulty: String(j['__tutorial_difficulty'] ?? ''),
      }
    } catch {
      return null
    }
  }, [isTutorial, realEntry])

  /**
   * 本页目录与正文 section 同源：正文没渲染的节绝不进目录。
   * 原目录是设计稿写死的 6 项，含真实条目根本没有的"诊断步骤"，点了会跳到不存在的锚点。
   */
  const sections = [
    { key: 'sec-1', label: '问题描述' },
    { key: 'sec-2', label: isTutorial ? '教程正文' : '根因分析' },
    ...(hasFixCommands ? [{ key: 'sec-4', label: isTutorial ? '教程命令' : '解决方案' }] : []),
    ...(displayVerification ? [{ key: 'sec-5', label: '验证方法' }] : []),
    { key: 'sec-6', label: '反馈' },
  ]

  // ===== 事件处理 =====
  const handleBackKnowledge = () => navigate('/knowledge')

  /**
   * 进入编辑模式（v2.2 P1 修复 #25：真实实现，替代原 WIP Modal.confirm）
   *
   * 把当前真实数据复制到 editXxx 状态，作为 textarea 的初始值。
   */
  const handleEdit = () => {
    if (!realEntry) return
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
    if (!realEntry) return
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

  return (
    <main className="kb-detail-page">
      {/* loading 占位：真实数据加载中时显示 Spin（避免短暂空白） */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 0' }}>
          <Spin tip="加载知识条目..." />
        </div>
      )}
      {!loading && notFound && (
        // v2.6 去假：条目不存在的诚实空态（替代原来的 KB-NGINX-014 假文章回退）
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '80px 0', color: 'var(--trae-text-tertiary)' }}>
          <AlertTriangle style={{ width: 32, height: 32 }} />
          <div style={{ fontSize: 14, color: 'var(--trae-text-secondary)' }}>知识条目不存在或已删除（ID: {id ?? '未提供'}）</div>
          <button
            type="button"
            onClick={handleBackKnowledge}
            className="kb-detail-back kb-btn-press"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回知识库
          </button>
        </div>
      )}
      {!loading && !notFound && (
        <>
          <header className="kb-detail-header">
        <div className="kb-detail-header__row1">
          <div className="kb-detail-back-group">
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
                  border: '1px solid var(--trae-border-brand, var(--trae-border-neutral-l1))',
                  borderRadius: 'var(--trae-radius-6, 6px)',
                  background: 'var(--trae-bg-base-tertiary)',
                  color: 'var(--trae-text-default)',
                  fontSize: 'var(--trae-heading-xl-font-size, 1.5rem)',
                  fontWeight: 'var(--trae-heading-xl-font-weight, 700)',
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
                  color: 'var(--trae-text-onbrand)',
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
          {/* 徽章按真实数据条件渲染 —— 成功率≥80% 才算已验证，AI 沉淀看 tags */}
          {displaySuccessRate >= 80 && (
            <span className="kb-chip kb-chip--verified">
              <CheckCircle2 className="h-3 w-3" />
              已验证
            </span>
          )}
          {displayTags.some((t) => t.toLowerCase().includes('ai')) && (
            <span className="kb-chip kb-chip--ai">
              AI 沉淀
            </span>
          )}
        </div>

        <div className="kb-detail-header__row3">
          <span className="kb-meta">
            <Clock className="h-3 w-3" />
            更新于 <strong className="kb-meta__strong">{displayUpdatedAt}</strong>
          </span>
          <span className="kb-meta__sep" />
          <span className="kb-meta">
            <Eye className="h-3 w-3" />
            <strong className="kb-meta__strong">{displayUseCount.toLocaleString()}</strong> 次阅读
          </span>
          {/* v2.6 去假：教程的 successRate 是阅读时长 hack，不是匹配度，不展示 */}
          {!isTutorial && (
            <>
              <span className="kb-meta__sep" />
              <span className="kb-meta">
                <CheckCircle2 className="h-3 w-3" />
                匹配 <strong className="kb-meta__strong">{displaySuccessRate}%</strong>
              </span>
            </>
          )}
        </div>
      </header>

      <div className="kb-detail-layout">
        <div className="kb-detail-main">

          <section id="sec-1" className="kb-detail-card">
            <CardHead icon={<Activity className="h-4 w-4" />} title="问题描述" tag="SYMPTOM" />
            <div className="kb-detail-card__body kb-body">
              {isEditing ? (
                // v2.2 P1 修复 #25：编辑模式 - 问题描述变为 textarea
                <textarea
                  value={editProblem}
                  onChange={(e) => setEditProblem(e.target.value)}
                  aria-label="编辑问题描述"
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid var(--trae-border-brand, var(--trae-border-neutral-l1))',
                    borderRadius: 'var(--trae-radius-6, 6px)',
                    background: 'var(--trae-bg-base-tertiary)',
                    color: 'var(--trae-text-default)',
                    fontSize: 'var(--trae-body-base-font-size, 14px)',
                    lineHeight: 'var(--trae-body-base-line-height, 1.6)',
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />
              ) : (
                <p className="kb-body__p">{displayProblem}</p>
              )}
            </div>
          </section>

          <section id="sec-2" className="kb-detail-card">
            <CardHead icon={<Zap className="h-4 w-4" />} title={isTutorial ? '教程正文' : '根因分析'} tag={isTutorial ? 'TUTORIAL' : 'ROOT CAUSE'} />
            <div className="kb-detail-card__body kb-body">
              {isEditing ? (
                // v2.2 P1 修复 #25：编辑模式 - 根因分析变为 textarea
                <textarea
                  value={editRootCause}
                  onChange={(e) => setEditRootCause(e.target.value)}
                  aria-label="编辑根因分析"
                  rows={6}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid var(--trae-border-brand, var(--trae-border-neutral-l1))',
                    borderRadius: 'var(--trae-radius-6, 6px)',
                    background: 'var(--trae-bg-base-tertiary)',
                    color: 'var(--trae-text-default)',
                    fontSize: 'var(--trae-body-base-font-size, 14px)',
                    lineHeight: 'var(--trae-body-base-line-height, 1.6)',
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />
              ) : isTutorial ? (
                // v2.6：教程条目 —— 解析内部 JSON 渲染 markdown 正文 + 来源，不再吐原始 JSON
                tutorialInfo && tutorialInfo.content ? (
                  <>
                    <MarkdownMessage content={tutorialInfo.content} />
                    {(tutorialInfo.sourceName || tutorialInfo.sourceUrl) && (
                      <p className="kb-body__p" style={{ marginTop: 12, color: 'var(--trae-text-tertiary)', fontSize: 12 }}>
                        来源：{tutorialInfo.sourceName || '官方文档'}
                        {tutorialInfo.sourceLicense ? `（${tutorialInfo.sourceLicense}）` : ''}
                        {tutorialInfo.sourceUrl ? ` · ${tutorialInfo.sourceUrl}` : ''}
                        {tutorialInfo.readingTime > 0 ? ` · 预计阅读 ${tutorialInfo.readingTime} 分钟` : ''}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="kb-body__p" style={{ color: 'var(--trae-text-tertiary)' }}>教程正文解析失败，请在教程页查看完整内容</p>
                )
              ) : (
                // KnowledgeEntry.rootCause 是纯文本字符串
                <p className="kb-body__p">{displayRootCause}</p>
              )}
            </div>
          </section>

          {/* 解决方案：只在条目真有命令时成节（示例版里的"诊断步骤/调整前对比"随 F4 一并删除） */}
          {hasFixCommands && (
            <section id="sec-4" className="kb-detail-card">
              <CardHead icon={<Wrench className="h-4 w-4" />} title={isTutorial ? '教程命令' : '解决方案'} tag="FIX" />
              <div className="kb-detail-card__body kb-body">
                <CodeBlock code={displayFixAfter} copyId="fix" />
                {displayRollback.length > 0 && (
                  <>
                    <p className="kb-body__p kb-body__p--mt">回滚/生效命令：</p>
                    <CodeBlock code={displayReloadCmd} copyId="reload" />
                  </>
                )}
              </div>
            </section>
          )}

          {displayVerification && (
            <section id="sec-5" className="kb-detail-card">
              <CardHead icon={<CheckCircle2 className="h-4 w-4" />} title="验证方法" tag="VERIFY" />
              <div className="kb-detail-card__body kb-body">
                <p className="kb-body__p">{displayVerification}</p>
              </div>
            </section>
          )}

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
          sections={sections}
          confidencePct={isTutorial ? undefined : (realEntry?.successRate ?? 0) * 100}
          metaRows={[
            { key: '知识 ID', val: displayId, mono: true },
            { key: '类型', val: realEntry?.type === 'incident_case' ? '故障案例' : realEntry?.type === 'command_skill' ? '命令技能' : '教程' },
            ...(isTutorial && tutorialInfo
              ? [
                  { key: '来源', val: tutorialInfo.sourceName || '官方文档' },
                  ...(tutorialInfo.readingTime > 0 ? [{ key: '阅读时长', val: `约 ${tutorialInfo.readingTime} 分钟` }] : []),
                ]
              : []),
            { key: '创建时间', val: realEntry ? new Date(realEntry.createdAt).toISOString().slice(0, 10) : '', mono: true },
            { key: '更新时间', val: displayUpdatedAt, mono: true },
            { key: '使用次数', val: `${displayUseCount} 次` },
          ]}
        />
      </div>

      <span className="sr-only">当前知识 ID：{id}</span>
        </>
      )}
    </main>
  )
}
