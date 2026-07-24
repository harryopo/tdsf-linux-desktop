/**
 * LearningPath — 推荐学习路径 section（横向滚动卡片）
 *
 * 1:1 对齐设计稿 tutorial.html §6：每张卡片含
 *   36×36 圆角图标盒 + 标题/课程数 / 难度标签 + 进度百分比 / 3px 进度条。
 * 路径数据由父组件 TutorialPage 通过 props 传入（真实推荐或 fallback）。
 */
import { Sparkles, ChevronRight } from 'lucide-react'
import type { LearningPath as LearningPathItem } from './types'

interface LearningPathProps {
  paths: LearningPathItem[]
}

export function LearningPath({ paths }: LearningPathProps) {
  return (
    <section className="tut-section tut-section--paths" aria-label="推荐学习路径">
      <div className="tut-section-title-row">
        <Sparkles size={18} style={{ color: 'var(--trae-icon-brand)' }} />
        <h2 className="tut-section-title">推荐学习路径</h2>
        <button
          type="button"
          className="tut-paths-viewall tut-btn-press"
          aria-label="查看全部学习路径"
        >
          查看全部
          <ChevronRight size={12} style={{ color: 'var(--trae-text-brand)' }} />
        </button>
      </div>
      <div className="tut-paths-scroller tut-no-scrollbar">
        {paths.map((path) => {
          const PathIcon = path.icon
          return (
            <div key={path.id} className="tut-path-card tut-btn-press">
              {/* 卡片头部：36×36 圆角图标盒 + 标题 + 课程数 */}
              <div className="tut-path-card-head">
                <span className="tut-path-card-iconbox">
                  <PathIcon size={18} style={{ color: 'var(--trae-icon-brand)' }} />
                </span>
                <div className="tut-path-card-meta">
                  <span className="tut-path-card-title">{path.title}</span>
                  <span className="tut-path-card-count">{path.courseCount} 门课程</span>
                </div>
              </div>
              {/* 难度标签 + 进度百分比（mono 字体右对齐） */}
              <div className="tut-path-card-levelrow">
                <span className="tut-path-card-level">{path.level}</span>
                <span className="tut-path-card-percent">{path.percent}%</span>
              </div>
              {/* 3px 进度条 */}
              <div className="tut-path-card-progress">
                <div className="tut-path-card-progress-fill" style={{ width: `${path.percent}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
