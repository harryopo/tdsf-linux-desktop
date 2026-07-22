/**
 * CorrelationCard — 关联分析卡片
 *
 * 设计稿：spec §B SubTask 2.4.5
 *
 * 内容：
 * - 影响评估：一段文字描述 critical 告警的潜在影响范围
 * - 处置建议：3 步编号列表（清理 / 归档 / 配置）
 *
 * 数据来源：
 * - 默认展示 sampleAlerts[0]（critical 磁盘告警）的 impact + suggestions
 * - 父组件可通过 props 传入指定告警覆盖默认值
 *
 * 视觉规范（spec §B）：
 * - 边框用 solid hex（var(--trae-border-neutral-l1)）
 * - 卡片标题用 heading-xs 字号
 * - 处置建议步骤数字徽章用 var(--trae-bg-brand) 主色
 *
 * Spec: build-runnable-tdsf-from-design · Task 2.4 · SubTask 2.4.5
 */
import type { AlertRecord } from './mock-data'
import { sampleAlerts } from './mock-data'

export interface CorrelationCardProps {
  /** 告警记录（默认使用 sampleAlerts[0]） */
  alert?: AlertRecord
}

/** 关联分析卡片组件 */
export function CorrelationCard({ alert }: CorrelationCardProps) {
  const current = alert ?? sampleAlerts[0]
  const impact = current.impact ?? '该告警可能影响系统稳定性，建议立即处理。'
  const suggestions = current.suggestions ?? [
    '识别问题根因',
    '执行修复操作',
    '验证修复结果',
  ]

  return (
    <div className="mon-corr-panel">
      {/* 标题栏 */}
      <div className="mon-corr-header flex items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-2 min-w-0">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M7 1L13 7L7 13L1 7L7 1Z"
              stroke="var(--trae-text-brand)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle cx="7" cy="7" r="1.5" fill="var(--trae-text-brand)" />
          </svg>
          <span className="mon-corr-title">
            关联分析
          </span>
          <span className="mon-corr-ai-tag">
            AI
          </span>
        </div>
        <span className="mon-corr-based whitespace-nowrap">
          基于 {current.server}
        </span>
      </div>

      {/* 影响评估 */}
      <div className="mon-corr-section px-3 py-3">
        <h3 className="mon-corr-section-title mb-1.5">
          影响评估
        </h3>
        <p className="mon-corr-section-text">
          {impact}
        </p>
      </div>

      {/* 处置建议 3 步 */}
      <div className="mon-corr-section px-3 py-3">
        <h3 className="mon-corr-section-title mb-2">
          处置建议
        </h3>
        <ol className="flex flex-col gap-2">
          {suggestions.slice(0, 3).map((suggestion, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="mon-corr-step-num">
                {idx + 1}
              </span>
              <p className="mon-corr-step-text">
                {suggestion}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
