/**
 * TutorialDetailPage — 教程详情页（v1.0 设计稿复刻）
 *
 * 路由：/tutorial/:id
 * 设计稿：tdsf-linux-redesign/pages/tutorial-detail.html
 *
 * 结构（自上而下）：
 *   1. PageHeader：返回按钮（back-tutorial）+ 居中标题/副标题 + 右侧 tag 组（难度 + 时长 + 进度）
 *   2. ChapterProgressBar：5 章节进度条（2 完成 + 1 进行中蓝脉冲 + 2 待学习）
 *   3. 两栏布局（lg: 左 flex-1 + 右 280px）：
 *      - 左栏：CurrentChapterCard + PracticeCard + QuizCard（3 卡片纵向）
 *      - 右栏：CourseSidebar（课程目录 + 讲师 + 相关课程）
 *   4. sticky 底部学习统计栏：已学习时长 + 进度条 + 继续学习按钮（btn-continue-learning）
 *
 * 章节 / 进度逻辑：
 *   - mock 兜底：默认第 3 章进行中，进度 65%，已学习 1h38min，剩余 52min（与设计稿一致）
 *   - 真实数据：currentChapterIdx 之前的章节标记 completed，当前 in-progress，之后 pending
 *   - 进度 = 已学习分钟 / 总分钟（已完成章节全额 + 当前章节 50%）
 *
 * 数据接入（v0.7.0 Sprint 4.4）：
 *   1. 启动时通过 IPC 加载真实教程：`tutorial:get` → TutorialEntry
 *   2. Markdown 解析为结构化章节：`parseTutorial(t)` → ParsedTutorial
 *   3. 章节 / 练习 / 测验卡片接收真实数据
 *   4. 真实数据为空时降级到 mock（保证 UI 不空白）
 *   5. 加载中显示 loading 状态
 *
 * JS 交互：
 *   - useNavigate 跳转（返回教程列表、跳转相关课程、打开沙箱）
 *   - 章节切换 useState（上一章/下一章/标记完成/侧边栏目录跳转）
 *   - 知识检查 useState 由 QuizCard 内部管理
 *
 * 设计 token：全部使用 `--trae-*` 前缀（项目约定）
 * 组件：TRAE Button + Badge + Lucide 图标 + Tailwind 类名
 * 子组件：ChapterProgressBar / CurrentChapterCard / PracticeCard / QuizCard / CourseSidebar
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, ArrowRight, Loader2, BookOpen } from 'lucide-react'
import { Button } from '@/components/trae/Button'
import { Badge } from '@/components/trae/Badge'
import { ChapterProgressBar } from '@/components/tutorial/v1/ChapterProgressBar'
import { CurrentChapterCard } from '@/components/tutorial/v1/CurrentChapterCard'
import { PracticeCard } from '@/components/tutorial/v1/PracticeCard'
import { QuizCard } from '@/components/tutorial/v1/QuizCard'
import { CourseSidebar } from '@/components/tutorial/v1/CourseSidebar'
import { parseTutorial, type ParsedChapter, type ParsedTutorial } from '@/components/tutorial/v1/tutorial-parser'
import type { TutorialEntry } from '@shared/tutorial-types'
import type { Chapter, RelatedCourse, CodeLine, QuizQuestion } from '@/components/tutorial/v1/detail-data'

/** electronAPI 引用（preload 暴露 + global.d.ts 已有完整类型） */
const api: {
  tutorialGet?: (id: string) => Promise<TutorialEntry | null>
  tutorialList?: (category?: string) => Promise<TutorialEntry[]>
} | undefined =
  typeof window !== 'undefined' && (window as any).electronAPI
    ? (window as any).electronAPI
    : undefined

/** 圆圈数字 ①②③④⑤⑥⑦⑧⑨⑩ */
const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']

/** 难度 → 中文标签 */
const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: '入门',
  intermediate: '中级',
  advanced: '高级'
}

