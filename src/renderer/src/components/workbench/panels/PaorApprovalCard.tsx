import { useState, type FC } from 'react'
import { CheckCircle2, Shield, X } from 'lucide-react'
import type { PaorApprovalRequest } from '@/types/electron'

/**
 * PAOR 审批卡片（v0.9.5）
 *
 * PAOR 循环遇到 HIGH/CRITICAL 风险命令时渲染，
 * 展示命令内容 + 风险等级，用户点击"批准/拒绝"后回调。
 */
const PaorApprovalCard: FC<{
  request: PaorApprovalRequest
  onApprove: (callId: string, approved: boolean) => void
}> = ({ request, onApprove }) => {
  const [responded, setResponded] = useState(false)
  const riskColor =
    request.riskLevel === 'CRITICAL'
      ? 'var(--trae-status-error-default)'
      : 'var(--trae-status-alert-default)'
  const riskBg =
    request.riskLevel === 'CRITICAL'
      ? 'var(--trae-status-error-surface-l1)'
      : 'var(--trae-bg-overlay-l1)'

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--trae-radius-6)] border px-3 py-2.5"
      style={{
        borderColor: riskColor,
        background: riskBg,
      }}
    >
      {/* 标题行 */}
      <div className="flex items-center gap-1.5">
        <Shield className="size-3.5 shrink-0" style={{ color: riskColor }} />
        <span className="text-[11px] font-semibold" style={{ color: riskColor }}>
          PAOR 审批 — {request.riskLevel} 风险
        </span>
      </div>
      {/* 命令 */}
      <div className="rounded-[var(--trae-radius-4)] bg-[var(--trae-terminal-block-bg)] px-2 py-1.5 font-mono text-[11px] leading-[1.5] text-[var(--trae-text-default)]">
        {request.command}
      </div>
      {/* 风险描述 */}
      {request.riskDescription && (
        <div className="text-[11px] leading-[1.4] text-[var(--trae-text-tertiary)]">
          {request.riskDescription}
        </div>
      )}
      {/* 操作按钮 */}
      {!responded ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)] px-3 text-[11px] font-medium text-[var(--trae-text-onbrand)] hover:bg-[var(--trae-bg-brand-hover)]"
            onClick={() => {
              setResponded(true)
              void onApprove(request.callId, true)
            }}
          >
            <CheckCircle2 className="mr-1 size-3" />
            批准执行
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[11px] font-medium text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)]"
            onClick={() => {
              setResponded(true)
              void onApprove(request.callId, false)
            }}
          >
            <X className="mr-1 size-3" />
            拒绝
          </button>
          <span className="text-[11px] text-[var(--trae-text-tertiary)]">60 秒未响应自动拒绝</span>
        </div>
      ) : (
        <div className="text-[11px] text-[var(--trae-text-tertiary)]">已响应，等待 PAOR 循环继续…</div>
      )}
    </div>
  )
}

export default PaorApprovalCard
