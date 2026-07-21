/**
 * TutorialDetailPage v1 复刻组件 — Mock 数据 + 类型定义
 *
 * 设计稿：tdsf-linux-redesign/pages/tutorial-detail.html
 *
 * 数据：1 个教程详情（Nginx 性能调优实战），含 5 个章节（2 完成 + 1 进行中 + 2 待学习）
 *       + 3 道知识检查单选题 + 3 个相关课程
 *
 * 步骤数：5 章节（设计稿要求 5-8 步骤，符合要求）
 */
import type { LucideIcon } from 'lucide-react'
import { Check, BookOpen, Cpu } from 'lucide-react'

// ==================== 类型定义 ====================

/** 章节状态 */
export type ChapterStatus = 'completed' | 'in-progress' | 'pending'

/** 章节结构（进度条 + 侧边栏目录共用） */
export interface Chapter {
  id: number
  index: string // ①②③④⑤
  title: string
  duration: string // "25min"
  status: ChapterStatus
}

/** 学习目标条目 */
export interface LearningObjective {
  id: string
  text: string
}

/** 代码块行（带语法着色） */
export interface CodeLine {
  type: 'comment' | 'text' | 'constant'
  content: string
}

/** 知识检查题选项 */
export interface QuizOption {
  key: string // A/B/C/D
  text: string
  correct?: boolean
}

/** 知识检查题 */
export interface QuizQuestion {
  id: string // Q1/Q2/Q3
  question: string
  options: QuizOption[]
}

/** 相关课程 */
export interface RelatedCourse {
  id: string
  title: string
  level: '中级' | '进阶'
  duration: string
}

// ==================== Mock 数据 ====================

/** 教程基本信息 */
export const TUTORIAL = {
  id: 'nginx-tuning',
  title: 'Nginx 性能调优实战',
  subtitle: '从 worker_connections 到内核参数的全面优化',
  level: '进阶' as const,
  duration: '2h30min',
  progress: 65,
  learnedDuration: '1h38min',
  totalDuration: '2h30min',
  remainingTime: '52min',
  completedChapters: 2,
  totalChapters: 5,
}

/** 章节列表（5 章 = 2 完成 + 1 进行中 + 2 待学习） */
export const CHAPTERS: Chapter[] = [
  {
    id: 1,
    index: '①',
    title: 'Nginx 基础架构',
    duration: '25min',
    status: 'completed',
  },
  {
    id: 2,
    index: '②',
    title: 'worker_connections 调优',
    duration: '35min',
    status: 'completed',
  },
  {
    id: 3,
    index: '③',
    title: '内核参数优化',
    duration: '40min',
    status: 'in-progress',
  },
  {
    id: 4,
    index: '④',
    title: 'keepalive 配置',
    duration: '30min',
    status: 'pending',
  },
  {
    id: 5,
    index: '⑤',
    title: '综合实战',
    duration: '20min',
    status: 'pending',
  },
]

/** 当前章节（第 3 章）学习目标 */
export const LEARNING_OBJECTIVES: LearningObjective[] = [
  { id: 'obj1', text: '理解 Linux 网络内核参数对 nginx 的影响' },
  { id: 'obj2', text: '掌握 somaxconn、tcp_max_syn_backlog 调优' },
  { id: 'obj3', text: '学会使用 sysctl 验证参数效果' },
]

/** 当前章节正文段落 */
export const CHAPTER_PARAGRAPHS: string[] = [
  'Linux 内核网络参数直接影响 nginx 的并发处理能力。当 worker_connections 已调优但仍有连接问题时，需要检查内核参数。',
  '关键参数包括：net.core.somaxconn（连接队列）、net.ipv4.tcp_max_syn_backlog（SYN 队列）、net.ipv4.tcp_tw_reuse（端口复用）。',
]

/** 当前章节代码示例 */
export const CODE_EXAMPLE: CodeLine[] = [
  { type: 'comment', content: '# 查看当前 somaxconn 值' },
  { type: 'text', content: 'cat /proc/sys/net/core/somaxconn' },
  { type: 'comment', content: '# 调整为 1024' },
  { type: 'text', content: 'sysctl -w net.core.somaxconn=1024' },
]

/** 代码块底部说明 */
export const CODE_CAPTION = '# 查看并调整 TCP 连接队列长度'

/** alert 注意事项 */
export const ALERT_TEXT = '修改内核参数需谨慎，建议先在测试环境验证'

/** 实践练习终端输出 */
export const PRACTICE_TERMINAL: CodeLine[] = [
  { type: 'constant', content: 'user@nginx-lab:~$' },
  { type: 'text', content: ' sysctl net.core.somaxconn' },
  { type: 'comment', content: 'net.core.somaxconn = 4096' },
  { type: 'constant', content: 'user@nginx-lab:~$' },
  { type: 'text', content: ' ab -n 10000 -c 500 http://localhost/' },
  { type: 'comment', content: 'Requests per second:    8421.33 [#/sec] (mean)' },
  { type: 'comment', content: 'Time per request:       59.37 [ms] (mean)' },
  { type: 'constant', content: 'P99 latency:            128ms' },
]

/** 实践练习描述 */
export const PRACTICE_DESCRIPTION = '在沙箱环境中调整 nginx 内核参数，观察 P99 延迟变化'

/** 知识检查题（3 道） */
export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'Q1',
    question: 'net.core.somaxconn 控制的是哪个队列？',
    options: [
      { key: 'A', text: '已建立连接的队列' },
      { key: 'B', text: '全连接队列(backlog)', correct: true },
      { key: 'C', text: 'SYN 半连接队列' },
      { key: 'D', text: '时间等待队列' },
    ],
  },
  {
    id: 'Q2',
    question: '修改内核参数后如何永久生效？',
    options: [
      { key: 'A', text: '重启 nginx 即可' },
      { key: 'B', text: '使用 sysctl -w 命令' },
      { key: 'C', text: '写入 /etc/sysctl.conf 并 sysctl -p', correct: true },
      { key: 'D', text: '修改 nginx.conf' },
    ],
  },
  {
    id: 'Q3',
    question: 'tcp_max_syn_backlog 控制的是？',
    options: [
      { key: 'A', text: '最大 TCP 连接数' },
      { key: 'B', text: '最大端口数' },
      { key: 'C', text: 'SYN 半连接队列长度', correct: true },
      { key: 'D', text: 'TCP 超时时间' },
    ],
  },
]

/** 讲师信息 */
export const INSTRUCTOR = {
  initial: '张',
  name: '张工',
  title: '资深 SRE 工程师',
  bio: '10 年 Linux 运维经验',
  tags: ['nginx', '性能优化', '内核调优'],
}

/** 相关课程（3 个） */
export const RELATED_COURSES: RelatedCourse[] = [
  { id: 'mysql-tuning', title: 'MySQL 性能优化', level: '进阶', duration: '3h' },
  { id: 'linux-troubleshoot', title: 'Linux 故障排查', level: '中级', duration: '1h45min' },
  { id: 'docker-ops', title: 'Docker 容器运维', level: '中级', duration: '2h' },
]

/** 侧边栏图标导出（便于章节目录渲染时使用） */
export const SIDEBAR_ICONS: { check: LucideIcon; book: LucideIcon; cpu: LucideIcon } = {
  check: Check,
  book: BookOpen,
  cpu: Cpu,
}
