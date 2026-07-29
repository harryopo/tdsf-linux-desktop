/**
 * TutorialPage — 运维教程页（1:1 复刻 tutorial.html 设计稿）
 * 路由：/tutorial
 * 结构：6 section 拆分为子组件（components/tutorial/）：
 *   1. TutorialHeader  2. TutorialStats  3. FeaturedCourses
 *   4. CategoryNav     5. CourseList     6. LearningPath
 * 数据：Electron 下通过 tutorial:list/categories/recommend-path 拉取真实数据，空库回退示例数据。
 * 视觉全用 var(--trae-*) token；button type + aria-* 无障碍；prefers-reduced-motion 禁用按压动画。
 */
import { useEffect, useMemo, useCallback, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TutorialCategory, TutorialCategorySummary } from '@shared/tutorial-types'
import type { TutorialProgress } from '@shared/models'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { message } from 'antd'
import { TutorialHeader } from '@/components/tutorial/TutorialHeader'
import { TutorialStats } from '@/components/tutorial/TutorialStats'
import { FeaturedCourses } from '@/components/tutorial/FeaturedCourses'
import { CategoryNav } from '@/components/tutorial/CategoryNav'
import { CourseList } from '@/components/tutorial/CourseList'
import { LearningPath } from '@/components/tutorial/LearningPath'
import {
  type Course, type CourseCategory, type LearningPath as LearningPathItem,
  type SearchResultItem, type RecommendedPathLite, type StatItem,
  UI_TO_TUTORIAL_CATEGORIES, DEFAULT_STATS, FEATURED_COURSES, DEFAULT_COURSES,
  LEARNING_PATHS, isLocalStorageAvailable, loadVisitedTutorialIds,
  saveVisitedTutorialIds, isValidTutorialCategory, entryToCourse, computeCategoryCounts,
  computeFeaturedProgress, tutorialPathToLearningPath,
} from '@/components/tutorial/types'
import './TutorialPage.css'

