import { useState, type FC } from 'react'
import { message } from 'antd'

/** ContextBadge props */
export interface ContextBadgeProps {
  /** 上下文使用率（0-100） */
  ctxUsedPct: number
  /** 已用 tokens 文本（如 "12.3K"） */
  ctxUsedTokens: string
  /** 总 tokens 文本（如 "200K"） */
  ctxTotalTokens: string
  /** 压缩上下文回调（T.7） */
  onCompress?: () => void
}

/**
 * Composer 工具栏上下文使用率徽章 + Hover tooltip
 *
 * - 圆环 SVG 显示使用率百分比
 * - Hover 弹出 tooltip 展示详细 token 数 + "压缩上下文"按钮（WIP 暂未上线）
 */
const ContextBadge: FC<ContextBadgeProps> = ({ ctxUsedPct, ctxUsedTokens, ctxTotalTokens, onCompress }) => {
  const [ctxTooltipVisible, setCtxTooltipVisible] = useState(false)

  return (
    <span
      className="relative inline-flex h-5 cursor-pointer items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-1.5"
      onMouseEnter={() => setCtxTooltipVisible(true)}
      onMouseLeave={() => setCtxTooltipVisible(false)}
    >
      <svg width="10" height="10" viewBox="0 0 36 36" className="shrink-0">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--trae-bg-overlay-l3)" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="15" fill="none"
          stroke="var(--trae-bg-brand)" strokeWidth="3"
          strokeDasharray="94.2"
          strokeDashoffset={94.2 * (1 - ctxUsedPct / 100)}
          transform="rotate(-90 18 18)" strokeLinecap="round"
        />
      </svg>
      <span className="text-[11px] font-medium tabular-nums text-[var(--trae-text-secondary)]">
        {ctxUsedPct}%
      </span>

      {/* Hover tooltip */}
      {ctxTooltipVisible && (
        <div className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 min-w-[180px] -translate-x-1/2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] p-2.5 shadow-xl">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--trae-text-tertiary)]">
            上下文使用率
          </div>
          <div className="flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 36 36" className="shrink-0">
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--trae-bg-overlay-l3)" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15" fill="none"
                stroke="var(--trae-bg-brand)" strokeWidth="3"
                strokeDasharray="94.2"
                strokeDashoffset={94.2 * (1 - ctxUsedPct / 100)}
                transform="rotate(-90 18 18)" strokeLinecap="round"
              />
              <text x="18" y="22" textAnchor="middle" fontSize="9" fill="var(--trae-text-default)" fontWeight="600">
                {ctxUsedPct}%
              </text>
            </svg>
            <div>
              <div className="text-[11px] font-semibold text-[var(--trae-text-default)]">
                {ctxUsedTokens} / {ctxTotalTokens}
              </div>
              <div className="text-[11px] text-[var(--trae-text-tertiary)]">tokens used</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (onCompress) {
                onCompress()
                void message.success('上下文已压缩')
              } else {
                // WIP: 父组件未传入压缩回调时的降级提示
                void message.warning('上下文压缩回调未绑定（WIP）')
              }
            }}
            className="btn-press mt-2 h-6 w-full rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] text-[11px] font-medium text-[var(--trae-text-brand)] transition-colors hover:brightness-110"
          >
            压缩上下文
          </button>
        </div>
      )}
    </span>
  )
}

export default ContextBadge
