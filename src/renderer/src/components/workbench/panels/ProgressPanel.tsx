import type { FC } from 'react'
import {
  CheckCircle2, RotateCcw, Square, Zap,
} from 'lucide-react'
import type { AIToolPanel } from '../mock-data'

/** 执行进度面板（非折叠） */
const ProgressPanel: FC<{ panel: AIToolPanel; onAction?: (action: string, payload?: string) => void }> = ({ panel, onAction }) => {
  return (
    <div className="ai-progress-panel my-4">
      <div className="ai-progress-header">
        <Zap className="size-3.5 text-[var(--trae-bg-brand)]" />
        <span className="ai-progress-title">{panel.title}</span>
        {panel.badge && (
          <span className="ai-progress-badge">
            <span className="ai-progress-pulse" />
            {panel.badge}
          </span>
        )}
        <div className="flex-1" />
        {/* P1 修复：后端无暂停/恢复能力，pauseExec 实为终止流 —— 文案诚实化为"停止" */}
        <button
          type="button"
          onClick={() => onAction?.('pauseExec')}
          className="btn-press inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-2.5 text-[12px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)]"
        >
          <Square className="size-3" />
          停止
        </button>
        <button
          type="button"
          onClick={() => onAction?.('rollbackExec')}
          className="btn-press inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-status-error-default)] px-2.5 text-[12px] text-[var(--trae-status-error-default)] transition-colors hover:bg-[var(--trae-status-error-surface-l1)]"
        >
          <RotateCcw className="size-3" />
          回滚
        </button>
      </div>
      <div className="ai-progress-steps">
        {panel.steps?.map((step, i) => (
          <div key={i} className="ai-progress-step">
            {step.status === 'success' ? (
              <>
                <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
                <span className="flex-1 text-[var(--trae-text-secondary)]">{step.label}</span>
                {typeof step.duration === 'number' && (
                  <span className="ai-step-duration">{step.duration.toFixed(1)}s</span>
                )}
              </>
            ) : step.status === 'active' ? (
              <>
                <span className="ai-progress-pulse-step" />
                <span className="flex-1 text-[var(--trae-text-brand)]">{step.label}</span>
                {step.hint && <span className="text-[12px] text-[var(--trae-text-brand)]">{step.hint}</span>}
              </>
            ) : (
              <>
                <span className="ai-progress-pending" />
                <span className="flex-1 text-[var(--trae-text-tertiary)]">{step.label}</span>
                {step.hint && <span className="text-[12px] text-[var(--trae-text-tertiary)]">{step.hint}</span>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default ProgressPanel
