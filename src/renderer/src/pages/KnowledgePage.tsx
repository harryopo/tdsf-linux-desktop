/**
 * KnowledgePage — 运维知识库列表
 *
 * 路由：/knowledge
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge.html
 *
 * 结构：
 * 1. PageHeader：标题"运维知识库" + 副标题 + 返回工作台按钮
 * 2. 搜索栏：HybridSearchBar（混合检索）+ 8 个分类标签（all/nginx/mysql/docker/network/security/shell/systemd）
 * 3. 两栏布局：
 *    - 左：知识卡片列表（含匹配度标签、标签、查看详情链接）
 *    - 右：热门知识 top5 + 最近浏览 3 项
 * 4. 底部 AI 知识沉淀统计区（已收录 / 本周新增 / AI 贡献率 + 贡献知识按钮）
 *
 * 交互：
 * - 搜索：HybridSearchBar 输入查询，useHybridSearch Hook 调用混合检索 IPC（FTS5 + 向量 + RRF 融合）
 *   - 关键词模式：仅 FTS5 BM25 检索
 *   - 语义模式：FTS5 + 向量 KNN + RRF 融合（首次使用需下载 BGE 模型，EmbeddingBanner 引导）
 *   - 搜索时左栏切换为 SearchResultCard 列表（显示 rrfScore + 召回来源标签）
 * - 分类筛选：点击 8 个分类标签切换本地过滤（仅在非搜索状态生效）
 * - 点击卡片：useNavigate 跳转 `/knowledge/:id`
 *
 * 数据接入（v0.7.0 Sprint 4.1）：
 * - 启动时通过 IPC 加载真实数据：
 *   1. tutorial:list      → 教程（type='tutorial'）
 *   2. kb:export          → 命令技能 + 故障案例（type='command_skill' | 'incident_case'）
 * - 真实数据为空时降级到 mock，保证 UI 不空白
 * - 加载中显示 loading 状态
 *
 * Sprint 7 任务 F（v0.9.6）：
 * - 接入混合检索 UI（HybridSearchBar + EmbeddingBanner + SearchResultCard）
 * - useHybridSearch Hook 封装防抖 + 降级 + 状态管理
 * - type='tutorial' 走混合检索；command/case 暂走本地过滤（无向量索引）
 * - 搜索结果点击跳转 `/knowledge/:id`，由详情页路由统一处理
 *
 * 子组件（拆分到 components/knowledge/v1/）：
 * - KnowledgeCard：单个知识卡片
 * - Sidebar：右栏（HotList + RecentList）
 * - ContributionSection：AI 知识沉淀统计区
 * - types：类型定义 + Mock 数据
 *
 * Sprint 7 任务 F 复用组件（来自 components/tutorial/v1/）：
 * - HybridSearchBar：搜索框 + 模式切换
 * - SearchResultCard：搜索结果项（rrfScore + 召回来源）
 * - EmbeddingBanner：首次使用语义检索引导条
 * - useHybridSearch：混合检索 Hook
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Layers, Loader2, Search, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/trae/Button'
import { Skeleton } from '@/components/trae/Skeleton'
import { SearchResultCard } from '@/components/tutorial/v1/SearchResultCard'
import { EmbeddingBanner } from '@/components/tutorial/v1/EmbeddingBanner'
import type { SearchResultItem, SearchMode } from '@/components/tutorial/v1/hybrid-search-types'
import { useHybridSearch } from '@/hooks/useHybridSearch'
import {
  CATEGORIES,
  ContributionSection,
  KnowledgeCard,
  Sidebar,
} from '@/components/knowledge/v1'
import type { KnowledgeCategory, KnowledgeItem } from '@/components/knowledge/v1'
import type { KnowledgeEntry, KnowledgeType } from '@shared/models'
import type { TutorialEntry, TutorialCategory } from '@shared/tutorial-types'

/** electronAPI 引用（preload 暴露 + global.d.ts 已有完整类型） */
const api: {
  tutorialList?: (category?: string) => Promise<TutorialEntry[]>
  kbExport?: (type?: KnowledgeType) => Promise<KnowledgeEntry[]>
} | undefined =
  typeof window !== 'undefined' && (window as any).electronAPI
    ? (window as any).electronAPI
    : undefined

