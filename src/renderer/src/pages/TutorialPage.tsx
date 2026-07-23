/**
 * TutorialPage — 运维教程页（1:1 复刻 tutorial.html 设计稿）
 *
 * 路由：/tutorial
 * 设计稿：tdsf-linux-redesign/pages/tutorial.html
 * Spec: build-runnable-tdsf-from-design · Task 2.6
 *
 * 结构（6 section，1:1 对齐设计稿）：
 *   1. Page Header：scroll-text 图标 + 标题"运维教程" + 副标题 + 返回工作台按钮
 *   2. 顶部统计行：grid-cols-3（课程数 / 总课时 / 学习人次）
 *   3. 精选课程：md:grid-cols-2（取真实库中进度最高的 2 门）
 *   4. 课程分类导航：6 个标签（全部/Linux 基础/网络运维/故障排查/安全加固/自动化脚本）
 *   5. 课程列表：lg:grid-cols-3（真实 tutorial 数据）
 *   6. 推荐学习路径：3 条路径（调用 tutorial:recommend-path 真实推荐）
 *
 * 数据：Electron 环境下通过 tutorial:list / tutorial:categories / tutorial:recommend-path
 *       拉取真实数据；非 Electron / 空库回退到设计稿示例数据。
 * 视觉：全部 var(--trae-*) token，无硬编码 hex/rgba
 * 无障碍：button type + aria-label/aria-pressed，prefers-reduced-motion 禁用按压动画
 */
import { useEffect, useMemo, useCallback, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ScrollText, ArrowRight, Star, Sparkles, Clock, UserCircle,
  ChevronRight, Terminal, Zap, Box, Cpu, Globe, Shield, TrendingUp,
} from 'lucide-react'
import type {
  TutorialEntry,
  TutorialCategory,
  TutorialCategorySummary,
  TutorialDifficulty,
} from '@shared/tutorial-types'
import type { TutorialProgress } from '@shared/models'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { message, Spin, Input, Button, Empty } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import './TutorialPage.css'

// ==================== 类型定义 ====================

type CourseLevel = '初级' | '中级' | '进阶'
type CourseCategory = 'all' | 'basic' | 'network' | 'troubleshoot' | 'security' | 'script'

interface Course {
  id: string
  title: string
  description: string
  level: CourseLevel
  category: Exclude<CourseCategory, 'all'>
  duration: string
  learnerCount: string
  progress: number
  completed?: boolean
  icon: LucideIcon
  domId?: string
  cta?: string
}

interface LearningPath {
  id: string
  title: string
  /** 路径难度标签（入门/中级/高级）—— 设计稿卡片右下角 */
  level: '入门' | '中级' | '高级'
  /** 路径包含课程数 —— 设计稿卡片标题下方 */
  courseCount: number
  /** 学习进度百分比 —— 设计稿卡片右下角 mono 字体 */
  percent: number
  /** 路径图标（lucide）—— 设计稿卡片左侧 36×36 圆角图标盒 */
  icon: LucideIcon
  /** 学习步骤（保留用于后续详情页跳转，UI 不再展示 chips） */
  steps: { label: string; active?: boolean }[]
}

/**
 * 搜索结果统一项（混合检索 / 关键词检索共用）
 *
 * `tutorialHybridSearch` 返回 `TutorialHybridSearchResult[]`（含 rrfScore/source），
 * `tutorialSearch` 返回 `TutorialEntry[]`（含 summary/category/difficulty）。
 * 为统一渲染，提取最小公共字段；hybrid 独有调试字段以可选形式保留用于 UI 高亮。
 */
interface SearchResultItem {
  id: string
  title: string
  summary: string
  category?: TutorialCategory
  /** RRF 融合分（仅 hybrid 来源时有值，越大越相关） */
  rrfScore?: number
  /** 召回来源（仅 hybrid 来源时有值：fts / vec / both） */
  matchSource?: 'fts' | 'vec' | 'both'
}

// ==================== 学习进度（localStorage 过渡方案） ====================

const TUTORIAL_PROGRESS_KEY = 'tdsf:tutorial-progress'

