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
import { Badge } from '@/components/trae/Badge'
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
    <aside
      className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[280px]"
    >
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
    <div
      className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
      style={{ padding: 14 }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <List size={14} style={{ color: 'var(--trae-text-secondary)' }} />
        <h2
          className="m-0 font-semibold"
          style={{
            fontSize: 'var(--trae-heading-xs-font-size)',
            lineHeight: 'var(--trae-heading-xs-line-height)',
            color: 'var(--trae-text-default)',
          }}
        >
          课程目录
        </h2>
      </div>
      <ul className="m-0 flex flex-col gap-0.5 p-0" style={{ listStyle: 'none' }}>
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
      className="relative flex cursor-pointer items-center gap-2 rounded-[var(--trae-radius-4)]"
      style={{
        padding: '7px 8px',
        background: isInProgress ? 'var(--trae-bg-brand-popup)' : 'transparent',
      }}
    >
      {isInProgress && (
        <span
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
          style={{ background: 'var(--trae-bg-brand)' }}
        />
      )}
      <span
        className="shrink-0"
        style={{
          width: 14,
          fontSize: 'var(--trae-body-xs-font-size)',
          color: isInProgress ? 'var(--trae-text-brand)' : 'var(--trae-text-tertiary)',
          fontWeight: isInProgress ? 'var(--trae-font-weight-medium)' : 'var(--trae-font-weight-default)',
        }}
      >
        {chapter.index}
      </span>
      {isCompleted ? (
        <Check
          size={13}
          className="shrink-0"
          style={{ color: 'var(--trae-status-success-default)' }}
        />
      ) : isInProgress ? (
        <span
          className="inline-block shrink-0"
          style={{
            width: 8,
            height: 8,
            borderRadius: 'var(--trae-radius-full)',
            background: 'var(--trae-bg-brand)',
          }}
        />
      ) : (
        <span
          className="inline-block shrink-0"
          style={{
            width: 13,
            height: 13,
            borderRadius: 'var(--trae-radius-full)',
            border: '1.5px solid var(--trae-border-neutral-l3)',
          }}
        />
      )}
      <span
        className="flex-1 truncate"
        style={{
          fontSize: 'var(--trae-body-sm-font-size)',
          color: isInProgress
            ? 'var(--trae-text-brand)'
            : isCompleted
              ? 'var(--trae-text-secondary)'
              : 'var(--trae-text-tertiary)',
          fontWeight: isInProgress ? 'var(--trae-font-weight-medium)' : 'var(--trae-font-weight-default)',
        }}
      >
        {chapter.title}
      </span>
      <span
        className="shrink-0"
        style={{
          fontSize: 'var(--trae-body-xs-font-size)',
          color: isInProgress ? 'var(--trae-text-brand)' : 'var(--trae-text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {chapter.duration}
      </span>
    </li>
  )
}

/** 2. 讲师信息卡 */
function InstructorCard({ instructor }: { instructor?: typeof INSTRUCTOR }) {
  const ins = instructor ?? INSTRUCTOR
  return (
    <div
      className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
      style={{ padding: 14 }}
    >
      <div className="mb-3 flex items-center gap-2">
        <UserCircle size={14} style={{ color: 'var(--trae-text-secondary)' }} />
        <h2
          className="m-0 font-semibold"
          style={{
            fontSize: 'var(--trae-heading-xs-font-size)',
            lineHeight: 'var(--trae-heading-xs-line-height)',
            color: 'var(--trae-text-default)',
          }}
        >
          讲师
        </h2>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="flex shrink-0 items-center justify-center"
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--trae-radius-full)',
            background: 'var(--trae-bg-brand)',
            color: '#ffffff',
            fontSize: 'var(--trae-body-md-font-size)',
            fontWeight: 'var(--trae-font-weight-strong)',
          }}
        >
          {ins.initial}
        </div>
        <div className="flex min-w-0 flex-col">
          <span
            className="truncate font-medium text-[var(--trae-text-default)]"
            style={{ fontSize: 'var(--trae-body-sm-font-size)' }}
          >
            {ins.name}
          </span>
          <span
            className="truncate text-[var(--trae-text-tertiary)]"
            style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
          >
            {ins.title}
          </span>
        </div>
      </div>
      <p
        className="mt-2.5 m-0 text-[var(--trae-text-secondary)]"
        style={{
          fontSize: 'var(--trae-body-xs-font-size)',
          lineHeight: 'var(--trae-body-xs-line-height)',
        }}
      >
        {ins.bio}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {ins.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
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
    <div
      className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
      style={{ padding: 14 }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <Star
          size={14}
          style={{ color: 'var(--trae-text-secondary)' }}
        />
        <h2
          className="m-0 font-semibold"
          style={{
            fontSize: 'var(--trae-heading-xs-font-size)',
            lineHeight: 'var(--trae-heading-xs-line-height)',
            color: 'var(--trae-text-default)',
          }}
        >
          相关课程
        </h2>
      </div>
      {list.length === 0 ? (
        <p
          className="m-0 text-[var(--trae-text-tertiary)]"
          style={{
            fontSize: 'var(--trae-body-xs-font-size)',
            lineHeight: 'var(--trae-body-xs-line-height)'
          }}
        >
          暂无相关推荐
        </p>
      ) : (
        <ul className="m-0 flex flex-col gap-2 p-0" style={{ listStyle: 'none' }}>
          {list.map((c, i) => (
            <li
              key={c.id}
              data-dom-id={`goto-related-course-${i + 1}`}
              onClick={() => onGoto(c.id)}
              className="cursor-pointer rounded-[var(--trae-radius-4)]"
              style={{ padding: '7px 8px' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate text-[var(--trae-text-default)]"
                  style={{ fontSize: 'var(--trae-body-sm-font-size)' }}
                >
                  {c.title}
                </span>
                <ChevronRight
                  size={13}
                  className="shrink-0"
                  style={{ color: 'var(--trae-text-tertiary)' }}
                />
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant={c.level === '进阶' ? 'primary' : 'secondary'}>
                  {c.level}
                </Badge>
                <span
                  className="text-[var(--trae-text-tertiary)]"
                  style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
                >
                  {c.duration}
                </span>
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
