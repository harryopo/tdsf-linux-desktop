/**
 * KnowledgeDetailPage — 知识详情
 *
 * 路由：/knowledge/:id
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html
 * - Header（返回 / 标题 / 编辑 + 5 chips + 5 meta）
 * - 两栏布局：左 main（6 张内容卡片）+ 右 sidebar（目录 / 置信度 / 元信息 / 关联知识）
 *
 * JS 交互：
 * - 目录点击：滚动到对应 section 并高亮当前项
 * - 编辑按钮：提示功能开发中（v1.0 复刻，v1.1 接入编辑弹窗）
 * - 分享按钮：切换"已复制"提示
 * - 反馈按钮：切换 helpful / unhelpful
 * - 代码块复制：mock（切换"已复制"）
 * - 关联知识点击：跳转 `/knowledge/:id`
 *
 * 数据接入（v0.7.0 Sprint 4.2）：
 * - 通过 useParams 获取 id
 * - 调用 `tutorial:get` 查单条教程（type='tutorial'）
 * - 或调用 `kb:export` 过滤找命令/案例（type='command_skill'/'incident_case'）
 * - 找不到时降级到 mock
 * - 加载中显示 loading 占位
 *
 * 子组件（拆分到 components/knowledge-detail/v1/）：
 * - detail-data：类型 + Mock 数据
 * - detail-parts：CodeBlock + CardHead
 * - KnowledgeDetailSidebar：右栏 4 张卡片
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowLeft, CheckCheck, CheckCircle2,
  Clock, Edit3, Eye, FileText, Loader2, MessageSquare, Share2, ThumbsDown, ThumbsUp,
  Wrench, Zap,
} from 'lucide-react'
import { Button } from '@/components/trae/Button'
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
import type { TutorialEntry } from '@shared/tutorial-types'

/** electronAPI 引用（preload 暴露） */
const api: {
  tutorialGet?: (id: string) => Promise<TutorialEntry | null>
  kbExport?: (type?: string) => Promise<KnowledgeEntry[]>
} | undefined =
  typeof window !== 'undefined' && (window as any).electronAPI
    ? (window as any).electronAPI
    : undefined

/**
 * KnowledgeDetailPage 主组件。
 */
