/**
 * ContributionSection — AI 知识沉淀统计区
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge.html 底部 section
 *
 * 结构：
 * - 左：标题"AI 知识沉淀" + 副标题
 * - 中：3 个统计指标（已收录 1,247 条 / 本周新增 23 条 / AI 贡献率 68%）
 * - 右：贡献知识按钮
 *
 * 交互：
 * - 贡献知识按钮 onClick（目前为占位，可后续接入新增知识弹窗）
 */
import { Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/trae/Button'
import { cn } from '@/components/trae/utils'

interface ContributionSectionProps {
  /** 贡献知识按钮回调 */
  onContribute?: () => void
}

/** AI 知识沉淀统计区组件 */
export function ContributionSection({ onContribute }: ContributionSectionProps) {
  return (
    <section className="kb-contribution">
      <div className="kb-contribution__main">
        <div className="kb-contribution__title-row">
          <Sparkles
            className="h-4 w-4"
            style={{ color: 'var(--trae-icon-brand)' }}
          />
          <h2 className="kb-contribution__title">
            AI 知识沉淀
          </h2>
        </div>
        <p className="kb-contribution__desc">
          AI Agent 在运维过程中自动沉淀知识,持续丰富知识库
        </p>
      </div>
      <div className="kb-stats">
        <StatBlock label="已收录" value="1,247 条" />
        <StatBlock label="本周新增" value="23 条" />
        <StatBlock label="AI 贡献率" value="68%" brand />
      </div>
      <Button variant="outline" size="default" onClick={onContribute} className="kb-contribute-btn">
        <Plus className="h-3.5 w-3.5" />
        贡献知识
      </Button>
    </section>
  )
}

/** 统计指标块 */
function StatBlock({
  label,
  value,
  brand = false,
}: {
  label: string
  value: string
  brand?: boolean
}) {
  return (
    <div className="kb-stat">
      <span className="kb-stat__label">
        {label}
      </span>
      <span className={cn('kb-stat__value', brand && 'kb-stat__value--brand')}>
        {value}
      </span>
    </div>
  )
}
