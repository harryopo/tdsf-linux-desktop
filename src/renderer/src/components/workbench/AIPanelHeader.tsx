/**
 * AI 停靠格头部（32px）
 *
 * 照 cc-gui 顶栏的语言：一条细高度带、左侧标题 + 状态 chip、右侧一排 28px 图标动作，
 * 全部走令牌，不再引用 AIPanel.css 里的旧类。
 *
 * 这里曾有第三个按钮：一个上下箭头，tooltip 写"显示/隐藏命令翻译注释"。
 * 它改的那个 showTranslation 标志全仓只有它自己读（用来换图标方向），
 * 界面别处没有任何"命令注释"会跟着出现或消失——点了只看见箭头翻个身。2026-10-17 删。
 * 要把它做回来，前提是"命令注释"这个界面元素真的存在：逐条命令给一句**针对整条命令**的解释
 * （拿字典里 `systemctl` 那种光命令名的泛化释义冒充 `systemctl restart nginx` 的说明，
 * 就是本项目清掉过好几次的假信息那一类），而不是再加一个只换图标的开关。
 */
import type { FC } from 'react'
import { PanelRightClose, RotateCcw, Sparkles } from 'lucide-react'
import { Chip, IconButton, Tooltip } from '@/ui'

export interface AIPanelHeaderProps {
  onClose?: () => void
  isStreaming: boolean
  hasLiveConversation: boolean
  onClear: () => void
}

const AIPanelHeader: FC<AIPanelHeaderProps> = ({
  onClose,
  isStreaming,
  hasLiveConversation,
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
