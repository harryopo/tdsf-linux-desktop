/**
 * TutorialDetailPage — 教程详情页（1:1 复刻 tutorial-detail.html 设计稿）
 *
 * 路由：/tutorial/:id
 * 设计稿：tdsf-linux-redesign/pages/tutorial-detail.html
 * Spec: build-runnable-tdsf-from-design · Task 2.7
 *
 * 结构（4 section，1:1 对齐设计稿）：
 *   1. Page Header：返回教程 + 居中标题/副标题 + 难度/时长/进度 tag
 *   2. 章节进度条卡片：5 章节（2 完成 + 1 进行中蓝脉冲 + 2 待学习）
 *   3. 两栏布局：左栏（当前章节 + 实践 + 知识检查）+ 右栏（目录 + 相关课程）
 *   4. sticky 底部学习统计栏：已学习时长 + 进度条 + 继续学习按钮
 *
 * 数据：严格使用设计稿 tutorial-detail.html 示例数据（Nginx 性能调优 / 5 章节 / 3 测验 / 3 相关课程）
 * 视觉：全部 var(--trae-*) token，无硬编码 hex/rgba
 * 无障碍：button type + aria-label，prefers-reduced-motion 禁用按压动画
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Modal, Spin, message, Button } from 'antd'
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Info, Clock,
  Terminal, List, Star, ChevronRight,
} from 'lucide-react'
import type { TutorialEntry } from '@shared/tutorial-types'
import { TUTORIAL_DIFFICULTY_LABELS } from '@shared/tutorial-types'
import './TutorialPage.css'

// ==================== 类型定义 ====================

type ChapterStatus = 'completed' | 'in-progress' | 'pending'

interface ChapterData { id: number; index: string; title: string; duration: string }
interface QuizOption { key: string; label: string; correct?: boolean }
interface QuizQuestion { id: string; question: string; options: QuizOption[] }
interface RelatedCourse { id: string; title: string; level: string; duration: string }
interface CodeLine { color: string; text: string }
interface QuizResult { correct: number; total: number; passed: boolean }

// ==================== 静态示例数据（1:1 来自设计稿 tutorial-detail.html） ====================

const CHAPTERS: ChapterData[] = [
  { id: 1, index: '①', title: 'Nginx基础架构', duration: '25min' },
  { id: 2, index: '②', title: 'worker_connections调优', duration: '35min' },
  { id: 3, index: '③', title: '内核参数优化', duration: '40min' },
  { id: 4, index: '④', title: 'keepalive配置', duration: '30min' },
  { id: 5, index: '⑤', title: '综合实战', duration: '20min' },
]

const OBJECTIVES: string[] = [
  '理解Linux网络内核参数对nginx的影响',
  '掌握somaxconn、tcp_max_syn_backlog调优',
  '学会使用sysctl验证参数效果',
]

const PARAGRAPHS: string[] = [
  'Linux内核网络参数直接影响nginx的并发处理能力。当worker_connections已调优但仍有连接问题时，需要检查内核参数。',
  '关键参数包括：net.core.somaxconn（连接队列）、net.ipv4.tcp_max_syn_backlog（SYN队列）、net.ipv4.tcp_tw_reuse（端口复用）。',
]

const CODE_LINES: CodeLine[] = [
  { color: 'var(--trae-code-doc)', text: '# 查看当前somaxconn值' },
  { color: 'var(--trae-code-text)', text: 'cat /proc/sys/net/core/somaxconn' },
  { color: 'var(--trae-code-doc)', text: '# 调整为1024' },
  { color: 'var(--trae-code-text)', text: 'sysctl -w net.core.somaxconn=1024' },
]

const PRACTICE_LINES: CodeLine[] = [
  { color: 'var(--trae-code-constant)', text: 'user@nginx-lab:~$' },
  { color: 'var(--trae-code-text)', text: ' sysctl net.core.somaxconn' },
  { color: 'var(--trae-code-doc)', text: 'net.core.somaxconn = 4096' },
  { color: 'var(--trae-code-constant)', text: 'user@nginx-lab:~$' },
  { color: 'var(--trae-code-text)', text: ' ab -n 10000 -c 500 http://localhost/' },
  { color: 'var(--trae-code-doc)', text: 'Requests per second:    8421.33 [#/sec] (mean)' },
  { color: 'var(--trae-code-doc)', text: 'Time per request:       59.37 [ms] (mean)' },
  { color: 'var(--trae-code-parameter)', text: 'P99 latency:            128ms' },
]

const QUIZ_QUESTIONS: QuizQuestion[] = [
  { id: 'q1', question: 'net.core.somaxconn 控制的是哪个队列？', options: [
    { key: 'A', label: '已建立连接的队列' },
    { key: 'B', label: '全连接队列(backlog)', correct: true },
    { key: 'C', label: 'SYN半连接队列' },
    { key: 'D', label: '时间等待队列' },
  ] },
  { id: 'q2', question: '修改内核参数后如何永久生效？', options: [
    { key: 'A', label: '重启nginx即可' },
    { key: 'B', label: '使用sysctl -w命令' },
    { key: 'C', label: '写入/etc/sysctl.conf并sysctl -p', correct: true },
    { key: 'D', label: '修改nginx.conf' },
  ] },
  { id: 'q3', question: 'tcp_max_syn_backlog 控制的是？', options: [
    { key: 'A', label: '最大TCP连接数' },
    { key: 'B', label: '最大端口数' },
    { key: 'C', label: 'SYN半连接队列长度', correct: true },
    { key: 'D', label: 'TCP超时时间' },
  ] },
]

const RELATED_COURSES: RelatedCourse[] = [
  { id: 'mysql-tuning', title: 'MySQL性能优化', level: '进阶', duration: '3h' },
  { id: 'linux-troubleshoot', title: 'Linux故障排查', level: '中级', duration: '1h45min' },
  { id: 'docker-ops', title: 'Docker容器运维', level: '中级', duration: '2h' },
]

// ==================== 辅助函数 ====================

/** 根据 activeChapter 和 completedChapters 计算章节状态 */
function getChapterStatus(idx: number, activeIdx: number, completed: boolean[]): ChapterStatus {
  if (completed[idx]) return 'completed'
  if (idx === activeIdx) return 'in-progress'
  return 'pending'
}