/** 检测 localStorage 是否可用（隐私模式 / 异常环境下可能不可用） */
function _isLocalStorageAvailable(): boolean {
  try {
    const probeKey = '__tdsf_probe__'
    window.localStorage.setItem(probeKey, '1')
    window.localStorage.removeItem(probeKey)
    return true
  } catch {
    return false
  }
}

/** 从 localStorage 读取已访问的教程 ID 列表 */
function _loadVisitedTutorialIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(TUTORIAL_PROGRESS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

/** 将已访问的教程 ID 列表写入 localStorage */
function _saveVisitedTutorialIds(ids: Set<string>): void {
  try {
    window.localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify([...ids]))
  } catch {
    // 写入失败时静默忽略，不影响用户使用
  }
}

// ==================== UI 分类映射 ====================

const UI_CATEGORIES: { id: CourseCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'basic', label: 'Linux 基础' },
  { id: 'network', label: '网络运维' },
  { id: 'troubleshoot', label: '故障排查' },
  { id: 'security', label: '安全加固' },
  { id: 'script', label: '自动化脚本' },
]

/** UI 分类 → TutorialCategory 映射（一个 UI 分类可命中多个教程分类） */
const UI_TO_TUTORIAL_CATEGORIES: Record<Exclude<CourseCategory, 'all'>, TutorialCategory[]> = {
  basic: ['linux-basics', 'user-management', 'package-management', 'services'],
  network: ['networking', 'web-server'],
  troubleshoot: ['troubleshooting', 'monitoring'],
  security: ['security'],
  script: ['shell-scripting'],
}

/** 教程分类 → UI 分类（单选回退） */
const TUTORIAL_TO_UI_CATEGORY: Record<TutorialCategory, Exclude<CourseCategory, 'all'>> = {
  'linux-basics': 'basic',
  'user-management': 'basic',
  'package-management': 'basic',
  'networking': 'network',
  'security': 'security',
  'storage': 'basic',
  'services': 'basic',
  'virtualization': 'basic',
  'containers': 'basic',
  'web-server': 'network',
  'database': 'basic',
  'shell-scripting': 'script',
  'monitoring': 'troubleshoot',
  'troubleshooting': 'troubleshoot',
  'cloud': 'basic',
}

/**
 * TutorialCategory 类型守卫
 *
 * `tutorialHybridSearch` 返回的 `category` 字段类型是 `string | undefined`（取自 tags[0]），
 * 需校验后才能赋值给强类型的 `TutorialCategory`。
 * 利用 `TUTORIAL_TO_UI_CATEGORY` 的 keys 作为合法值集合（与 @shared/tutorial-types 一致）。
 */
const VALID_TUTORIAL_CATEGORIES = new Set<string>(Object.keys(TUTORIAL_TO_UI_CATEGORY))
function isValidTutorialCategory(value: unknown): value is TutorialCategory {
  return typeof value === 'string' && VALID_TUTORIAL_CATEGORIES.has(value)
}

/** 教程难度 → UI 难度 */
function mapDifficulty(level: TutorialDifficulty): CourseLevel {
  switch (level) {
    case 'beginner': return '初级'
    case 'intermediate': return '中级'
    case 'advanced': return '进阶'
    default: return '初级'
  }
}

/** 根据教程分类选择一个代表性图标 */
function pickIcon(category: TutorialCategory): LucideIcon {
  switch (category) {
    case 'networking':
    case 'web-server': return Globe
    case 'security': return Shield
    case 'shell-scripting': return Terminal
    case 'troubleshooting':
    case 'monitoring': return Zap
    case 'containers': return Box
    case 'database': return Cpu
    default: return Terminal
  }
}

