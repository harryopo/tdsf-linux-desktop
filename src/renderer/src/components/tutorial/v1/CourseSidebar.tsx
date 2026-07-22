/**
 * CourseSidebar — 课程侧边栏（TutorialDetailPage 子组件）
 *
 * 设计稿参考：tutorial-detail.html 右栏 280px aside
 * 结构：3 个独立卡片
 *   1. 课程目录：5 章节列表（已完成 / 进行中 / 待学习 三态）
 *   2. 讲师信息：圆形头像 + 姓名 + 职位 + 简介 + 技能 tag
 *   3. 相关课程：3 个课程跳转入口（含 chevron-right 图标）
 *
 * JS 交互：章节点击 data-dom-id="goto-chapter-N"，相关课程 data-dom-id="goto-related-course-N"
 */
import { List, UserCircle, Star, Check, ChevronRight } from 'lucide-react'
import '../../../pages/TutorialPage.css'
import {
  type Chapter,
  type RelatedCourse,
  INSTRUCTOR
} from './detail-data'

/** 课程侧边栏 */
export function CourseSidebar({
  onGotoChapter,
  onGotoRelated,
  chapters,
  relatedCourses,
  instructor
}: {
  onGotoChapter: (id: number) => void
  onGotoRelated: (id: string) => void
  /** 章节列表（v0.7.0 Sprint 4.4 接入：默认 = mock CHAPTERS） */
  chapters?: Chapter[]
  /** 相关课程（v0.7.0 Sprint 4.4 接入：默认 = mock RELATED_COURSES） */
  relatedCourses?: RelatedCourse[]
  /** 讲师（v0.7.0 Sprint 4.4 接入：默认 = mock INSTRUCTOR） */
  instructor?: typeof INSTRUCTOR
}) {
  return (
    <aside className="tut-detail-right">
      <ChapterCatalogCard chapters={chapters} onGoto={onGotoChapter} />
      <InstructorCard instructor={instructor} />
      <RelatedCoursesCard relatedCourses={relatedCourses} onGoto={onGotoRelated} />
    </aside>
  )
}

/** 1. 章节目录卡 */
function ChapterCatalogCard({
  onGoto,
  chapters
}: {
  onGoto: (id: number) => void
  chapters?: Chapter[]
}) {
  const list = chapters ?? defaultChapters
  return (
    <div className="tut-card">
      <div className="tut-card-title-row" style={{ marginBottom: 10 }}>
        <List size={14} className="tut-card-icon--secondary" />
        <h2 className="tut-card-title">课程目录</h2>
      </div>
      <ul className="tut-catalog-list">
        {list.map((ch) => (
          <ChapterRow key={ch.id} chapter={ch} onGoto={onGoto} />
        ))}
      </ul>
    </div>
  )
}

/** 章节目录条目 */
function ChapterRow({
  chapter,
  onGoto,
}: {
  chapter: Chapter
  onGoto: (id: number) => void
}) {
  const isInProgress = chapter.status === 'in-progress'
  const isCompleted = chapter.status === 'completed'

  return (
    <li
      data-dom-id={`goto-chapter-${chapter.id}`}
      onClick={() => onGoto(chapter.id)}
      className={`tut-catalog-row${isInProgress ? ' tut-catalog-row--current' : ''}`}
      style={isInProgress ? { position: 'relative' } : undefined}
    >
      {isInProgress && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            height: 20,
            width: 3,
            transform: 'translateY(-50%)',
            borderRadius: 'var(--trae-radius-full)',
            background: 'var(--trae-bg-brand)'
          }}
        />
      )}
      <span className={`tut-catalog-index${isInProgress ? ' tut-catalog-index--current' : ''}`}>
        {chapter.index}
      </span>
      {isCompleted ? (
        <Check
          size={13}
          style={{ flexShrink: 0, color: 'var(--trae-status-success-default)' }}
        />
      ) : isInProgress ? (
        <span className="tut-catalog-dot--current" />
      ) : (
        <span className="tut-catalog-circle--pending" />
      )}
      <span
        className={`tut-catalog-title${
          isInProgress
            ? ' tut-catalog-title--current'
            : !isCompleted
              ? ' tut-catalog-title--pending'
              : ''
        }`}
      >
        {chapter.title}
      </span>
      <span className={`tut-catalog-duration${isInProgress ? ' tut-catalog-duration--current' : ''}`}>
        {chapter.duration}
      </span>
    </li>
  )
}

