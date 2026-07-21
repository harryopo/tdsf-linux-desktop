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
    <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-2 p-3 border-b border-[var(--trae-border-neutral-l1)]">
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
          <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">
            关联分析
          </span>
          <span className="inline-flex items-center px-1.5 h-[18px] whitespace-nowrap text-[10px] bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)] rounded-[var(--trae-radius-2)] uppercase tracking-[0.04em]">
            AI
          </span>
        </div>
        <span className="text-[10px] text-[var(--trae-text-tertiary)] whitespace-nowrap">
          基于 {current.server}
        </span>
      </div>

      {/* 影响评估 */}
      <div className="px-3 py-3 border-b border-[var(--trae-border-neutral-l1)]">
        <h3 className="text-[10px] font-semibold text-[var(--trae-text-secondary)] tracking-[0.04em] uppercase mb-1.5">
          影响评估
        </h3>
        <p className="text-[12px] leading-[18px] text-[var(--trae-text-default)]">
          {impact}
        </p>
      </div>

      {/* 处置建议 3 步 */}
      <div className="px-3 py-3">
        <h3 className="text-[10px] font-semibold text-[var(--trae-text-secondary)] tracking-[0.04em] uppercase mb-2">
          处置建议
        </h3>
        <ol className="flex flex-col gap-2">
          {suggestions.slice(0, 3).map((suggestion, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span
                className="shrink-0 w-[18px] h-[18px] inline-flex items-center justify-center rounded-full text-[10px] font-semibold tabular-nums"
                style={{
                  background: 'var(--trae-bg-brand)',
                  color: 'var(--trae-text-onbrand)',
                  fontFamily: 'var(--trae-font-family-mono)',
                }}
              >
                {idx + 1}
              </span>
              <p className="flex-1 min-w-0 text-[11px] leading-[16px] text-[var(--trae-text-default)] break-words">
                {suggestion}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
