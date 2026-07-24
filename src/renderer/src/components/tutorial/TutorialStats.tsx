/**
 * TutorialStats — 顶部统计行（grid-cols-3）
 *
 * 1:1 对齐设计稿：课程数 / 课时 / 学习人次。
 * 数据由父组件 TutorialPage 通过 props 传入（真实库计算或 fallback）。
 */
import type { StatItem } from './types'

interface TutorialStatsProps {
  stats: StatItem[]
}

export function TutorialStats({ stats }: TutorialStatsProps) {
  return (
    <div className="tut-stats-grid">
      {stats.map((s) => (
        <div key={s.unit} className="tut-stat-card">
          <div className="tut-stat-value-row">
            <span className="tut-stat-value">{s.value}</span>
            <span className="tut-stat-unit">{s.unit}</span>
          </div>
          <div className="tut-stat-desc">{s.hint}</div>
        </div>
      ))}
    </div>
  )
}