/**
 * 把 KnowledgeEntry 映射为 KnowledgeItem（UI 展示格式）
 *
 * 字段映射：
 *   id         → id
 *   title      → title
 *   problem    → summary
 *   tags[0]    → category（按关键字匹配回 8 类）
 *   tags       → tags（除 category 外）
 *   useCount   → views
 */
function mapKnowledgeEntryToItem(k: KnowledgeEntry): KnowledgeItem {
  // 分类匹配：根据 tags/title 反推 8 类分类
  const cat = inferCategory(k)
  return {
    id: k.id,
    title: k.title,
    summary: k.problem,
    category: cat,
    tags: (k.tags ?? []).filter((t) => t && !CATEGORIES.some((c) => c.label === t)),
    updatedAt: formatRelativeTime(k.updatedAt),
    views: k.useCount,
    matchScore: Math.round((k.successRate ?? 0) * 100)
  }
}

/** 根据标签/标题反推 8 类分类 */
function inferCategory(k: KnowledgeEntry): Exclude<KnowledgeCategory, 'all'> {
  const text = `${k.title} ${(k.tags ?? []).join(' ')} ${(k.keywords ?? []).join(' ')}`.toLowerCase()
  if (text.includes('nginx')) return 'nginx'
  if (text.includes('mysql') || text.includes('postgres') || text.includes('maria')) return 'mysql'
  if (text.includes('docker') || text.includes('k8s') || text.includes('container') || text.includes('kubernetes')) return 'docker'
  if (text.includes('net') || text.includes('tcp') || text.includes('iptables') || text.includes('ip ')) return 'network'
  if (text.includes('sec') || text.includes('ssh') || text.includes('selinux') || text.includes('firewall')) return 'security'
  if (text.includes('shell') || text.includes('bash') || text.includes('cron') || text.includes('disk') || text.includes('script')) return 'shell'
  if (text.includes('systemd') || text.includes('service') || text.includes('system')) return 'systemd'
  return 'shell'
}

/** 把 TutorialEntry 映射为 KnowledgeItem（type='tutorial'） */
function mapTutorialToItem(t: TutorialEntry): KnowledgeItem {
  // 教程的 category 转为 8 类之一（按关键字模糊匹配）
  const cat = inferCategoryFromTutorial(t)
  return {
    id: t.id,
    title: t.title,
    summary: t.summary,
    category: cat,
    tags: (t.tags ?? []).slice(0, 4),
    updatedAt: formatRelativeTime(t.updatedAt),
    views: 0,
    matchScore: 90
  }
}

/** 教程 category → 8 类（按前缀） */
function inferCategoryFromTutorial(t: TutorialEntry): Exclude<KnowledgeCategory, 'all'> {
  const c: TutorialCategory = t.category
  if (c === 'web-server' || c === 'networking') return 'nginx'
  if (c === 'database') return 'mysql'
  if (c === 'containers' || c === 'virtualization') return 'docker'
  if (c === 'security') return 'security'
  if (c === 'shell-scripting' || c === 'storage' || c === 'troubleshooting') return 'shell'
  if (c === 'services') return 'systemd'
  return 'shell'
}

/** 时间戳转相对时间（中文） */
function formatRelativeTime(ts: number): string {
  if (!ts) return '未知'
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}天前`
  const w = Math.floor(d / 7)
  if (w < 4) return `${w}周前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

/**
 * KnowledgePage — 运维知识库列表页
 *
 * @returns React 元素
 */