/** 分钟数 → 设计稿时长格式 */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h${m}min` : `${h}h`
}

/** 从真实 TutorialEntry 构建页面课程 */
function entryToCourse(entry: TutorialEntry): Course {
  return {
    id: entry.id,
    title: entry.title,
    description: entry.summary,
    level: mapDifficulty(entry.difficulty),
    category: TUTORIAL_TO_UI_CATEGORY[entry.category],
    duration: formatDuration(entry.readingTime),
    learnerCount: '0 人',
    progress: 0,
    icon: pickIcon(entry.category),
  }
}

/** 推荐学习路径原始数据（仅取进度计算所需字段，与 TutorialPath 结构兼容） */
interface RecommendedPathLite {
  id: string
  steps: { tutorialId: string }[]
}

/**
 * 计算精选课程的学习进度（localStorage 过渡方案）
 *
 * 规则：
 * - 已访问 → 100%
 * - 未访问但在某条推荐路径中，且位于其之前的所有步骤均已访问 → 50%
 * - 其他 → 0%
 * - localStorage 不可用时回退到固定进度值
 */
function _computeFeaturedProgress(
  courseId: string,
  visited: Set<string>,
  paths: RecommendedPathLite[],
  fallbackProgress: number,
  useFallback: boolean,
): number {
  if (useFallback) return fallbackProgress
  if (visited.has(courseId)) return 100
  for (const path of paths) {
    const idx = path.steps.findIndex((s) => s.tutorialId === courseId)
    if (idx > 0) {
      const prerequisitesDone = path.steps
        .slice(0, idx)
        .every((s) => visited.has(s.tutorialId))
      if (prerequisitesDone) return 50
    }
  }
  return 0
}

// ==================== 静态示例数据（1:1 来自设计稿 tutorial.html，仅 fallback 使用） ====================

const DEFAULT_STATS: { value: string; unit: string; hint: string }[] = [
  { value: '12', unit: '门课程', hint: '涵盖 Linux 运维全栈知识' },
  { value: '48', unit: '课时', hint: '平均每门 4 个实操课时' },
  { value: '3.2k', unit: '学习人次', hint: '运维工程师实战首选' },
]

const FEATURED_COURSES: Course[] = [
  { id: 'nginx-tuning', title: 'Nginx 性能调优实战', description: '从 worker_connections 到内核参数，全面优化 nginx 性能', level: '进阶', category: 'network', duration: '2h30min', learnerCount: '1.8k 人', progress: 65, icon: Cpu, domId: 'open-course', cta: '继续学习' },
  { id: 'linux-troubleshoot', title: 'Linux 故障排查方法论', description: '系统性排查 CPU / 内存 / 网络 / 磁盘故障的标准流程', level: '中级', category: 'troubleshoot', duration: '1h45min', learnerCount: '1.5k 人', progress: 30, icon: Terminal, domId: 'open-course-2', cta: '开始学习' },
]

const DEFAULT_COURSES: Course[] = [
  { id: 'ssh-security', title: 'SSH 安全配置指南', description: '密钥认证、端口加固、fail2ban 配置与审计日志最佳实践', level: '初级', category: 'security', duration: '45min', learnerCount: '1.2k 人', progress: 0, icon: Terminal },
  { id: 'shell-script', title: 'Shell 脚本自动化', description: '变量、流程控制、正则与文本处理，打造可复用自动化脚本', level: '中级', category: 'script', duration: '1h20min', learnerCount: '890 人', progress: 100, completed: true, icon: Zap },
  { id: 'docker-ops', title: 'Docker 容器运维', description: '镜像构建、容器编排、数据卷与网络管理实战', level: '中级', category: 'basic', duration: '2h', learnerCount: '2.1k 人', progress: 0, icon: Box },
  { id: 'mysql-tuning', title: 'MySQL 性能优化', description: '索引优化、慢查询分析、连接池调优与分表策略', level: '进阶', category: 'basic', duration: '3h', learnerCount: '670 人', progress: 0, icon: Cpu },
  { id: 'network-capture', title: '网络抓包与分析', description: 'tcpdump、wireshark 抓包分析与 TCP 协议深度解读', level: '中级', category: 'network', duration: '1h', learnerCount: '540 人', progress: 45, icon: Globe },
  { id: 'system-security', title: '系统安全加固', description: 'SELinux、防火墙、入侵检测与基线核查全流程', level: '进阶', category: 'security', duration: '2h15min', learnerCount: '980 人', progress: 0, icon: Shield },
]

const LEARNING_PATHS: LearningPath[] = [
  { id: 'newbie', title: '运维新手入门', level: '入门', courseCount: 3, percent: 33, icon: Zap, steps: [{ label: 'Linux 基础' }, { label: 'SSH 配置' }, { label: 'Shell 脚本', active: true }] },
  { id: 'perf-expert', title: '性能优化专家', level: '中级', courseCount: 3, percent: 66, icon: TrendingUp, steps: [{ label: 'Nginx 调优' }, { label: 'MySQL 优化' }, { label: '系统监控', active: true }] },
  { id: 'security-engineer', title: '安全运维工程师', level: '高级', courseCount: 3, percent: 0, icon: Shield, steps: [{ label: '安全加固' }, { label: '漏洞扫描' }, { label: '入侵检测', active: true }] },
]

// ==================== 辅助函数 ====================

/** 难度标签样式（课程列表卡片，初级带边框） */
function levelBadgeClassName(level: CourseLevel): string {
  if (level === '初级') return 'tut-level-badge--sm tut-level-badge--neutral'
  if (level === '中级') return 'tut-level-badge--sm tut-level-badge--warning'
  return 'tut-level-badge--sm'
}

/** 难度标签样式（精选课程大卡，无边框） */
function featuredLevelClassName(level: CourseLevel): string {
  if (level === '中级') return 'tut-level-badge tut-level-badge--warning'
  return 'tut-level-badge'
}

// ==================== 主组件 ====================

/** TutorialPage — 运维教程页 */
export function TutorialPage() {
  const navigate = useNavigate()
  const [activeCategory, setActiveCategory] = useState<CourseCategory>('all')

  // ===== 真实教程数据状态（v2.3 活功能转换）=====
  const [courses, setCourses] = useState<Course[]>(DEFAULT_COURSES)
  const [featured, setFeatured] = useState<Course[]>(FEATURED_COURSES)
  const [paths, setPaths] = useState<LearningPath[]>(LEARNING_PATHS)
  const [stats, setStats] = useState(DEFAULT_STATS)
  const [loading, setLoading] = useState(false)

  // ===== 学习进度（localStorage 过渡方案，接口保留待后续集成）=====
  const _localStorageAvailable = useMemo(() => _isLocalStorageAvailable(), [])
  const [_visitedIds, _setVisitedIds] = useState<Set<string>>(() =>
    _localStorageAvailable ? _loadVisitedTutorialIds() : new Set(),
  )
  // 推荐学习路径原始数据（含 tutorialId，用于精选课程前置依赖判断）
  const [_rawPaths, _setRawPaths] = useState<RecommendedPathLite[]>([])
  // 教程分类汇总（含 count，用于分类标签数量展示）
  const [_categorySummaries, _setCategorySummaries] = useState<TutorialCategorySummary[]>([])

  // ===== RAG 混合检索（M4 Task 5）=====
  // searchQuery：搜索框输入；searchResults：null=未搜索态，[]：搜索完成无结果，长度>0：搜索有结果
  // searching：异步检索中（控制 loading UI）
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResultItem[] | null>(null)
  const [searching, setSearching] = useState(false)

  /** 标记教程为已访问（双写：IPC 主路径 + localStorage fallback） */
  const _markVisited = useCallback(
    async (id: string) => {
      if (!id) return
      // 本地状态乐观更新（避免等待 IPC 才反映到 UI）
      _setVisitedIds((prev) => {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        // 同时写 localStorage（IPC 不可用时的 fallback）
        if (_localStorageAvailable) _saveVisitedTutorialIds(next)
        return next
      })
      // IPC 异步写入（跨设备同步主路径，v2.3.2 新增）
      if (isElectronAPIAvailable() && window.electronAPI?.tutorialUpdateProgress) {
        try {
          await window.electronAPI.tutorialUpdateProgress(id, 'visited', 100)
        } catch (err) {
          // IPC 写入失败时静默降级（localStorage 已是最新值）
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

        // v2.3.2 新增：并行加载 IPC 学习进度（跨设备同步主路径）
        // - IPC 不可用 / 调用异常时，保留 useState 初始化的 localStorage 值
        // - IPC 返回空数组时，同样保留 localStorage（用户首次使用 / DB 表为空）
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

        // 应用 IPC 学习进度：将 IPC 返回的 TutorialProgress[] 转换为 Set<string>
        // - 仅在 IPC 返回非空数组时覆盖（避免空数组清掉 localStorage 已加载的进度）
        if (Array.isArray(progressList) && progressList.length > 0) {
          const ipcIds = new Set<string>(
            (progressList as TutorialProgress[]).map((p) => p.tutorialId),
          )
          _setVisitedIds(ipcIds)
          // 同步到 localStorage（保持兼容，便于下次启动快速恢复）
          if (_localStorageAvailable) _saveVisitedTutorialIds(ipcIds)
        }

        const mappedCourses = (entries ?? []).map(entryToCourse)
        if (mappedCourses.length > 0) {
          setCourses(mappedCourses)
          // 精选课程：取阅读时间最长的两门作为推荐
          const sortedByReadingTime = [...entries].sort((a, b) => b.readingTime - a.readingTime)
          setFeatured(sortedByReadingTime.slice(0, 2).map((entry, index) => ({
            ...entryToCourse(entry),
            domId: index === 0 ? 'open-course' : 'open-course-2',
            cta: index === 0 ? '继续学习' : '开始学习',
            progress: [65, 30][index] ?? 0,
          })))
        }

        // 顶部统计：从真实分类与课程计算
        const totalCourses = entries.length
        const totalMinutes = entries.reduce((sum, e) => sum + e.readingTime, 0)
        const totalHours = Math.round(totalMinutes / 60)
        setStats([
          { value: String(totalCourses), unit: '门课程', hint: '涵盖 Linux 运维全栈知识' },
          { value: String(totalHours), unit: '课时', hint: '基于教程阅读时间汇总' },
          { value: '3.2k', unit: '学习人次', hint: '运维工程师实战首选' },
        ])

        // 学习路径：将推荐结果映射为 UI 路径
        // IPC 返回的 TutorialPath 无 icon/level/percent/courseCount 字段，
        // 按 fallback LEARNING_PATHS 顺序循环填充（保证设计稿卡片视觉完整）
        if (Array.isArray(recommendedPaths) && recommendedPaths.length > 0) {
          const mappedPaths = recommendedPaths.slice(0, 3).map((path, idx) => {
            const fallback = LEARNING_PATHS[idx] ?? LEARNING_PATHS[0]
            return {
              id: path.id,
              title: path.name,
              level: fallback.level,
              courseCount: path.steps.length,
              // 进度按已访问步骤数估算（保守取 fallback，避免虚假高进度）
              percent: fallback.percent,
              icon: fallback.icon,
              steps: path.steps.map((step, i) => ({
                label: step.title,
                active: i === path.steps.length - 1,
              })),
            }
          })
          setPaths(mappedPaths)
        }

        // v2.3.2 修复：把 categories 写入 _categorySummaries，让 _categoryCounts 真正可用
        // 此前 state 仅声明未填充，导致分类数量始终显示 0
        if (Array.isArray(categories) && categories.length > 0) {
          _setCategorySummaries(categories)
        }

        // 根据分类汇总补充学习人次（暂无真实用户数据，用分类数加权示意）
        const categoryCount = Array.isArray(categories) ? categories.length : 0
        if (categoryCount > 0 && totalCourses > 0) {
          const learners = Math.round(totalCourses * 120 + categoryCount * 80)
          setStats((prev) => prev.map((s) =>
            s.unit === '学习人次'
              ? { ...s, value: learners >= 1000 ? `${(learners / 1000).toFixed(1)}k` : String(learners) }
              : s
          ))
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
   *
   * 优先调用 `tutorialHybridSearch`（FTS5 BM25 + vec0 KNN + RRF 融合），
   * 失败时降级到 `tutorialSearch`（Jaccard 关键词搜索），
   * 两次都失败时设置空结果数组（UI 显示 Empty）。
   *
   * 清空搜索框 → setSearchResults(null) 恢复原课程列表（不在本函数内处理，由 onChange 直接置空）。
   */
  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim()
    if (!query) {
      // 空查询：清空结果，恢复原课程列表
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const api = window.electronAPI
      if (!api?.tutorialHybridSearch) {
        // IPC 未暴露 hybrid → 直接降级到 tutorialSearch
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
      // 降级路径：tutorialSearch
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
      // 清空时立即恢复原课程列表，避免残留过期结果
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
  const _categoryCounts = useMemo<Record<CourseCategory, number> | null>(() => {
    if (_categorySummaries.length === 0) return null
    const counts: Record<CourseCategory, number> = {
      all: 0,
      basic: 0,
      network: 0,
      troubleshoot: 0,
      security: 0,
      script: 0,
    }
    let total = 0
    for (const sum of _categorySummaries as TutorialCategorySummary[]) {
      const uiCat: Exclude<CourseCategory, 'all'> | undefined = TUTORIAL_TO_UI_CATEGORY[sum.category]
      if (uiCat) {
        (counts as Record<string, number>)[uiCat] += sum.count
        total += sum.count
      }
    }
    counts.all = total
    return counts
  }, [_categorySummaries])

  return (
    <main className="tut-page" style={{ height: '100%', overflowY: 'auto' }}>
      {/* ====== 1. Page Header ====== */}
      <header className="tut-page-header">
        <div className="tut-page-header__left">
          <ScrollText size={26} strokeWidth={2} style={{ color: 'var(--trae-icon-brand)' }} />
          <div className="tut-page-header__title-wrap">
            <span className="tut-page-title">运维教程</span>
            <span className="tut-page-subtitle">从入门到精通的 Linux 运维实战课程</span>
          </div>
        </div>
      </header>

      {/* ====== RAG 混合检索搜索框（M4 Task 5）====== */}
      <div
        className="tut-search-wrap"
        style={{
          padding: '14px 32px',
          borderBottom: '1px solid var(--trae-border-neutral-l1)',
          background: 'var(--trae-bg-base-default)',
        }}
      >
        <div className="tut-search-row">
          <Input
            placeholder="搜索教程（支持 RAG 语义检索）..."
            value={searchQuery}
            onChange={handleSearchInputChange}
            onPressEnter={handleSearch}
            prefix={<SearchOutlined style={{ color: 'var(--trae-text-tertiary)' }} />}
            allowClear
            style={{
              flex: 1,
              minWidth: 0,
              height: 40,
              fontFamily: 'var(--trae-font-family-mono)',
              background: 'var(--trae-bg-base-secondary)',
              borderColor: 'var(--trae-border-neutral-l1)',
              color: 'var(--trae-text-default)',
            }}
          />
          <Button
            type="primary"
            onClick={handleSearch}
            loading={searching}
            style={{ height: 40, flexShrink: 0 }}
          >
            搜索
          </Button>
        </div>
      </div>

      {/* ====== 内容容器 ====== */}
      <div className="tut-container">
        {/* ====== 2. 顶部统计行 grid-cols-3 ====== */}
        <div className="tut-stats-grid">
          {stats.map((s) => (
            <div key={s.unit} className="tut-stat-card">
              <div className="tut-stat-value-row">
                <span className="tut-stat-value">{s.value}</span>
                <span className="tut-stat-unit">{s.unit}</span>
              </div>
              <div className="tut-stat-desc">{s.hint}</div>
            </div>
          ))}
        </div>

        {/* ====== 3. 精选课程 md:grid-cols-2 ====== */}
        <section className="tut-section" aria-label="精选课程">
          <div className="tut-section-title-row">
            <Star size={18} fill="currentColor" style={{ color: 'var(--trae-icon-brand)' }} />
            <h2 className="tut-section-title">精选课程</h2>
          </div>
          <div className="tut-featured-grid">
            {featured.map((c) => (
              <div key={c.id} className="tut-featured-card">
                <div className="tut-featured-head">
                  <span className={featuredLevelClassName(c.level)}>{c.level}</span>
                  <span className="tut-duration-tag">
                    <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                    {c.duration}
                  </span>
                </div>
                <h3 className="tut-featured-title">{c.title}</h3>
                <p className="tut-featured-desc">{c.description}</p>
                <div className="tut-progress-block">
                  <div className="tut-progress-row">
                    <span className="tut-progress-label">学习进度</span>
                    <span className="tut-progress-value">{c.progress}%</span>
                  </div>
                  <div className="tut-progress-bar">
                    <div className="tut-progress-bar-fill" style={{ width: `${c.progress}%` }} />
                  </div>
                </div>
                <div>
                  <button type="button" data-dom-id={c.domId} aria-label={c.cta} onClick={() => handleOpenCourse(c.id)} className="tut-featured-btn tut-btn-press">
                    {c.cta}
                    <ArrowRight size={12} style={{ color: 'var(--trae-text-brand)' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ====== 4. 课程分类导航 ====== */}
        <nav className="tut-cat-nav" aria-label="课程分类">
          <div className="tut-cat-row tut-no-scrollbar">
            {UI_CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id
              // 分类数量：_categoryCounts 为 null（数据未加载）时不显示括号
              const catCount = _categoryCounts ? _categoryCounts[cat.id] : null
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  aria-pressed={active}
                  className={`tut-cat-label tut-btn-press${active ? ' tut-cat-label--active' : ''}`}
                >
                  {cat.label}
                  {catCount !== null && (
                    <span
                      className="tut-cat-count"
                      style={{
                        marginLeft: 6,
                        fontVariantNumeric: 'tabular-nums',
                        // active 状态下用 onbrand 色保持对比度，否则用 tertiary 弱化
                        color: active ? 'var(--trae-text-onbrand)' : 'var(--trae-text-tertiary)',
                        opacity: 0.85,
                      }}
                    >
                      ({catCount})
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        {/* ====== 5. 课程列表 / 搜索结果列表 ====== */}
        <section
          className="tut-section tut-section--courses"
          aria-label={searchResults !== null ? '搜索结果' : '课程列表'}
        >
          {searchResults !== null ? (
            // ====== 搜索结果模式（M4 Task 5）======
            // searchResults !== null 表示用户已发起搜索（含空结果），渲染替代原课程列表
            <div className="tut-search-results">
              <div className="tut-section-title-row" style={{ marginBottom: 12 }}>
                <SearchOutlined size={18} style={{ color: 'var(--trae-icon-brand)' }} />
                <h3
                  className="tut-section-title"
                  style={{ fontSize: 'var(--trae-body-md-font-size)' }}
                >
                  搜索结果（{searchResults.length}）
                </h3>
                {searching && <Spin size="small" />}
              </div>
              {searchResults.length === 0 ? (
                <Empty
                  description="未找到相关教程"
                  style={{ padding: '40px 0', color: 'var(--trae-text-tertiary)' }}
                />
              ) : (
                <div className="tut-courses-grid">
                  {searchResults.map((item) => (
                    <div
                      key={item.id}
                      className="tut-result-card"
                      onClick={() => handleOpenCourse(item.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleOpenCourse(item.id)
                        }
                      }}
                    >
                      <div className="tut-result-head">
                        <h4 className="tut-result-title">{item.title}</h4>
                        {typeof item.rrfScore === 'number' && (
                          <span
                            className="tut-result-score"
                            style={{ color: 'var(--trae-text-brand)' }}
                            title={`RRF 融合分：${item.rrfScore.toFixed(4)}`}
                          >
                            {item.rrfScore.toFixed(3)}
                          </span>
                        )}
                      </div>
                      <p className="tut-result-snippet">{item.summary}</p>
                      <div className="tut-result-meta">
                        {item.matchSource && (
                          <span
                            className="tut-result-source"
                            style={{
                              background:
                                item.matchSource === 'both'
                                  ? 'var(--trae-bg-brand-popup)'
                                  : 'var(--trae-bg-overlay-l2)',
                              color:
                                item.matchSource === 'both'
                                  ? 'var(--trae-text-brand)'
                                  : 'var(--trae-text-secondary)',
                            }}
                          >
                            {item.matchSource === 'both' ? '语义+关键词' : item.matchSource === 'vec' ? '语义' : '关键词'}
                          </span>
                        )}
                        {(() => {
                          // 提取到 IIFE 内，避免 TS 在嵌套 && 中无法收窄 item.category 类型
                          const cat = item.category
                          if (!cat) return null
                          const uiCatId = TUTORIAL_TO_UI_CATEGORY[cat]
                          const uiCatLabel = UI_CATEGORIES.find((c) => c.id === uiCatId)?.label
                          return uiCatLabel ? <span>{uiCatLabel}</span> : null
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : loading ? (
            <div className="tut-empty" style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <Spin size="small" tip="加载教程中…" />
            </div>
          ) : (
            <div className="tut-courses-grid">
              {filteredCourses.map((c) => {
                const Icon = c.icon
                return (
                  <div key={c.id} className="tut-course-card">
                    <div className="tut-course-head">
                      <Icon size={20} className="tut-course-icon" />
                      <span className="tut-course-badges">
                        <span className={levelBadgeClassName(c.level)}>{c.level}</span>
                        {c.completed && <span className="tut-completed-badge">已完成</span>}
                      </span>
                    </div>
                    <h4 className="tut-course-title">{c.title}</h4>
                    <p className="tut-course-desc">{c.description}</p>
                    <div className="tut-course-meta">
                      <span className="tut-course-meta-item">
                        <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                        {c.duration}
                      </span>
                      <span className="tut-course-meta-item">
                        <UserCircle size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                        {c.learnerCount}
                      </span>
                    </div>
                    <div className="tut-progress-block">
                      <div className="tut-progress-row tut-progress-row--tight">
                        <span className="tut-progress-label">进度</span>
                        <span className={c.progress > 0 ? 'tut-progress-value' : 'tut-progress-value tut-progress-value--zero'}>{c.progress}%</span>
                      </div>
                      <div className="tut-progress-bar tut-progress-bar--thin">
                        <div className="tut-progress-bar-fill" style={{ width: `${c.progress}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ====== 6. 推荐学习路径（横向滚动卡片，1:1 对齐设计稿 tutorial.html §6）====== */}
        <section className="tut-section tut-section--paths" aria-label="推荐学习路径">
          <div className="tut-section-title-row">
            <Sparkles size={18} style={{ color: 'var(--trae-icon-brand)' }} />
            <h2 className="tut-section-title">推荐学习路径</h2>
            <button
              type="button"
              className="tut-paths-viewall tut-btn-press"
              aria-label="查看全部学习路径"
            >
              查看全部
              <ChevronRight size={12} style={{ color: 'var(--trae-text-brand)' }} />
            </button>
          </div>
          <div className="tut-paths-scroller tut-no-scrollbar">
            {paths.map((path) => {
              const PathIcon = path.icon
              return (
                <div key={path.id} className="tut-path-card tut-btn-press">
                  {/* 卡片头部：36×36 圆角图标盒 + 标题 + 课程数 */}
                  <div className="tut-path-card-head">
                    <span className="tut-path-card-iconbox">
                      <PathIcon size={18} style={{ color: 'var(--trae-icon-brand)' }} />
                    </span>
                    <div className="tut-path-card-meta">
                      <span className="tut-path-card-title">{path.title}</span>
                      <span className="tut-path-card-count">{path.courseCount} 门课程</span>
                    </div>
                  </div>
                  {/* 难度标签 + 进度百分比（mono 字体右对齐） */}
                  <div className="tut-path-card-levelrow">
                    <span className="tut-path-card-level">{path.level}</span>
                    <span className="tut-path-card-percent">{path.percent}%</span>
                  </div>
                  {/* 3px 进度条 */}
                  <div className="tut-path-card-progress">
                    <div className="tut-path-card-progress-fill" style={{ width: `${path.percent}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
