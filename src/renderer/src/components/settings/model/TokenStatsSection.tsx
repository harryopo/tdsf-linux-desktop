/**
 * TokenStatsSection — Token 使用统计 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，仅作为 TokenUsageChart 的 SettingsCard 外壳。
 *
 * 原 Section 4：标题 + TokenUsageChart 组件。
 */
import { BarChart3 } from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { TokenUsageChart } from '@/components/settings/TokenUsageChart'

export interface TokenStatsSectionProps {
  // 当前无外部依赖；TokenUsageChart 内部自管数据。
  // 保留接口便于未来扩展（例如传入时间范围）。
}

export function TokenStatsSection(_props: TokenStatsSectionProps) {
  return (
    <SettingsCard icon={BarChart3} title="Token使用统计" tag="usage.tokens" className="p-5">
      <TokenUsageChart />
    </SettingsCard>
  )
}