export function KnowledgePage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword')
  const [activeCategory, setActiveCategory] = useState<KnowledgeCategory>('all')
  const [loading, setLoading] = useState(true)
  const [realItems, setRealItems] = useState<KnowledgeItem[]>([])
  const [dataSource, setDataSource] = useState<'mock' | 'real' | 'mixed'>('real')

  // ===== Sprint 7 任务 F：混合检索 Hook =====
  // type='tutorial' 走混合检索（FTS5 + 向量 + RRF 融合）；
  // command_skill / incident_case 暂走本地过滤（无向量索引）。
  const hybridSearch = useHybridSearch({
    mode: searchMode,
    query: searchQuery,
    debounceMs: 300,
    limit: 10,
    type: 'tutorial',
    storageKey: 'knowledge:hybrid-search:skipped',
    bannerEnabled: true,
  })

  /** 当语义模式被禁用（模型未加载）且用户切到 semantic 时，自动回退到 keyword */
  useEffect(() => {
    if (searchMode === 'semantic' && !hybridSearch.semanticAvailable && searchQuery) {
      // 仅在有搜索内容时回退，避免空查询时反复切换
      setSearchMode('keyword')
    }
  }, [searchMode, hybridSearch.semanticAvailable, searchQuery])

  /** 是否处于搜索状态（有查询字符串） */
  const isSearching = searchQuery.trim().length > 0

  /** 加载真实数据（无假数据降级：空库显示空状态） */
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!api?.tutorialList || !api?.kbExport) {
        if (!cancelled) {
          setLoading(false)
          setDataSource('real')
          setRealItems([])
        }
        return
      }
      try {
        setLoading(true)
        const [tutorials, others] = await Promise.all([
          api.tutorialList().catch(() => []),
          api.kbExport().catch(() => [])
        ])
        if (cancelled) return
        const fromTutorials = tutorials.map(mapTutorialToItem)
        const fromOthers = others
          .filter((k) => k.type === 'command_skill' || k.type === 'incident_case')
          .map(mapKnowledgeEntryToItem)
        const merged = [...fromTutorials, ...fromOthers]
        setRealItems(merged)
        setDataSource('real')
      } catch (err) {
        console.error('[KnowledgePage] 加载真实数据失败:', err)
        if (!cancelled) {
          setRealItems([])
          setDataSource('real')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  /** 仅真实数据，不回退 mock */
  const items = realItems

  /** 过滤后的知识条目（搜索 + 分类联动） */
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      // 分类筛选（all 表示全部）
      const categoryMatch =
        activeCategory === 'all' || item.category === activeCategory
      // 搜索筛选（标题 + 摘要 + 标签）
      const searchMatch =
        query === '' ||
        item.title.toLowerCase().includes(query) ||
        item.summary.toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query))
      return categoryMatch && searchMatch
    })
  }, [items, searchQuery, activeCategory])

  /**
   * 跳转到知识详情
   * @param id - 知识 ID
   */
  const handleNavigateDetail = (id: string) => {
    navigate(`/knowledge/${id}`)
  }

  /** 返回工作台 */
  const handleBackToWorkbench = () => navigate('/workbench')

  /**
   * AI 检索按钮回调
   * 按设计稿：点击切换关键词 / 语义检索模式。
   * 语义不可用时提示用户下载模型或降级到关键词。
   */
  const handleAiSearch = () => {
    if (searchMode === 'keyword') {
      if (hybridSearch.semanticAvailable) {
        setSearchMode('semantic')
      } else if (hybridSearch.status && !hybridSearch.status.embeddingModelLoaded) {
        window.alert(
          '语义检索需下载 BGE 模型（约 24MB）。\n请点击下方提示条上的「下载模型」按钮，或继续使用关键词检索。'
        )
      } else {
        window.alert('当前环境不支持语义检索，已使用关键词模式。')
      }
    } else {
      setSearchMode('keyword')
    }
  }

  /**
   * 贡献知识按钮回调
   * v1.0 复刻：当前无新增知识弹窗组件，提示用户功能开发中
   * 后续 v0.9.6+ 接入 _kb_add IPC
   */
  const handleContribute = () => {
    window.alert('贡献知识功能正在开发中，敬请期待 v1.1 版本接入知识新增弹窗。')
  }

  return (
    <main className="flex h-full w-full flex-col gap-4 bg-[var(--trae-bg-base-default)] px-6 py-6">
      {/* 1. Page Header */}
      <header
        className="flex items-start justify-between gap-6 border-b pb-5"
        style={{ borderColor: 'var(--trae-border-neutral-l1)' }}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <Layers
              className="h-6 w-6 shrink-0"
              style={{ color: 'var(--trae-icon-brand)' }}
            />
            <h1
              className="font-semibold"
              style={{
                fontSize: 'var(--trae-heading-2xl-font-size)',
                lineHeight: 'var(--trae-heading-2xl-line-height)',
                color: 'var(--trae-text-default)',
              }}
            >
              运维知识库
            </h1>
            {/* 数据源标签（v0.7.0 Sprint 4.1 新增：提示当前展示的是真实数据还是 mock） */}
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
                ● 真实数据 {realItems.length} 条
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
          </div>
          <p
            style={{
              fontSize: 'var(--trae-body-xs-font-size)',
              lineHeight: 'var(--trae-body-xs-line-height)',
              color: 'var(--trae-text-tertiary)',
            }}
          >
            AI 驱动的运维知识检索与沉淀
            {dataSource === 'real' && realItems.length === 0 && !loading && (
              <span style={{ marginLeft: 8 }}>
                （库为空：可先跑教程爬虫/回填，或使用搜索）
              </span>
            )}
            {dataSource === 'real' && realItems.length > 0 && (
              <span style={{ marginLeft: 8 }}>
                （教程 + 命令技能 + 故障案例）
              </span>
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          size="lg"
          onClick={handleBackToWorkbench}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回工作台
        </Button>
      </header>

      {/* 2. Search Bar + Category Tabs（按设计稿：简化搜索框 + AI检索按钮） */}
      <div
        className="border p-3"
        style={{
          background: 'var(--trae-bg-base-secondary)',
          borderColor: 'var(--trae-border-neutral-l1)',
          borderRadius: 'var(--trae-radius-8)',
        }}
      >
        {/* 搜索输入框 + AI 检索按钮 */}
        <div className="flex items-center gap-2">
          <div
            className="flex h-10 min-w-0 flex-1 items-center gap-2 border px-3 transition-colors"
            style={{
              background: 'var(--trae-bg-base-tertiary)',
              borderColor: 'var(--trae-border-neutral-l1)',
              borderRadius: 'var(--trae-radius-6)',
            }}
          >
            <Search
              className="h-4 w-4 shrink-0"
              style={{
                color: hybridSearch.loading
                  ? 'var(--trae-icon-brand)'
                  : 'var(--trae-icon-secondary)',
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchQuery) {
                  e.preventDefault()
                  setSearchQuery('')
                }
              }}
              placeholder="搜索知识、故障、解决方案..."
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--trae-text-tertiary)] focus:outline-none"
              style={{
                fontFamily: 'var(--trae-font-family-mono)',
                fontSize: 'var(--trae-body-md-font-size)',
                lineHeight: 'var(--trae-body-md-line-height)',
                color: 'var(--trae-text-default)',
                border: 'none',
              }}
              onFocus={(e) => {
                e.currentTarget.parentElement!.style.borderColor =
                  'var(--trae-bg-brand)'
              }}
              onBlur={(e) => {
                e.currentTarget.parentElement!.style.borderColor =
                  'var(--trae-border-neutral-l1)'
              }}
              aria-label="搜索知识"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="清空搜索"
                className="shrink-0 cursor-pointer rounded-full p-0.5 transition-colors"
                style={{
                  color: 'var(--trae-text-tertiary)',
                  background: 'transparent',
                  border: 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--trae-text-secondary)'
                  e.currentTarget.style.background = 'var(--trae-bg-overlay-l2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--trae-text-tertiary)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleAiSearch}
            className="btn-press inline-flex h-10 shrink-0 items-center gap-1.5 px-4 transition-colors"
            style={{
              background: 'var(--trae-bg-brand)',
              color: 'var(--trae-text-onbrand)',
              border: '1px solid var(--trae-bg-brand)',
              borderRadius: 'var(--trae-radius-6)',
              fontSize: 'var(--trae-body-sm-font-size)',
              fontWeight: 'var(--trae-font-weight-medium)',
              cursor: 'pointer',
            }}
          >
            <Sparkles className="h-4 w-4" style={{ color: 'var(--trae-icon-onbrand)' }} />
            AI检索
          </button>
        </div>

        {/* 搜索状态指示 */}
        {isSearching && (
          <div
            className="mt-2 flex items-center justify-end"
            style={{
              fontSize: 'var(--trae-body-xs-font-size)',
              color: 'var(--trae-text-tertiary)',
              fontFamily: 'var(--trae-font-family-mono)',
            }}
          >
            {searchMode === 'semantic' ? '语义检索中' : '关键词检索中'}
          </div>
        )}

        {/* 分类标签栏（搜索时禁用，仅非搜索状态生效） */}
        <div
          className="no-scrollbar mt-3 flex items-center gap-2 overflow-x-auto"
          style={{ opacity: isSearching ? 0.5 : 1, pointerEvents: isSearching ? 'none' : 'auto' }}
        >
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className="inline-flex h-6 shrink-0 cursor-pointer items-center whitespace-nowrap border px-2.5 transition-colors"
                style={{
                  background: isActive
                    ? 'var(--trae-bg-brand-popup)'
                    : 'var(--trae-bg-overlay-l2)',
                  color: isActive
                    ? 'var(--trae-text-brand)'
                    : 'var(--trae-text-secondary)',
                  borderColor: isActive
                    ? 'var(--trae-border-brand)'
                    : 'var(--trae-border-neutral-l1)',
                  fontSize: 'var(--trae-body-xs-font-size)',
                  fontWeight: isActive ? 500 : 400,
                  borderRadius: 'var(--trae-radius-4)',
                }}
              >
                {cat.label}
              </button>
            )
          })}
        </div>
        {/* 首次使用引导 Banner（模型未加载时显示） */}
        {hybridSearch.bannerVisible && (
          <div style={{ marginTop: 12 }}>
            <EmbeddingBanner
              status={hybridSearch.status}
              progress={hybridSearch.progress}
              skipped={hybridSearch.skipped}
              onDownload={() => void hybridSearch.backfill()}
              onSkip={hybridSearch.skip}
              onDismiss={hybridSearch.dismissBanner}
            />
          </div>
        )}
      </div>

      {/* 3. Two-column Layout */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Left: Knowledge List（搜索时切换为 SearchResultCard 列表） */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {isSearching ? (
            <KnowledgeSearchResults
              loading={hybridSearch.loading}
              error={hybridSearch.error}
              results={hybridSearch.results}
              mode={searchMode}
              onOpen={handleNavigateDetail}
            />
          ) : filteredItems.length === 0 ? (
            <div
              className="border p-8 text-center"
              style={{
                background: 'var(--trae-bg-base-secondary)',
                borderColor: 'var(--trae-border-neutral-l1)',
                borderRadius: 'var(--trae-radius-8)',
                color: 'var(--trae-text-tertiary)',
              }}
            >
              {realItems.length === 0
                ? '知识库暂无数据。可先运行教程爬虫/回填，或切换分类与搜索。'
                : '未找到匹配的知识条目'}
            </div>
          ) : (
            filteredItems.map((item) => (
              <KnowledgeCard
                key={item.id}
                item={item}
                onNavigate={handleNavigateDetail}
              />
            ))
          )}
        </div>

        {/* Right: Sidebar */}
        <Sidebar onNavigate={handleNavigateDetail} />
      </div>

      {/* 4. AI Contribution Section */}
      <ContributionSection onContribute={handleContribute} />
    </main>
  )
}

