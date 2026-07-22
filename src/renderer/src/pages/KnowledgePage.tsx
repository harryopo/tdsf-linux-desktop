/**
 * KnowledgePage — 运维知识库页（1:1 复刻 knowledge.html 设计稿）
 *
 * 路由：/knowledge
 * 设计稿：tdsf-linux-redesign/pages/knowledge.html
 * Spec: build-runnable-tdsf-from-design · Task 2.8
 *
 * 结构（4 section，1:1 对齐设计稿）：
 *   1. Page Header：layers 图标 + 标题"运维知识库" + 副标题 + 返回工作台按钮
 *   2. 搜索栏：搜索框 + AI检索按钮 + 8 个分类标签（all/nginx/mysql/docker/network/security/shell/systemd）
 *   3. 两栏布局：
 *      - 左：5 个推荐知识卡片（标题 + 匹配度 + 摘要 + 标签/时间/浏览量/查看详情）
 *      - 右：热门知识 Top5 + 最近浏览 3 项
 *   4. AI 知识沉淀：已收录 1,247 条 / 本周新增 23 条 / AI 贡献率 68% + 贡献知识按钮
 *
 * 数据：严格使用设计稿 knowledge.html 示例数据（5 卡片 + 5 热门 + 3 最近 + 贡献统计）
 * 视觉：全部 var(--trae-*) token，无硬编码 hex/rgba
 * 无障碍：button type + aria-label/aria-pressed；li role=button + tabIndex + onKeyDown；Modal role=dialog + aria-modal + ESC 关闭 + 焦点管理；prefers-reduced-motion 禁用按压动画
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import {
  Layers, ArrowLeft, Search, Sparkles, Clock, Eye,
  ArrowUpRight, Star, FileText, Plus, X, Check,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import type { KnowledgeEntry, KnowledgeType } from '@shared/models'
import './KnowledgePage.css'

// ==================== 类型定义 ====================

type KnowledgeCategory = 'all' | 'nginx' | 'mysql' | 'docker' | 'network' | 'security' | 'shell' | 'systemd'

interface KnowledgeItem {
  id: string
  title: string
  summary: string
  category: Exclude<KnowledgeCategory, 'all'>
  updatedAt: string
  views: string
  matchScore: number
}

interface HotItem { rank: number; title: string; views: string; id: string }
interface RecentItem { title: string; time: string; id: string }

// ==================== 静态示例数据（1:1 来自设计稿 knowledge.html） ====================

const CATEGORIES: { id: KnowledgeCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'nginx', label: 'nginx' },
  { id: 'mysql', label: 'mysql' },
  { id: 'docker', label: 'docker' },
  { id: 'network', label: 'network' },
  { id: 'security', label: 'security' },
  { id: 'shell', label: 'shell' },
  { id: 'systemd', label: 'systemd' },
]

const KNOWLEDGE_ITEMS: KnowledgeItem[] = [
  { id: 'KB-NGINX-014', title: 'Nginx worker_connections 调优指南', summary: '当worker_connections达到上限时,请求将排队等待,响应延迟急剧上升。本文详解worker_processes与worker_connections的协同调优,含压力测试数据。', category: 'nginx', updatedAt: '2天前', views: '1.2k', matchScore: 98 },
  { id: 'KB-MYSQL-007', title: 'MySQL连接数过多的排查与解决', summary: 'SHOW PROCESSLIST查看活跃连接,调整max_connections与wait_timeout,定位慢查询与长事务,释放被占用的连接池资源。', category: 'mysql', updatedAt: '5天前', views: '890', matchScore: 95 },
  { id: 'KB-SHELL-021', title: 'Linux磁盘空间满的应急处理', summary: '使用du和find定位大文件,清理日志、临时文件与孤立数据,扩展分区或挂载新盘,避免服务因磁盘写满而崩溃。', category: 'shell', updatedAt: '1周前', views: '2.1k', matchScore: 92 },
  { id: 'KB-DOCKER-003', title: 'Docker容器日志清理方案', summary: 'docker system prune清理无用镜像和日志,配置log-rotate与max-size限制,持久化日志到外部采集系统。', category: 'docker', updatedAt: '3天前', views: '670', matchScore: 88 },
  { id: 'KB-SEC-009', title: 'SSH安全加固最佳实践', summary: '禁用root登录、密钥认证替代密码、修改默认端口、配置fail2ban防暴力破解,构建最小化暴露面。', category: 'security', updatedAt: '1周前', views: '1.5k', matchScore: 85 },
]

const HOT_ITEMS: HotItem[] = [
  { rank: 1, title: 'P99延迟优化实战', views: '4.2k', id: 'KB-NGINX-014' },
  { rank: 2, title: '系统巡检脚本大全', views: '3.8k', id: 'KB-SYS-005' },
  { rank: 3, title: 'iptables防火墙配置', views: '3.1k', id: 'KB-NET-011' },
  { rank: 4, title: 'Cron定时任务指南', views: '2.7k', id: 'KB-SHELL-021' },
  { rank: 5, title: '内存泄漏排查', views: '2.3k', id: 'KB-MYSQL-007' },
]

const RECENT_ITEMS: RecentItem[] = [
  { title: 'Nginx日志分析', time: '3小时前', id: 'KB-NGINX-021' },
  { title: 'CPU负载高排查', time: '昨天', id: 'KB-NGINX-014' },
  { title: 'systemd服务管理', time: '2天前', id: 'KB-SYS-005' },
]

const CONTRIBUTION_STATS: { label: string; value: string; brand: boolean }[] = [
  { label: '已收录', value: '1,247 条', brand: false },
  { label: '本周新增', value: '23 条', brand: false },
  { label: 'AI贡献率', value: '68%', brand: true },
]

// ==================== 主组件 ====================

/** KnowledgePage — 运维知识库页 */
export function KnowledgePage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<KnowledgeCategory>('all')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // —— 贡献知识 Modal 状态 ——
  const [showContributeModal, setShowContributeModal] = useState(false)
  const [contributeSubmitted, setContributeSubmitted] = useState(false)
  const [contributeForm, setContributeForm] = useState({
    title: '',
    category: 'nginx' as Exclude<KnowledgeCategory, 'all'>,
    summary: '',
  })
  const contributeTriggerRef = useRef<HTMLButtonElement>(null)
  const contributeTitleInputRef = useRef<HTMLInputElement>(null)

  const handleBack = () => navigate('/workbench')
  const handleOpenKnowledge = (id: string) => navigate(`/knowledge/${id}`)
  const handleAiSearchFocus = () => searchInputRef.current?.focus()

  /** 打开贡献知识 Modal：重置表单 + 切换到表单态 */
  const handleContribute = () => {
    setContributeSubmitted(false)
    setContributeForm({ title: '', category: 'nginx', summary: '' })
    setShowContributeModal(true)
  }

  /** 关闭 Modal：清状态 + 焦点返回触发按钮（WAI-ARIA Dialog 模式） */
  const handleCloseContributeModal = () => {
    setShowContributeModal(false)
    setContributeSubmitted(false)
    requestAnimationFrame(() => contributeTriggerRef.current?.focus())
  }

  /** 提交贡献（v1.0 P1 接入 kbAdd IPC 真实写入知识库） */
  const handleSubmitContribute = async () => {
    const title = contributeForm.title.trim()
    const summary = contributeForm.summary.trim()
    if (!title || !summary) return

    // WIP: 非 Electron 环境降级为本地演示（CLAUDE.md A4 诚实标注）
    if (typeof window === 'undefined' || !window.electronAPI?.kbAdd) {
      message.warning('当前环境不支持贡献知识（非 Electron 环境），已切换到演示模式')
      setContributeSubmitted(true)
      return
    }

    // 显示提交中状态（禁用按钮 + 提示用户等待）
    const hide = message.loading('正在提交知识...', 0)
    try {
      // 构造 KnowledgeEntry 实例
      // - id：使用时间戳 + 随机后缀避免冲突
      // - type：用户贡献默认 'incident_case'（事件案例）
      // - problem：使用 summary 作为问题描述
      // - commands/rollbackCommands：空数组（用户可在编辑界面补充）
      // - keywords/tags：从分类生成
      // - successRate/useCount：初始 0
      // - createdAt/updatedAt：当前时间戳
      const now = Date.now()
      const randomSuffix = Math.random().toString(36).slice(2, 6).toUpperCase()
      const newEntry: KnowledgeEntry = {
        id: `KB-USER-${now.toString(36).toUpperCase()}-${randomSuffix}`,
        type: 'incident_case' as KnowledgeType,
        title,
        problem: summary,
        commands: [],
        keywords: [contributeForm.category],
        tags: [contributeForm.category, '用户贡献'],
        successRate: 0,
        useCount: 0,
        createdAt: now,
        updatedAt: now,
      }

      const success = await window.electronAPI.kbAdd(newEntry)
      hide()
      if (success) {
        message.success('知识已成功贡献到知识库')
        setContributeSubmitted(true)
      } else {
        message.error('知识库写入失败（kbAdd 返回 false）')
      }
    } catch (err) {
      hide()
      const reason = err instanceof Error ? err.message : String(err)
      message.error(`知识贡献失败：${reason}`)
    }
  }

  /** ESC 关闭 Modal + 打开时聚焦标题输入框（焦点管理） */
  useEffect(() => {
    if (!showContributeModal) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowContributeModal(false)
        setContributeSubmitted(false)
        requestAnimationFrame(() => contributeTriggerRef.current?.focus())
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    requestAnimationFrame(() => contributeTitleInputRef.current?.focus())
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showContributeModal])

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return KNOWLEDGE_ITEMS.filter((item) => {
      const catMatch = activeCategory === 'all' || item.category === activeCategory
      const searchMatch = q === '' || item.title.toLowerCase().includes(q) || item.summary.toLowerCase().includes(q)
      return catMatch && searchMatch
    })
  }, [searchQuery, activeCategory])

  return (
    <main className="kb-page">
      <div className="kb-container">

        {/* ====== 1. Page Header ====== */}
        <header className="kb-header">
          <div className="kb-header__main">
            <div className="kb-header__title-row">
              <Layers size={26} strokeWidth={2} style={{ color: 'var(--trae-icon-brand)' }} />
              <h1 className="kb-header__title">运维知识库</h1>
            </div>
            <p className="kb-header__subtitle">AI驱动的运维知识检索与沉淀</p>
          </div>
          <button type="button" data-dom-id="back-workbench" aria-label="返回工作台" onClick={handleBack} className="kb-back-btn kb-btn-press">
            <ArrowLeft size={14} style={{ color: 'var(--trae-icon-default)' }} />
            <span>返回工作台</span>
          </button>
        </header>

        {/* ====== 2. Search Bar ====== */}
        <div className="kb-search-bar">
          {/* 搜索输入框 + AI检索按钮 */}
          <div className="kb-search-row">
            <div className="kb-search-wrapper">
              <Search size={16} className="shrink-0" style={{ color: 'var(--trae-icon-secondary)' }} />
              <input
                ref={searchInputRef}
                type="text"
                data-dom-id="search-knowledge"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索知识、故障、解决方案..."
                aria-label="搜索知识"
                className="kb-search-input"
              />
            </div>
            <button type="button" aria-label="AI检索" onClick={handleAiSearchFocus} className="kb-ai-search-btn kb-btn-press">
              <Sparkles size={16} style={{ color: 'var(--trae-icon-onbrand)' }} />
              <span>AI检索</span>
            </button>
          </div>
          {/* 分类标签栏 */}
          <div className="kb-cat-bar kb-no-scrollbar">
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id
              return (
                <button key={cat.id} type="button" onClick={() => setActiveCategory(cat.id)} aria-pressed={active} className={cn('kb-cat-btn kb-btn-press', active && 'is-active')}>
                  {cat.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ====== 3. Two-column Layout ====== */}
        <div className="kb-layout">
          {/* 左栏：知识卡片列表 */}
          <div className="kb-list">
            {filteredItems.length === 0 ? (
              <div className="kb-empty">未找到匹配的知识条目</div>
            ) : (
              filteredItems.map((item) => (
                <article key={item.id} className="kb-card">
                  <div className="kb-card__head">
                    <h3 className="kb-card__title">{item.title}</h3>
                    <span className="kb-card__match">{item.matchScore}%匹配</span>
                  </div>
                  <p className="kb-card__summary">{item.summary}</p>
                  <div className="kb-card__meta">
                    <span className="kb-cat-tag">{item.category}</span>
                    <span className="kb-meta-time">
                      <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                      {item.updatedAt}
                    </span>
                    <span className="kb-meta-views">
                      <Eye size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                      <span className="kb-meta-views__num">{item.views}</span>
                    </span>
                    <button type="button" data-dom-id={`goto-knowledge-${item.id}`} aria-label={`查看详情：${item.title}`} onClick={() => handleOpenKnowledge(item.id)} className="kb-view-link kb-btn-press">
                      查看详情
                      <ArrowUpRight size={12} style={{ color: 'var(--trae-icon-brand)' }} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          {/* 右栏：侧边栏 280px */}
          <aside className="kb-sidebar">
            {/* 热门知识 */}
            <section className="kb-side-card">
              <div className="kb-side-card__head">
                <Star size={16} style={{ color: 'var(--trae-icon-brand)' }} />
                <h2 className="kb-side-card__title">热门知识</h2>
              </div>
              <ol className="kb-hot-list">
                {HOT_ITEMS.map((hot) => (
                  <li
                    key={hot.id}
                    data-dom-id={`goto-hot-knowledge-${hot.id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`查看热门知识：${hot.title}，浏览量 ${hot.views}`}
                    onClick={() => handleOpenKnowledge(hot.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleOpenKnowledge(hot.id)
                      }
                    }}
                    className="kb-hot-item"
                  >
                    <span className="kb-hot-rank">{hot.rank}</span>
                    <span className="kb-hot-title">{hot.title}</span>
                    <span className="kb-hot-views">{hot.views}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* 最近浏览 */}
            <section className="kb-side-card">
              <div className="kb-side-card__head">
                <Clock size={16} style={{ color: 'var(--trae-icon-brand)' }} />
                <h2 className="kb-side-card__title">最近浏览</h2>
              </div>
              <ul className="kb-recent-list">
                {RECENT_ITEMS.map((recent) => (
                  <li
                    key={recent.id}
                    data-dom-id={`goto-recent-knowledge-${recent.id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`查看最近浏览：${recent.title}，${recent.time}`}
                    onClick={() => handleOpenKnowledge(recent.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleOpenKnowledge(recent.id)
                      }
                    }}
                    className="kb-recent-item"
                  >
                    <FileText size={14} className="shrink-0" style={{ color: 'var(--trae-icon-secondary)' }} />
                    <span className="kb-recent-title">{recent.title}</span>
                    <span className="kb-recent-time">{recent.time}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        {/* ====== 4. AI 知识沉淀 ====== */}
        <section className="kb-contribution">
          <div className="kb-contribution__main">
            <div className="kb-contribution__title-row">
              <Sparkles size={16} style={{ color: 'var(--trae-icon-brand)' }} />
              <h2 className="kb-contribution__title">AI知识沉淀</h2>
            </div>
            <p className="kb-contribution__desc">AI Agent在运维过程中自动沉淀知识,持续丰富知识库</p>
          </div>
          <div className="kb-stats">
            {CONTRIBUTION_STATS.map((stat) => (
              <div key={stat.label} className="kb-stat">
                <span className="kb-stat__label">{stat.label}</span>
                <span className={cn('kb-stat__value', stat.brand && 'kb-stat__value--brand')}>{stat.value}</span>
              </div>
            ))}
          </div>
          <button ref={contributeTriggerRef} type="button" data-dom-id="goto-ai-contribution" aria-label="贡献知识" aria-haspopup="dialog" aria-expanded={showContributeModal} onClick={handleContribute} className="kb-contribute-btn kb-btn-press">
            <Plus size={14} style={{ color: 'var(--trae-icon-brand)' }} />
            <span>贡献知识</span>
          </button>
        </section>
      </div>

      {/* ====== 贡献知识 Modal（无障碍：role=dialog + aria-modal + ESC 关闭 + 焦点管理 + 点击遮罩关闭） ====== */}
      {showContributeModal && (
        <div
          role="presentation"
          onClick={handleCloseContributeModal}
          className="kb-modal-overlay"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="贡献知识"
            onClick={(e) => e.stopPropagation()}
            className="kb-modal"
          >
            {/* Modal 标题栏 */}
            <div className="kb-modal__head">
              <div className="kb-modal__title-row">
                <Plus size={18} style={{ color: 'var(--trae-icon-brand)' }} />
                <h2 className="kb-modal__title">贡献知识</h2>
              </div>
              <button
                type="button"
                aria-label="关闭贡献知识弹窗"
                onClick={handleCloseContributeModal}
                className="kb-modal__close kb-btn-press"
              >
                <X size={14} />
              </button>
            </div>

            {contributeSubmitted ? (
              /* 提交成功态：role=status + aria-live=polite 通知屏幕阅读器 */
              <div role="status" aria-live="polite" className="kb-modal__success">
                <div className="kb-modal__success-icon">
                  <Check size={20} style={{ color: 'var(--trae-icon-brand)' }} />
                </div>
                <p className="kb-modal__success-text">感谢贡献，知识已提交审核</p>
                <button
                  type="button"
                  onClick={handleCloseContributeModal}
                  className="kb-modal__success-btn kb-btn-press"
                >
                  完成
                </button>
              </div>
            ) : (
              /* 表单态：原生 form + label + required，HTML5 校验 + submit 触发 */
              <form onSubmit={(e) => { e.preventDefault(); handleSubmitContribute() }} className="kb-modal__form">
                {/* 知识标题 */}
                <div className="kb-form-row">
                  <label htmlFor="contribute-title" className="kb-form-label">知识标题 <span className="kb-form-label__required">*</span></label>
                  <input
                    ref={contributeTitleInputRef}
                    id="contribute-title"
                    type="text"
                    required
                    value={contributeForm.title}
                    onChange={(e) => setContributeForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="如：Nginx worker_connections 调优"
                    aria-required="true"
                    className="kb-form-input"
                  />
                </div>

                {/* 分类 */}
                <div className="kb-form-row">
                  <label htmlFor="contribute-category" className="kb-form-label">分类</label>
                  <select
                    id="contribute-category"
                    value={contributeForm.category}
                    onChange={(e) => setContributeForm((prev) => ({ ...prev, category: e.target.value as Exclude<KnowledgeCategory, 'all'> }))}
                    className="kb-form-select"
                  >
                    {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>

                {/* 摘要 */}
                <div className="kb-form-row">
                  <label htmlFor="contribute-summary" className="kb-form-label">摘要 <span className="kb-form-label__required">*</span></label>
                  <textarea
                    id="contribute-summary"
                    required
                    rows={4}
                    value={contributeForm.summary}
                    onChange={(e) => setContributeForm((prev) => ({ ...prev, summary: e.target.value }))}
                    placeholder="简述知识内容、应用场景与关键操作..."
                    aria-required="true"
                    className="kb-form-textarea"
                  />
                </div>

                {/* 操作按钮 */}
                <div className="kb-modal__actions">
                  <button
                    type="button"
                    onClick={handleCloseContributeModal}
                    className="kb-btn-cancel kb-btn-press"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    aria-label="提交知识贡献"
                    className="kb-btn-submit kb-btn-press"
                  >
                    提交审核
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
