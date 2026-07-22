import type { FC } from 'react'
import { Pause, Play, X } from 'lucide-react'
import type { AIToolPanel } from '../mock-data'

/** 暂停面板 */
const PausePanel: FC<{ panel: AIToolPanel; onAction?: (action: string, payload?: string) => void }> = ({ panel, onAction }) => {
  const pause = panel.pause
  if (!pause) return null
  return (
    <div className="ai-pause-panel my-4">
      <div className="ai-progress-header">
        <Pause className="size-3.5 text-[var(--trae-status-alert-default)]" />
        <span className="ai-progress-title">{panel.title}</span>
        {panel.badge && (
          <span className="ai-badge ai-badge-alert">
            {panel.badge}
          </span>
        )}
        <span className="ml-auto ai-step-duration">{pause.pausedFor}</span>
      </div>
      <div className="mb-2 text-[12px] leading-[1.5] text-[var(--trae-text-tertiary)]">{pause.description}</div>
      <div className="ai-action-group">
        <button
          type="button"
          onClick={() => onAction?.('resumeExec')}
          className="ai-action-btn ai-action-btn-primary btn-press"
        >
          <Play />
          继续执行
        </button>
        <button
          type="button"
          onClick={() => onAction?.('terminateTask')}
          className="ai-action-btn ai-action-btn-ghost btn-press"
          style={{ borderColor: 'var(--trae-status-error-default)', color: 'var(--trae-status-error-default)' }}
        >
          <X />
          终止任务
        </button>
      </div>
    </div>
  )
}

export default PausePanel
