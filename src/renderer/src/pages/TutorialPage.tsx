/**
 * TutorialPage — 运维教程列表（v1.0 设计稿复刻 + v0.7.0 Sprint 4.3 真实数据接入）
 *
 * 路由：/tutorial
 * 设计稿：tdsf-linux-redesign/pages/tutorial.html
 *
 * 结构：
 * 1. PageHeader：scroll-text 图标 + 标题 + 副标题 + 返回工作台按钮 + 刷新教程按钮
 * 2. 顶部统计行：纵向堆叠（课程数 / 总课时 / 累计学习人次）
 * 3. 精选课程：单列大卡（按 readingTime 排序选 Top 2）
 * 4. 课程分类导航：6 个分类切换（全部/Linux 基础/网络运维/故障排查/安全加固/自动化脚本）
 * 5. 课程列表：网格（真实数据 + mock 补足）
 *
 * 数据接入（v0.7.0 Sprint 4.3）：
 * - 启动时通过 IPC tutorial:list 加载真实教程（type='tutorial'）
 * - TutorialEntry → Course 映射（difficulty 翻译 / category 映射 / readingTime 格式化）
 * - 仅展示 tutorial:list 真实数据
 * - 加载中显示 spinner，数据源标签
 * - 顶部"刷新教程"按钮：触发 tutorial:listSources 拉源列表并显示
 * - 真实数据为空时显示空状态（不降级 mock）
 *
 * 子组件：components/tutorial/v1/（FeaturedCourseCard / CourseCard / LearningPathRow / types）
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ScrollText, ArrowLeft, Star, Loader2, RefreshCw, Database, FileText, Search as SearchIcon
} from 'lucide-react'
import { Button } from '@/components/trae/Button'
import { Skeleton } from '@/components/trae/Skeleton'
import { FeaturedCourseCard } from '@/components/tutorial/v1/FeaturedCourseCard'
import { CourseCard } from '@/components/tutorial/v1/CourseCard'
import { HybridSearchBar } from '@/components/tutorial/v1/HybridSearchBar'
import { SearchResultCard } from '@/components/tutorial/v1/SearchResultCard'
import { EmbeddingBanner } from '@/components/tutorial/v1/EmbeddingBanner'
import type { SearchMode, SearchResultItem } from '@/components/tutorial/v1/hybrid-search-types'
import { useHybridSearch } from '@/hooks/useHybridSearch'
import {
  type Course,
  type CourseCategory,
  CATEGORIES,
} from '@/components/tutorial/v1/types'
import type { TutorialEntry, TutorialCategory } from '@shared/tutorial-types'

/** electronAPI 引用（preload 暴露） */
const api: {
  tutorialList?: (category?: string) => Promise<TutorialEntry[]>
  tutorialListSources?: () => Promise<unknown[]>
} | undefined =
  typeof window !== 'undefined' && (window as any).electronAPI
    ? (window as any).electronAPI
    : undefined

// ============ 字段映射函数 ============

/** TutorialCategory → 8 类 UI 分类 */
const CATEGORY_MAP: Partial<Record<TutorialCategory, CourseCategory>> = {
  'networking': 'network',
  'web-server': 'network',
  'troubleshooting': 'troubleshoot',
  'security': 'security',
  'shell-scripting': 'script',
  'services': 'security',
  'storage': 'troubleshoot',
  'containers': 'network',
  'virtualization': 'network',
  'database': 'troubleshoot',
  'monitoring': 'troubleshoot',
  'cloud': 'network',
  'package-management': 'basic',
  'user-management': 'basic',
  'linux-basics': 'basic',
}

/** difficulty → 4 级标签 */
const LEVEL_MAP: Record<'beginner' | 'intermediate' | 'advanced', '初级' | '中级' | '进阶' | '专家'> = {
  beginner: '初级',
  intermediate: '中级',
  advanced: '进阶',
}

