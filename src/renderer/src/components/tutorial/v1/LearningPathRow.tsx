/**
 * LearningPathRow — 推荐学习路径条目（TutorialPage 子组件）
 *
 * 设计稿参考：tutorial.html 推荐学习路径
 * 结构：左侧路径名（120px 固定宽）→ 右侧多个步骤 chip + chevron 分隔
 * 当前激活步骤用品牌色 chip，其它用 overlay 灰色 chip
 */
import { ChevronRight } from 'lucide-react'
import { type LearningPath } from './types'

/** 学习路径条目 */
export function LearningPathRow({ path }: { path: LearningPath }) {
  return (
    <div
      className="flex items-center gap-4 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
      style={{ padding: '14px 18px' }}
    >
      <span
        className="shrink-0 font-medium text-[var(--trae-text-default)]"
        style={{
          fontSize: 'var(--trae-body-sm-font-size)',
          minWidth: 120,
        }}
      >
        {path.title}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto no-scrollbar">
        {path.steps.map((step, i) => (
          <span key={step.label} className="flex items-center gap-2">
            <span
              className="shrink-0 whitespace-nowrap rounded-[var(--trae-radius-4)]"
              style={{
                padding: '4px 12px',
                fontSize: 'var(--trae-body-xs-font-size)',
                background: step.active
                  ? 'var(--trae-bg-brand-popup)'
                  : 'var(--trae-bg-overlay-l3)',
                color: step.active
                  ? 'var(--trae-text-brand)'
                  : 'var(--trae-text-default)',
                fontWeight: step.active
                  ? 'var(--trae-font-weight-medium)'
                  : 'var(--trae-font-weight-default)',
              }}
            >
              {step.label}
            </span>
            {i < path.steps.length - 1 && (
              <ChevronRight
                size={12}
                className="shrink-0 text-[var(--trae-text-tertiary)]"
              />
            )}
          </span>
        ))}
      </span>
    </div>
  )
}