/** TutorialEntry → Chapter[]（按 currentIdx 切分完成/进行中/待学习） */
function chaptersFromParsed(parsed: ParsedChapter[], currentIdx: number): Chapter[] {
  if (parsed.length === 0) {
    return [{ id: 1, index: '①', title: '教程内容', duration: '5min', status: 'in-progress' }]
  }
  return parsed.map((ch, i) => ({
    id: i + 1,
    index: CIRCLED_NUMS[i] ?? `${i + 1}`,
    title: ch.title,
    duration: estimateChapterDuration(ch),
    status: i < currentIdx ? 'completed' : i === currentIdx ? 'in-progress' : 'pending'
  }))
}

/** 估算章节时长（基于段落 + 代码块 + 目标 + 列表） */
function estimateChapterDuration(ch: ParsedChapter): string {
  const textLen =
    ch.paragraphs.reduce((s, p) => s + p.length, 0) +
    ch.objectives.reduce((s, p) => s + p.length, 0) +
    ch.codeBlocks.reduce((s, b) => s + b.lines.length * 20, 0)
  const min = Math.max(5, Math.round(textLen / 200))
  return `${min}min`
}

/** 难度 → Course 难度等级 */
function difficultyToLevel(d: string): RelatedCourse['level'] {
  if (d === 'advanced') return '进阶'
  return '中级'
}

/** TutorialEntry → RelatedCourse[]（按 category 匹配其他真实教程） */
function relatedFromList(
  current: TutorialEntry,
  allTutorials: TutorialEntry[]
): RelatedCourse[] {
  // 1) 优先：同 category 的其他教程
  const sameCat = allTutorials
    .filter((t) => t.id !== current.id && t.category === current.category)
    .slice(0, 3)
  // 2) 不足则用 tags 关键词相似度
  if (sameCat.length < 3) {
    const others = allTutorials.filter(
      (t) => t.id !== current.id && t.category !== current.category
    )
    // 按 keywords 命中数排序
    const curTags = new Set([
      ...(current.tags ?? []),
      ...(current.keywords ?? [])
    ].map((s) => s.toLowerCase()))
    const scored = others
      .map((t) => {
        const tTags = new Set([
          ...(t.tags ?? []),
          ...(t.keywords ?? [])
        ].map((s) => s.toLowerCase()))
        let hit = 0
        for (const tag of curTags) if (tTags.has(tag)) hit++
        return { t, hit }
      })
      .sort((a, b) => b.hit - a.hit)
      .map((s) => s.t)
    for (const t of scored) {
      if (sameCat.length >= 3) break
      if (!sameCat.find((c) => c.id === t.id)) sameCat.push(t)
    }
  }
  return sameCat.slice(0, 3).map((t) => ({
    id: t.id,
    title: t.title,
    level: difficultyToLevel(t.difficulty),
    duration: `${t.readingTime ?? 5}min`
  }))
}

/** 解析 "1h30min" / "90min" / "2h" → 分钟 */
function parseDurationToMin(s: string): number {
  if (!s) return 0
  const h = s.match(/(\d+)h/)
  const m = s.match(/(\d+)min/)
  return (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0)
}

/** 分钟 → "2h30min" / "45min" */
function formatDurationMin(min: number): string {
  if (min <= 0) return '0min'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h > 0 && m > 0) return `${h}h${m}min`
  if (h > 0) return `${h}h`
  return `${m}min`
}

/**
 * 计算已学习分钟数
 * - 已完成章节：全额
 * - 当前章节：按 50% 估算
 * - 待学习章节：0
 */
function calcLearnedMinutes(chapters: Chapter[], currentIdx: number, totalMin: number): number {
  let learned = 0
  for (let i = 0; i < chapters.length; i++) {
    const min = parseDurationToMin(chapters[i].duration)
    if (i < currentIdx) learned += min
    else if (i === currentIdx) learned += Math.round(min / 2)
  }
  return Math.min(learned, totalMin)
}

