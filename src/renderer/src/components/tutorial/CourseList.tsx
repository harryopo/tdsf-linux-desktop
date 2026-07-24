/**
 * CourseList — 课程列表 / 搜索结果列表
 *
 * 三态渲染（由父组件传入 searchResults 控制）：
 *   - searchResults !== null：搜索结果模式（M4 Task 5），渲染匹配卡片网格
 *   - loading：加载中 Spin
 *   - 其他：按分类过滤后的课程卡片网格（1:1 设计稿课程卡）
 *
 * 课程卡片含：图标 / 难度+完成度徽章 / 标题 / 描述 / 时长+人次 / 进度条。
 */
import { Clock, UserCircle } from 'lucide-react'
import { SearchOutlined } from '@ant-design/icons'
import { Spin, Empty } from 'antd'
import type { Course, SearchResultItem } from './types'
import { levelBadgeClassName, UI_CATEGORIES, TUTORIAL_TO_UI_CATEGORY } from './types'

interface CourseListProps {
  loading: boolean
  filteredCourses: Course[]
  searchResults: SearchResultItem[] | null
  searching: boolean
  onOpenCourse: (id: string) => void
}

export function CourseList({
  loading,
  filteredCourses,
  searchResults,
  searching,
  onOpenCourse,
}: CourseListProps) {
  return (
    <section
      className="tut-section tut-section--courses"
      aria-label={searchResults !== null ? '搜索结果' : '课程列表'}
    >
      {searchResults !== null ? (
        // ====== 搜索结果模式（M4 Task 5）======
        // searchResults !== null 表示用户已发起搜索（含空结果），渲染替代原课程列表
        <div className="tut-search-results">
          <div className="tut-section-title-row" style={{ marginBottom: 12 }}>
            <SearchOutlined size={18} style={{ color: 'var(--trae-icon-brand)' }} />
            <h3
              className="tut-section-title"
              style={{ fontSize: 'var(--trae-body-md-font-size)' }}
            >
              搜索结果（{searchResults.length}）
            </h3>
            {searching && <Spin size="small" />}
          </div>
          {searchResults.length === 0 ? (
            <Empty
              description="未找到相关教程"
              style={{ padding: '40px 0', color: 'var(--trae-text-tertiary)' }}
            />
          ) : (
            <div className="tut-courses-grid">
              {searchResults.map((item) => (
                <div
                  key={item.id}
                  className="tut-result-card"
                  onClick={() => onOpenCourse(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenCourse(item.id)
                    }
                  }}
                >
                  <div className="tut-result-head">
                    <h4 className="tut-result-title">{item.title}</h4>
                    {typeof item.rrfScore === 'number' && (
                      <span
                        className="tut-result-score"
                        style={{ color: 'var(--trae-text-brand)' }}
                        title={`RRF 融合分：${item.rrfScore.toFixed(4)}`}
                      >
                        {item.rrfScore.toFixed(3)}
                      </span>
                    )}
                  </div>
                  <p className="tut-result-snippet">{item.summary}</p>
                  <div className="tut-result-meta">
                    {item.matchSource && (
                      <span
                        className="tut-result-source"
                        style={{
                          background:
                            item.matchSource === 'both'
                              ? 'var(--trae-bg-brand-popup)'
                              : 'var(--trae-bg-overlay-l2)',
                          color:
                            item.matchSource === 'both'
                              ? 'var(--trae-text-brand)'
                              : 'var(--trae-text-secondary)',
                        }}
                      >
                        {item.matchSource === 'both' ? '语义+关键词' : item.matchSource === 'vec' ? '语义' : '关键词'}
                      </span>
                    )}
                    {(() => {
                      // 提取到 IIFE 内，避免 TS 在嵌套 && 中无法收窄 item.category 类型
                      const cat = item.category
                      if (!cat) return null
                      const uiCatId = TUTORIAL_TO_UI_CATEGORY[cat]
                      const uiCatLabel = UI_CATEGORIES.find((c) => c.id === uiCatId)?.label
                      return uiCatLabel ? <span>{uiCatLabel}</span> : null
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="tut-empty" style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin size="small" tip="加载教程中…" />
        </div>
      ) : (
        // ====== 正常课程列表 ======
        <div className="tut-courses-grid">
          {filteredCourses.map((c) => {
            const Icon = c.icon
            return (
              <div key={c.id} className="tut-course-card">
                <div className="tut-course-head">
                  <Icon size={20} className="tut-course-icon" />
                  <span className="tut-course-badges">
                    <span className={levelBadgeClassName(c.level)}>{c.level}</span>
                    {c.completed && <span className="tut-completed-badge">已完成</span>}
                  </span>
                </div>
                <h4 className="tut-course-title">{c.title}</h4>
                <p className="tut-course-desc">{c.description}</p>
                <div className="tut-course-meta">
                  <span className="tut-course-meta-item">
                    <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                    {c.duration}
                  </span>
                  <span className="tut-course-meta-item">
                    <UserCircle size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                    {c.learnerCount}
                  </span>
                </div>
                <div className="tut-progress-block">
                  <div className="tut-progress-row tut-progress-row--tight">
                    <span className="tut-progress-label">进度</span>
                    <span className={c.progress > 0 ? 'tut-progress-value' : 'tut-progress-value tut-progress-value--zero'}>{c.progress}%</span>
                  </div>
                  <div className="tut-progress-bar tut-progress-bar--thin">
                    <div className="tut-progress-bar-fill" style={{ width: `${c.progress}%` }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