/**
 * 格式化阅读时长（v1.0 P0 真实数据展示）
 *
 * @param minutes 真实数据 readingTime（分钟数字）
 * @returns "Xh YYmin" 或 "Xmin" 格式字符串
 *
 * 示例：
 *   150 → "2h 30min"
 *   45  → "45min"
 */
function formatReadingTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '0min'
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

/** 真实教程章节（v2.6：从 markdown 正文按 ## 二级标题切分） */
interface RealChapter {
  /** 章节标题（去序号） */
  title: string
  /** 章节正文 markdown（含本节内容，不含 ## 标题行） */
  body: string
  /** 估算阅读分钟（按篇幅占比分摊 readingTime） */
  minutes: number
}

/**
 * 把教程 markdown 正文切分成真实章节（v2.6 修复“下一章内容不变”）
 *
 * 此前 5 章框架是设计稿硬编码，所有章节共用同一篇完整正文，
 * 点“下一章”只有标题数字变。现按 ## 二级标题切分：每章有自己的内容；
 * 开头无标题的引言作为“简介”章；无任何 ## 时整篇作为单章。
 */
function splitContentIntoChapters(content: string, totalMinutes: number): RealChapter[] {
  const parts = content.split(/\n(?=##\s)/)
  const chapters: Array<{ title: string; body: string }> = []
  let intro = ''
  for (const part of parts) {
    const m = part.match(/^##\s+(.+)/)
    if (m) {
      chapters.push({
        title: m[1].trim().replace(/^\d+[.、:：]\s*/, ''),
        body: part.replace(/^##\s+.+\n?/, ''),
      })
    } else {
      intro += part
    }
  }
  if (chapters.length === 0) {
    return [{ title: '教程正文', body: content, minutes: Math.max(1, totalMinutes || 1) }]
  }
  if (intro.trim()) {
    chapters.unshift({ title: '简介', body: intro.trim() })
  }
  const totalLen = chapters.reduce((s, c) => s + c.body.length, 0) || 1
  const budget = totalMinutes > 0 ? totalMinutes : chapters.length * 5
  return chapters.map((c) => ({
    ...c,
    minutes: Math.max(1, Math.round(budget * (c.body.length / totalLen))),
  }))
}

// ==================== 轻量 Markdown 渲染器 ====================

/**
 * 渲染内联 `code` 片段
 * 将 `code` 形式的文本转为 <code> 元素，其余保持纯文本
 */
function renderInlineCode(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code key={i} className="tut-md-code">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{part}</span>
  })
}

/**
 * 轻量 Markdown 渲染器
 *
 * 支持：
 * - ## heading    → styled <h2>
 * - ### heading   → styled <h3>
 * - # heading     → styled <h2> (major, brand color)
 * - > blockquote  → styled alert (warning surface + left border)
 * - ```lang code``` → styled <pre> with syntax coloring
 * - 普通文本      → styled <p>
 * - `inline code` → styled <code>
 *
 * 设计稿对齐：tutorial-detail.html 的 article > h2 / p / pre / alert 结构
 */
function renderMarkdownContent(content: string): ReactNode {
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let keyCounter = 0

  while (i < lines.length) {
    const line = lines[i]

    // 空行 — 跳过
    if (line.trim() === '') {
      i++
      continue
    }

    // 代码块：```lang ... ```
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 跳过结束 ```

      blocks.push(
        <pre key={keyCounter++} className="tut-code-block tut-md-pre">
          {codeLines.map((cl, idx) => {
            const trimmed = cl.trimStart()
            let color = 'var(--trae-code-text)'
            if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
              color = 'var(--trae-code-doc)'
            } else if (trimmed.startsWith('$') || trimmed.startsWith('user@') || trimmed.startsWith('root@')) {
              color = 'var(--trae-code-constant)'
            }
            return (
              <span key={idx} style={{ color, display: 'block' }}>
                {cl || '\u00A0'}
              </span>
            )
          })}
        </pre>
      )
      continue
    }

    // H3：### heading
    if (line.startsWith('### ')) {
      blocks.push(
        <h3 key={keyCounter++} className="tut-md-h3">
          {renderInlineCode(line.slice(4))}
        </h3>
      )
      i++
      continue
    }

    // H2：## heading
    if (line.startsWith('## ')) {
      blocks.push(
        <h2 key={keyCounter++} className="tut-md-h2">
          {renderInlineCode(line.slice(3))}
        </h2>
      )
      i++
      continue
    }

    // H1：# heading（非 shebang #!）
    if (line.startsWith('# ') && !line.startsWith('#!')) {
      blocks.push(
        <h2 key={keyCounter++} className="tut-md-h2 tut-md-h2--major">
          {renderInlineCode(line.slice(2))}
        </h2>
      )
      i++
      continue
    }

    // Blockquote：> text
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [line.slice(2)]
      i++
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      blocks.push(
        <div key={keyCounter++} className="tut-md-blockquote">
          <Info size={14} className="tut-alert-icon" />
          <span className="tut-alert-text">{renderInlineCode(quoteLines.join(' '))}</span>
        </div>
      )
      continue
    }

    // 普通段落 — 收集连续非特殊行
    const paraLines: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' &&
           !lines[i].startsWith('## ') && !lines[i].startsWith('### ') &&
           !lines[i].startsWith('# ') && !lines[i].startsWith('> ') &&
           !lines[i].trim().startsWith('```')) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push(
      <p key={keyCounter++} className="tut-paragraph">
        {renderInlineCode(paraLines.join(' '))}
      </p>
    )
  }

  return <div className="tut-md-content">{blocks}</div>
}

// ==================== 主组件 ====================

/** TutorialDetailPage — 教程详情页 */
export function TutorialDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // v2.6 去假：初始无任何假进度（此前硬编码“第 3 章学习中 + 前 2 章已完成”，
  // 首次打开真实教程即展示假进度）；真实进度由 tutorialProgress 回填
  const [activeChapter, setActiveChapter] = useState(0)
  const [completedChapters, setCompletedChapters] = useState<boolean[]>([false, false, false, false, false])
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({ q1: 'B', q2: 'C', q3: 'C' })
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null)
  const chapterTitleRef = useRef<HTMLHeadingElement>(null)

  // ===== 真实数据状态（v1.0 P0 接入 tutorialGet IPC） =====
  const [tutorialEntry, setTutorialEntry] = useState<TutorialEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [useReal, setUseReal] = useState(false)
  /** v2.6 去假：Electron 下条目不存在时显示空态，不再静默冒充设计稿假教程 */
  const [notFound, setNotFound] = useState(false)

  // ===== 沙箱执行状态（v1.0 P0 接入 sandboxCreate + sandboxExecute IPC） =====
  const [sandboxRunning, setSandboxRunning] = useState(false)
  const [sandboxResult, setSandboxResult] = useState<{ stdout: string; stderr: string; exitCode: number } | null>(null)
  const [sandboxModalOpen, setSandboxModalOpen] = useState(false)

  // ===== 沙箱审批状态（M4 Task 3 接入 onSandboxApprovalRequest + sandboxApprove IPC） =====
  // HC-6 强制审批：sandboxExecute 调用后主进程推送 sandbox:approval-request 事件，
  // 渲染层弹窗显示命令 + 风险等级，用户通过 sandboxApprove(callId, approved) 响应后才执行。
  const [approvalModal, setApprovalModal] = useState<{
    open: boolean
    callId: string
    command: string
    loading: boolean
  }>({ open: false, callId: '', command: '', loading: false })

  // 加载真实教程条目（按 URL :id 精确匹配）
  useEffect(() => {
    let cancelled = false
    const loadRealEntry = async () => {
      if (typeof window === 'undefined' || !window.electronAPI?.tutorialGet || !id) {
        // WIP: 非 Electron 环境或缺 id，保留设计稿示例数据（CLAUDE.md A4 诚实标注）
        setLoading(false)
        return
      }
      try {
        const entry = await window.electronAPI.tutorialGet(id)
        if (cancelled) return
        if (entry) {
          setTutorialEntry(entry)
          setUseReal(true)
        } else {
          // v2.6 去假：查无此条 → 空态页，不再静默展示“Nginx性能调优实战”假文章
          setNotFound(true)
        }
      } catch (err) {
        if (cancelled) return
        const reason = err instanceof Error ? err.message : String(err)
        message.error(`教程加载失败：${reason}`)
        setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRealEntry()
    return () => { cancelled = true }
  }, [id])

  // 加载真实学习进度（M4 Task 2 接入 tutorialProgress IPC，替代硬编码 completedChapters）
  // v2.6：章节数改为真实切分后的动态长度
  useEffect(() => {
    let cancelled = false
    const loadProgress = async () => {
      if (typeof window === 'undefined' || !window.electronAPI?.tutorialProgress || !id) return
      try {
        const progressList = await window.electronAPI.tutorialProgress()
        if (cancelled) return
        const current = progressList.find((p) => p.tutorialId === id)
        if (current) {
          const chapterTotal = (useReal && tutorialEntry)
            ? splitContentIntoChapters(tutorialEntry.content, tutorialEntry.readingTime).length
            : CHAPTERS.length
          // 根据进度百分比反推章节完成状态
          const completedCount = Math.round((current.progress / 100) * chapterTotal)
          const newCompleted = Array.from({ length: chapterTotal }, (_, idx) => idx < completedCount)
          setCompletedChapters(newCompleted)
        }
        // 未找到进度记录时保持硬编码默认值（[true, true, false, false, false]）
      } catch (err) {
        if (cancelled) return
        console.error('[TutorialDetailPage] 进度加载失败', err)
        // 降级：保持硬编码默认值，不阻塞 UI
      }
    }
    loadProgress()
    return () => { cancelled = true }
  }, [id, useReal, tutorialEntry])

  // 监听沙箱命令审批请求（M4 Task 3 接入 onSandboxApprovalRequest IPC）
  // HC-6 强制审批：sandboxExecute 调用后主进程推送 sandbox:approval-request 事件，
  // 渲染层弹窗显示命令，用户批准/拒绝后通过 sandboxApprove(callId, approved) 响应。
  // onSandboxApprovalRequest 返回 unsubscribe 函数，组件卸载时调用以避免内存泄漏。
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onSandboxApprovalRequest) {
      // 降级：非 Electron 环境或 IPC 未暴露时不监听
      console.warn('[TutorialDetailPage] onSandboxApprovalRequest IPC 不可用，跳过审批监听')
      return
    }
    const unsubscribe = window.electronAPI.onSandboxApprovalRequest((request) => {
      setApprovalModal({
        open: true,
        callId: request.callId,
        command: request.command,
        loading: false,
      })
    })
    return () => { unsubscribe?.() }
  }, [])

  // ===== 渲染辅助：根据 useReal 决定字段来源 =====
  // 真实数据：title/summary/difficulty/readingTime/content/commands
  // 设计稿示例：Nginx 性能调优实战 / 从worker_connections到内核参数的全面优化 / 进阶 / 2h30min
  const displayTitle = useReal && tutorialEntry ? tutorialEntry.title : 'Nginx性能调优实战'
  const displaySummary = useReal && tutorialEntry ? tutorialEntry.summary : '从worker_connections到内核参数的全面优化'
  // 难度映射：真实数据为 'beginner'/'intermediate'/'advanced'，映射到中文标签
  // 设计稿示例 "进阶" 对应真实数据 "advanced"
  const displayDifficultyLabel: string = useReal && tutorialEntry
    ? TUTORIAL_DIFFICULTY_LABELS[tutorialEntry.difficulty]
    : '进阶'
  // 阅读时长格式化：真实数据 readingTime 为分钟数字，转为 "Xh YYmin" 或 "Xmin" 格式
  const displayReadingTime: string = useReal && tutorialEntry
    ? formatReadingTime(tutorialEntry.readingTime)
    : '2h30min'
  // 内容正文：真实数据为 Markdown 字符串，按空行分段
  const displayParagraphs: string[] = useReal && tutorialEntry
    ? tutorialEntry.content.split(/\n\s*\n/).filter(Boolean)
    : PARAGRAPHS
  // 命令示例：真实数据为 string[]，每条命令作为一行
  const displayCodeLines: CodeLine[] = useReal && tutorialEntry && tutorialEntry.commands.length > 0
    ? tutorialEntry.commands.map((cmd) => ({ color: 'var(--trae-code-text)', text: cmd }))
    : CODE_LINES

  // ===== v2.6：真实章节切分（修复“下一章内容不变”） =====
  const realChapters = useMemo(
    () => (useReal && tutorialEntry ? splitContentIntoChapters(tutorialEntry.content, tutorialEntry.readingTime) : null),
    [useReal, tutorialEntry],
  )
  /** 展示用章节：真实教程按标题切分；非 Electron 预览用设计稿 5 章 */
  const displayChapters: ChapterData[] = useMemo(
    () => realChapters
      ? realChapters.map((c, i) => ({ id: i + 1, index: `${i + 1}`, title: c.title, duration: `${c.minutes}min` }))
      : CHAPTERS,
    [realChapters],
  )

  // 章节数变化时同步 completedChapters 长度 + 重置当前章（避免越界）
  useEffect(() => {
    if (!realChapters) return
    setCompletedChapters((prev) =>
      prev.length === realChapters.length ? prev : realChapters.map(() => false),
    )
    setActiveChapter((prev) => (prev < realChapters.length ? prev : 0))
  }, [realChapters])

  // ===== v2.6：相关课程真实化（此前硬编码 3 个不存在的 ID，点击后回退同一套示例数据） =====
  const [realRelated, setRealRelated] = useState<RelatedCourse[] | null>(null)
  useEffect(() => {
    let cancelled = false
    const loadRelated = async () => {
      const api = window.electronAPI
      if (!api?.tutorialList || !id) return
      try {
        const entries = (await api.tutorialList(undefined)) as TutorialEntry[]
        if (cancelled || !Array.isArray(entries)) return
        // 同分类优先，排除当前教程，取前 3 个真实存在的教程
        const others = entries.filter((e) => e.id !== id)
        const sameCat = others.filter((e) => e.category === tutorialEntry?.category)
        const rest = others.filter((e) => e.category !== tutorialEntry?.category)
        const picked = [...sameCat, ...rest].slice(0, 3)
        setRealRelated(picked.map((e) => ({
          id: e.id,
          title: e.title,
          level: TUTORIAL_DIFFICULTY_LABELS[e.difficulty] ?? String(e.difficulty),
          duration: formatReadingTime(e.readingTime),
        })))
      } catch (err) {
        console.warn('[TutorialDetailPage] 相关课程加载失败', err)
      }
    }
    void loadRelated()
    return () => { cancelled = true }
  }, [id, tutorialEntry])
  /** 相关课程：真实教程库优先；非 Electron 预览回退设计稿示例 */
  const displayRelated = realRelated && realRelated.length > 0 ? realRelated : RELATED_COURSES

  const completedCount = completedChapters.filter(Boolean).length
  const isFirst = activeChapter === 0
  const isLast = activeChapter === displayChapters.length - 1
  const currentChapter = displayChapters[activeChapter] ?? displayChapters[0]
  /** v2.6：真实进度百分比（替代硬编码 65%）与剩余分钟 */
  const progressPct = displayChapters.length > 0
    ? Math.round((completedCount / displayChapters.length) * 100)
    : 0
  const remainingMinutes = realChapters
    ? realChapters.reduce((sum, c, i) => (completedChapters[i] ? sum : sum + c.minutes), 0)
    : null

  // ===== 焦点管理：章节切换后聚焦新章节标题（无障碍） =====
  useEffect(() => {
    chapterTitleRef.current?.focus()
  }, [activeChapter])

  // ===== 事件处理 =====
  const handleBackTutorial = () => navigate('/tutorial')
  const handlePrev = () => !isFirst && setActiveChapter(activeChapter - 1)
  const handleNext = () => !isLast && setActiveChapter(activeChapter + 1)
  const handleComplete = async () => {
    const newCompleted = [...completedChapters]
    newCompleted[activeChapter] = true
    const progressPct = Math.round((newCompleted.filter(Boolean).length / newCompleted.length) * 100)
    const allCompleted = newCompleted.every(Boolean)
    try {
      if (id) {
        // 章节完成持久化：status 类型仅允许 'visited' | 'completed'
        // 全部章节完成 → 'completed'；部分完成 → 'visited'（学习中）
        await window.electronAPI.tutorialUpdateProgress(id, allCompleted ? 'completed' : 'visited', progressPct)
      }
    } catch (err) {
      console.error('[TutorialDetailPage] 章节完成持久化失败', err)
      // 降级：仅更新本地 state，不阻塞 UI
    } finally {
      setCompletedChapters(newCompleted)
      if (!isLast) setActiveChapter(activeChapter + 1)
    }
  }
  const handleGotoChapter = (idx: number) => setActiveChapter(idx)
  const handleGotoRelated = (targetId: string) => navigate(`/tutorial/${targetId}`)
  /** v2.6：继续学习 = 跳到第一个未完成的章节（此前只是“下一章”的别名） */
  const handleContinueLearning = () => {
    const firstUnfinished = completedChapters.findIndex((c) => !c)
    setActiveChapter(firstUnfinished >= 0 ? firstUnfinished : displayChapters.length - 1)
  }

  /**
   * 打开沙箱并执行实践命令（v1.0 P0 接入 sandboxCreate + sandboxExecute IPC）
   *
   * 流程：
   *   1. 检测 window.electronAPI?.sandboxExecute（非 Electron 环境降级）
   *   2. sandboxList 查找现有沙箱（status='READY'）；无则 sandboxCreate 创建新沙箱
   *   3. sandboxExecute(sandboxId, command) 执行实践命令
   *   4. 弹窗展示 stdout/stderr/exitCode
   *
   * 安全说明：
   *   - HC-6 强制审批：sandboxExecute 调用后主进程会推送 sandbox:approval-request 事件
   *     渲染层弹窗显示命令 + 风险等级，用户通过 sandboxApprove(callId, approved) 响应
   *   - 主进程通过 sessionKeyMap 句柄模式查找 session_api_key，渲染层无需传递
   *
   * 实践命令：从 PRACTICE_LINES 提取（设计稿示例 `ab -n 10000 -c 500 http://localhost/`）
   *   真实数据场景下，使用 tutorialEntry.commands[0] 作为实践命令
   */
  const handleOpenSandbox = async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.sandboxExecute) {
      message.warning('当前环境不支持沙箱执行（非 Electron 环境）')
      return
    }
    setSandboxRunning(true)
    const hide = message.loading('准备沙箱环境...', 0)
    try {
      // Step 1: 查找现有沙箱或创建新沙箱
      let sandboxId: string | null = null
      const listResult = await window.electronAPI.sandboxList(10)
      // listResult 可能是 SandboxPage 或 SandboxErrorResponse；用 'items' in 检查
      if (listResult && 'items' in listResult && Array.isArray(listResult.items)) {
        // SandboxStatus 为 'STARTING' | 'RUNNING' | 'PAUSED' | 'ERROR' | 'MISSING'
        // 'RUNNING' 是可用状态
        const ready = listResult.items.find((s) => s.status === 'RUNNING')
        if (ready) sandboxId = ready.id
      }
      if (!sandboxId) {
        const createResult = await window.electronAPI.sandboxCreate()
        // createResult 可能是 SandboxInfo 或 SandboxErrorResponse；用 'success' in 检查
        if (!createResult || 'success' in createResult) {
          const err = createResult as { success: false; error: string } | null
          throw new Error(`沙箱创建失败：${err?.error || '未知错误'}`)
        }
        // 此处 createResult 是 SandboxInfo
        if (!createResult.id) throw new Error('沙箱创建返回无效 ID')
        sandboxId = createResult.id
      }

      // Step 2: 提取实践命令（真实数据优先；fallback 到设计稿示例 ab 压测命令）
      const practiceCommand = useReal && tutorialEntry && tutorialEntry.commands.length > 0
        ? tutorialEntry.commands[0]
        : 'ab -n 10000 -c 500 http://localhost/'

      // Step 3: 执行命令（HC-6 强制审批：主进程会推送 sandbox:approval-request）
      const execResult = await window.electronAPI.sandboxExecute(sandboxId, practiceCommand)
      hide()
      // execResult 可能是 SandboxCommandResult 或 SandboxErrorResponse；用 'success' in 检查
      if (!execResult || 'success' in execResult) {
        const err = execResult as { success: false; error: string } | null
        throw new Error(err?.error || '沙箱执行返回未知错误')
      }
      // 此处 execResult 是 SandboxCommandResult
      setSandboxResult({
        stdout: execResult.stdout || '',
        stderr: execResult.stderr || '',
        exitCode: typeof execResult.exitCode === 'number' ? execResult.exitCode : -1,
      })
      setSandboxModalOpen(true)
      if (execResult.exitCode === 0) {
        message.success('沙箱执行成功')
      } else {
        message.warning(`沙箱执行完成（exit=${execResult.exitCode}）`)
      }
    } catch (err) {
      hide()
      const reason = err instanceof Error ? err.message : String(err)
      message.error(`沙箱执行失败：${reason}`)
    } finally {
      setSandboxRunning(false)
    }
  }

  /**
   * 响应沙箱命令审批请求（M4 Task 3 接入 sandboxApprove IPC）
   *
   * 用户在审批 Modal 点击"批准执行"/"拒绝执行"后调用：
   *   1. 设置 loading 防止重复点击
   *   2. 调用 sandboxApprove(callId, approved) 将决策回传主进程
   *   3. 无论成功/失败，finally 关闭 Modal（失败时 console.error 记录）
   *
   * 安全说明：
   *   - 拒绝时主进程自动清理沙箱状态（由主进程处理，渲染层无需额外清理）
   *   - sandboxApprove 调用失败 → console.error + 关闭 Modal（降级策略）
   */
  const handleApprove = async (approved: boolean) => {
    setApprovalModal((prev) => ({ ...prev, loading: true }))
    try {
      await window.electronAPI.sandboxApprove(approvalModal.callId, approved)
    } catch (err) {
      console.error('[TutorialDetailPage] 沙箱审批失败', err)
    } finally {
      setApprovalModal({ open: false, callId: '', command: '', loading: false })
    }
  }

  const handleSubmitQuiz = async () => {
    let correct = 0
    QUIZ_QUESTIONS.forEach((q) => {
      const correctOpt = q.options.find((o) => o.correct)
      if (quizAnswers[q.id] === correctOpt?.key) correct++
    })
    const total = QUIZ_QUESTIONS.length
    const score = Math.round((correct / total) * 100)
    const passed = score >= 60
    setQuizResult({ correct, total, passed })
    try {
      if (id && passed) {
        // 测验通过 → 进度设为 100%（status='completed'）
        await window.electronAPI.tutorialUpdateProgress(id, 'completed', 100)
      }
    } catch (err) {
      console.error('[TutorialDetailPage] 测验提交持久化失败', err)
      // 降级：仅本地 state（quizResult 已设置），不阻塞 UI
    }
  }

  return (
    <main className="tut-detail-page" style={{ color: 'var(--trae-text-default)', height: '100%', overflowY: 'auto' }}>
      {/* loading 占位：真实数据加载中时显示 Spin（避免短暂空白） */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 0' }}>
          <Spin tip="加载教程条目..." />
        </div>
      )}
      {!loading && notFound && (
        // v2.6 去假：条目不存在的诚实空态（替代原来静默展示的设计稿假教程）
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '80px 0', color: 'var(--trae-text-tertiary)' }}>
          <Info size={32} />
          <div style={{ fontSize: 14, color: 'var(--trae-text-secondary)' }}>教程不存在或已下架（ID: {id ?? '未提供'}）</div>
          <button type="button" onClick={handleBackTutorial} className="tut-detail-back-btn tut-btn-press">
            <ArrowLeft size={14} style={{ color: 'var(--trae-icon-secondary)' }} />
            <span>返回教程列表</span>
          </button>
        </div>
      )}
      {!loading && !notFound && (
        <>
          <div className="tut-detail-container">

        {/* ====== 1. Page Header ====== */}
        <header className="tut-detail-header">
          {/* 左：返回按钮（1:1 对齐设计稿 tutorial-detail.html：仅保留"返回教程"按钮） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" data-dom-id="back-tutorial" aria-label="返回教程" onClick={handleBackTutorial} className="tut-detail-back-btn tut-btn-press">
              <ArrowLeft size={14} style={{ color: 'var(--trae-icon-secondary)' }} />
              <span>返回教程</span>
            </button>
          </div>
          {/* 中：标题 + 副标题 */}
          <div className="tut-detail-title-wrap">
            <h1 className="tut-detail-title">{displayTitle}</h1>
            <span className="tut-detail-subtitle">{displaySummary}</span>
          </div>
          {/* 右：难度 tag + 时长 tag + 进度 */}
          <div className="tut-detail-meta">
            <span className="tut-detail-badge tut-detail-badge--brand">{displayDifficultyLabel}</span>
            <span className="tut-detail-badge tut-detail-badge--neutral">
              <Clock size={11} style={{ color: 'var(--trae-text-secondary)' }} />
              {displayReadingTime}
            </span>
            <span className="tut-detail-progress-pct">{useReal ? `${progressPct}%` : '65%'}</span>
          </div>
        </header>

        {/* ====== 2. 章节进度条卡片 ====== */}
        <section className="tut-progress-card">
          <div className="tut-progress-track">
            {displayChapters.map((ch, i) => {
              const status = getChapterStatus(i, activeChapter, completedChapters)
              return (
                <div key={ch.id} style={{ display: 'flex', alignItems: 'center', flex: i < displayChapters.length - 1 ? '1 0 auto' : '0 0 auto' }}>
                  <div className="tut-progress-node">
                    {status === 'completed' && (
                      <div className="tut-progress-indicator tut-progress-indicator--completed">
                        <Check size={12} style={{ color: 'var(--trae-special-white)' }} />
                      </div>
                    )}
                    {status === 'in-progress' && (
                      <div className="tut-progress-indicator tut-progress-indicator--in-progress">
                        <span className="tut-chapter-ping tut-progress-ping" />
                        <span className="tut-progress-inner-dot" />
                      </div>
                    )}
                    {status === 'pending' && (
                      <div className="tut-progress-indicator tut-progress-indicator--pending" />
                    )}
                    <span className={`tut-progress-node-label tut-progress-node-label--${status}`}>{ch.title}</span>
                  </div>
                  {i < displayChapters.length - 1 && (
                    <div className={`tut-progress-connector ${completedChapters[i] ? 'tut-progress-connector--completed' : 'tut-progress-connector--pending'}`} />
                  )}
                </div>
              )
            })}
          </div>
          <div className="tut-progress-text">
            已完成 {completedCount}/{displayChapters.length} 章
            {remainingMinutes !== null
              ? (remainingMinutes > 0 ? ` · 预计还需 ${formatReadingTime(remainingMinutes)}` : ' · 全部完成')
              : ' · 预计还需 52min'}
          </div>
        </section>

        {/* ====== 3. 两栏布局 ====== */}
        <div className="tut-detail-body">

          {/* 左栏：课程内容 */}
          <div className="tut-detail-left">

            {/* 【当前章节卡片】 */}
            <article className="tut-card tut-fade-in">
              <div className="tut-card-title-row" style={{ justifyContent: 'space-between' }}>
                <h2 ref={chapterTitleRef} tabIndex={-1} className="tut-card-title" style={{ outline: 'none' }}>第{activeChapter + 1}章：{currentChapter.title}</h2>
                <span className="tut-detail-badge tut-detail-badge--brand">当前学习</span>
              </div>
              {/* 学习目标（v2.6：无真实字段，仅设计稿预览展示） */}
              {!useReal && (
              <div style={{ marginTop: 12 }}>
                <div className="tut-objective-label">学习目标</div>
                <ul className="tut-objective-list">
                  {OBJECTIVES.map((obj) => (
                    <li key={obj} className="tut-objective-item">
                      <CheckCircle2 size={14} className="tut-objective-icon" />
                      <span className="tut-objective-text">{obj}</span>
                    </li>
                  ))}
                </ul>
              </div>
              )}
              {/* 内容正文（v2.6：真实数据只渲染当前章节的内容，不再每章都是全文） */}
              {realChapters
                ? renderMarkdownContent(realChapters[activeChapter]?.body ?? '')
                : (
                  <div className="tut-paragraphs">
                    {displayParagraphs.map((p, i) => (
                      <p key={i} className="tut-paragraph">{p}</p>
                    ))}
                  </div>
                )}
              {/* 命令示例块（真实数据仅首章展示教程命令汇总，避免每章重复） */}
              {(!useReal || activeChapter === 0) && (
              <div style={{ marginTop: 12 }}>
                <pre className="tut-code-block">
                  {displayCodeLines.map((line, i) => (
                    <span key={i} style={{ color: line.color, display: 'block' }}>{line.text}</span>
                  ))}
                </pre>
                {!useReal && <div className="tut-code-caption"># 查看并调整TCP连接队列长度</div>}
              </div>
              )}
              {/* 注意事项 alert（v2.6：设计稿专属文案，仅预览展示） */}
              {!useReal && (
              <div className="tut-alert">
                <Info size={14} className="tut-alert-icon" />
                <span className="tut-alert-text">修改内核参数需谨慎，建议先在测试环境验证</span>
              </div>
              )}
              {/* 按钮组 */}
              <div className="tut-btn-group">
                <button type="button" data-dom-id="btn-prev-chapter" aria-label="上一章" onClick={handlePrev} disabled={isFirst} className="tut-chapter-btn tut-chapter-btn--prev tut-btn-press">
                  <ArrowLeft size={13} style={{ color: 'currentColor' }} />
                  上一章
                </button>
                <button type="button" data-dom-id="btn-complete-chapter" aria-label="标记完成" onClick={handleComplete} className="tut-chapter-btn tut-chapter-btn--complete tut-btn-press">
                  <Check size={13} style={{ color: 'var(--trae-special-white)' }} />
                  标记完成
                </button>
                <button type="button" data-dom-id="btn-next-chapter" aria-label="下一章" onClick={handleNext} disabled={isLast} className="tut-chapter-btn tut-chapter-btn--next tut-btn-press">
                  下一章
                  <ArrowRight size={13} style={{ color: 'currentColor' }} />
                </button>
              </div>
            </article>

            {/* 【实践练习卡片】 */}
            <article className="tut-card tut-fade-in tut-fade-in--delay-1">
              <div className="tut-card-title-row">
                <Terminal size={15} className="tut-card-icon--brand" />
                <h2 className="tut-card-title">动手实践</h2>
              </div>
              <p className="tut-practice-desc">在沙箱环境中调整nginx内核参数，观察P99延迟变化</p>
              <pre className="tut-code-block" style={{ marginTop: 10 }}>
                {PRACTICE_LINES.map((line, i) => (
                  <span key={i} style={{ color: line.color, display: 'block' }}>{line.text}</span>
                ))}
              </pre>
              <div className="tut-practice-btn-row">
                <button type="button" data-dom-id="btn-open-sandbox" aria-label="打开沙箱练习" onClick={handleOpenSandbox} disabled={sandboxRunning} className="tut-practice-btn tut-btn-press">
                  <Terminal size={13} style={{ color: 'currentColor' }} />
                  {sandboxRunning ? '沙箱执行中...' : '打开沙箱练习'}
                </button>
              </div>
            </article>

            {/* 【知识检查卡片】 */}
            <article className="tut-card tut-fade-in tut-fade-in--delay-2">
              <div className="tut-card-title-row">
                <CheckCircle2 size={15} className="tut-card-icon--brand" />
                <h2 className="tut-card-title">知识检查</h2>
              </div>
              {QUIZ_QUESTIONS.map((q) => (
                <div key={q.id} className="tut-quiz-question">
                  <div className="tut-quiz-question-text">
                    <span className="tut-quiz-question-num">Q{q.id.slice(1)}.</span> {q.question}
                  </div>
                  <div className="tut-quiz-options">
                    {q.options.map((opt) => {
                      const isSelected = quizAnswers[q.id] === opt.key
                      const isCorrectSelected = !!opt.correct && isSelected
                      return (
                        <label key={opt.key} className={`tut-quiz-option${isCorrectSelected ? ' tut-quiz-option--correct' : ''}`}>
                          <input type="radio" name={q.id} checked={isSelected} onChange={() => setQuizAnswers((prev) => ({ ...prev, [q.id]: opt.key }))} style={{ accentColor: 'var(--trae-bg-brand)' }} />
                          {opt.key}. {opt.label}{isCorrectSelected ? ' ✓' : ''}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
              <div className="tut-quiz-submit-row">
                <button type="button" data-dom-id="btn-submit-quiz" aria-label="提交答案" onClick={handleSubmitQuiz} className="tut-quiz-submit-btn tut-btn-press">
                  提交答案
                </button>
                {quizResult && (
                  <div role="status" aria-live="polite" className={`tut-quiz-result tut-quiz-result--${quizResult.passed ? 'passed' : 'failed'}`}>
                    {quizResult.passed ? (
                      <CheckCircle2 size={14} style={{ color: 'var(--trae-status-success-default)' }} />
                    ) : (
                      <Info size={14} style={{ color: 'var(--trae-status-warning-default)' }} />
                    )}
                    <span className="tut-quiz-result-text">
                      {quizResult.passed
                        ? `🎉 全部正确！答题情况：${quizResult.correct}/${quizResult.total}`
                        : `答题情况：${quizResult.correct}/${quizResult.total} 正确，请回顾章节内容后重试`}
                    </span>
                  </div>
                )}
              </div>
            </article>

          </div>

          {/* 右栏：侧边栏 280px */}
          <aside className="tut-detail-right">

            {/* 【课程目录卡片】 */}
            <div className="tut-card" style={{ padding: 14 }}>
              <div className="tut-card-title-row" style={{ marginBottom: 10 }}>
                <List size={14} className="tut-card-icon--secondary" />
                <h2 className="tut-card-title">课程目录</h2>
              </div>
              <ul className="tut-catalog-list">
                {displayChapters.map((ch, i) => {
                  const status = getChapterStatus(i, activeChapter, completedChapters)
                  const isActive = i === activeChapter
                  return (
                    <li key={ch.id} data-dom-id={`goto-chapter-${ch.id}`} onClick={() => handleGotoChapter(i)} className={`tut-catalog-row${isActive ? ' tut-catalog-row--current' : ''}`}>
                      <span className={`tut-catalog-index${isActive ? ' tut-catalog-index--current' : ''}`}>{ch.index}</span>
                      {status === 'completed' && <Check size={13} style={{ color: 'var(--trae-status-success-default)', flexShrink: 0 }} />}
                      {status === 'in-progress' && <span className="tut-catalog-dot--current" />}
                      {status === 'pending' && <span className="tut-catalog-circle--pending" />}
                      <span className={`tut-catalog-title${isActive ? ' tut-catalog-title--current' : status === 'pending' ? ' tut-catalog-title--pending' : ''}`}>{ch.title}</span>
                      <span className={`tut-catalog-duration${isActive ? ' tut-catalog-duration--current' : ''}`}>{ch.duration}</span>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* 【相关推荐卡片】 */}
            <div className="tut-card" style={{ padding: 14 }}>
              <div className="tut-card-title-row" style={{ marginBottom: 10 }}>
                <Star size={14} className="tut-card-icon--secondary" />
                <h2 className="tut-card-title">相关课程</h2>
              </div>
              <ul className="tut-related-list">
                {displayRelated.map((course, i) => (
                  <li key={course.id} data-dom-id={`goto-related-course-${i + 1}`} onClick={() => handleGotoRelated(course.id)} className="tut-related-item">
                    <div className="tut-related-title-row">
                      <span className="tut-related-title">{course.title}</span>
                      <ChevronRight size={13} style={{ color: 'var(--trae-text-tertiary)', flexShrink: 0 }} />
                    </div>
                    <div className="tut-related-meta">
                      <span className={`tut-related-level-badge ${course.level === '进阶' ? 'tut-related-level-badge--brand' : 'tut-related-level-badge--neutral'}`}>{course.level}</span>
                      <span className="tut-related-duration">{course.duration}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

          </aside>
        </div>
      </div>

      {/* ====== 4. 底部学习统计栏（sticky 满宽） ====== */}
      <footer className="tut-detail-footer">
        <div className="tut-footer-inner">
          {/* 左：学习进度（v2.6：真实章节进度，不再编造已学习时长） */}
          <div className="tut-footer-time">
            <Clock size={14} style={{ color: 'var(--trae-text-secondary)' }} />
            <span>
              {useReal ? (
                <>已完成 <span className="tut-footer-time-value">{completedCount}/{displayChapters.length}</span> 章 · 总时长 {displayReadingTime}</>
              ) : (
                <>已学习 <span className="tut-footer-time-value">1h38min</span> / 总时长 2h30min</>
              )}
            </span>
          </div>
          {/* 中：进度条（v2.6：真实百分比） */}
          <div className="tut-footer-progress">
            <div className="tut-footer-progress-bar">
              <div className="tut-footer-progress-fill" style={{ width: useReal ? `${progressPct}%` : '65%' }} />
            </div>
            <span className="tut-footer-progress-pct">{useReal ? `${progressPct}%` : '65%'}</span>
          </div>
          {/* 右：继续学习按钮 */}
          <button type="button" data-dom-id="btn-continue-learning" aria-label="继续学习" onClick={handleContinueLearning} className="tut-footer-continue-btn tut-btn-press">
            继续学习
            <ArrowRight size={13} style={{ color: 'var(--trae-special-white)' }} />
          </button>
        </div>
      </footer>

          {/* 沙箱执行结果 Modal（v1.0 P0 接入 sandboxExecute IPC） */}
          <Modal
            title="沙箱执行结果"
            open={sandboxModalOpen}
            onOk={() => setSandboxModalOpen(false)}
            onCancel={() => setSandboxModalOpen(false)}
            okText="关闭"
            cancelButtonProps={{ style: { display: 'none' } }}
            width={680}
          >
            {sandboxResult && (
              <div>
                <div style={{ marginBottom: 12, fontSize: 13 }}>
                  <strong>退出码：</strong>
                  <span style={{
                    color: sandboxResult.exitCode === 0
                      ? 'var(--trae-status-success-default)'
                      : 'var(--trae-status-warning-default)',
                    fontWeight: 600,
                    marginLeft: 6,
                  }}>
                    {sandboxResult.exitCode}
                  </span>
                </div>
                {sandboxResult.stdout && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--trae-text-secondary)', marginBottom: 4 }}>stdout：</div>
                    <pre style={{
                      background: 'var(--trae-bg-overlay-l3)',
                      padding: 10,
                      borderRadius: 4,
                      fontSize: 12,
                      maxHeight: 200,
                      overflow: 'auto',
                      color: 'var(--trae-text-default)',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {sandboxResult.stdout}
                    </pre>
                  </div>
                )}
                {sandboxResult.stderr && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--trae-text-secondary)', marginBottom: 4 }}>stderr：</div>
                    <pre style={{
                      background: 'var(--trae-bg-overlay-l3)',
                      padding: 10,
                      borderRadius: 4,
                      fontSize: 12,
                      maxHeight: 150,
                      overflow: 'auto',
                      color: 'var(--trae-status-warning-default)',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {sandboxResult.stderr}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </Modal>

          {/* 沙箱命令审批 Modal（M4 Task 3 接入 onSandboxApprovalRequest + sandboxApprove IPC） */}
          {/* HC-6 强制审批：sandboxExecute 调用后主进程推送审批请求，用户批准/拒绝后才执行 */}
          <Modal
            title="沙箱命令审批"
            open={approvalModal.open}
            onCancel={() => handleApprove(false)}
            footer={[
              <Button key="reject" danger onClick={() => handleApprove(false)} loading={approvalModal.loading}>
                拒绝执行
              </Button>,
              <Button key="approve" type="primary" onClick={() => handleApprove(true)} loading={approvalModal.loading}>
                批准执行
              </Button>,
            ]}
          >
            <div style={{ marginBottom: 8, color: 'var(--trae-text-secondary)' }}>即将在沙箱中执行以下命令：</div>
            <pre style={{
              padding: 12,
              background: 'var(--trae-bg-overlay-l1)',
              borderRadius: 4,
              fontFamily: 'var(--trae-font-family-mono)',
              fontSize: 12,
              color: 'var(--trae-text-default)',
              overflowX: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {approvalModal.command}
            </pre>
          </Modal>
        </>
      )}
    </main>
  )
}