export function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [activeSection, setActiveSection] = useState<string>('sec-1')
  const [shared, setShared] = useState(false)
  const [feedback, setFeedback] = useState<'helpful' | 'unhelpful' | null>(null)
  const [loading, setLoading] = useState(true)
  const [entry, setEntry] = useState<KnowledgeEntry | TutorialEntry | null>(null)
  const [dataSource, setDataSource] = useState<'mock' | 'real'>('mock')

  /** 加载单条数据（v0.7.0 Sprint 4.2） */
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!id) {
        setLoading(false)
        return
      }
      if (!api?.tutorialGet || !api?.kbExport) {
        setLoading(false)
        return
      }
      try {
        setLoading(true)
        // 1. 先查 tutorial（id 可能以 tutorial: 开头或直接是 tutorial id）
        const tutorial = await api.tutorialGet(id).catch(() => null)
        if (cancelled) return
        if (tutorial) {
          setEntry(tutorial)
          setDataSource('real')
          return
        }
        // 2. 退而求其次查 kb:export
        const all = await api.kbExport().catch(() => [])
        if (cancelled) return
        const found = all.find((k) => k.id === id)
        if (found) {
          setEntry(found)
          setDataSource('real')
        } else {
          setDataSource('mock')
        }
      } catch (err) {
        console.error('[KnowledgeDetailPage] 加载失败:', err)
        setDataSource('mock')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  /** 目录点击：滚动到对应 section + 设置激活态 */
  const handleTocClick = (target: string) => {
    setActiveSection(target)
    const el = document.getElementById(target)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  /** 返回知识库 */
  const handleBack = () => navigate('/knowledge')

  /**
   * 编辑按钮回调
   * v1.0 复刻：当前无编辑弹窗组件，提示用户功能开发中
   * v1.1+ 接入知识编辑弹窗
   */
  const handleEdit = () => {
    window.alert('编辑功能正在开发中，敬请期待 v1.1 版本接入知识编辑弹窗。')
  }

  /** 分享（mock 切换"已复制链接"） */
  const handleShare = () => {
    setShared(true)
    setTimeout(() => setShared(false), 1500)
  }

  /** 关联知识点击跳转 */
  const handleNavigateRelated = (targetId: string) => {
    navigate(`/knowledge/${targetId}`)
  }

  /** 当前展示的标题（真实数据优先） */
  const displayTitle =
    entry && 'title' in entry
      ? entry.title
      : 'Nginx worker_connections 调优指南'

  /** 提取 entry 的 problem/summary 字段（兼容两种类型） */
  const problemText = entry
    ? 'problem' in entry
      ? (entry as KnowledgeEntry).problem
      : (entry as TutorialEntry).summary
    : ''

  return (
    <main className="flex h-full w-full flex-col bg-[var(--trae-bg-base-default)]">
      {/* ===== Header（3 rows）===== */}
      <header className="border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-6 py-4">
        {/* row1: 返回 + 标题 + 编辑 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-base-tertiary)]"
            aria-label="返回知识库"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回知识库
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold leading-[26px] tracking-[-0.01em] text-[var(--trae-text-default)]">
              {displayTitle}
            </h1>
          </div>
          {/* 数据源 + 编辑 */}
          {dataSource === 'real' && (
            <span
              className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border px-2"
              style={{
                borderColor: 'var(--trae-status-success-default)',
                background: 'rgba(51,193,146,0.12)',
                color: 'var(--trae-status-success-default)',
                fontSize: 'var(--trae-body-xs-font-size)',
                fontWeight: 500
              }}
            >
              ● 真实数据
            </span>
          )}
          {loading && (
            <span
              className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border px-2"
              style={{
                borderColor: 'var(--trae-border-neutral-l1)',
                color: 'var(--trae-text-tertiary)',
                fontSize: 'var(--trae-body-xs-font-size)'
              }}
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中
            </span>
          )}
          <Button variant="brand" size="sm" onClick={handleEdit}>
            <Edit3 className="h-3.5 w-3.5" />
            编辑
          </Button>
        </div>

        {/* row2: 5 chips */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 font-mono text-[11px] font-medium text-[var(--trae-text-brand)]">
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
          <span className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] px-2 text-[11px] font-medium text-[var(--trae-status-success-default)]">
            <CheckCircle2 className="h-3 w-3" />
            已验证
          </span>
          <span className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[11px] font-medium text-[var(--trae-text-brand)]">
            AI 沉淀
          </span>
        </div>

        {/* row3: 5 meta + 分享按钮 */}
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
          <button
            type="button"
            onClick={handleShare}
            className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-2 text-[11px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            aria-label="分享"
          >
            {shared ? <CheckCheck className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
            {shared ? '已复制链接' : '分享'}
          </button>
        </div>
      </header>

      {/* ===== Two-column layout ===== */}
      <div className="flex flex-1 gap-5 overflow-y-auto px-6 py-5">
        {/* ===== Main content ===== */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* 0. 知识正文（v0.7.0 Sprint 4.2：动态真实数据，mock 不可见） */}
          {entry && (
            <>
              {/* 问题/摘要 section */}
              <section
                id="sec-0"
                className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
              >
                <CardHead
                  icon={<FileText className="h-4 w-4" />}
                  title="问题描述"
                  tag="FROM DB"
                />
                <div className="space-y-2 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
                  <p>{problemText}</p>
                  {'source' in entry && entry.source?.name && (
                    <p className="text-[12px] text-[var(--trae-text-tertiary)]">
                      来源：<strong className="font-medium text-[var(--trae-text-secondary)]">{entry.source.name}</strong>
                      {entry.source.license && (
                        <span className="ml-2">（{entry.source.license}）</span>
                      )}
                      {entry.source.url && (
                        <a
                          href={entry.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-[var(--trae-text-brand)] hover:underline"
                        >
                          查看原文 ↗
                        </a>
                      )}
                    </p>
                  )}
                </div>
              </section>

              {/* 根因 section（仅 KnowledgeEntry 有） */}
              {'rootCause' in entry && entry.rootCause && (
                <section
                  id="sec-rootcause"
                  className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                >
                  <CardHead icon={<Zap className="h-4 w-4" />} title="根因分析" tag="ROOT CAUSE" />
                  <div className="space-y-2 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
                    <p>{entry.rootCause}</p>
                  </div>
                </section>
              )}

              {/* 修复命令 section */}
              {'commands' in entry && entry.commands && entry.commands.length > 0 && (
                <section
                  id="sec-cmds"
                  className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                >
                  <CardHead icon={<Wrench className="h-4 w-4" />} title="修复命令" tag="COMMANDS" />
                  <div className="space-y-2 px-4 py-3.5">
                    {entry.commands.map((cmd, idx) => (
                      <div
                        key={idx}
                        className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)] px-3 py-2 font-mono text-[12px] leading-[20px] text-[var(--trae-text-default)]"
                      >
                        <span className="mr-2 text-[var(--trae-text-tertiary)]">$</span>
                        {cmd}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 教程内容 section（仅 TutorialEntry 有，content 为 markdown） */}
              {'content' in entry && entry.content && (
                <section
                  id="sec-content"
                  className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                >
                  <CardHead icon={<FileText className="h-4 w-4" />} title="教程正文" tag="CONTENT" />
                  <div className="px-4 py-3.5">
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-[22px] text-[var(--trae-text-secondary)]">
                      {entry.content}
                    </pre>
                  </div>
                </section>
              )}

              {/* 验证方法 section（仅 KnowledgeEntry 有） */}
              {'verification' in entry && entry.verification && (
                <section
                  id="sec-verify"
                  className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                >
                  <CardHead icon={<CheckCircle2 className="h-4 w-4" />} title="验证方法" tag="VERIFY" />
                  <div className="space-y-2 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
                    <p>{entry.verification}</p>
                  </div>
                </section>
              )}

              {/* 回滚命令 section（仅 KnowledgeEntry 有） */}
              {'rollbackCommands' in entry && entry.rollbackCommands && entry.rollbackCommands.length > 0 && (
                <section
                  id="sec-rollback"
                  className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-status-alert-default)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                >
                  <CardHead icon={<AlertTriangle className="h-4 w-4" />} title="回滚命令" tag="ROLLBACK" />
                  <div className="space-y-2 px-4 py-3.5">
                    {entry.rollbackCommands.map((cmd, idx) => (
                      <div
                        key={idx}
                        className="rounded-[var(--trae-radius-6)] border border-[var(--trae-status-alert-default)] bg-[var(--trae-bg-base-default)] px-3 py-2 font-mono text-[12px] leading-[20px] text-[var(--trae-text-default)]"
                      >
                        <span className="mr-2 text-[var(--trae-text-tertiary)]">$</span>
                        {cmd}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {/* 1. 问题描述 - mock fallback（仅在无真实数据时显示） */}
          {!entry && (
            <>
          <section
            id="sec-1"
            className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
          >
            <CardHead icon={<Activity className="h-4 w-4" />} title="问题描述" tag="SYMPTOM" />
            <div className="space-y-2 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
              <p>
                高并发场景下 Nginx 出现 <strong className="font-medium text-[var(--trae-text-default)]">502 Bad Gateway</strong> 或
                <strong className="font-medium text-[var(--trae-text-default)]"> "accept() failed (24: Too many open files)"</strong> 错误，服务间歇性不可用。
              </p>
              <p>
                典型触发条件：单机并发连接数超过 <code className="rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-1.5 py-px font-mono text-[12px] text-[var(--trae-code-value,#80BBFF)]">1024</code>，或 Nginx worker 进程达到文件描述符上限。多见于流量突增、长连接保持、或反向代理后端响应缓慢的场景。
              </p>
            </div>
          </section>

          {/* 2. 根因分析 */}
          <section
            id="sec-2"
            className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
          >
            <CardHead icon={<Zap className="h-4 w-4" />} title="根因分析" tag="ROOT CAUSE" />
            <div className="space-y-2 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
              <p>
                Nginx 采用多进程架构，每个 worker 进程独立处理连接。
                <strong className="font-medium text-[var(--trae-text-default)]">worker_connections</strong> 限制单个 worker 可同时持有的最大连接数。默认值
                <code className="rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-1.5 py-px font-mono text-[12px] text-[var(--trae-code-value,#80BBFF)]">512</code> 或
                <code className="rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-1.5 py-px font-mono text-[12px] text-[var(--trae-code-value,#80BBFF)]">1024</code> 远不能满足高并发需求。
              </p>
              <p>最大连接数公式：</p>
              <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)] px-4 py-3 font-mono text-[12px] leading-[20px]">
                <span className="text-[var(--trae-text-tertiary)]">// max_clients = worker_processes × worker_connections / 2（反向代理）</span>
                <br />
                <span className="text-[var(--trae-code-parameter,#82D99F)]">max_clients</span>{' '}
                = <span className="text-[var(--trae-code-parameter,#82D99F)]">worker_processes</span>{' '}
                × <span className="text-[var(--trae-code-parameter,#82D99F)]">worker_connections</span>{' '}
                ÷ <span className="text-[var(--trae-code-number,#F48CCA)]">2</span>
              </div>
              <p>作为反向代理时，每个客户端连接消耗 2 个 worker 连接（一个对客户端，一个对后端），因此需除以 2。</p>
              <div className="flex items-start gap-2 rounded-[var(--trae-radius-6)] border border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.08)] px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--trae-status-alert-default)]" />
                <span className="text-[12px] leading-[19px] text-[var(--trae-text-secondary)]">
                  <strong className="font-medium text-[var(--trae-text-default)]">注意：</strong>
                  worker_connections 不能超过系统 <code className="rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-1 py-px font-mono text-[11px] text-[var(--trae-code-value,#80BBFF)]">ulimit -n</code> 的文件描述符上限，否则配置不生效。需同步调整系统级限制。
                </span>
              </div>
            </div>
          </section>

          {/* 3. 诊断步骤 */}
          <section
            id="sec-3"
            className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
          >
            <CardHead icon={<Activity className="h-4 w-4" />} title="诊断步骤" tag="DIAGNOSE" />
            <div className="px-4 py-3.5">
              {DIAGNOSE_STEPS.map((step, idx) => (
                <div
                  key={step.num}
                  className={`flex gap-3 ${idx > 0 ? 'border-t border-[var(--trae-border-neutral-l1)] pt-3' : ''} ${idx < DIAGNOSE_STEPS.length - 1 ? 'pb-3' : ''}`}
                >
                  <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--trae-bg-brand)] text-[11px] font-semibold text-[var(--trae-text-onbrand)]">
                    {step.num}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[13px] font-medium text-[var(--trae-text-default)]">{step.title}</div>
                    <div className="mb-1.5 text-[12px] leading-[19px] text-[var(--trae-text-tertiary)]">{step.desc}</div>
                    <CodeBlock code={step.code} />
                    {step.result && (
                      <div className="mt-2 flex items-start gap-2 rounded-[var(--trae-radius-6)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.08)] px-3 py-2">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--trae-status-success-default)]" />
                        <span className="text-[12px] leading-[19px] text-[var(--trae-text-secondary)]">
                          <strong className="font-medium text-[var(--trae-text-default)]">诊断结论：</strong>
                          {step.result}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 4. 解决方案 */}
          <section
            id="sec-4"
            className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
          >
            <CardHead icon={<Wrench className="h-4 w-4" />} title="解决方案" tag="FIX" />
            <div className="space-y-3 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
              <p>
                需同步调整 <strong className="font-medium text-[var(--trae-text-default)]">Nginx 配置</strong>和
                <strong className="font-medium text-[var(--trae-text-default)]">系统级文件描述符限制</strong>，否则 Nginx 配置不生效。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
                  <div className="flex items-center gap-1.5 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-status-error-default)]">
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-error-default)]" />
                    调整前（默认）
                  </div>
                  <pre className="overflow-x-auto bg-[var(--trae-bg-base-default)] px-3 py-2 font-mono text-[11px] leading-[17px] text-[var(--trae-text-default)]">
                    {FIX_BEFORE}
                  </pre>
                </div>
                <div className="overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
                  <div className="flex items-center gap-1.5 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-status-success-default)]">
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-success-default)]" />
                    调整后（推荐）
                  </div>
                  <pre className="overflow-x-auto bg-[var(--trae-bg-base-default)] px-3 py-2 font-mono text-[11px] leading-[17px] text-[var(--trae-text-default)]">
                    {FIX_AFTER}
                  </pre>
                </div>
              </div>
              <p className="mt-3">修改后执行以下命令使配置生效：</p>
              <CodeBlock code={FIX_RELOAD_CMD} />
            </div>
          </section>

          {/* 5. 验证方法 */}
          <section
            id="sec-5"
            className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
          >
            <CardHead icon={<CheckCircle2 className="h-4 w-4" />} title="验证方法" tag="VERIFY" />
            <div className="space-y-2 px-4 py-3.5 text-[13px] leading-[21px] text-[var(--trae-text-secondary)]">
              <p>使用压测工具验证调优效果，确认连接数提升且无报错：</p>
              <CodeBlock code={VERIFY_CMD} />
              <div className="mt-2 flex items-start gap-2 rounded-[var(--trae-radius-6)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.08)] px-3 py-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--trae-status-success-default)]" />
                <span className="text-[12px] leading-[19px] text-[var(--trae-text-secondary)]">
                  <strong className="font-medium text-[var(--trae-text-default)]">验证通过：</strong>
                  5000 并发压测零报错，Active connections 峰值 4876，远低于 10240 上限，调优生效。
                </span>
              </div>
            </div>
          </section>
            </>
          )}

          {/* 6. 反馈区 */}
          <section
            id="sec-6"
            className="scroll-mt-4 overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
          >
            <CardHead icon={<MessageSquare className="h-4 w-4" />} title="此知识对您有帮助吗？" />
            <div className="flex flex-col items-start gap-3 px-4 py-4">
              <span className="text-[12px] text-[var(--trae-text-tertiary)]">您的反馈将帮助改进知识库质量</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFeedback('helpful')}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border px-3 text-[12px] font-medium transition-colors ${
                    feedback === 'helpful'
                      ? 'border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-[var(--trae-status-success-default)]'
                      : 'border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]'
                  }`}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  有帮助
                </button>
                <button
                  type="button"
                  onClick={() => setFeedback('unhelpful')}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border px-3 text-[12px] font-medium transition-colors ${
                    feedback === 'unhelpful'
                      ? 'border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] text-[var(--trae-status-error-default)]'
                      : 'border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]'
                  }`}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  无帮助
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* ===== Sidebar ===== */}
        <KnowledgeDetailSidebar
          activeSection={activeSection}
          onTocClick={handleTocClick}
          onNavigate={handleNavigateRelated}
        />
      </div>

      {/* id 提示（用于 useParams 显示，不显眼） */}
      <span className="sr-only">当前知识 ID：{id}</span>
    </main>
  )
}
