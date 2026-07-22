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
import '../../../pages/TutorialPage.css'
import { type Course } from './types'

function levelBadgeSmClass(level: string): string {
  if (level === '进阶') return 'tut-level-badge--sm tut-level-badge--warning'
  if (level === '中级') return 'tut-level-badge--sm'
  return 'tut-level-badge--sm tut-level-badge--neutral'
}

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
      className="tut-course-card"
    >
      <div className="tut-course-head">
        <Icon size={20} className="tut-course-icon" />
        <span className="tut-course-badges">
          <span className={levelBadgeSmClass(course.level)}>
            {course.level}
          </span>
          {course.completed && (
            <span className="tut-completed-badge">已完成</span>
          )}
        </span>
      </div>
      <h4 className="tut-course-title">{course.title}</h4>
      <p className="tut-course-desc">{course.description}</p>
      <div className="tut-course-meta">
        <span className="tut-course-meta-item">
          <Clock size={12} />
          {course.duration}
        </span>
        <span className="tut-course-meta-item">
          <CircleUser size={12} />
          {course.learnerCount}
        </span>
      </div>
      <div className="tut-progress-block">
        <div className="tut-progress-row tut-progress-row--tight">
          <span className="tut-progress-label">进度</span>
          <span
            className={
              course.progress > 0
                ? 'tut-progress-value'
                : 'tut-progress-value tut-progress-value--zero'
            }
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {course.progress}%
          </span>
        </div>
        <div className="tut-progress-bar tut-progress-bar--thin">
          <div
            className="tut-progress-bar-fill"
            style={{ width: `${course.progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}
