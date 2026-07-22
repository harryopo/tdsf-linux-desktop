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
import '../../../pages/TutorialPage.css'
import { type Course } from './types'

function levelBadgeClass(level: string): string {
  if (level === '进阶') return 'tut-level-badge tut-level-badge--warning'
  if (level === '中级') return 'tut-level-badge'
  return 'tut-level-badge tut-level-badge--neutral'
}

/** 精选课程大卡 */
export function FeaturedCourseCard({
  course,
  onOpen,
}: {
  course: Course
  onOpen: (id: string) => void
}) {
  return (
    <div
      className="tut-featured-card"
      onClick={() => onOpen(course.id)}
    >
      <div className="tut-featured-head">
        <span className={levelBadgeClass(course.level)}>
          {course.level}
        </span>
        <span className="tut-duration-tag">
          <Clock size={12} />
          {course.duration}
        </span>
      </div>
      <h3 className="tut-featured-title">{course.title}</h3>
      <p className="tut-featured-desc">{course.description}</p>
      <div className="tut-progress-block">
        <div className="tut-progress-row">
          <span className="tut-progress-label">学习进度</span>
          <span className="tut-progress-value">{course.progress}%</span>
        </div>
        <div className="tut-progress-bar">
          <div
            className="tut-progress-bar-fill"
            style={{ width: `${course.progress}%` }}
          />
        </div>
      </div>
      <div>
        <button
          type="button"
          data-dom-id="open-course"
          className="tut-featured-btn tut-btn-press"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(course.id)
          }}
        >
          {course.progress > 0 ? '继续学习' : '开始学习'}
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  )
}
