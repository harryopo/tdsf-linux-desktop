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

interface ContributionSectionProps {
  /** 贡献知识按钮回调 */
  onContribute?: () => void
}

/** AI 知识沉淀统计区组件 */
export function ContributionSection({ onContribute }: ContributionSectionProps) {
  return (
    <section
      className="flex items-center justify-between border p-4"
      style={{
        background: 'var(--trae-bg-base-secondary)',
        borderColor: 'var(--trae-border-neutral-l1)',
        borderRadius: 'var(--trae-radius-8)',
      }}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Sparkles
            className="h-4 w-4"
            style={{ color: 'var(--trae-icon-brand)' }}
          />
          <h2
            className="font-semibold"
            style={{
              fontSize: 'var(--trae-heading-sm-font-size)',
              lineHeight: 'var(--trae-heading-sm-line-height)',
              color: 'var(--trae-text-default)',
            }}
          >
            AI 知识沉淀
          </h2>
        </div>
        <p
          style={{
            fontSize: 'var(--trae-body-xs-font-size)',
            lineHeight: 'var(--trae-body-xs-line-height)',
            color: 'var(--trae-text-secondary)',
          }}
        >
          AI Agent 在运维过程中自动沉淀知识,持续丰富知识库
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-6" style={{ marginLeft: 16 }}>
        <StatBlock label="已收录" value="1,247 条" />
        <StatBlock label="本周新增" value="23 条" />
        <StatBlock label="AI 贡献率" value="68%" brand />
      </div>
      <Button variant="outline" size="default" onClick={onContribute} style={{ marginLeft: 16 }}>
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
    <div className="flex flex-col gap-0.5">
      <span
        style={{
          fontSize: 'var(--trae-body-xs-font-size)',
          lineHeight: 'var(--trae-body-xs-line-height)',
          color: 'var(--trae-text-tertiary)',
        }}
      >
        {label}
      </span>
      <span
        className="font-semibold"
        style={{
          fontSize: 'var(--trae-heading-md-font-size)',
          lineHeight: 'var(--trae-heading-md-line-height)',
          color: brand ? 'var(--trae-text-brand)' : 'var(--trae-text-default)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}