/** 2. 讲师信息卡 */
function InstructorCard({ instructor }: { instructor?: typeof INSTRUCTOR }) {
  const ins = instructor ?? INSTRUCTOR
  return (
    <div className="tut-card">
      <div className="tut-card-title-row" style={{ marginBottom: 12 }}>
        <UserCircle size={14} className="tut-card-icon--secondary" />
        <h2 className="tut-card-title">讲师</h2>
      </div>
      <div className="tut-instructor-info">
        <div className="tut-instructor-avatar">{ins.initial}</div>
        <div className="tut-instructor-meta">
          <span className="tut-instructor-name">{ins.name}</span>
          <span className="tut-instructor-role">{ins.title}</span>
        </div>
      </div>
      <p className="tut-instructor-bio">{ins.bio}</p>
      <div className="tut-instructor-tags">
        {ins.tags.map((tag) => (
          <span key={tag} className="tut-instructor-tag">
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

/** 3. 相关课程卡 */
function RelatedCoursesCard({
  onGoto,
  relatedCourses
}: {
  onGoto: (id: string) => void
  relatedCourses?: RelatedCourse[]
}) {
  const list = relatedCourses ?? defaultRelatedCourses
  return (
    <div className="tut-card">
      <div className="tut-card-title-row" style={{ marginBottom: 10 }}>
        <Star size={14} className="tut-card-icon--secondary" />
        <h2 className="tut-card-title">相关课程</h2>
      </div>
      {list.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--trae-body-xs-font-size)',
            lineHeight: 'var(--trae-body-xs-line-height)',
            color: 'var(--trae-text-tertiary)'
          }}
        >
          暂无相关推荐
        </p>
      ) : (
        <ul className="tut-related-list">
          {list.map((c, i) => (
            <li
              key={c.id}
              data-dom-id={`goto-related-course-${i + 1}`}
              onClick={() => onGoto(c.id)}
              className="tut-related-item"
            >
              <div className="tut-related-title-row">
                <span className="tut-related-title">{c.title}</span>
                <ChevronRight
                  size={13}
                  style={{ flexShrink: 0, color: 'var(--trae-text-tertiary)' }}
                />
              </div>
              <div className="tut-related-meta">
                <span
                  className={`tut-related-level-badge${
                    c.level === '进阶'
                      ? ' tut-related-level-badge--brand'
                      : ' tut-related-level-badge--neutral'
                  }`}
                >
                  {c.level}
                </span>
                <span className="tut-related-duration">{c.duration}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 默认章节（fallback，无真实数据时使用） */
const defaultChapters: Chapter[] = [
  { id: 1, index: '①', title: 'Nginx 基础架构', duration: '25min', status: 'completed' },
  { id: 2, index: '②', title: 'worker_connections 调优', duration: '35min', status: 'completed' },
  { id: 3, index: '③', title: '内核参数优化', duration: '40min', status: 'in-progress' },
  { id: 4, index: '④', title: 'keepalive 配置', duration: '30min', status: 'pending' },
  { id: 5, index: '⑤', title: '综合实战', duration: '20min', status: 'pending' }
]

/** 默认相关课程（fallback） */
const defaultRelatedCourses: RelatedCourse[] = [
  { id: 'mysql-tuning', title: 'MySQL 性能优化', level: '进阶', duration: '3h' },
  { id: 'linux-troubleshoot', title: 'Linux 故障排查', level: '中级', duration: '1h45min' },
  { id: 'docker-ops', title: 'Docker 容器运维', level: '中级', duration: '2h' }
]
