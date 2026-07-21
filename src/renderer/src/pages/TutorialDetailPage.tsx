/**
 * TutorialDetailPage — 教程详情页（1:1 复刻 tutorial-detail.html 设计稿）
 *
 * 路由：/tutorial/:id
 * 设计稿：tdsf-linux-redesign/pages/tutorial-detail.html
 * Spec: build-runnable-tdsf-from-design · Task 2.7
 *
 * 结构（4 section，1:1 对齐设计稿）：
 *   1. Page Header：返回工作台 + 返回教程 + 居中标题/副标题 + 难度/时长/进度 tag
 *   2. 章节进度条卡片：5 章节（2 完成 + 1 进行中蓝脉冲 + 2 待学习）
 *   3. 两栏布局：左栏（当前章节 + 实践 + 知识检查）+ 右栏（目录 + 讲师 + 相关课程）
 *   4. sticky 底部学习统计栏：已学习时长 + 进度条 + 继续学习按钮
 *
 * 数据：严格使用设计稿 tutorial-detail.html 示例数据（Nginx 性能调优 / 5 章节 / 3 测验 / 3 相关课程）
 * 视觉：全部 var(--trae-*) token，无硬编码 hex/rgba
 * 无障碍：button type + aria-label，prefers-reduced-motion 禁用按压动画
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Info, Clock,
  Terminal, List, UserCircle, Star, ChevronRight,
} from 'lucide-react'

// ==================== 类型定义 ====================

type ChapterStatus = 'completed' | 'in-progress' | 'pending'

interface ChapterData { id: number; index: string; title: string; duration: string }
interface QuizOption { key: string; label: string; correct?: boolean }
interface QuizQuestion { id: string; question: string; options: QuizOption[] }
interface RelatedCourse { id: string; title: string; level: '进阶' | '中级'; duration: string }
interface CodeLine { color: string; text: string }

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

const INSTRUCTOR_TAGS: string[] = ['nginx', '性能优化', '内核调优']

// ==================== 辅助函数 ====================

/** 根据 activeChapter 和 completedChapters 计算章节状态 */
function getChapterStatus(idx: number, activeIdx: number, completed: boolean[]): ChapterStatus {
  if (completed[idx]) return 'completed'
  if (idx === activeIdx) return 'in-progress'
  return 'pending'
}

// ==================== 主组件 ====================

