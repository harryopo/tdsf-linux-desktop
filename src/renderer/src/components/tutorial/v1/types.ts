/**
 * TutorialPage v1 复刻组件 — 类型 + Mock 数据 + 辅助函数
 *
 * 设计稿：tdsf-linux-redesign/pages/tutorial.html
 *
 * 说明：从 pages/TutorialPage.tsx 拆分而来，避免主页面超 500 行
 * 导出：类型定义（Course / CourseLevel / CourseCategory / LearningPath）+
 *       Mock 数据（STATS / FEATURED_COURSES / COURSES / CATEGORIES / LEARNING_PATHS）+
 *       辅助函数（getLevelBadgeVariant / getLevelBadgeClass / levelStyle）
 */
import type { LucideIcon } from 'lucide-react'
import { Cpu, Terminal, Zap, Box, Globe, Shield } from 'lucide-react'

// ==================== 类型定义 ====================

/** 教程难度等级 */
export type CourseLevel = '初级' | '中级' | '进阶' | '专家'

/** 教程分类（用于分类导航筛选） */
export type CourseCategory =
  | 'all'
  | 'basic'
  | 'network'
  | 'troubleshoot'
  | 'security'
  | 'script'

/** 教程数据结构 */
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
}

/** 学习路径数据结构 */
export interface LearningPath {
  id: string
  title: string
  steps: { label: string; active?: boolean }[]
}

// ==================== Mock 数据 ====================

/** 顶部统计：3 列卡片 */
export const STATS: { value: string; unit: string; hint: string }[] = [
  { value: '12', unit: '门课程', hint: '涵盖 Linux 运维全栈知识' },
  { value: '48', unit: '课时', hint: '平均每门 4 个实操课时' },
  { value: '3.2k', unit: '学习人次', hint: '运维工程师实战首选' },
]

/** 精选课程：2 列大卡 */
export const FEATURED_COURSES: Course[] = [
  {
    id: 'nginx-tuning',
    title: 'Nginx 性能调优实战',
    description: '从 worker_connections 到内核参数，全面优化 nginx 性能',
    level: '进阶',
    category: 'network',
    duration: '2h30min',
    learnerCount: '1.8k 人',
    progress: 65,
    icon: Cpu,
  },
  {
    id: 'linux-troubleshoot',
    title: 'Linux 故障排查方法论',
    description: '系统性排查 CPU / 内存 / 网络 / 磁盘故障的标准流程',
    level: '中级',
    category: 'troubleshoot',
    duration: '1h45min',
    learnerCount: '1.5k 人',
    progress: 30,
    icon: Terminal,
  },
]

/** 课程列表：6 张普通卡（mock 共 8 条 = 2 精选 + 6 普通） */
export const COURSES: Course[] = [
  {
    id: 'ssh-security',
    title: 'SSH 安全配置指南',
    description: '密钥认证、端口加固、fail2ban 配置与审计日志最佳实践',
    level: '初级',
    category: 'security',
    duration: '45min',
    learnerCount: '1.2k 人',
    progress: 0,
    icon: Terminal,
  },
  {
    id: 'shell-script',
    title: 'Shell 脚本自动化',
    description: '变量、流程控制、正则与文本处理，打造可复用自动化脚本',
    level: '中级',
    category: 'script',
    duration: '1h20min',
    learnerCount: '890 人',
    progress: 100,
    completed: true,
    icon: Zap,
  },
  {
    id: 'docker-ops',
    title: 'Docker 容器运维',
    description: '镜像构建、容器编排、数据卷与网络管理实战',
    level: '中级',
    category: 'basic',
    duration: '2h',
    learnerCount: '2.1k 人',
    progress: 0,
    icon: Box,
  },
  {
    id: 'mysql-tuning',
    title: 'MySQL 性能优化',
    description: '索引优化、慢查询分析、连接池调优与分表策略',
    level: '进阶',
    category: 'basic',
    duration: '3h',
    learnerCount: '670 人',
    progress: 0,
    icon: Cpu,
  },
  {
    id: 'network-capture',
    title: '网络抓包与分析',
    description: 'tcpdump、wireshark 抓包分析与 TCP 协议深度解读',
    level: '中级',
    category: 'network',
    duration: '1h',
    learnerCount: '540 人',
    progress: 45,
    icon: Globe,
  },
  {
    id: 'system-security',
    title: '系统安全加固',
    description: 'SELinux、防火墙、入侵检测与基线核查全流程',
    level: '进阶',
    category: 'security',
    duration: '2h15min',
    learnerCount: '980 人',
    progress: 0,
    icon: Shield,
  },
]

/** 分类导航：6 项 */
export const CATEGORIES: { id: CourseCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'basic', label: 'Linux 基础' },
  { id: 'network', label: '网络运维' },
  { id: 'troubleshoot', label: '故障排查' },
  { id: 'security', label: '安全加固' },
  { id: 'script', label: '自动化脚本' },
]

/** 推荐学习路径：3 条 */
export const LEARNING_PATHS: LearningPath[] = [
  {
    id: 'newbie',
    title: '运维新手入门',
    steps: [
      { label: 'Linux 基础' },
      { label: 'SSH 配置' },
      { label: 'Shell 脚本', active: true },
    ],
  },
  {
    id: 'perf-expert',
    title: '性能优化专家',
    steps: [
      { label: 'Nginx 调优' },
      { label: 'MySQL 优化' },
      { label: '系统监控', active: true },
    ],
  },
  {
    id: 'security-engineer',
    title: '安全运维工程师',
    steps: [
      { label: '安全加固' },
      { label: '漏洞扫描' },
      { label: '入侵检测', active: true },
    ],
  },
]

// ==================== 辅助函数 ====================

/** 根据难度等级返回 Badge variant（用于精选课程大卡） */
export function getLevelBadgeVariant(level: CourseLevel) {
  if (level === '初级') return 'secondary' as const
  if (level === '中级') return 'warning' as const
  if (level === '进阶') return 'primary' as const
  return 'error' as const
}

/** 根据难度等级返回自定义背景类（精选课程大卡的 Badge） */
export function getLevelBadgeClass(level: CourseLevel) {
  if (level === '初级')
    return 'border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l2)] text-[var(--trae-text-secondary)]'
  if (level === '中级')
    return 'border-transparent bg-[var(--trae-status-warning-surface-l1)] text-[var(--trae-status-warning-default)]'
  if (level === '进阶')
    return 'border-transparent bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)]'
  return 'border-transparent bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)]'
}

/** 返回难度的内联样式对象（用于普通卡片里的难度小标签） */
export function levelStyle(level: CourseLevel): React.CSSProperties {
  if (level === '初级')
    return {
      background: 'var(--trae-bg-overlay-l2)',
      color: 'var(--trae-text-secondary)',
      border: '1px solid var(--trae-border-neutral-l1)',
    }
  if (level === '中级')
    return {
      background: 'var(--trae-status-warning-surface-l1)',
      color: 'var(--trae-status-warning-default)',
    }
  if (level === '进阶')
    return {
      background: 'var(--trae-bg-brand-popup)',
      color: 'var(--trae-text-brand)',
    }
  return {
    background: 'var(--trae-status-error-surface-l1)',
    color: 'var(--trae-status-error-default)',
  }
}
