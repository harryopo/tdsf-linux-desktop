/**
 * FeaturedCourseCard — 精选课程大卡（TutorialPage 子组件）
 *
 * 设计稿参考：tutorial.html 精选课程 2 列网格
 * 结构：难度 Badge + 时长 → 标题 → 描述 → 学习进度条 → 继续学习按钮
 *
 * TRAE 组件：Card / Badge / Button / Progress
 * Lucide 图标：Clock / ArrowRight
 */
import { Clock, ArrowRight } from 'lucide-react'
import { Card } from '@/components/trae/Card'
import { Progress } from '@/components/trae/Progress'
import { type Course, levelStyle } from './types'

/** 精选课程大卡 */
export function FeaturedCourseCard({
  course,
  onOpen,
}: {
  course: Course
  onOpen: (id: string) => void
}) {
  return (
    <Card
      className="flex flex-col gap-3"
      style={{ padding: 18 }}
      onClick={() => onOpen(course.id)}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center"
          style={{
            padding: '0 8px',
            height: 20,
            borderRadius: 'var(--trae-radius-4)',
            fontSize: 'var(--trae-body-xs-font-size)',
            fontWeight: 'var(--trae-font-weight-medium)',
            lineHeight: 1,
            ...levelStyle(course.level),
          }}
        >
          {course.level}
        </span>
        <span
          className="flex items-center gap-1 text-[var(--trae-text-tertiary)]"
          style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
        >
          <Clock size={12} />
          {course.duration}
        </span>
      </div>
      <h3
        className="m-0 font-semibold"
        style={{
          fontSize: 'var(--trae-heading-sm-font-size)',
          lineHeight: 'var(--trae-heading-sm-line-height)',
          color: 'var(--trae-text-default)',
        }}
      >
        {course.title}
      </h3>
      <p
        className="m-0 text-[var(--trae-text-secondary)]"
        style={{
          fontSize: 'var(--trae-body-sm-font-size)',
          lineHeight: 'var(--trae-body-sm-line-height)',
        }}
      >
        {course.description}
      </p>
      <div>
        <div
          className="mb-1.5 flex items-center justify-between"
          style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
        >
          <span className="text-[var(--trae-text-tertiary)]">学习进度</span>
          <span
            className="font-medium text-[var(--trae-text-brand)]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {course.progress}%
          </span>
        </div>
        <Progress value={course.progress} className="h-1" />
      </div>
      <div>
        <button
          type="button"
          data-dom-id="open-course"
          className="btn-press inline-flex items-center"
          style={{
            gap: 6,
            padding: '7px 14px',
            border: '1px solid var(--trae-bg-brand)',
            borderRadius: 'var(--trae-radius-6)',
            background: 'transparent',
            color: 'var(--trae-text-brand)',
            fontSize: 'var(--trae-body-sm-font-size)',
            fontWeight: 'var(--trae-font-weight-medium)',
            cursor: 'pointer',
            transition: 'background .15s ease',
          }}
          onClick={(e) => {
            e.stopPropagation()
            onOpen(course.id)
          }}
        >
          {course.progress > 0 ? '继续学习' : '开始学习'}
          <ArrowRight size={12} />
        </button>
      </div>
    </Card>
  )
}
