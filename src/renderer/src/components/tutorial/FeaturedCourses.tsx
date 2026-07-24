/**
 * FeaturedCourses — 精选课程 section（md:grid-cols-2）
 *
 * 取真实库中进度最高的 2 门课程，1:1 对齐设计稿精选课程大卡：
 *   难度标签 + 时长 / 标题 / 描述 / 学习进度条 / CTA 按钮。
 * 课程数据与打开回调由父组件 TutorialPage 通过 props 传入。
 */
import { Star, Clock, ArrowRight } from 'lucide-react'
import type { Course } from './types'
import { featuredLevelClassName } from './types'

interface FeaturedCoursesProps {
  featured: Course[]
  onOpenCourse: (id: string) => void
}

export function FeaturedCourses({ featured, onOpenCourse }: FeaturedCoursesProps) {
  return (
    <section className="tut-section" aria-label="精选课程">
      <div className="tut-section-title-row">
        <Star size={18} fill="currentColor" style={{ color: 'var(--trae-icon-brand)' }} />
        <h2 className="tut-section-title">精选课程</h2>
      </div>
      <div className="tut-featured-grid">
        {featured.map((c) => (
          <div key={c.id} className="tut-featured-card">
            <div className="tut-featured-head">
              <span className={featuredLevelClassName(c.level)}>{c.level}</span>
              <span className="tut-duration-tag">
                <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                {c.duration}
              </span>
            </div>
            <h3 className="tut-featured-title">{c.title}</h3>
            <p className="tut-featured-desc">{c.description}</p>
            <div className="tut-progress-block">
              <div className="tut-progress-row">
                <span className="tut-progress-label">学习进度</span>
                <span className="tut-progress-value">{c.progress}%</span>
              </div>
              <div className="tut-progress-bar">
                <div className="tut-progress-bar-fill" style={{ width: `${c.progress}%` }} />
              </div>
            </div>
            <div>
              <button type="button" data-dom-id={c.domId} aria-label={c.cta} onClick={() => onOpenCourse(c.id)} className="tut-featured-btn tut-btn-press">
                {c.cta}
                <ArrowRight size={12} style={{ color: 'var(--trae-text-brand)' }} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