// ============================================================================
// Sprint 7 任务 F：知识库搜索结果区子组件
// 与 TutorialPage 的 SearchResultsSection 结构保持一致，便于复用样式规范
// ============================================================================

interface KnowledgeSearchResultsProps {
  /** 是否正在搜索（防抖期间也显示 loading） */
  loading: boolean
  /** 错误信息（null 表示无错误） */
  error: string | null
  /** 搜索结果列表 */
  results: SearchResultItem[]
  /** 当前搜索模式（用于结果统计条展示） */
  mode: SearchMode
  /** 点击结果项跳转 */
  onOpen: (id: string) => void
}

/**
 * 知识库搜索结果区子组件
 *
 * - loading=true：显示 3 个 Skeleton 卡片（与知识卡片同等高度）
 * - error：显示错误提示（红色边框）
 * - results.length === 0：显示空状态（SearchIcon 图标 + 提示文案）
 * - results.length > 0：渲染结果列表（SearchResultCard 单列） + 结果统计条
 *
 * 视觉规范：
 * - 单列布局（与 KnowledgeCard 列表保持一致）
 * - 空状态用 var(--trae-text-tertiary) 灰色，避免过度强调
 */
function KnowledgeSearchResults({
  loading,
  error,
  results,
  mode,
  onOpen,
}: KnowledgeSearchResultsProps) {
  // ===== Loading 状态：Skeleton 占位 =====
  if (loading) {
    return (
      <>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-2 border"
            style={{
              background: 'var(--trae-bg-base-secondary)',
              borderColor: 'var(--trae-border-neutral-l1)',
              borderRadius: 'var(--trae-radius-8)',
              padding: '14px 16px',
            }}
          >
            {/* 标题行 Skeleton */}
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 shrink-0" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-12" />
            </div>
            {/* 摘要 Skeleton */}
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            {/* 元信息 Skeleton */}
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
        ))}
      </>
    )
  }

  // ===== Error 状态 =====
  if (error) {
    return (
      <div
        className="border p-6 text-center"
        style={{
          background: 'var(--trae-status-error-surface-l1)',
          borderColor: 'var(--trae-status-error-default)',
          borderRadius: 'var(--trae-radius-8)',
          color: 'var(--trae-status-error-default)',
          fontSize: 'var(--trae-body-sm-font-size)',
        }}
      >
        {error}
      </div>
    )
  }

  // ===== 空状态：无搜索结果 =====
  if (results.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-3 border p-12 text-center"
        style={{
          background: 'var(--trae-bg-base-secondary)',
          borderColor: 'var(--trae-border-neutral-l1)',
          borderRadius: 'var(--trae-radius-8)',
          color: 'var(--trae-text-tertiary)',
        }}
      >
        <Search
          className="h-10 w-10"
          style={{ color: 'var(--trae-icon-tertiary)' }}
          strokeWidth={1.5}
        />
        <div
          style={{
            fontSize: 'var(--trae-body-md-font-size)',
            color: 'var(--trae-text-secondary)',
            fontWeight: 'var(--trae-font-weight-medium)',
          }}
        >
          未找到匹配的知识条目
        </div>
        <div
          style={{
            fontSize: 'var(--trae-body-xs-font-size)',
            color: 'var(--trae-text-tertiary)',
            lineHeight: 'var(--trae-body-sm-line-height)',
          }}
        >
          尝试更换关键词，或切换到语义模式获取相关结果
        </div>
      </div>
    )
  }

  // ===== 正常结果列表 =====
  return (
    <>
      {/* 结果统计条 */}
      <div
        className="flex items-center justify-between"
        style={{
          fontSize: 'var(--trae-body-xs-font-size)',
          color: 'var(--trae-text-tertiary)',
        }}
      >
        <span>
          找到 <span style={{ color: 'var(--trae-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{results.length}</span> 条结果
        </span>
        <span style={{ fontFamily: 'var(--trae-font-family-mono)' }}>
          {mode === 'semantic' ? '语义检索' : '关键词检索'}
        </span>
      </div>
      {/* 结果卡片列表（单列，与 KnowledgeCard 一致） */}
      {results.map((r) => (
        <SearchResultCard key={r.id} result={r} onOpen={onOpen} />
      ))}
    </>
  )
}
