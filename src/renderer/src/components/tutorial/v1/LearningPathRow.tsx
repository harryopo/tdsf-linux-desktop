/**
 * LearningPathRow — 推荐学习路径条目（TutorialPage 子组件）
 *
 * 设计稿参考：tutorial.html 推荐学习路径
 * 结构：左侧路径名（120px 固定宽）→ 右侧多个步骤 chip + chevron 分隔
 * 当前激活步骤用品牌色 chip，其它用 overlay 灰色 chip
 */
import { ChevronRight } from 'lucide-react'
import '../../../pages/TutorialPage.css'
import { type LearningPath } from './types'

/** 学习路径条目 */
export function LearningPathRow({ path }: { path: LearningPath }) {
  return (
    <div className="tut-path-row">
      <span className="tut-path-title">{path.title}</span>
      <span className="tut-path-steps tut-no-scrollbar">
        {path.steps.map((step, i) => (
          <span key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`tut-path-step${step.active ? ' tut-path-step--active' : ''}`}>
              {step.label}
            </span>
            {i < path.steps.length - 1 && (
              <ChevronRight size={12} className="tut-path-chevron" />
            )}
          </span>
        ))}
      </span>
    </div>
  )
}
