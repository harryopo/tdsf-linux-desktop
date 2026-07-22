import type { FC } from 'react'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import type { AIToolPanel } from '../mock-data'

/** 回滚面板 */
const RollbackPanel: FC<{ panel: AIToolPanel }> = ({ panel }) => {
  const rb = panel.rollback
  if (!rb) return null
  return (
    <div className="ai-rollback-panel my-4">
      <div className="ai-progress-header">
        <RotateCcw className="size-3.5 text-[var(--trae-status-error-default)]" />
        <span className="ai-progress-title">{panel.title}</span>
        {panel.badge && (
          <span className="ai-badge ai-badge-error">
            {panel.badge}
          </span>
        )}
        {rb.time && <span className="ml-auto ai-step-duration">{rb.time}</span>}
      </div>
      <div className="ai-cmd-block mb-2">
        <span className="text-[var(--trae-brand-3)]">root@prod-web-01:~#</span> {rb.cmd}
      </div>
      <div className="mb-2 text-[12px] text-[var(--trae-text-tertiary)]">回滚原因：{rb.reason}</div>
      <div className="ai-exec-status">
        <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
        <span className="font-medium text-[var(--trae-status-success-default)]">{rb.status}</span>
        <span className="text-[var(--trae-text-tertiary)]">·</span>
        <span className="text-[var(--trae-text-tertiary)]">nginx已恢复</span>
      </div>
    </div>
  )
}

export default RollbackPanel
