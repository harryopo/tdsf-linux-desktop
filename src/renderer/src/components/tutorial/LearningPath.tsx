/**
 * LearningPath — 推荐学习路径 section（横向时间线）
 *
 * 1:1 对齐设计稿 tutorial.html §6：单条横向 5 节点时间线，
 *   含进度头（trending-up 图标 + 路线名 + "2/5 已完成" + 进度条）
 *   与 5 个节点（步骤圆圈 + 名称 + 描述）。
 * 路径数据由父组件 TutorialPage 通过 props 传入（真实推荐或 fallback）。
 * 组件取 paths[0] 渲染单条时间线；空数组时返回 null。
 */
import { Sparkles, ChevronRight, TrendingUp, Check } from 'lucide-react'
import type { LearningPath as LearningPathItem } from './types'

interface LearningPathProps {
  paths: LearningPathItem[]
}

export function LearningPath({ paths }: LearningPathProps) {
  const path = paths[0]
  if (!path) return null

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

      <div className="tut-path-timeline-card">
        {/* Progress header: trending-up icon + title + "2/5 已完成" + progress bar */}
        <div className="tut-path-progress-header">
          <div className="tut-path-progress-title">
            <TrendingUp size={16} style={{ color: 'var(--trae-icon-brand)' }} />
            <span className="tut-path-progress-name">{path.title}</span>
          </div>
          <div className="tut-path-progress-meta">
            <span className="tut-path-progress-count">
              {path.completedCount}/{path.totalCount} 已完成
            </span>
            <div className="tut-path-progress-bar">
              <div
                className="tut-path-progress-fill"
                style={{ width: `${path.percent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Path nodes — horizontal timeline */}
        <div className="tut-path-nodes">
          {path.steps.map((step, index) => {
            const isCompleted = step.status === 'completed'
            const isCurrent = step.status === 'current'
            const isFirst = index === 0
            const isLast = index === path.steps.length - 1
            const prevStep = index > 0 ? path.steps[index - 1] : null

            // Connector line between prev node and this node:
            //   brand when prev is completed, neutral otherwise.
            // First node has an empty (invisible) left connector.
            const leftConnectorClass = isFirst
              ? ''
              : prevStep?.status === 'completed'
                ? 'tut-path-connector--brand'
                : 'tut-path-connector--neutral'

            // Connector line between this node and next node:
            //   brand when this node is completed, neutral otherwise.
            // Last node has an empty (invisible) right connector.
            const rightConnectorClass = isLast
              ? ''
              : isCompleted
                ? 'tut-path-connector--brand'
                : 'tut-path-connector--neutral'

            const circleClass = isCompleted
              ? 'tut-path-node-circle--completed'
              : isCurrent
                ? 'tut-path-node-circle--current'
                : 'tut-path-node-circle--upcoming'

            const labelClass = isCompleted || isCurrent
              ? 'tut-path-node-label--active'
              : ''

            return (
              <div key={index} className="tut-path-node">
                <div className="tut-path-node-row">
                  <div className={`tut-path-connector ${leftConnectorClass}`} />
                  <div className={`tut-path-node-circle ${circleClass}`}>
                    {isCompleted ? (
                      <Check size={14} style={{ color: 'var(--trae-text-onbrand)' }} />
                    ) : (
                      <span className="tut-path-node-number">{index + 1}</span>
                    )}
                  </div>
                  <div className={`tut-path-connector ${rightConnectorClass}`} />
                </div>
                <div className={`tut-path-node-label ${labelClass}`}>
                  {step.label}
                </div>
                {step.description && (
                  <div className="tut-path-node-desc">{step.description}</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
