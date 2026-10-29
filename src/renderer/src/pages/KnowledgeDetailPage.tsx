/**
 * KnowledgeDetailPage — 知识详情页
 *
 * 路由：/knowledge/:id
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html（版式沿用，示例内容已删）
 *
 * 结构：
 *   1. PageHeader（全站唯一页头原语，必须是根节点第一个子节点）：标题就地改名 + 返回/编辑/保存/取消
 *   2. 元信息条（徽章行 + meta 行），随正文一起滚动
 *   3. 两栏布局：
 *      - 主内容按条目实际有的字段成节：问题描述 / 根因分析（教程为正文）/ 解决方案 / 验证方法
 *      - 右侧 sticky 侧栏：本页目录（与正文同源）/ 知识置信度 / 元信息
 *
 * data-dom-id 接入：
 *   - page-title（PageHeader 提供）
 *   - back-knowledge（返回）
 *   - edit-knowledge（编辑按钮）
 *   - copy-cmd-fix / copy-cmd-reload（命令代码块）
 *   - goto-section-N（目录跳转，N 随实际节数变化）
 *
 * 数据：只渲染 kbGet(id) 拿到的真实条目；拿不到（非 Electron / 条目不存在 / 查询失败）一律走诚实空态，
 *       不再有设计稿示例文章兜底（阶段 F4 删除）。
 * 视觉：页头走 @/ui 的 PageHeader（全站同一字号/位置/高度），正文沿用 var(--trae-*) token，
 *       全实色 hex 边框（背景 rgba 允许），shadow 用 var(--trae-shadow-card)
 * 无障碍：button type="button" + aria-label，prefers-reduced-motion 禁用按压动画
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, Clock,
  Edit3, Eye, Loader2, Save,
  Trash2, Wrench, X, Zap,
} from 'lucide-react'
import { CardHead, CodeBlock, KnowledgeDetailSidebar } from '@/components/knowledge-detail/v1'
import type { KnowledgeEntry } from '@shared/models'
import { Button, PageHeader, Spinner, TextArea, TextInput, confirmDialog } from '@/ui'
// v2.6：教程正文 markdown 渲染（复用工作台轻量安全渲染器，无 innerHTML）
import { MarkdownMessage } from '@/components/workbench/panels/MarkdownMessage'
import './KnowledgePage.css'

/** KnowledgeDetailPage — 知识详情页 */
export function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [activeSection, setActiveSection] = useState<string>('sec-1')
  /** 编辑按钮引用 —— Modal 关闭后焦点返回此按钮（无障碍） */
  const editButtonRef = useRef<HTMLButtonElement>(null)

  /** 按 URL :id 取一次条目（编辑保存后要拿回库里那一份，界面显示的答复不是本地猜的） */
  const fetchEntry = useCallback(async (): Promise<KnowledgeEntry | null> => {
    if (typeof window === 'undefined' || !window.electronAPI?.kbGet) return null
    return await window.electronAPI.kbGet(id ?? '')
  }, [id])

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
        const found = await fetchEntry()
        if (cancelled) return
        if (found) {
          setRealEntry(found)
        } else {
          setNotFound(true)
        }
      } catch (err) {
        if (cancelled) return
        const reason = err instanceof Error ? err.message : String(err)
        toast.error(`知识库加载失败：${reason}`)
        setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRealEntry()
    return () => { cancelled = true }
  }, [id, fetchEntry])

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
  /** 条目类型中文标签：页头副标题与侧栏元信息共用同一份判定 */
  const typeLabel = !realEntry
    ? '知识条目'
    : realEntry.type === 'incident_case'
      ? '故障案例'
      : realEntry.type === 'command_skill'
        ? '命令技能'
        : '教程'
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
  ]

  // ===== 事件处理 =====
  const handleBackKnowledge = () => navigate('/knowledge')

  /**
   * 进入编辑模式（v2.2 P1 修复 #25：真实实现，替代原 WIP Modal.confirm）
   *
   * 把当前真实数据复制到 editXxx 状态，作为就地编辑控件（页头 TextInput / 正文 TextArea）的初始值。
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
          toast.success('知识条目已保存')
        } else {
          toast.error('保存失败：主进程返回 false，请检查日志')
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        toast.error(`保存失败：${reason}`)
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
   * 删除这条知识（#203）
   *
   * 三种结果说三种话——主进程把"删掉了 / 本来就不在 / 数据库出错"分开回之后，
   * 界面就不许再把它们混成一句"已删除"。库被锁住时对用户说"这条已经不在了"是假话，
   * 而假话会教用户以为自己根本没建过这条知识。
   */
  const handleDelete = async () => {
    if (!realEntry || typeof window === 'undefined' || !window.electronAPI?.kbDelete) return
    const ok = await confirmDialog({
      title: '删除这条知识？',
      description: `「${realEntry.title}」会从知识库、全文索引和语义索引里一起删掉，删了找不回来。`,
      okText: '删除',
      cancelText: '先不删',
      danger: true,
    })
    if (!ok) return
    const result = await window.electronAPI.kbDelete(realEntry.id)
    if (result.kind === 'deleted') {
      toast.success('已删除')
      handleBackKnowledge()
      return
    }
    if (result.kind === 'not-found') {
      toast.info('这条已经不在了')
      handleBackKnowledge()
      return
    }
    toast.error(`没删掉：${result.message}`)
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
    <main className="flex h-full w-full flex-col bg-canvas">
      {/* ===== 页头（全站唯一 PageHeader，八个模块左上角对齐）===== */}
      <PageHeader
        icon={BookOpen}
        title={
          isEditing ? (
            // macOS 重命名式就地改标题：原"标题换成大号内联样式 textarea"已删除
            <TextInput
              autoFocus
              aria-label="条目标题"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="max-w-[420px]"
            />
          ) : (
            displayTitle || '知识条目'
          )
        }
        subtitle={displayId ? `${typeLabel} · ${displayId}` : typeLabel}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="md"
              data-dom-id="back-knowledge"
              aria-label="返回知识库"
              onClick={handleBackKnowledge}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回知识库
            </Button>
            {isEditing ? (
              <>
                <Button
                  type="button"
                  variant="solid"
                  size="md"
                  onClick={handleSave}
                  disabled={isSaving}
                  aria-label="保存"
                >
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {isSaving ? '保存中...' : '保存'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  aria-label="取消"
                >
                  <X className="h-3.5 w-3.5" />
                  取消
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="solid"
                size="md"
                ref={editButtonRef}
                data-dom-id="edit-knowledge"
                aria-label="编辑知识"
                onClick={handleEdit}
                disabled={!realEntry}
              >
                <Edit3 className="h-3.5 w-3.5" />
                编辑
              </Button>
            )}
            {!isEditing && realEntry && (
              <Button
                type="button"
                variant="outline"
                size="md"
                data-dom-id="delete-knowledge"
                aria-label="删除这条知识"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </Button>
            )}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* loading 占位：真实数据加载中时显示 Spinner（避免短暂空白） */}
        {loading && (
          <div className="flex justify-center py-20">
            <Spinner label="加载知识条目..." />
          </div>
        )}
        {!loading && notFound && (
          // v2.6 去假：条目不存在的诚实空态（替代原来的 KB-NGINX-014 假文章回退）
          // 返回入口在页头（back-knowledge），这里不再重复一个返回按钮
          <div className="flex flex-col items-center gap-3 py-20 text-ink-mute">
            <AlertTriangle className="size-8" />
            <p className="text-composer text-ink-dim">知识条目不存在或已删除（ID: {id ?? '未提供'}）</p>
          </div>
        )}
        {!loading && !notFound && (
          <>
            {/* 元信息条（徽章行 + meta 行）：标题已上提到 PageHeader，这里只留条目属性 */}
            <div className="flex flex-col gap-2.5 border-b border-line bg-panel px-6 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="kb-chip kb-chip--id">
                  {displayId}
                </span>
                {displayTags.map((tag) => (
                  <span key={tag} className="kb-chip kb-chip--tag">
                    {tag}
                  </span>
                ))}
                {/* AI 沉淀看 tags；「已验证」徽章已撤——它原来只看 successRate≥80，
                    而这个数在反馈模块整删后没有任何生产者（种子常量 0.9/0.95），
                    留着就是把出厂标注演成"这条被验证过" */}
                {displayTags.some((t) => t.toLowerCase().includes('ai')) && (
                  <span className="kb-chip kb-chip--ai">
                    AI 沉淀
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t border-line pt-2.5">
                <span className="kb-meta">
                  <Clock className="h-3 w-3" />
                  更新于 <strong className="kb-meta__strong">{displayUpdatedAt}</strong>
                </span>
                <span className="kb-meta__sep" />
                <span className="kb-meta">
                  <Eye className="h-3 w-3" />
                  <strong className="kb-meta__strong">{displayUseCount.toLocaleString()}</strong> 次阅读
                </span>
                {/* 「匹配 X%」这一格整删：它读的是 successRate，而这个数在反馈模块整删后
                    再没有任何生产者（种子条目是出厂常量，教程那格本来就是"阅读时长/60"的 hack）。
                    阅读次数是 kb:view 真自增的，留着。 */}
              </div>
            </div>

            <div className="kb-detail-layout">
              <div className="kb-detail-main">

                <section id="sec-1" className="kb-detail-card">
                  <CardHead icon={<Activity className="h-4 w-4" />} title="问题描述" tag="SYMPTOM" />
                  <div className="kb-detail-card__body kb-body">
                    {isEditing ? (
                      // v2.2 P1 修复 #25：编辑模式 - 问题描述就地编辑（原内联样式 textarea 换为 @/ui TextArea）
                      <TextArea
                        value={editProblem}
                        onChange={(e) => setEditProblem(e.target.value)}
                        aria-label="编辑问题描述"
                        rows={4}
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
                      // v2.2 P1 修复 #25：编辑模式 - 根因分析就地编辑（同上，换 @/ui TextArea）
                      <TextArea
                        value={editRootCause}
                        onChange={(e) => setEditRootCause(e.target.value)}
                        aria-label="编辑根因分析"
                        rows={6}
                      />
                    ) : isTutorial ? (
                      // v2.6：教程条目 —— 解析内部 JSON 渲染 markdown 正文 + 来源，不再吐原始 JSON
                      tutorialInfo && tutorialInfo.content ? (
                        <>
                          <MarkdownMessage content={tutorialInfo.content} />
                          {(tutorialInfo.sourceName || tutorialInfo.sourceUrl) && (
                            <p className="kb-body__p mt-3 text-sm text-ink-mute">
                              来源：{tutorialInfo.sourceName || '官方文档'}
                              {tutorialInfo.sourceLicense ? `（${tutorialInfo.sourceLicense}）` : ''}
                              {tutorialInfo.sourceUrl ? ` · ${tutorialInfo.sourceUrl}` : ''}
                              {tutorialInfo.readingTime > 0 ? ` · 预计阅读 ${tutorialInfo.readingTime} 分钟` : ''}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="kb-body__p text-ink-mute">教程正文解析失败，请在教程页查看完整内容</p>
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
              </div>

              {/* 侧栏置信度环不再喂 successRate：反馈票整删后这个数没有生产者，
                  画成「知识置信度 90%」就是拿出厂标注冒充实测（#134 同一族的第二次判决） */}
              <KnowledgeDetailSidebar
                activeSection={activeSection}
                onTocClick={handleTocClick}
                sections={sections}
                metaRows={[
                  { key: '知识 ID', val: displayId, mono: true },
                  { key: '类型', val: typeLabel },
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
      </div>
    </main>
  )
}
