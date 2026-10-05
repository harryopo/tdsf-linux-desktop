/**
 * TutorialPage 共享类型、常量、辅助函数与静态数据
 *
 * 从 pages/TutorialPage.tsx 提取，供主页面与 6 个子组件复用。
 * 包含：UI 类型定义 / 分类映射 / 难度与时长转换 / localStorage 进度工具 /
 *       静态示例数据（fallback）/ 难度标签样式 / 分类数量计算。
 */
import type { LucideIcon } from 'lucide-react'
import {
  Globe, Shield, Terminal, Zap, Box, Cpu, TrendingUp,
} from 'lucide-react'
import type {
  TutorialEntry,
  TutorialCategory,
  TutorialCategorySummary,
  TutorialDifficulty,
} from '@shared/tutorial-types'
import type { PathStep, TutorialPath } from '@/types/electron'

// ==================== 类型定义 ====================

export type CourseLevel = '初级' | '中级' | '进阶'
export type CourseCategory = 'all' | 'basic' | 'network' | 'troubleshoot' | 'security' | 'script'

export interface Course {
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

/** 学习路径单步节点（横向时间线） */
export interface LearningPathStep {
  /** 步骤名称 —— 设计稿节点下方粗体文字 */
  label: string
  /** 步骤描述 —— 设计稿节点下方小字（可选） */
  description?: string
  /** 步骤状态：completed=已完成（勾选）/ current=进行中（脉冲）/ upcoming=未开始（虚化） */
  status: 'completed' | 'current' | 'upcoming'
}

export interface LearningPath {
  id: string
  title: string
  /** 路径难度标签（初级/中级/进阶）—— 与课程难度保持一致 */
  level: CourseLevel
  /** 路径包含课程数 */
  courseCount: number
  /** 学习进度百分比 —— 设计稿进度条填充宽度 */
  percent: number
  /** 已完成步骤数 —— 设计稿 "2/5 已完成" 徽标分子 */
  completedCount: number
  /** 总步骤数 —— 设计稿 "2/5 已完成" 徽标分母 */
  totalCount: number
  /** 路径图标（lucide）—— 设计稿进度头左侧 trending-up 图标 */
  icon: LucideIcon
  /** 学习步骤（横向时间线节点，5 个） */
  steps: LearningPathStep[]
}

/**
 * 搜索结果统一项（混合检索 / 关键词检索共用）
 *
 * `tutorialHybridSearch` 返回 `TutorialHybridSearchResult[]`（含 rrfScore/source），
 * `tutorialSearch` 返回 `TutorialEntry[]`（含 summary/category/difficulty）。
 * 为统一渲染，提取最小公共字段；hybrid 独有调试字段以可选形式保留用于 UI 高亮。
 */
export interface SearchResultItem {
  id: string
  title: string
  summary: string
  category?: TutorialCategory
  /** RRF 融合分（仅 hybrid 来源时有值，越大越相关） */
  rrfScore?: number
  /** 召回来源（仅 hybrid 来源时有值：fts / vec / both） */
  matchSource?: 'fts' | 'vec' | 'both'
}

/** 顶部统计行单卡数据 */
export interface StatItem {
  value: string
  unit: string
  hint: string
}

/** 推荐学习路径原始数据（仅取进度计算所需字段，与 TutorialPath 结构兼容） */
export interface RecommendedPathLite {
  id: string
  steps: { tutorialId: string }[]
}

// ==================== localStorage 进度工具（过渡方案） ====================

export const TUTORIAL_PROGRESS_KEY = 'tdsf:tutorial-progress'

/** 检测 localStorage 是否可用（隐私模式 / 异常环境下可能不可用） */
export function isLocalStorageAvailable(): boolean {
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
export function loadVisitedTutorialIds(): Set<string> {
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
export function saveVisitedTutorialIds(ids: Set<string>): void {
  try {
    window.localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify([...ids]))
  } catch {
    // 写入失败时静默忽略，不影响用户使用
  }
}

// ==================== UI 分类映射 ====================

export const UI_CATEGORIES: { id: CourseCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'basic', label: 'Linux 基础' },
  { id: 'network', label: '网络运维' },
  { id: 'troubleshoot', label: '故障排查' },
  { id: 'security', label: '安全加固' },
  { id: 'script', label: '自动化脚本' },
]

/** UI 分类 → TutorialCategory 映射（一个 UI 分类可命中多个教程分类） */
export const UI_TO_TUTORIAL_CATEGORIES: Record<Exclude<CourseCategory, 'all'>, TutorialCategory[]> = {
  basic: ['linux-basics', 'user-management', 'package-management', 'services'],
  network: ['networking', 'web-server'],
  troubleshoot: ['troubleshooting', 'monitoring'],
  security: ['security'],
  script: ['shell-scripting'],
}

/** 教程分类 → UI 分类（单选回退） */
export const TUTORIAL_TO_UI_CATEGORY: Record<TutorialCategory, Exclude<CourseCategory, 'all'>> = {
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

const VALID_TUTORIAL_CATEGORIES = new Set<string>(Object.keys(TUTORIAL_TO_UI_CATEGORY))

/**
 * TutorialCategory 类型守卫
 *
 * `tutorialHybridSearch` 返回的 `category` 字段类型是 `string | undefined`（取自 tags[0]），
 * 需校验后才能赋值给强类型的 `TutorialCategory`。
 */
export function isValidTutorialCategory(value: unknown): value is TutorialCategory {
  return typeof value === 'string' && VALID_TUTORIAL_CATEGORIES.has(value)
}

// ==================== 转换辅助函数 ====================

/** 教程难度 → UI 难度 */
export function mapDifficulty(level: TutorialDifficulty): CourseLevel {
  switch (level) {
    case 'beginner': return '初级'
    case 'intermediate': return '中级'
    case 'advanced': return '进阶'
    default: return '初级'
  }
}

/** 根据教程分类选择一个代表性图标 */
export function pickIcon(category: TutorialCategory): LucideIcon {
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
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h${m}min` : `${h}h`
}

/** 从真实 TutorialEntry 构建页面课程 */
export function entryToCourse(entry: TutorialEntry): Course {
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

/** 将主进程返回的 PathStep 映射为 UI 时间线节点 */
function mapPathStep(
  step: PathStep,
  index: number,
  visited: Set<string>,
  prevTutorialId?: string,
): LearningPathStep {
  const isCompleted = visited.has(step.tutorialId)
  // 第一个未完成的步骤标记为 current，其前为 completed，其后为 upcoming
  let status: LearningPathStep['status'] = 'upcoming'
  if (isCompleted) {
    status = 'completed'
  } else if (index === 0 || (prevTutorialId && visited.has(prevTutorialId))) {
    status = 'current'
  }
  const rawDesc = step.why || step.summary || ''
  const description = rawDesc.length > 40 ? `${rawDesc.slice(0, 40)}…` : rawDesc
  return {
    label: step.title,
    description,
    status,
  }
}

/**
 * 将主进程返回的 TutorialPath 映射为页面 LearningPath
 *
 * 进度计算：
 * - 已访问（visited 包含 tutorialId）→ completed
 * - 第一个未访问且其前一步已完成（或是首步）→ current
 * - 其余 → upcoming
 */
export function tutorialPathToLearningPath(
  path: TutorialPath,
  visited?: Set<string>,
): LearningPath {
  const visitedSet = visited ?? new Set<string>()
  const steps = path.steps.map((step, index) =>
    mapPathStep(step, index, visitedSet, index > 0 ? path.steps[index - 1]?.tutorialId : undefined),
  )
  const completedCount = steps.filter((s) => s.status === 'completed').length
  const totalCount = steps.length
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return {
    id: path.id,
    title: path.name,
    level: mapDifficulty(path.targetDifficulty as TutorialDifficulty),
    courseCount: totalCount,
    percent,
    completedCount,
    totalCount,
    icon: TrendingUp,
    steps,
  }
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
export function computeFeaturedProgress(
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

/** 各 UI 分类的教程数量（分类数据不可用时为 null，不显示数量） */
export function computeCategoryCounts(
  summaries: TutorialCategorySummary[],
): Record<CourseCategory, number> | null {
  if (summaries.length === 0) return null
  const counts: Record<CourseCategory, number> = {
    all: 0,
    basic: 0,
    network: 0,
    troubleshoot: 0,
    security: 0,
    script: 0,
  }
  let total = 0
  for (const sum of summaries) {
    const uiCat: Exclude<CourseCategory, 'all'> | undefined = TUTORIAL_TO_UI_CATEGORY[sum.category]
    if (uiCat) {
      (counts as Record<string, number>)[uiCat] += sum.count
      total += sum.count
    }
  }
  counts.all = total
  return counts
}

// ==================== 难度标签样式 ====================

/** 难度标签样式（课程列表卡片，初级带边框） */
export function levelBadgeClassName(level: CourseLevel): string {
  if (level === '初级') return 'tut-level-badge--sm tut-level-badge--neutral'
  if (level === '中级') return 'tut-level-badge--sm tut-level-badge--warning'
  return 'tut-level-badge--sm'
}

/** 难度标签样式（精选课程大卡，无边框） */
export function featuredLevelClassName(level: CourseLevel): string {
  if (level === '中级') return 'tut-level-badge tut-level-badge--warning'
  return 'tut-level-badge'
}

// ==================== 静态示例数据已于阶段 F4 删除 ====================
//
// 这里原本放着设计稿 tutorial.html 的示例统计（12 门课程 / 48 课时 / 3.2k 学习人次）、
// 两门精选课、六门默认课和一条"运维工程师成长路线"。它们只在 IPC 没返回时顶位，
// 而教程库真有数据时又会全部覆盖——也就是说界面上一度出现的数字，
// 有一部分跟本机 SQLite 里的真实教程毫无关系。现在初始状态一律为空，由 TutorialPage 拉真实数据。
