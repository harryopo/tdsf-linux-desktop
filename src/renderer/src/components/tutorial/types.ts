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

export interface LearningPath {
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

// ==================== 静态示例数据（1:1 来自设计稿 tutorial.html，仅 fallback 使用） ====================

export const DEFAULT_STATS: StatItem[] = [
  { value: '12', unit: '门课程', hint: '涵盖 Linux 运维全栈知识' },
  { value: '48', unit: '课时', hint: '平均每门 4 个实操课时' },
  { value: '3.2k', unit: '学习人次', hint: '运维工程师实战首选' },
]

export const FEATURED_COURSES: Course[] = [
  { id: 'nginx-tuning', title: 'Nginx 性能调优实战', description: '从 worker_connections 到内核参数，全面优化 nginx 性能', level: '进阶', category: 'network', duration: '2h30min', learnerCount: '1.8k 人', progress: 65, icon: Cpu, domId: 'open-course', cta: '继续学习' },
  { id: 'linux-troubleshoot', title: 'Linux 故障排查方法论', description: '系统性排查 CPU / 内存 / 网络 / 磁盘故障的标准流程', level: '中级', category: 'troubleshoot', duration: '1h45min', learnerCount: '1.5k 人', progress: 30, icon: Terminal, domId: 'open-course-2', cta: '开始学习' },
]

export const DEFAULT_COURSES: Course[] = [
  { id: 'ssh-security', title: 'SSH 安全配置指南', description: '密钥认证、端口加固、fail2ban 配置与审计日志最佳实践', level: '初级', category: 'security', duration: '45min', learnerCount: '1.2k 人', progress: 0, icon: Terminal },
  { id: 'shell-script', title: 'Shell 脚本自动化', description: '变量、流程控制、正则与文本处理，打造可复用自动化脚本', level: '中级', category: 'script', duration: '1h20min', learnerCount: '890 人', progress: 100, completed: true, icon: Zap },
  { id: 'docker-ops', title: 'Docker 容器运维', description: '镜像构建、容器编排、数据卷与网络管理实战', level: '中级', category: 'basic', duration: '2h', learnerCount: '2.1k 人', progress: 0, icon: Box },
  { id: 'mysql-tuning', title: 'MySQL 性能优化', description: '索引优化、慢查询分析、连接池调优与分表策略', level: '进阶', category: 'basic', duration: '3h', learnerCount: '670 人', progress: 0, icon: Cpu },
  { id: 'network-capture', title: '网络抓包与分析', description: 'tcpdump、wireshark 抓包分析与 TCP 协议深度解读', level: '中级', category: 'network', duration: '1h', learnerCount: '540 人', progress: 45, icon: Globe },
  { id: 'system-security', title: '系统安全加固', description: 'SELinux、防火墙、入侵检测与基线核查全流程', level: '进阶', category: 'security', duration: '2h15min', learnerCount: '980 人', progress: 0, icon: Shield },
]

export const LEARNING_PATHS: LearningPath[] = [
  { id: 'newbie', title: '运维新手入门', level: '入门', courseCount: 3, percent: 33, icon: Zap, steps: [{ label: 'Linux 基础' }, { label: 'SSH 配置' }, { label: 'Shell 脚本', active: true }] },
  { id: 'perf-expert', title: '性能优化专家', level: '中级', courseCount: 3, percent: 66, icon: TrendingUp, steps: [{ label: 'Nginx 调优' }, { label: 'MySQL 优化' }, { label: '系统监控', active: true }] },
  { id: 'security-engineer', title: '安全运维工程师', level: '高级', courseCount: 3, percent: 0, icon: Shield, steps: [{ label: '安全加固' }, { label: '漏洞扫描' }, { label: '入侵检测', active: true }] },
]
