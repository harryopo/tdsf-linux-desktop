/**
 * TokenStatsSection — Token 使用统计 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，仅作为 TokenUsageChart 的 SettingsCard 外壳。
 * 原 Section 4：标题 + TokenUsageChart 组件。
 *
 * 以前这里挂着 `TokenStatsSectionProps` 空接口与 `_props` 形参，注释写"保留接口便于未来扩展"——
 * 空的对外接口只会让人以为这个 Section 有可配置项，真要用时才发现什么都传不进去。
 */
import { BarChart3 } from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { TokenUsageChart } from '@/components/settings/TokenUsageChart'

export function TokenStatsSection() {
  return (
    <SettingsCard
      icon={BarChart3}
      title="Token使用统计"
      tag="usage.tokens"
      className="p-5"
      hideTag
      noHeadBorder
      headMb="lg"
    >
      <TokenUsageChart />
    </SettingsCard>
  )
}