/** TutorialDetailPage — 教程详情页 */
export function TutorialDetailPage() {
  const navigate = useNavigate()
  const [activeChapter, setActiveChapter] = useState(2)
  const [completedChapters, setCompletedChapters] = useState<boolean[]>([true, true, false, false, false])
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({ q1: 'B', q2: 'C', q3: 'C' })

  const completedCount = completedChapters.filter(Boolean).length
  const isFirst = activeChapter === 0
  const isLast = activeChapter === CHAPTERS.length - 1
  const currentChapter = CHAPTERS[activeChapter]

  // ===== 事件处理 =====
  const handleBackWorkbench = () => navigate('/workbench')
  const handleBackTutorial = () => navigate('/tutorial')
  const handlePrev = () => !isFirst && setActiveChapter(activeChapter - 1)
  const handleNext = () => !isLast && setActiveChapter(activeChapter + 1)
  const handleComplete = () => {
    setCompletedChapters((prev) => { const next = [...prev]; next[activeChapter] = true; return next })
    if (!isLast) setActiveChapter(activeChapter + 1)
  }
  const handleGotoChapter = (idx: number) => setActiveChapter(idx)
  const handleGotoRelated = (id: string) => navigate(`/tutorial/${id}`)
  const handleContinueLearning = () => !isLast && setActiveChapter(activeChapter + 1)
  const handleOpenSandbox = () => window.alert('沙箱环境正在启动...\n\nv1.1 版本将接入完整的 Linux 容器沙箱，支持实时执行 sysctl/nginx 命令。')
  const handleSubmitQuiz = () => {
    let correct = 0
    QUIZ_QUESTIONS.forEach((q) => {
      const correctOpt = q.options.find((o) => o.correct)
      if (quizAnswers[q.id] === correctOpt?.key) correct++
    })
    window.alert(`知识检查完成\n\n答题情况：${correct}/${QUIZ_QUESTIONS.length} 正确`)
  }

  return (
    <main style={{ background: 'var(--trae-bg-base-default)', color: 'var(--trae-text-default)', minHeight: '100%' }}>
      <div style={{ maxWidth: '100%', padding: '16px 24px 88px' }}>

        {/* ====== 1. Page Header ====== */}
        <header className="flex flex-wrap items-center justify-between gap-3" style={{ paddingBottom: 14, borderBottom: '1px solid var(--trae-border-neutral-l1)' }}>
          {/* 左：返回按钮 */}
          <div className="flex items-center" style={{ gap: 8 }}>
            <button type="button" data-dom-id="back-workbench" aria-label="返回工作台" onClick={handleBackWorkbench} className="btn-press inline-flex shrink-0 items-center transition-colors" style={{ gap: 6, height: 30, padding: '0 12px', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-text-default)', background: 'transparent', border: '1px solid var(--trae-border-neutral-l2)', borderRadius: 'var(--trae-radius-6)', cursor: 'pointer' }}>
              <ArrowLeft size={14} style={{ color: 'var(--trae-icon-secondary)' }} />
              <span>返回工作台</span>
            </button>
            <button type="button" data-dom-id="back-tutorial" aria-label="返回教程" onClick={handleBackTutorial} className="btn-press inline-flex shrink-0 items-center transition-colors" style={{ gap: 6, height: 30, padding: '0 12px', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-text-default)', background: 'transparent', border: '1px solid var(--trae-border-neutral-l2)', borderRadius: 'var(--trae-radius-6)', cursor: 'pointer' }}>
              <ArrowLeft size={14} style={{ color: 'var(--trae-icon-secondary)' }} />
              <span>返回教程</span>
            </button>
          </div>
          {/* 中：标题 + 副标题 */}
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 2, textAlign: 'center', minWidth: 200 }}>
            <h1 style={{ margin: 0, fontSize: 'var(--trae-heading-md-font-size)', lineHeight: 'var(--trae-heading-md-line-height)', fontWeight: 'var(--trae-heading-md-font-weight)', color: 'var(--trae-text-default)', wordBreak: 'keep-all', overflowWrap: 'break-word' }}>Nginx性能调优实战</h1>
            <span className="truncate" style={{ fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 'var(--trae-body-xs-line-height)', color: 'var(--trae-text-tertiary)' }}>从worker_connections到内核参数的全面优化</span>
          </div>
          {/* 右：难度 tag + 时长 tag + 进度 */}
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center" style={{ padding: '0 6px', height: 18, borderRadius: 'var(--trae-radius-2)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, background: 'var(--trae-bg-brand-popup)', color: 'var(--trae-text-brand)' }}>进阶</span>
            <span className="inline-flex items-center gap-1" style={{ padding: '0 6px', height: 18, borderRadius: 'var(--trae-radius-2)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, background: 'var(--trae-bg-overlay-l2)', color: 'var(--trae-text-secondary)', border: '1px solid var(--trae-border-neutral-l1)' }}>
              <Clock size={11} style={{ color: 'var(--trae-text-secondary)' }} />
              2h30min
            </span>
            <span style={{ fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-text-brand)', fontVariantNumeric: 'tabular-nums' }}>65%</span>
          </div>
        </header>

        {/* ====== 2. 章节进度条卡片 ====== */}
        <section style={{ marginTop: 14, background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: '12px 16px' }}>
          <div className="flex items-center" style={{ gap: 6 }}>
            {CHAPTERS.map((ch, i) => {
              const status = getChapterStatus(i, activeChapter, completedChapters)
              return (
                <div key={ch.id} className="flex items-center" style={{ flex: i < CHAPTERS.length - 1 ? '1 0 auto' : '0 0 auto' }}>
                  <div className="flex shrink-0 flex-col items-center" style={{ gap: 6, minWidth: 64 }}>
                    {status === 'completed' && (
                      <div className="flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: 'var(--trae-radius-full)', background: 'var(--trae-status-success-default)' }}>
                        <Check size={12} style={{ color: 'var(--trae-special-white)' }} />
                      </div>
                    )}
                    {status === 'in-progress' && (
                      <div className="relative flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: 'var(--trae-radius-full)', background: 'var(--trae-bg-brand)' }}>
                        <span className="chapter-ping absolute inline-flex" style={{ width: 22, height: 22, borderRadius: 'var(--trae-radius-full)', background: 'var(--trae-bg-brand)', opacity: 0.4 }} />
                        <span className="relative inline-block" style={{ width: 8, height: 8, borderRadius: 'var(--trae-radius-full)', background: 'var(--trae-special-white)' }} />
                      </div>
                    )}
                    {status === 'pending' && (
                      <div className="flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: 'var(--trae-radius-full)', background: 'transparent', border: '1.5px solid var(--trae-border-neutral-l3)' }} />
                    )}
                    <span className="hidden truncate sm:inline" style={{ fontSize: 'var(--trae-body-xs-font-size)', maxWidth: 84, color: status === 'in-progress' ? 'var(--trae-text-brand)' : status === 'completed' ? 'var(--trae-text-secondary)' : 'var(--trae-text-tertiary)', fontWeight: status === 'in-progress' ? 'var(--trae-font-weight-medium)' : undefined }}>{ch.title}</span>
                  </div>
                  {i < CHAPTERS.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: completedChapters[i] ? 'var(--trae-status-success-default)' : 'var(--trae-border-neutral-l2)', borderRadius: 'var(--trae-radius-full)' }} />
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)', textAlign: 'center' }}>已完成 {completedCount}/5 章 · 预计还需 52min</div>
        </section>

        {/* ====== 3. 两栏布局 ====== */}
        <div className="flex flex-col lg:flex-row" style={{ gap: 16, marginTop: 14 }}>

          {/* 左栏：课程内容 */}
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 14 }}>

            {/* 【当前章节卡片】 */}
            <article className="tutorial-fade-in" style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 16 }}>
              <div className="flex items-center justify-between gap-2">
                <h2 style={{ margin: 0, fontSize: 'var(--trae-heading-xs-font-size)', lineHeight: 'var(--trae-heading-xs-line-height)', fontWeight: 'var(--trae-heading-xs-font-weight)', color: 'var(--trae-text-default)' }}>第{activeChapter + 1}章：{currentChapter.title}</h2>
                <span className="inline-flex shrink-0 items-center" style={{ padding: '0 6px', height: 18, borderRadius: 'var(--trae-radius-2)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, background: 'var(--trae-bg-brand-popup)', color: 'var(--trae-text-brand)' }}>当前学习</span>
              </div>
              {/* 学习目标 */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)', marginBottom: 6, fontWeight: 'var(--trae-font-weight-medium)' }}>学习目标</div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {OBJECTIVES.map((obj) => (
                    <li key={obj} className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="mt-px shrink-0" style={{ color: 'var(--trae-status-success-default)' }} />
                      <span style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-default)' }}>{obj}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {/* 内容正文 */}
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {PARAGRAPHS.map((p, i) => (
                  <p key={i} style={{ margin: 0, fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-default)' }}>{p}</p>
                ))}
              </div>
              {/* 命令示例块 */}
              <div style={{ marginTop: 12 }}>
                <pre style={{ margin: 0, background: 'var(--trae-bg-base-default)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-6)', padding: 12, fontFamily: 'var(--trae-font-family-mono)', fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 1.7, overflowX: 'auto' }}>
                  {CODE_LINES.map((line, i) => (
                    <span key={i} style={{ color: line.color, display: 'block' }}>{line.text}</span>
                  ))}
                </pre>
                <div style={{ marginTop: 6, fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-code-constant)', fontFamily: 'var(--trae-font-family-mono)' }}># 查看并调整TCP连接队列长度</div>
              </div>
              {/* 注意事项 alert */}
              <div className="flex items-start" style={{ marginTop: 12, gap: 8, padding: '8px 12px', background: 'var(--trae-status-warning-surface-l1)', borderLeft: '3px solid var(--trae-status-warning-default)', borderRadius: '0 4px 4px 0' }}>
                <Info size={14} className="mt-px shrink-0" style={{ color: 'var(--trae-status-warning-default)' }} />
                <span style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-default)' }}>修改内核参数需谨慎，建议先在测试环境验证</span>
              </div>
              {/* 按钮组 */}
              <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 14 }}>
                <button type="button" data-dom-id="btn-prev-chapter" aria-label="上一章" onClick={handlePrev} disabled={isFirst} className="btn-press inline-flex items-center gap-1.5 transition-colors" style={{ height: 30, padding: '0 12px', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-text-default)', background: 'transparent', border: '1px solid var(--trae-border-neutral-l2)', borderRadius: 'var(--trae-radius-6)', ...(isFirst ? { opacity: 0.4, cursor: 'not-allowed' } : { cursor: 'pointer' }) }}>
                  <ArrowLeft size={13} style={{ color: 'currentColor' }} />
                  上一章
                </button>
                <button type="button" data-dom-id="btn-complete-chapter" aria-label="标记完成" onClick={handleComplete} className="btn-press inline-flex cursor-pointer items-center gap-1.5 transition-transform" style={{ height: 30, padding: '0 14px', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-special-white)', background: 'var(--trae-bg-brand)', border: '1px solid var(--trae-bg-brand)', borderRadius: 'var(--trae-radius-6)' }}>
                  <Check size={13} style={{ color: 'var(--trae-special-white)' }} />
                  标记完成
                </button>
                <button type="button" data-dom-id="btn-next-chapter" aria-label="下一章" onClick={handleNext} disabled={isLast} className="btn-press inline-flex items-center gap-1.5 transition-colors" style={{ height: 30, padding: '0 12px', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-text-brand)', background: 'transparent', border: '1px solid var(--trae-border-brand)', borderRadius: 'var(--trae-radius-6)', ...(isLast ? { opacity: 0.4, cursor: 'not-allowed' } : { cursor: 'pointer' }) }}>
                  下一章
                  <ArrowRight size={13} style={{ color: 'currentColor' }} />
                </button>
              </div>
            </article>

            {/* 【实践练习卡片】 */}
            <article className="tutorial-fade-in" style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 16, animationDelay: '0.05s' }}>
              <div className="flex items-center gap-2">
                <Terminal size={15} style={{ color: 'var(--trae-text-brand)' }} />
                <h2 style={{ margin: 0, fontSize: 'var(--trae-heading-xs-font-size)', lineHeight: 'var(--trae-heading-xs-line-height)', fontWeight: 'var(--trae-heading-xs-font-weight)', color: 'var(--trae-text-default)' }}>动手实践</h2>
              </div>
              <p style={{ marginTop: 8, fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-secondary)' }}>在沙箱环境中调整nginx内核参数，观察P99延迟变化</p>
              <pre style={{ marginTop: 10, background: 'var(--trae-bg-base-default)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-6)', padding: 12, fontFamily: 'var(--trae-font-family-mono)', fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 1.7, overflowX: 'auto' }}>
                {PRACTICE_LINES.map((line, i) => (
                  <span key={i} style={{ color: line.color, display: 'block' }}>{line.text}</span>
                ))}
              </pre>
              <div style={{ marginTop: 12 }}>
                <button type="button" data-dom-id="btn-open-sandbox" aria-label="打开沙箱练习" onClick={handleOpenSandbox} className="btn-press inline-flex cursor-pointer items-center gap-1.5 transition-colors" style={{ height: 30, padding: '0 14px', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-text-brand)', background: 'transparent', border: '1px solid var(--trae-border-brand)', borderRadius: 'var(--trae-radius-6)' }}>
                  <Terminal size={13} style={{ color: 'currentColor' }} />
                  打开沙箱练习
                </button>
              </div>
            </article>

            {/* 【知识检查卡片】 */}
            <article className="tutorial-fade-in" style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 16, animationDelay: '0.1s' }}>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} style={{ color: 'var(--trae-text-brand)' }} />
                <h2 style={{ margin: 0, fontSize: 'var(--trae-heading-xs-font-size)', lineHeight: 'var(--trae-heading-xs-line-height)', fontWeight: 'var(--trae-heading-xs-font-weight)', color: 'var(--trae-text-default)' }}>知识检查</h2>
              </div>
              {QUIZ_QUESTIONS.map((q) => (
                <div key={q.id} style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 'var(--trae-body-sm-font-size)', color: 'var(--trae-text-default)', marginBottom: 6 }}>
                    <span style={{ color: 'var(--trae-text-brand)', fontWeight: 'var(--trae-font-weight-medium)' }}>Q{q.id.slice(1)}.</span> {q.question}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {q.options.map((opt) => {
                      const isSelected = quizAnswers[q.id] === opt.key
                      const isCorrectSelected = !!opt.correct && isSelected
                      return (
                        <label key={opt.key} className="flex cursor-pointer items-center gap-2" style={{ padding: '6px 10px', border: `1px solid ${isCorrectSelected ? 'var(--trae-status-success-default)' : 'var(--trae-border-neutral-l1)'}`, borderRadius: 'var(--trae-radius-4)', fontSize: 'var(--trae-body-sm-font-size)', background: isCorrectSelected ? 'var(--trae-status-success-surface-l1)' : 'transparent', color: isCorrectSelected ? 'var(--trae-status-success-default)' : 'var(--trae-text-secondary)', fontWeight: isCorrectSelected ? 'var(--trae-font-weight-medium)' : undefined }}>
                          <input type="radio" name={q.id} checked={isSelected} onChange={() => setQuizAnswers((prev) => ({ ...prev, [q.id]: opt.key }))} style={{ accentColor: 'var(--trae-bg-brand)' }} />
                          {opt.key}. {opt.label}{isCorrectSelected ? ' ✓' : ''}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 14 }}>
                <button type="button" data-dom-id="btn-submit-quiz" aria-label="提交答案" onClick={handleSubmitQuiz} className="btn-press inline-flex cursor-pointer items-center gap-1.5 transition-transform" style={{ height: 30, padding: '0 16px', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-special-white)', background: 'var(--trae-bg-brand)', border: '1px solid var(--trae-bg-brand)', borderRadius: 'var(--trae-radius-6)' }}>
                  提交答案
                </button>
              </div>
            </article>

          </div>

          {/* 右栏：侧边栏 280px */}
          <aside className="flex w-full shrink-0 flex-col lg:w-[280px]" style={{ gap: 14 }}>

            {/* 【课程目录卡片】 */}
            <div style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 14 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                <List size={14} style={{ color: 'var(--trae-text-secondary)' }} />
                <h2 style={{ margin: 0, fontSize: 'var(--trae-heading-xs-font-size)', lineHeight: 'var(--trae-heading-xs-line-height)', fontWeight: 'var(--trae-heading-xs-font-weight)', color: 'var(--trae-text-default)' }}>课程目录</h2>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {CHAPTERS.map((ch, i) => {
                  const status = getChapterStatus(i, activeChapter, completedChapters)
                  const isActive = i === activeChapter
                  return (
                    <li key={ch.id} data-dom-id={`goto-chapter-${ch.id}`} onClick={() => handleGotoChapter(i)} className="flex cursor-pointer items-center gap-2" style={{ padding: '7px 8px', borderRadius: 'var(--trae-radius-4)', background: isActive ? 'var(--trae-bg-brand-popup)' : 'transparent' }}>
                      <span style={{ fontSize: 'var(--trae-body-xs-font-size)', color: isActive ? 'var(--trae-text-brand)' : 'var(--trae-text-tertiary)', width: 14, flexShrink: 0, fontWeight: isActive ? 'var(--trae-font-weight-medium)' : undefined }}>{ch.index}</span>
                      {status === 'completed' && <Check size={13} className="shrink-0" style={{ color: 'var(--trae-status-success-default)' }} />}
                      {status === 'in-progress' && <span className="inline-block shrink-0" style={{ width: 8, height: 8, borderRadius: 'var(--trae-radius-full)', background: 'var(--trae-bg-brand)' }} />}
                      {status === 'pending' && <span className="inline-block shrink-0" style={{ width: 13, height: 13, borderRadius: 'var(--trae-radius-full)', border: '1.5px solid var(--trae-border-neutral-l3)' }} />}
                      <span className="flex-1 truncate" style={{ fontSize: 'var(--trae-body-sm-font-size)', color: isActive ? 'var(--trae-text-brand)' : status === 'pending' ? 'var(--trae-text-tertiary)' : 'var(--trae-text-secondary)', fontWeight: isActive ? 'var(--trae-font-weight-medium)' : undefined }}>{ch.title}</span>
                      <span className="shrink-0" style={{ fontSize: 'var(--trae-body-xs-font-size)', color: isActive ? 'var(--trae-text-brand)' : 'var(--trae-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{ch.duration}</span>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* 【讲师信息卡片】 */}
            <div style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 14 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
                <UserCircle size={14} style={{ color: 'var(--trae-text-secondary)' }} />
                <h2 style={{ margin: 0, fontSize: 'var(--trae-heading-xs-font-size)', lineHeight: 'var(--trae-heading-xs-line-height)', fontWeight: 'var(--trae-heading-xs-font-weight)', color: 'var(--trae-text-default)' }}>讲师</h2>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex shrink-0 items-center justify-center" style={{ width: 40, height: 40, borderRadius: 'var(--trae-radius-full)', background: 'var(--trae-bg-brand)', color: 'var(--trae-special-white)', fontSize: 'var(--trae-body-md-font-size)', fontWeight: 'var(--trae-font-weight-strong)' }}>张</div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate" style={{ fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-text-default)' }}>张工</span>
                  <span className="truncate" style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>资深SRE工程师</span>
                </div>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 'var(--trae-body-xs-line-height)', color: 'var(--trae-text-secondary)' }}>10年Linux运维经验</p>
              <div className="flex flex-wrap" style={{ gap: 6, marginTop: 10 }}>
                {INSTRUCTOR_TAGS.map((tag) => (
                  <span key={tag} className="inline-flex items-center" style={{ padding: '0 6px', height: 18, borderRadius: 'var(--trae-radius-2)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, background: 'var(--trae-bg-overlay-l2)', color: 'var(--trae-text-secondary)', border: '1px solid var(--trae-border-neutral-l1)' }}>{tag}</span>
                ))}
              </div>
            </div>

            {/* 【相关推荐卡片】 */}
            <div style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 14 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                <Star size={14} style={{ color: 'var(--trae-text-secondary)' }} />
                <h2 style={{ margin: 0, fontSize: 'var(--trae-heading-xs-font-size)', lineHeight: 'var(--trae-heading-xs-line-height)', fontWeight: 'var(--trae-heading-xs-font-weight)', color: 'var(--trae-text-default)' }}>相关课程</h2>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {RELATED_COURSES.map((course, i) => (
                  <li key={course.id} data-dom-id={`goto-related-course-${i + 1}`} onClick={() => handleGotoRelated(course.id)} className="cursor-pointer" style={{ padding: '7px 8px', borderRadius: 'var(--trae-radius-4)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate" style={{ fontSize: 'var(--trae-body-sm-font-size)', color: 'var(--trae-text-default)' }}>{course.title}</span>
                      <ChevronRight size={13} className="shrink-0" style={{ color: 'var(--trae-text-tertiary)' }} />
                    </div>
                    <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                      <span className="inline-flex items-center" style={{ padding: '0 6px', height: 18, borderRadius: 'var(--trae-radius-2)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, background: course.level === '进阶' ? 'var(--trae-bg-brand-popup)' : 'var(--trae-bg-overlay-l2)', color: course.level === '进阶' ? 'var(--trae-text-brand)' : 'var(--trae-text-secondary)', ...(course.level === '进阶' ? {} : { border: '1px solid var(--trae-border-neutral-l1)' }) }}>{course.level}</span>
                      <span style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>{course.duration}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

          </aside>
        </div>
      </div>

      {/* ====== 4. 底部学习统计栏（sticky 满宽） ====== */}
      <footer className="sticky bottom-0" style={{ background: 'var(--trae-bg-base-secondary)', borderTop: '1px solid var(--trae-border-neutral-l1)', padding: '12px 24px' }}>
        <div className="mx-auto flex flex-wrap items-center gap-4" style={{ maxWidth: '100%' }}>
          {/* 左：已学习时长 */}
          <div className="flex shrink-0 items-center gap-1.5">
            <Clock size={14} style={{ color: 'var(--trae-text-secondary)' }} />
            <span style={{ fontSize: 'var(--trae-body-sm-font-size)', color: 'var(--trae-text-secondary)' }}>
              已学习 <span style={{ color: 'var(--trae-text-default)', fontWeight: 'var(--trae-font-weight-medium)', fontVariantNumeric: 'tabular-nums' }}>1h38min</span> / 总时长 2h30min
            </span>
          </div>
          {/* 中：进度条 */}
          <div className="flex min-w-[120px] flex-1 items-center gap-2">
            <div style={{ flex: 1, height: 6, background: 'var(--trae-bg-overlay-l3)', borderRadius: 'var(--trae-radius-full)', overflow: 'hidden' }}>
              <div style={{ width: '65%', height: '100%', background: 'var(--trae-bg-brand)', borderRadius: 'var(--trae-radius-full)' }} />
            </div>
            <span className="shrink-0" style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-brand)', fontWeight: 'var(--trae-font-weight-medium)', fontVariantNumeric: 'tabular-nums' }}>65%</span>
          </div>
          {/* 右：继续学习按钮 */}
          <button type="button" data-dom-id="btn-continue-learning" aria-label="继续学习" onClick={handleContinueLearning} className="btn-press inline-flex shrink-0 cursor-pointer items-center gap-1.5 transition-transform" style={{ height: 32, padding: '0 16px', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-special-white)', background: 'var(--trae-bg-brand)', border: '1px solid var(--trae-bg-brand)', borderRadius: 'var(--trae-radius-6)' }}>
            继续学习
            <ArrowRight size={13} style={{ color: 'var(--trae-special-white)' }} />
          </button>
        </div>
      </footer>

      {/* 动效：仅含 @keyframes 与 reduced-motion 降级，无 class 定义 */}
      <style>{`
        @keyframes tutorialFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .tutorial-fade-in { animation: tutorialFadeIn 0.4s cubic-bezier(0.3, 0, 0, 1); }
        @keyframes chapterPing { 0% { transform: scale(1); opacity: 0.4; } 75%, 100% { transform: scale(2); opacity: 0; } }
        .chapter-ping { animation: chapterPing 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; }
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.96); }
        @media (prefers-reduced-motion: reduce) {
          .tutorial-fade-in, .chapter-ping { animation: none !important; }
          .btn-press:active { transform: none !important; }
        }
      `}</style>
    </main>
  )
}
