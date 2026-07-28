import type { FC } from 'react'
import { Pause, X } from 'lucide-react'
import type { AIToolPanel } from '../mock-data'

/** 暂停面板
 *
 * P1 修复：移除假"继续执行"按钮 —— 后端没有恢复能力（resumeExec 只弹 toast），
 * 诚实告知用户重新发送消息继续，仅保留真实可用的"终止任务"。
 */
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
      <div className="mb-2 text-[12px] leading-[1.5] text-[var(--trae-text-tertiary)]">
        如需继续，请在输入框重新发送消息（当前不支持原地恢复）。
      </div>
      <div className="ai-action-group">
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
