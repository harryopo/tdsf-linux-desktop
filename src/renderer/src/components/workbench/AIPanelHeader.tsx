/**
 * AI 停靠格头部（32px）
 *
 * 照 cc-gui 顶栏的语言：一条细高度带、左侧标题 + 状态 chip、右侧一排 28px 图标动作，
 * 全部走令牌，不再引用 AIPanel.css 里的旧类。
 */
import type { FC } from 'react'
import { ChevronDown, ChevronUp, PanelRightClose, RotateCcw, Sparkles } from 'lucide-react'
import { Chip, IconButton, Tooltip } from '@/ui'

export interface AIPanelHeaderProps {
  onClose?: () => void
  isStreaming: boolean
  hasLiveConversation: boolean
  showTranslation: boolean
  setShowTranslation: (v: boolean | ((prev: boolean) => boolean)) => void
  onClear: () => void
}

const AIPanelHeader: FC<AIPanelHeaderProps> = ({
  onClose,
  isStreaming,
  hasLiveConversation,
  showTranslation,
  setShowTranslation,
  onClear,
}) => {
  const status = isStreaming
    ? { tone: 'accent' as const, text: '生成中' }
    : hasLiveConversation
      ? { tone: 'success' as const, text: '已连接' }
      : { tone: 'neutral' as const, text: '就绪' }

  return (
    <header className="ai-panel-header flex shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-2">
      <div className="flex min-w-0 items-center gap-2">
        <Sparkles className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
        <span className="truncate text-md font-semibold text-ink-strong">AI 运维助手</span>
        <Chip tone={status.tone}>
          <span
            aria-hidden
            className={
              'size-1 rounded-full ' +
              (isStreaming
                ? 'animate-pulse bg-accent'
                : hasLiveConversation
                  ? 'bg-success'
                  : 'bg-ink-mute')
            }
          />
          {status.text}
        </Chip>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {hasLiveConversation ? (
          <Tooltip content="清空对话">
            <IconButton label="清空对话" size="sm" onClick={onClear}>
              <RotateCcw className="size-3.5" />
            </IconButton>
          </Tooltip>
        ) : null}
        <Tooltip content={showTranslation ? '隐藏命令翻译注释' : '显示命令翻译注释'}>
          <IconButton
            label={showTranslation ? '隐藏命令翻译注释' : '显示命令翻译注释'}
            size="sm"
            active={showTranslation}
            onClick={() => setShowTranslation((v) => !v)}
          >
            {showTranslation ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </IconButton>
        </Tooltip>
        <Tooltip content="收起 AI 面板">
          <IconButton label="收起 AI 面板" size="sm" onClick={onClose}>
            <PanelRightClose className="size-4" />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  )
}

export default AIPanelHeader
