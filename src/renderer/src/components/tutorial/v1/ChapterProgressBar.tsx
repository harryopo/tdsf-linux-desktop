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
    <section
      className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
      style={{ padding: '12px 16px' }}
    >
      <div className="flex items-center" style={{ gap: 6 }}>
        {chapters.map((ch, i) => (
          <ChapterNode key={ch.id} chapter={ch} isLast={i === chapters.length - 1} />
        ))}
      </div>
      <div
        className="mt-2.5 text-center text-[var(--trae-text-tertiary)]"
        style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
      >
        已完成 {completedCount}/{chapters.length} 章 · 预计还需 {remainingTime}
      </div>
    </section>
  )
}

/** 单个章节节点：圆形指示器 + 标签 + 连接线 */
function ChapterNode({ chapter, isLast }: { chapter: Chapter; isLast: boolean }) {
  const lineColor =
    chapter.status === 'completed'
      ? 'var(--trae-status-success-default)'
      : 'var(--trae-border-neutral-l2)'

  return (
    <>
      <div
        className="flex shrink-0 flex-col items-center"
        style={{ gap: 6, minWidth: 64 }}
      >
        <ChapterIndicator status={chapter.status} />
        <span
          className="hidden truncate sm:inline"
          style={{
            fontSize: 'var(--trae-body-xs-font-size)',
            maxWidth: 84,
            color:
              chapter.status === 'in-progress'
                ? 'var(--trae-text-brand)'
                : chapter.status === 'completed'
                  ? 'var(--trae-text-secondary)'
                  : 'var(--trae-text-tertiary)',
            fontWeight:
              chapter.status === 'in-progress'
                ? 'var(--trae-font-weight-medium)'
                : 'var(--trae-font-weight-default)',
          }}
        >
          {chapter.title}
        </span>
      </div>
      {!isLast && (
        <div
          style={{
            flex: 1,
            height: 2,
            background: lineColor,
            borderRadius: 'var(--trae-radius-full)',
          }}
        />
      )}
    </>
  )
}

/** 章节圆形指示器（已完成 / 进行中 / 待学习） */
function ChapterIndicator({ status }: { status: Chapter['status'] }) {
  if (status === 'completed') {
    return (
      <div
        className="flex items-center justify-center"
        style={{
          width: 22,
          height: 22,
          borderRadius: 'var(--trae-radius-full)',
          background: 'var(--trae-status-success-default)',
        }}
      >
        <Check
          size={12}
          className="text-white"
          strokeWidth={3}
          style={{ color: 'var(--special-white, #ffffff)' }}
        />
      </div>
    )
  }
  if (status === 'in-progress') {
    return (
      <div
        className="relative flex items-center justify-center"
        style={{
          width: 22,
          height: 22,
          borderRadius: 'var(--trae-radius-full)',
          background: 'var(--trae-bg-brand)',
        }}
      >
        <span
          className="absolute inline-flex animate-ping"
          style={{
            width: 22,
            height: 22,
            borderRadius: 'var(--trae-radius-full)',
            background: 'var(--trae-bg-brand)',
            opacity: 0.4,
          }}
        />
        <span
          className="relative inline-block"
          style={{
            width: 8,
            height: 8,
            borderRadius: 'var(--trae-radius-full)',
            background: '#ffffff',
          }}
        />
      </div>
    )
  }
  // pending
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: 22,
        height: 22,
        borderRadius: 'var(--trae-radius-full)',
        background: 'transparent',
        border: '1.5px solid var(--trae-border-neutral-l3)',
      }}
    />
  )
}