/** TutorialPage — 运维教程页 */
export function TutorialPage() {
  const navigate = useNavigate()
  const [activeCategory, setActiveCategory] = useState<CourseCategory>('all')

  // ===== 真实教程数据状态（v2.3 活功能转换）=====
  const [courses, setCourses] = useState<Course[]>(DEFAULT_COURSES)
  const [featured, setFeatured] = useState<Course[]>(FEATURED_COURSES)
  const [paths, setPaths] = useState<LearningPathItem[]>(LEARNING_PATHS)
  const [stats, setStats] = useState<StatItem[]>(DEFAULT_STATS)
  const [loading, setLoading] = useState(false)

  // ===== 学习进度（localStorage 过渡方案，接口保留待后续集成）=====
  const _localStorageAvailable = useMemo(() => isLocalStorageAvailable(), [])
  const [_visitedIds, _setVisitedIds] = useState<Set<string>>(() =>
    _localStorageAvailable ? loadVisitedTutorialIds() : new Set(),
  )
  // 推荐学习路径原始数据（含 tutorialId，用于精选课程前置依赖判断）
  const [_rawPaths, _setRawPaths] = useState<RecommendedPathLite[]>([])
  const [_categorySummaries, _setCategorySummaries] = useState<TutorialCategorySummary[]>([])

  // ===== RAG 混合检索（M4 Task 5）=====
  // searchResults：null=未搜索态，[]：搜索完成无结果，长度>0：搜索有结果
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResultItem[] | null>(null)
  const [searching, setSearching] = useState(false)

  /** 标记教程为已访问（双写：IPC 主路径 + localStorage fallback） */
  const _markVisited = useCallback(
    async (id: string) => {
      if (!id) return
      _setVisitedIds((prev) => {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        if (_localStorageAvailable) saveVisitedTutorialIds(next)
        return next
      })
      // IPC 异步写入（跨设备同步主路径，v2.3.2 新增）
      if (isElectronAPIAvailable() && window.electronAPI?.tutorialUpdateProgress) {
        try {
          await window.electronAPI.tutorialUpdateProgress(id, 'visited', 100)
        } catch (err) {
          console.warn('[TutorialPage] tutorialUpdateProgress 写入失败', err)
        }
      }
    },
    [_localStorageAvailable],
  )

  /** 挂载时拉取真实教程数据、分类汇总与学习路径 */
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    let cancelled = false
    setLoading(true)

    const load = async () => {
      try {
        const api = window.electronAPI
        if (!api?.tutorialList || !api?.tutorialCategories || !api?.tutorialRecommendPath) return

        // v2.3.2：并行加载 IPC 学习进度（跨设备同步主路径），不可用/空时保留 localStorage
        const progressPromise = api.tutorialProgress
          ? api.tutorialProgress().catch((err: unknown) => {
              console.warn('[TutorialPage] 加载 tutorialProgress 失败，回退到 localStorage', err)
              return [] as unknown[]
            })
          : Promise.resolve([] as unknown[])

        const [entries, categories, recommendedPaths, progressList] = await Promise.all([
          api.tutorialList(undefined),
          api.tutorialCategories(),
          api.tutorialRecommendPath({ goal: 'Linux 运维系统学习', currentLevel: 'beginner', maxSteps: 3 }),
          progressPromise,
        ])

        if (cancelled) return

        // 应用 IPC 学习进度（仅在 IPC 返回非空数组时覆盖，避免空数组清掉 localStorage）
        const visitedIds = new Set<string>(_visitedIds)
        if (Array.isArray(progressList) && progressList.length > 0) {
          const ipcIds = new Set<string>(
            (progressList as TutorialProgress[]).map((p) => p.tutorialId),
          )
          ipcIds.forEach((id) => visitedIds.add(id))
          _setVisitedIds(visitedIds)
          if (_localStorageAvailable) saveVisitedTutorialIds(visitedIds)
        }

        const mappedCourses = (entries ?? []).map(entryToCourse)
        // v2.6 去假：Electron 下无论空否都接管（空库时展示空列表，
        // 不再让 DEFAULT_COURSES/FEATURED_COURSES 假课程带假学习人次静默常驻）
        setCourses(mappedCourses)
        if (mappedCourses.length > 0) {
          // 精选课程：取阅读时间最长的两门作为推荐
          const sortedByReadingTime = [...entries].sort((a, b) => b.readingTime - a.readingTime)
          const featuredEntries = sortedByReadingTime.slice(0, 2)
          // 构建路径精简结构，用于计算精选课程进度
          const pathLite: RecommendedPathLite[] = Array.isArray(recommendedPaths)
            ? recommendedPaths.map((p) => ({ id: p.id, steps: p.steps.map((s) => ({ tutorialId: s.tutorialId })) }))
            : []
          _setRawPaths(pathLite)
          setFeatured(featuredEntries.map((entry, index) => {
            const base = entryToCourse(entry)
            // v2.6 去假：fallback 进度一律 0（此前传设计稿的 65/30，无学习记录也显示假进度）
            const progress = computeFeaturedProgress(entry.id, visitedIds, pathLite, 0, false)
            const cta = progress === 100 ? '复习' : progress > 0 ? '继续学习' : '开始学习'
            return {
              ...base,
              domId: index === 0 ? 'open-course' : 'open-course-2',
              cta,
              progress,
            }
          }))
        } else {
          // v2.6 去假：空库时精选与学习路径同步清空，不保留设计稿 mock
          setFeatured([])
          setPaths([])
        }

        const totalCourses = entries.length
        const totalMinutes = entries.reduce((sum, e) => sum + e.readingTime, 0)
        const totalHours = Math.round(totalMinutes / 60)
        setStats([
          { value: String(totalCourses), unit: '门课程', hint: '涵盖 Linux 运维全栈知识' },
          { value: String(totalHours), unit: '课时', hint: '基于教程阅读时间汇总' },
          { value: '—', unit: '学习人次', hint: '暂无真实用户数据' },
        ])

        // 学习路径：将 IPC 返回的 TutorialPath 映射为页面 LearningPath，保留真实 steps
        if (Array.isArray(recommendedPaths) && recommendedPaths.length > 0) {
          setPaths(recommendedPaths.map((p) => tutorialPathToLearningPath(p, visitedIds)))
        }

        // v2.3.2 修复：把 categories 写入 _categorySummaries，让 _categoryCounts 真正可用
        if (Array.isArray(categories) && categories.length > 0) {
          _setCategorySummaries(categories)
        }
      } catch (err) {
        if (cancelled) return
        console.warn('[TutorialPage] 拉取教程数据失败', err)
        message.error('教程数据加载失败，已使用本地示例数据')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  const handleOpenCourse = (id: string) => {
    _markVisited(id)
    navigate(`/tutorial/${id}`)
  }

  /**
   * RAG 混合检索（M4 Task 5）
   * 优先调用 tutorialHybridSearch（FTS5 BM25 + vec0 KNN + RRF 融合），
   * 失败时降级到 tutorialSearch（Jaccard 关键词搜索），两次都失败时设置空结果。
   */
  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim()
    if (!query) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const api = window.electronAPI
      if (!api?.tutorialHybridSearch) {
        throw new Error('tutorialHybridSearch not available')
      }
      const hybridResults = await api.tutorialHybridSearch(query)
      const items: SearchResultItem[] = hybridResults.map((r) => ({
        id: r.id,
        title: r.title,
        // TutorialHybridSearchResult.problem 字段即教程摘要
        summary: r.problem,
        // r.category 是 string，需校验后才能赋值给 TutorialCategory
        category: isValidTutorialCategory(r.category) ? r.category : undefined,
        rrfScore: r.rrfScore,
        matchSource: r.source,
      }))
      setSearchResults(items)
    } catch (err) {
      console.error('[TutorialPage] 混合检索失败，降级到 tutorialSearch', err)
      try {
        const api = window.electronAPI
        if (!api?.tutorialSearch) {
          setSearchResults([])
          return
        }
        const fallback = await api.tutorialSearch(query)
        const items: SearchResultItem[] = fallback.map((e) => ({
          id: e.id,
          title: e.title,
          summary: e.summary,
          category: e.category,
        }))
        setSearchResults(items)
      } catch (fallbackErr) {
        console.error('[TutorialPage] tutorialSearch 也失败', fallbackErr)
        setSearchResults([])
      }
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  /** 搜索框 onChange：清空时同步清掉 searchResults（恢复原课程列表） */
  const handleSearchInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setSearchQuery(val)
      if (!val.trim() && searchResults !== null) {
        setSearchResults(null)
      }
    },
    [searchResults],
  )

  const filteredCourses = useMemo(() => {
    if (activeCategory === 'all') return courses
    const allowed = new Set(UI_TO_TUTORIAL_CATEGORIES[activeCategory])
    return courses.filter((c) => allowed.has(c.category as unknown as TutorialCategory))
  }, [activeCategory, courses])

  /** 各 UI 分类的教程数量（分类数据不可用时为 null，不显示数量） */
  const _categoryCounts = useMemo(
    () => computeCategoryCounts(_categorySummaries),
    [_categorySummaries],
  )

  return (
    <main className="tut-page" style={{ height: '100%', overflowY: 'auto' }}>
      <TutorialHeader
        searchQuery={searchQuery}
        onSearchInputChange={handleSearchInputChange}
        onSearch={handleSearch}
        searching={searching}
      />
      <div className="tut-container">
        <TutorialStats stats={stats} />
        <FeaturedCourses featured={featured} onOpenCourse={handleOpenCourse} />
        <CategoryNav
          activeCategory={activeCategory}
          onSelectCategory={setActiveCategory}
          categoryCounts={_categoryCounts}
        />
        <CourseList
          loading={loading}
          filteredCourses={filteredCourses}
          searchResults={searchResults}
          searching={searching}
          onOpenCourse={handleOpenCourse}
        />
        <LearningPath paths={paths} />
      </div>
    </main>
  )
}