/** TutorialDetailPage — 教程详情页 */
export function TutorialDetailPage() {
  const navigate = useNavigate()
  const { id: routeId } = useParams<{ id: string }>()

  // 真实数据状态
  const [tutorial, setTutorial] = useState<TutorialEntry | null>(null)
  const [relatedCourses, setRelatedCourses] = useState<RelatedCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [dataSource, setDataSource] = useState<'mock' | 'real'>('real')

  // 当前章节索引（真实数据从第 1 章开始）
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0)

  /** 真实数据加载后，从第 1 章开始学习 */
  useEffect(() => {
    if (tutorial) {
      setCurrentChapterIdx(0)
    }
  }, [tutorial])

  /** 加载真实数据（Sprint 4.4 接入） */
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const targetId = routeId ?? 'nginx-tuning'
      if (!api?.tutorialGet) {
        if (!cancelled) {
          setLoading(false)
          setTutorial(null)
          setRelatedCourses([])
          setDataSource('real')
        }
        return
      }
      try {
        setLoading(true)
        // 并发加载：当前教程 + 全量教程（用于相关推荐）
        const getFn = api.tutorialGet
        const listFn = api.tutorialList
        const [t, all] = await Promise.all([
          getFn ? getFn(targetId).catch(() => null) : Promise.resolve(null),
          listFn ? listFn().catch(() => []) : Promise.resolve([])
        ])
        if (cancelled) return
        if (t) {
          setTutorial(t)
          setDataSource('real')
          setRelatedCourses(relatedFromList(t, all))
        } else {
          setTutorial(null)
          setRelatedCourses([])
          setDataSource('real')
        }
      } catch (err) {
        console.error('[TutorialDetailPage] 加载真实数据失败:', err)
        if (!cancelled) {
          setTutorial(null)
          setRelatedCourses([])
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
  }, [routeId])

  /** 解析后的教程结构（仅真实数据） */
  const parsed = useMemo<ParsedTutorial | null>(() => {
    if (!tutorial) return null
    return parseTutorial(tutorial)
  }, [tutorial])

  /**
   * 章节列表（用于进度条 + 侧边栏目录）
   * 真实数据：根据 currentChapterIdx 切分完成 / 进行中 / 待学习
   */
  const chapters: Chapter[] = useMemo(() => {
    if (!tutorial || !parsed) return []
    return chaptersFromParsed(parsed.chapters, currentChapterIdx)
  }, [parsed, currentChapterIdx, tutorial])

  /** 当前章节（越界保护） */
  const effectiveIdx = Math.min(currentChapterIdx, Math.max(0, chapters.length - 1))
  const currentChapter = chapters[effectiveIdx]
  const currentParsedChapter = parsed?.chapters[effectiveIdx]

  const isLastChapter = chapters.length > 0 && effectiveIdx === chapters.length - 1
  const isFirstChapter = chapters.length > 0 && effectiveIdx === 0

  /** 来源标签 */
  const sourceLabel = tutorial?.source?.name
    ? `FROM ${tutorial.source.name}`
    : undefined

  /** 难度标签 */
  const levelLabel = tutorial ? (DIFFICULTY_LABEL[tutorial.difficulty] ?? tutorial.difficulty) : '—'

  /** 时长与进度（仅真实数据） */
  const totalReadingMin = tutorial?.readingTime ?? 0
  const duration = formatDurationMin(totalReadingMin || 5)
  const learnedMin = tutorial
    ? calcLearnedMinutes(chapters, effectiveIdx, totalReadingMin || 5)
    : 0
  const learnedDuration = formatDurationMin(learnedMin)
  const progress = totalReadingMin > 0 ? Math.round((learnedMin / totalReadingMin) * 100) : 0
  const remainingMin = Math.max(0, totalReadingMin - learnedMin)
  const remainingTime = formatDurationMin(remainingMin)

  /** 标题 + 副标题 */
  const title = tutorial?.title ?? '教程未找到'
  const subtitle = tutorial?.summary ?? (loading ? '加载中…' : '请从教程列表重新进入')

  /** 当前章节数据派生（用于 CurrentChapterCard） */
  const currentParagraphs: string[] = currentParsedChapter
    ? currentParsedChapter.paragraphs.length > 0
      ? currentParsedChapter.paragraphs
      : currentParsedChapter.listItems.length > 0
        ? currentParsedChapter.listItems
        : ['本章节暂无正文内容']
    : []
  const currentCodeLines: CodeLine[] = currentParsedChapter && currentParsedChapter.codeBlocks.length > 0
    ? currentParsedChapter.codeBlocks[0].lines
    : []
  const currentObjectives: string[] = currentParsedChapter?.objectives ?? []
  const currentAlert: string | undefined = currentParsedChapter?.alert
  const currentCodeCaption: string | undefined = currentParsedChapter?.codeBlocks[0]?.lang
    ? `语言：${currentParsedChapter.codeBlocks[0].lang}`
    : undefined

  /** 实践命令（来自整篇 tutorial） */
  const practiceLines: CodeLine[] = parsed && parsed.practiceLines.length > 0
    ? parsed.practiceLines
    : []
  const practiceDescription = parsed?.practiceDescription || '在沙箱环境中动手实践本教程命令'

  /** 知识检查题 */
  const quizQuestions: QuizQuestion[] = parsed?.quiz ?? []

  /** 返回教程列表 */
  const handleBack = () => {
    navigate('/tutorial')
  }

  /** 上一章 */
  const handlePrevChapter = () => {
    if (!isFirstChapter) {
      setCurrentChapterIdx((idx) => Math.max(0, idx - 1))
    }
  }

  /** 下一章 */
  const handleNextChapter = () => {
    if (!isLastChapter) {
      setCurrentChapterIdx((idx) => Math.min(chapters.length - 1, idx + 1))
    }
  }

  /** 标记当前章节完成并自动跳到下一章 */
  const handleCompleteChapter = () => {
    if (!isLastChapter) {
      handleNextChapter()
    }
  }

  /** 侧边栏目录点击跳章 */
  const handleGotoChapter = (id: number) => {
    const idx = chapters.findIndex((ch) => ch.id === id)
    if (idx >= 0) {
      setCurrentChapterIdx(idx)
    }
  }

  /** 跳转相关课程 */
  const handleGotoRelated = (id: string) => {
    navigate(`/tutorial/${id}`)
  }

  /** 打开沙箱 */
  const handleOpenSandbox = () => {
    const cmdList = practiceLines
      .map((l) => l.content)
      .filter((c) => c && !c.trim().startsWith('#'))
      .slice(0, 5)
      .join('\n') || '本教程暂无演示命令'
    window.alert(
      '沙箱环境正在启动...\n\n' +
        'v1.1 版本将接入完整的 Linux 容器沙箱，支持：\n' +
        '• 实时执行 sysctl / nginx 命令\n' +
        '• 监控 P99 延迟变化\n' +
        '• 自动恢复初始状态\n\n' +
        '本教程将练习：\n' +
        cmdList
    )
  }

  /** 提交知识检查（根据答题情况给出评分反馈） */
  const handleSubmitQuiz = (answers: Record<string, string>) => {
    if (quizQuestions.length === 0) {
      window.alert('本教程暂无知识检查题')
      return
    }
    if (Object.keys(answers).length === 0) {
      window.alert('请先选择答案后再提交')
      return
    }
    let correct = 0
    let total = 0
    const wrongQuestions: string[] = []
    quizQuestions.forEach((q) => {
      total++
      const userAnswer = answers[q.id]
      const correctOpt = q.options.find((o) => o.correct)
      if (userAnswer && correctOpt && userAnswer === correctOpt.key) {
        correct++
      } else {
        wrongQuestions.push(q.id)
      }
    })
    const ratio = total > 0 ? correct / total : 0
    let evaluation: string
    if (ratio === 1) {
      evaluation = '完美！已掌握本教程核心知识点'
    } else if (ratio >= 0.6) {
      evaluation = `基本掌握，建议回顾错题：${wrongQuestions.join('、')}`
    } else {
      evaluation = `需要重新学习本教程内容（错题：${wrongQuestions.join('、')}）`
    }
    window.alert(
      `知识检查完成\n\n` +
        `答题情况：${correct}/${total} 正确\n` +
        `${evaluation}`
    )
  }

  /** 继续学习（底部 CTA） */
  const handleContinueLearning = () => {
    if (!isLastChapter) {
      handleNextChapter()
    }
  }

  return (
    <div
      className="min-h-full"
      style={{ background: 'var(--trae-bg-base-default)' }}
    >
      {!loading && !tutorial && (
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-20 text-center">
          <BookOpen className="size-10 text-[var(--trae-text-tertiary)]" />
          <div className="text-[16px] font-semibold text-[var(--trae-text-default)]">
            教程未找到
          </div>
          <p className="text-[13px] leading-5 text-[var(--trae-text-secondary)]">
            无法加载该教程（id: {routeId ?? '—'}）。请返回列表选择真实条目，或先抓取教程源。
          </p>
          <Button variant="secondary" onClick={handleBack}>
            <ArrowLeft size={14} />
            返回教程列表
          </Button>
        </div>
      )}
      {(loading || tutorial) && (
      <>
      <div
        className="mx-auto"
        style={{ maxWidth: '100%', padding: '16px 24px 88px' }}
      >
        {/* ===== 1. Page Header ===== */}
        <header
          className="flex flex-wrap items-center justify-between gap-3"
          style={{
            paddingBottom: 14,
            borderBottom: '1px solid var(--trae-border-neutral-l1)',
          }}
        >
          {/* 左：返回按钮 */}
          <Button
            variant="outline"
            size="default"
            data-dom-id="back-tutorial"
            onClick={handleBack}
            className="shrink-0"
          >
            <ArrowLeft size={14} />
            返回教程
          </Button>

          {/* 中：标题 + 副标题 */}
          <div
            className="flex min-w-0 flex-1 flex-col"
            style={{ gap: 2, textAlign: 'center', minWidth: 200 }}
          >
            <h1
              className="m-0"
              style={{
                fontSize: 'var(--trae-heading-md-font-size)',
                lineHeight: 'var(--trae-heading-md-line-height)',
                fontWeight: 'var(--trae-font-weight-strong)',
                color: 'var(--trae-text-default)',
                wordBreak: 'keep-all',
                overflowWrap: 'break-word',
              }}
            >
              {title}
            </h1>
            <span
              className="truncate"
              style={{
                fontSize: 'var(--trae-body-xs-font-size)',
                lineHeight: 'var(--trae-body-xs-line-height)',
                color: 'var(--trae-text-tertiary)',
              }}
            >
              {subtitle}
            </span>
          </div>

          {/* 右：难度 tag + 时长 tag + 进度 */}
          <div className="flex shrink-0 items-center gap-2">
            {dataSource === 'real' && tutorial?.source?.name && (
              <span
                className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] border px-2"
                style={{
                  borderColor: 'var(--trae-status-success-default)',
                  background: 'rgba(51,193,146,0.12)',
                  color: 'var(--trae-status-success-default)',
                  fontSize: '10px',
                  fontWeight: 500
                }}
              >
                <BookOpen size={10} />
                FROM {tutorial.source.name}
              </span>
            )}
            {loading && (
              <span
                className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] border px-2"
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
            <Badge variant="primary">{levelLabel}</Badge>
            <Badge variant="secondary" className="inline-flex items-center gap-1">
              <Clock
                size={11}
                style={{ color: 'var(--trae-text-secondary)' }}
              />
              {duration}
            </Badge>
            <span
              style={{
                fontSize: 'var(--trae-body-sm-font-size)',
                fontWeight: 'var(--trae-font-weight-medium)',
                color: 'var(--trae-text-brand)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {progress}%
            </span>
          </div>
        </header>

        {/* ===== 2. 章节进度条 ===== */}
        <div style={{ marginTop: 14 }}>
          <ChapterProgressBar
            chapters={chapters}
            completedCount={chapters.filter((c) => c.status === 'completed').length}
            remainingTime={remainingTime}
          />
        </div>

        {/* ===== 3. 两栏布局 ===== */}
        <div
          className="flex flex-col lg:flex-row"
          style={{ gap: 16, marginTop: 14 }}
        >
          {/* 左栏：课程内容（3 卡片纵向） */}
          <div
            className="flex min-w-0 flex-1 flex-col"
            style={{ gap: 14 }}
          >
            <CurrentChapterCard
              chapterIndex={effectiveIdx + 1}
              chapterTitle={currentChapter?.title ?? '教程内容'}
              onPrev={handlePrevChapter}
              onComplete={handleCompleteChapter}
              onNext={handleNextChapter}
              contentParagraphs={currentParagraphs}
              codeLines={currentCodeLines}
              objectives={currentObjectives}
              alertText={currentAlert}
              codeCaption={currentCodeCaption}
              sourceBadge={dataSource === 'real' ? sourceLabel : undefined}
            />
            <PracticeCard
              onOpenSandbox={handleOpenSandbox}
              description={practiceDescription}
              commands={practiceLines.map((l) => l.content)}
              sourceLabel={dataSource === 'real' ? sourceLabel : undefined}
            />
            <QuizCard
              onSubmit={handleSubmitQuiz}
              questions={quizQuestions}
              sourceLabel={dataSource === 'real' ? sourceLabel : undefined}
            />
          </div>

          {/* 右栏：侧边栏（280px） */}
          <CourseSidebar
            onGotoChapter={handleGotoChapter}
            onGotoRelated={handleGotoRelated}
            chapters={chapters}
            relatedCourses={relatedCourses}
          />
        </div>
      </div>

      {/* ===== 4. 底部学习统计栏（sticky 满宽） ===== */}
      <footer
        className="sticky bottom-0"
        style={{
          background: 'var(--trae-bg-base-secondary)',
          borderTop: '1px solid var(--trae-border-neutral-l1)',
          padding: '12px 24px',
        }}
      >
        <div
          className="mx-auto flex flex-wrap items-center gap-4"
          style={{ maxWidth: '100%' }}
        >
          {/* 左：已学习时长 */}
          <div className="flex shrink-0 items-center gap-1.5">
            <Clock
              size={14}
              style={{ color: 'var(--trae-text-secondary)' }}
            />
            <span
              style={{
                fontSize: 'var(--trae-body-sm-font-size)',
                color: 'var(--trae-text-secondary)',
              }}
            >
              已学习{' '}
              <span
                style={{
                  color: 'var(--trae-text-default)',
                  fontWeight: 'var(--trae-font-weight-medium)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {learnedDuration}
              </span>{' '}
              / 总时长 {duration}
            </span>
          </div>

          {/* 中：进度条 */}
          <div
            className="flex min-w-[120px] flex-1 items-center gap-2"
          >
            <div
              style={{
                flex: 1,
                height: 6,
                background: 'var(--trae-bg-overlay-l3)',
                borderRadius: 'var(--trae-radius-full)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: 'var(--trae-bg-brand)',
                  borderRadius: 'var(--trae-radius-full)',
                }}
              />
            </div>
            <span
              className="shrink-0"
              style={{
                fontSize: 'var(--trae-body-xs-font-size)',
                color: 'var(--trae-text-brand)',
                fontWeight: 'var(--trae-font-weight-medium)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {progress}%
            </span>
          </div>

          {/* 右：继续学习按钮 */}
          <Button
            variant="brand"
            size="lg"
            data-dom-id="btn-continue-learning"
            onClick={handleContinueLearning}
            className="shrink-0"
          >
            继续学习
            <ArrowRight size={13} />
          </Button>
        </div>
      </footer>

      {/* 动效：仅含 @keyframes 与 reduced-motion 降级，无 class 定义 */}
      <style>{`
        @keyframes tutorialFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
      </>
      )}
    </div>
  )
}
