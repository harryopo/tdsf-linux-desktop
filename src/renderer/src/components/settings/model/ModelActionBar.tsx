/**
 * ModelActionBar — 模型配置底部操作栏（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，负责"恢复默认 / 导出统计 / 保存所有配置"三个按钮
 * 以及保存/导出反馈提示。设计稿为 sticky 底部操作栏。
 */
import { RotateCcw, FileText, Check } from 'lucide-react'

export interface ModelActionBarProps {
  /** 点击"恢复默认"回调 */
  onResetDefaults: () => void
  /** 点击"导出统计"回调 */
  onExportStats: () => void
  /** 点击"保存所有配置"回调 */
  onSaveAll: () => void
  /** 保存反馈提示文本（null 表示不显示） */
  saveFeedback: string | null
  /** 导出反馈提示文本（null 表示不显示） */
  exportFeedback: string | null
}

export function ModelActionBar(props: ModelActionBarProps) {
  const {
    onResetDefaults,
    onExportStats,
    onSaveAll,
    saveFeedback,
    exportFeedback,
  } = props

  return (
    <footer className="set-model-actionbar">
      <button
        type="button"
        onClick={onResetDefaults}
        aria-label="恢复默认"
        className="set-btn-secondary btn-press"
      >
        <RotateCcw className="size-3.5" />
        恢复默认
      </button>
      <button
        type="button"
        onClick={onExportStats}
        aria-label="导出统计"
        className="set-btn-secondary btn-press"
      >
        <FileText className="size-3.5" />
        导出统计
      </button>
      <button
        type="button"
        onClick={onSaveAll}
        aria-label="保存所有配置"
        className="set-btn-primary btn-press"
      >
        <Check className="size-3.5" />
        保存所有配置
      </button>
      {saveFeedback && (
        <span
          className={
            'set-model-actionbar__feedback ' +
            (saveFeedback === '配置已保存'
              ? 'set-model-actionbar__feedback--success'
              : 'set-model-actionbar__feedback--error')
          }
        >
          {saveFeedback}
        </span>
      )}
      {exportFeedback && (
        <span className="set-model-actionbar__feedback set-model-actionbar__feedback--success">
          {exportFeedback}
        </span>
      )}
    </footer>
  )
}
