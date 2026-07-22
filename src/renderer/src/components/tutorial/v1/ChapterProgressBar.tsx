/**
 * ChapterProgressBar — 章节进度条（TutorialDetailPage 子组件）
 *
 * 设计稿参考：tutorial-detail.html 课程进度条卡片
 * 结构：5 个章节节点 + 4 段连接线
 *   - 已完成：绿色实心圆 + 对勾图标
 *   - 进行中：品牌蓝实心圆 + 白色内点 + animate-ping 脉冲
 *   - 待学习：透明圆 + 灰色描边
 * 连接线：已完成段绿色，未完成段灰色
 *
 * 底部辅助文字："已完成 2/5 章 · 预计还需 52min"
 */
import { Check } from 'lucide-react'
import '../../../pages/TutorialPage.css'
import { type Chapter } from './detail-data'

/** 章节进度条 */
export function ChapterProgressBar({
  chapters,
  completedCount,
  remainingTime,
}: {
  chapters: Chapter[]
  completedCount: number
  remainingTime: string
}) {
  return (
    <section className="tut-progress-card">
      <div className="tut-progress-track">
        {chapters.map((ch, i) => (
          <ChapterNode key={ch.id} chapter={ch} isLast={i === chapters.length - 1} />
        ))}
      </div>
      <div className="tut-progress-text">
        已完成 {completedCount}/{chapters.length} 章 · 预计还需 {remainingTime}
      </div>
    </section>
  )
}

/** 单个章节节点：圆形指示器 + 标签 + 连接线 */
function ChapterNode({ chapter, isLast }: { chapter: Chapter; isLast: boolean }) {
  const connectorClass =
    chapter.status === 'completed'
      ? 'tut-progress-connector tut-progress-connector--completed'
      : 'tut-progress-connector tut-progress-connector--pending'

  const labelClass =
    chapter.status === 'in-progress'
      ? 'tut-progress-node-label tut-progress-node-label--in-progress'
      : chapter.status === 'completed'
        ? 'tut-progress-node-label tut-progress-node-label--completed'
        : 'tut-progress-node-label tut-progress-node-label--pending'

  return (
    <>
      <div className="tut-progress-node">
        <ChapterIndicator status={chapter.status} />
        <span className={labelClass}>
          {chapter.title}
        </span>
      </div>
      {!isLast && <div className={connectorClass} />}
    </>
  )
}

/** 章节圆形指示器（已完成 / 进行中 / 待学习） */
function ChapterIndicator({ status }: { status: Chapter['status'] }) {
  if (status === 'completed') {
    return (
      <div className="tut-progress-indicator tut-progress-indicator--completed">
        <Check
          size={12}
          strokeWidth={3}
          style={{ color: 'var(--trae-special-white, #ffffff)' }}
        />
      </div>
    )
  }
  if (status === 'in-progress') {
    return (
      <div className="tut-progress-indicator tut-progress-indicator--in-progress">
        <span className="tut-chapter-ping tut-progress-ping" />
        <span className="tut-progress-inner-dot" />
      </div>
    )
  }
  return (
    <div className="tut-progress-indicator tut-progress-indicator--pending" />
  )
}
