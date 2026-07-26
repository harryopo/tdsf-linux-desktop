/**
 * AIPanelHeader — 40px 标题栏
 *
 * v2.3.6 修复：彻底移除"示例开/示例关"按钮和 showDemo/setShowDemo props。
 * 设计稿不再展示设计稿示例消息，避免给用户"演示数据是真的"错觉。
 *
 * 保留：
 * - 左：AI 运维助手标题 + live badge（生成中 / 已连接 / 就绪）
 * - 右：清空对话、命令翻译注释切换、收起 AI 面板
 */
import type { FC } from 'react'
import { ChevronDown, ChevronUp, PanelRightClose, RotateCcw, Sparkles } from 'lucide-react'
import { cn } from '@/components/trae/utils'

/** AIPanelHeader props */
export interface AIPanelHeaderProps {
  onClose?: () => void
  isStreaming: boolean
  hasLiveConversation: boolean
  showTranslation: boolean
  setShowTranslation: (v: boolean | ((prev: boolean) => boolean)) => void
  onClear: () => void
}

/** AIPanel 40px 标题栏（AI运维助手 + live badge + 工具按钮） */
const AIPanelHeader: FC<AIPanelHeaderProps> = ({
  onClose,
  isStreaming,
  hasLiveConversation,
  showTranslation,
  setShowTranslation,
  onClear,
}) => {
  return (
    <div className="relative flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-3">
      {/* Left: title + live badge */}
      <div className="flex min-w-0 items-center gap-2">
        <Sparkles className="size-3.5 text-[var(--trae-text-brand)]" />
        <span className="whitespace-nowrap text-[13px] font-semibold text-[var(--trae-text-default)]">AI运维助手</span>
        <span
          className={cn(
            'inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium',
            isStreaming
              ? 'bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)]'
              : hasLiveConversation
                ? 'bg-[var(--trae-status-success-surface-l1)] text-[var(--trae-status-success-default)]'
                : 'bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-text-tertiary)]',
          )}
        >
          <span
            className={cn(
              'inline-block size-1 rounded-full',
              isStreaming
                ? 'ai-pulse-dot bg-[var(--trae-bg-brand)]'
                : hasLiveConversation
                  ? 'bg-[var(--trae-status-success-default)]'
                  : 'bg-[var(--trae-text-tertiary)]',
            )}
          />
          {isStreaming
            ? '生成中'
            : hasLiveConversation
              ? '已连接'
              : '就绪'}
        </span>
      </div>

      {/* Right: clear / translate / collapse */}
      <div className="flex items-center gap-1">
        {hasLiveConversation && (
          <button
            type="button"
            title="清空对话"
            onClick={onClear}
            className="btn-press flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          title={showTranslation ? '隐藏命令翻译注释' : '显示命令翻译注释'}
          onClick={() => setShowTranslation((v) => !v)}
          className="btn-press flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
        >
          {showTranslation ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          title="收起 AI 面板"
          onClick={onClose}
          className="btn-press flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>
    </div>
  )
}

export default AIPanelHeader