/** readingTime（分钟） → "2h30min" / "45min" 格式 */
function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '5min'
  if (minutes < 60) return `${Math.round(minutes)}min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (m === 0) return `${h}h`
  return `${h}h${m}min`
}

/** category 反推 fallback（用于源未登记的） */
function inferCourseCategory(t: TutorialEntry): CourseCategory {
  if (CATEGORY_MAP[t.category]) return CATEGORY_MAP[t.category]!
  const text = `${t.title} ${t.summary} ${(t.tags ?? []).join(' ')}`.toLowerCase()
  if (text.includes('ssh') || text.includes('安全') || text.includes('security') || text.includes('selinux') || text.includes('firewall')) return 'security'
  if (text.includes('shell') || text.includes('脚本') || text.includes('bash') || text.includes('script') || text.includes('cron')) return 'script'
  if (text.includes('排障') || text.includes('故障') || text.includes('排查') || text.includes('troubleshoot') || text.includes('debug')) return 'troubleshoot'
  if (text.includes('网络') || text.includes('nginx') || text.includes('tcp') || text.includes('net')) return 'network'
  if (text.includes('基础') || text.includes('入门') || text.includes('basic') || text.includes('linux')) return 'basic'
  return 'basic'
}

/**
 * TutorialEntry → Course 映射
 *
 * 字段对应：
 *   id              → id
 *   title           → title
 *   summary         → description
 *   category        → category（CATEGORY_MAP / inferCourseCategory）
 *   difficulty      → level（LEVEL_MAP）
 *   readingTime     → duration（formatDuration）
 *   source.name     → 标签："官方教程 · {source.name}"
 *   progress        → 0（新数据无进度）
 *   completed       → false
 *   icon            → FileText（动态生成）
 *   learnerCount    → "—"（暂无数据）
 */
function mapTutorialToCourse(t: TutorialEntry): Course {
  return {
    id: t.id,
    title: t.title,
    description: t.summary || '(无摘要)',
    level: LEVEL_MAP[t.difficulty] ?? '初级',
    category: inferCourseCategory(t) as Exclude<CourseCategory, 'all'>,
    duration: formatDuration(t.readingTime),
    learnerCount: '—',
    progress: 0,
    completed: false,
    icon: FileText
  }
}

/** 从合并后课程中选 Top 2 精选（readingTime 长的优先） */
function pickFeatured(all: Course[]): Course[] {
  if (all.length === 0) return []
  // 按 duration 分钟数降序（粗略提取数字）
  const ranked = [...all].sort((a, b) => {
    const aMin = parseInt(a.duration) || 0
    const bMin = parseInt(b.duration) || 0
    return bMin - aMin
  })
  return ranked.slice(0, 2)
}

// ============ 统计计算 ============

interface StatsData {
  courses: number
  lessons: string
  totalMinutes: number
}


// ============ 主组件 ============

export function TutorialPage() {
  const navigate = useNavigate()
  const [activeCategory, setActiveCategory] = useState<CourseCategory>('all')
  const [loading, setLoading] = useState(true)
  const [realCourses, setRealCourses] = useState<Course[]>([])
  const [dataSource, setDataSource] = useState<'mock' | 'real' | 'mixed'>('real')
  const [refreshing, setRefreshing] = useState(false)
  const [sourceCount, setSourceCount] = useState<number | null>(null)

  // ===== Sprint 7 任务 F：混合检索 UI 接入 =====
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword')

  /** 混合检索 Hook（防抖 300ms + 自动降级 + 状态管理） */
  const hybridSearch = useHybridSearch({
    mode: searchMode,
    query: searchQuery,
    debounceMs: 300,
    limit: 10,
    type: 'tutorial',
    storageKey: 'tutorial:hybrid-search:skipped',
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

  // ===== Sprint 9 任务：学习路径推荐 UI 接入 =====

  /** 学习路径推荐 Hook */

  /** 触发路径推荐（默认推荐 beginner → intermediate 路径） */

  /** 点击学习路径步骤，跳转到对应教程 */

  /** 加载真实数据（Sprint 4.3 接入） */
  const loadData = async () => {
    if (!api?.tutorialList) {
      setLoading(false)
      setDataSource('real')
      return
    }
    try {
      setLoading(true)
      const list = await api.tutorialList().catch(() => [])
      const mapped = list.map(mapTutorialToCourse)
      setRealCourses(mapped)
      if (mapped.length > 0) {
        setDataSource('real')
      } else {
        setDataSource('real')
      }
    } catch (err) {
      console.error('[TutorialPage] 加载真实教程失败:', err)
      setDataSource('real')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  /** 加载爬虫源数量（用于头部提示） */
  useEffect(() => {
    if (!api?.tutorialListSources) return
    let cancelled = false
    api.tutorialListSources()
      .then((list) => {
        if (cancelled) return
        setSourceCount(Array.isArray(list) ? list.length : 0)
      })
      .catch(() => {
        if (!cancelled) setSourceCount(null)
      })
    return () => { cancelled = true }
  }, [])

  /** 仅真实教程数据，不回退 mock */
  const allCourses = useMemo(() => realCourses, [realCourses])

  /** 按当前分类筛选 */
  const filteredCourses = useMemo(() => {
    return activeCategory === 'all'
      ? allCourses
      : allCourses.filter((c) => c.category === activeCategory)
  }, [allCourses, activeCategory])

  /** 精选课程（按 duration 排序 Top 2） */
  const featuredCourses = useMemo(() => pickFeatured(realCourses), [realCourses])

  /** 顶部统计（v1.0 复刻：按设计稿固定为 12 门课程 / 48 课时 / 3.2k 学习人次） */
  const stats = useMemo<StatsData>(() => {
    // duration 为展示字符串（如 45min / 2h30min），统计用课程数即可
    return {
      courses: realCourses.length,
      lessons: String(realCourses.length),
      totalMinutes: realCourses.length * 20,
    }
  }, [realCourses])

  /** 跳转到教程详情页（去 mock: 前缀） */
  const goToDetail = (id: string) => {
    const realId = id.startsWith('mock:') ? id.replace('mock:', '') : id
    navigate(`/tutorial/${realId}`)
  }

  /** 跳回工作台 */
  const goWorkbench = () => navigate('/workbench')

  /** 刷新教程（重新拉取） */
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await loadData()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <main
      className="min-h-full font-sans antialiased"
      style={{
        background: 'var(--trae-bg-base-default)',
        color: 'var(--trae-text-default)',
        fontFamily: 'var(--trae-body-base-font-family)',
        fontSize: 'var(--trae-body-base-font-size)',
      }}
    >
      {/* ============ 1. Page Header ============ */}
      <header
        className="flex items-center justify-between"
        style={{
          padding: '18px 32px',
          borderBottom: '1px solid var(--trae-border-neutral-l1)',
        }}
      >
        <div className="flex items-center gap-[14px]">
          <ScrollText
            className="shrink-0 text-[var(--trae-text-brand)]"
            size={26}
            strokeWidth={2}
          />
          <div className="flex flex-col gap-[2px]">
            <div className="flex items-center gap-2">
              <span
                className="font-semibold"
                style={{
                  fontSize: 'var(--trae-heading-2xl-font-size)',
                  lineHeight: 'var(--trae-heading-2xl-line-height)',
                  color: 'var(--trae-text-default)',
                }}
              >
                运维教程
              </span>
              {/* 数据源标签（Sprint 4.3 新增） */}
              {dataSource === 'mixed' && (
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
                  <Database className="h-3 w-3" />
                  真实 {realCourses.length} 条
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
              {!loading && dataSource === 'real' && realCourses.length === 0 && (
                <span
                  className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border px-2"
                  style={{
                    borderColor: 'var(--trae-border-neutral-l1)',
                    color: 'var(--trae-text-tertiary)',
                    fontSize: 'var(--trae-body-xs-font-size)'
                  }}
                >
                  暂无教程数据
                </span>
              )}
            </div>
            <span
              className="text-[var(--trae-text-tertiary)]"
              style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
            >
              从入门到精通的 Linux 运维实战课程
              {sourceCount !== null && sourceCount > 0 && (
                <span className="ml-2">
                  · 已接入 {sourceCount} 个权威源
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="default"
            onClick={handleRefresh}
            disabled={refreshing}
            data-dom-id="refresh-tutorials"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新教程
          </Button>
          <Button
            variant="outline"
            size="default"
            data-dom-id="back-workbench"
            onClick={goWorkbench}
          >
            <ArrowLeft size={14} className="text-[var(--trae-text-secondary)]" />
            <span>返回工作台</span>
          </Button>
        </div>
      </header>

      {/* ============ 内容容器 ============ */}
      <div className="mx-auto" style={{ padding: '28px 32px 64px' }}>
        {/* ====== Sprint 7 任务 F：混合检索搜索区 ====== */}
        <section style={{ marginBottom: 24 }}>
          <HybridSearchBar
            query={searchQuery}
            mode={searchMode}
            loading={hybridSearch.loading}
            semanticDisabled={!hybridSearch.semanticAvailable}
            semanticDisabledHint={
              hybridSearch.status && !hybridSearch.status.embeddingModelLoaded
                ? '模型未加载，请先点击下方「下载模型」'
                : hybridSearch.status && !hybridSearch.status.vectorEnabled
                  ? '向量扩展未加载'
                  : '语义检索不可用'
            }
            placeholder="搜索教程... (支持中英文语义检索)"
            onQueryChange={setSearchQuery}
            onModeChange={setSearchMode}
          />
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
        </section>

        {/* ====== 搜索结果区（仅 isSearching 时显示，覆盖原内容） ====== */}
        {isSearching ? (
          <SearchResultsSection
            loading={hybridSearch.loading}
            error={hybridSearch.error}
            results={hybridSearch.results}
            mode={searchMode}
            onOpen={goToDetail}
          />
        ) : (
          <>
            {/* ====== 2. 顶部统计行（设计稿：纵向堆叠） ====== */}
            <div className="flex flex-col gap-3">
          <div
            className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
            style={{ padding: '18px 20px' }}
          >
            <div className="flex items-baseline gap-2">
              <span
                className="font-semibold"
                style={{
                  fontSize: 'var(--trae-heading-2xl-font-size)',
                  lineHeight: 1,
                  color: 'var(--trae-text-brand)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {stats.courses}
              </span>
              <span
                className="text-[var(--trae-text-tertiary)]"
                style={{ fontSize: 'var(--trae-body-sm-font-size)' }}
              >
                门课程
              </span>
            </div>
            <div
              className="mt-1.5 text-[var(--trae-text-tertiary)]"
              style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
            >
              涵盖 Linux 运维全栈知识
            </div>
          </div>
          <div
            className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
            style={{ padding: '18px 20px' }}
          >
            <div className="flex items-baseline gap-2">
              <span
                className="font-semibold"
                style={{
                  fontSize: 'var(--trae-heading-2xl-font-size)',
                  lineHeight: 1,
                  color: 'var(--trae-text-brand)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {stats.lessons}
              </span>
              <span
                className="text-[var(--trae-text-tertiary)]"
                style={{ fontSize: 'var(--trae-body-sm-font-size)' }}
              >
                课时
              </span>
            </div>
            <div
              className="mt-1.5 text-[var(--trae-text-tertiary)]"
              style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
            >
              平均每个课程 4 个课时
            </div>
          </div>
          <div
            className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
            style={{ padding: '18px 20px' }}
          >
            <div className="flex items-baseline gap-2">
              <span
                className="font-semibold"
                style={{
                  fontSize: 'var(--trae-heading-2xl-font-size)',
                  lineHeight: 1,
                  color: 'var(--trae-text-brand)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                3.2k
              </span>
              <span
                className="text-[var(--trae-text-tertiary)]"
                style={{ fontSize: 'var(--trae-body-sm-font-size)' }}
              >
                学习人次
              </span>
            </div>
            <div
              className="mt-1.5 text-[var(--trae-text-tertiary)]"
              style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
            >
              运维工程师的沉淀集合
            </div>
          </div>
        </div>

        {/* ====== 3. 精选课程（设计稿：单列大卡） ====== */}
        {featuredCourses.length > 0 && (
          <section style={{ marginTop: 36 }}>
            <div className="mb-4 flex items-center gap-2">
              <Star
                size={18}
                className="text-[var(--trae-text-brand)]"
                fill="currentColor"
              />
              <h2
                className="m-0 font-semibold"
                style={{
                  fontSize: 'var(--trae-heading-md-font-size)',
                  lineHeight: 'var(--trae-heading-md-line-height)',
                  color: 'var(--trae-text-default)',
                }}
              >
                精选课程
              </h2>
            </div>
            <div className="flex flex-col gap-4">
              {featuredCourses.map((c) => (
                <FeaturedCourseCard key={c.id} course={c} onOpen={goToDetail} />
              ))}
            </div>
          </section>
        )}

        {/* ====== 4. 课程分类导航 ====== */}
        <nav style={{ marginTop: 36 }}>
          <div
            className="flex flex-nowrap gap-2 overflow-x-auto no-scrollbar"
            style={{ padding: '2px 0' }}
          >
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className="btn-press shrink-0 cursor-pointer whitespace-nowrap rounded-[var(--trae-radius-4)] border px-3 py-1 text-[11px] font-medium transition-all"
                  style={{
                    background: active ? 'var(--trae-bg-brand)' : 'transparent',
                    borderColor: active
                      ? 'var(--trae-bg-brand)'
                      : 'var(--trae-border-neutral-l2)',
                    color: active
                      ? 'var(--trae-text-onbrand)'
                      : 'var(--trae-text-secondary)',
                    borderRadius: 'var(--trae-radius-4)',
                  }}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
        </nav>

        {/* ====== 5. 课程列表（网格） ====== */}
        <section style={{ marginTop: 20 }}>
          {filteredCourses.length === 0 ? (
            <div
              className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-8 text-center"
              style={{
                color: 'var(--trae-text-tertiary)',
                fontSize: 'var(--trae-body-sm-font-size)',
              }}
            >
              {activeCategory === 'all'
                ? '暂无教程数据，请先抓取教程源或点击刷新'
                : `「${CATEGORIES.find((c) => c.id === activeCategory)?.label}」分类下暂无教程`}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCourses.map((c) => (
                <CourseCard key={c.id} course={c} onOpen={goToDetail} />
              ))}
            </div>
          )}
        </section>

        {/* ====== 6. 推荐学习路径（设计稿未包含，已移除） ====== */}
          </>
        )}
      </div>

      {/* ============ 按压动画样式 ============ */}
      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { scrollbar-width: none; }
      `}</style>
    </main>
  )
}

