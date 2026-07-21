/**
 * CourseCard — 普通课程小卡（TutorialPage 子组件）
 *
 * 设计稿参考：tutorial.html 课程列表 6 张网格卡
 * 结构：图标 + 难度（+ 已完成 Badge）→ 标题 → 描述 → 时长/人数 → 进度
 *
 * 卡片整体可点击跳转详情，支持键盘 Enter/Space 操作
 * hover 仅阴影变化（遵循项目硬约束）
 */
import { Clock, CircleUser } from 'lucide-react'
import { Progress } from '@/components/trae/Progress'
import { type Course, levelStyle } from './types'

/** 普通课程小卡 */
export function CourseCard({
  course,
  onOpen,
}: {
  course: Course
  onOpen: (id: string) => void
}) {
  const Icon = course.icon
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(course.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(course.id)
        }
      }}
      className="flex cursor-pointer flex-col gap-2.5 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
      style={{ padding: 14 }}
    >
      <div className="flex items-center justify-between">
        <Icon size={20} className="text-[var(--trae-text-secondary)]" />
        <span className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center"
            style={{
              padding: '0 8px',
              height: 18,
              borderRadius: 'var(--trae-radius-4)',
              fontSize: 'var(--trae-body-xs-font-size)',
              lineHeight: 1,
              ...levelStyle(course.level),
            }}
          >
            {course.level}
          </span>
          {course.completed && (
            <span
              className="inline-flex items-center"
              style={{
                padding: '0 8px',
                height: 18,
                borderRadius: 'var(--trae-radius-4)',
                fontSize: 'var(--trae-body-xs-font-size)',
                lineHeight: 1,
                background: 'var(--trae-status-success-surface-l1)',
                color: 'var(--trae-status-success-default)',
              }}
            >
              已完成
            </span>
          )}
        </span>
      </div>
      <h4
        className="m-0 font-semibold"
        style={{
          fontSize: 'var(--trae-body-md-font-size)',
          lineHeight: 'var(--trae-body-md-strong-line-height)',
          color: 'var(--trae-text-default)',
        }}
      >
        {course.title}
      </h4>
      <p
        className="m-0 text-[var(--trae-text-tertiary)]"
        style={{
          fontSize: 'var(--trae-body-xs-font-size)',
          lineHeight: 'var(--trae-body-sm-line-height)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {course.description}
      </p>
      <div
        className="flex items-center gap-3 text-[var(--trae-text-tertiary)]"
        style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
      >
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {course.duration}
        </span>
        <span className="flex items-center gap-1">
          <CircleUser size={12} />
          {course.learnerCount}
        </span>
      </div>
      <div>
        <div
          className="mb-1 flex items-center justify-between"
          style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
        >
          <span className="text-[var(--trae-text-tertiary)]">进度</span>
          <span
            className={
              course.progress > 0
                ? 'font-medium text-[var(--trae-text-brand)]'
                : 'text-[var(--trae-text-tertiary)]'
            }
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {course.progress}%
          </span>
        </div>
        <Progress value={course.progress} style={{ height: 3 }} />
      </div>
    </div>
  )
}