// ============================================================================
// Sprint 7 任务 F：搜索结果区子组件
// ============================================================================

interface SearchResultsSectionProps {
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
 * 搜索结果区子组件
 *
 * - loading=true：显示 3 个 Skeleton 卡片（与课程卡片同等高度）
 * - error：显示错误提示（红色边框）
 * - results.length === 0：显示空状态（FileText 图标 + 提示文案）
 * - results.length > 0：渲染结果列表（SearchResultCard 单列网格）
 *
 * 视觉规范：
 * - 网格用 1 列（避免卡片过窄），最大宽度 800px 居中
 * - 空状态用 var(--trae-text-tertiary) 灰色，避免过度强调
 */
function SearchResultsSection({
  loading,
  error,
  results,
  mode,
  onOpen,
}: SearchResultsSectionProps) {
  // ===== Loading 状态：Skeleton 占位 =====
  if (loading) {
    return (
      <section style={{ marginTop: 8 }}>
        <div className="flex flex-col gap-3">
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
        </div>
      </section>
    )
  }

  // ===== Error 状态 =====
  if (error) {
    return (
      <section style={{ marginTop: 8 }}>
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
      </section>
    )
  }

  // ===== 空状态：无搜索结果 =====
  if (results.length === 0) {
    return (
      <section style={{ marginTop: 8 }}>
        <div
          className="flex flex-col items-center gap-3 border p-12 text-center"
          style={{
            background: 'var(--trae-bg-base-secondary)',
            borderColor: 'var(--trae-border-neutral-l1)',
            borderRadius: 'var(--trae-radius-8)',
            color: 'var(--trae-text-tertiary)',
          }}
        >
          <SearchIcon
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
            未找到匹配的教程
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
      </section>
    )
  }

  // ===== 正常结果列表 =====
  return (
    <section style={{ marginTop: 8 }}>
      {/* 结果统计条 */}
      <div
        className="flex items-center justify-between"
        style={{
          marginBottom: 12,
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
      {/* 结果卡片列表（单列） */}
      <div className="flex flex-col gap-3">
        {results.map((r) => (
          <SearchResultCard key={r.id} result={r} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}
