/**
 * StatusBar — 工作台底部状态栏（24px）
 *
 * // @ai-session: ai-claude-20260720-wire2
 * // @ai-task: Wire-2-provider-terminal-status
 *
 * 设计稿：workbench-ai.html 第 3301-3332 行
 *
 * Wire-2：SSH / AI 状态来自 server-store + agent-store（不再写死 mock）
 */
import { Terminal, CheckCircle, Sparkles, Code, Zap } from 'lucide-react'
import { useMemo } from 'react'
import { useServerStore } from '@/stores/server-store'
import { useAgentStore } from '@/stores/agent-store'

/** StatusBar 工作台底部状态栏 */
export function StatusBar() {
  const servers = useServerStore((s) => s.servers)
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const sessionMap = useServerStore((s) => s.sessionMap)
  const connectionStates = useServerStore((s) => s.connectionStates)

  const isStreaming = useAgentStore((s) => s.isStreaming)
  const selectedProviderId = useAgentStore((s) => s.selectedProviderId)
  const providers = useAgentStore((s) => s.providers)
  const tokenStats = useAgentStore((s) => s.tokenStats)

  const activeServer = useMemo(() => {
    if (activeSessionId) {
      const entry = Object.entries(sessionMap).find(([, sid]) => sid === activeSessionId)
      if (entry) {
        const found = servers.find((s) => s.id === entry[0])
        if (found) return found
      }
    }
    return servers.find((s) => connectionStates[s.id] === 'connected') ?? null
  }, [activeSessionId, sessionMap, servers, connectionStates])

  const connState = activeServer
    ? connectionStates[activeServer.id] ?? 'disconnected'
    : 'disconnected'

  const sshLabel =
    connState === 'connected'
      ? 'SSH已连接'
      : connState === 'connecting'
        ? 'SSH连接中'
        : connState === 'error'
          ? 'SSH错误'
          : 'SSH未连接'

  const sshColor =
    connState === 'connected'
      ? 'var(--trae-status-success-default)'
      : connState === 'connecting'
        ? 'var(--trae-status-alert-default)'
        : connState === 'error'
          ? 'var(--trae-status-error-default)'
          : 'var(--trae-text-tertiary)'

  const provider = providers.find((p) => p.id === selectedProviderId)
  const aiLabel = isStreaming
    ? 'AI生成中'
    : provider
      ? `AI · ${provider.name || provider.model}`
      : selectedProviderId
        ? 'AI已就绪'
        : 'AI未配置'

  const aiColor = isStreaming
    ? 'var(--trae-text-brand)'
    : provider
      ? 'var(--trae-text-brand)'
      : 'var(--trae-text-tertiary)'

  const todayTokens = tokenStats.today

  return (
    <footer
      className="wb-statusbar flex h-7 shrink-0 items-center justify-between border-t border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-2 text-[12px] text-[var(--trae-text-secondary)]"
      style={{ fontVariantNumeric: 'tabular-nums' }}
      aria-label="状态栏"
    >
      {/* === 左侧：连接/错误/AI 状态 === */}
      <div className="flex items-center gap-1">
        <StatusItem onClick={focusActiveTerminal} title="聚焦终端">
          <Terminal className="size-3" />
          <span>main</span>
        </StatusItem>

        <StatusItem color={sshColor}>
          <span className="size-1.5 rounded-full" style={{ background: sshColor }} />
          <span>{sshLabel}</span>
          {activeServer && (
            <span className="max-w-[100px] truncate text-[var(--trae-text-tertiary)]">
              {activeServer.host}
            </span>
          )}
        </StatusItem>

        <StatusItem>
          <CheckCircle className="size-3 text-[var(--trae-status-success-default)]" />
          <span>0 Errors</span>
        </StatusItem>

        <StatusItem color={aiColor}>
          <Sparkles className="size-3" />
          <span className="max-w-[140px] truncate">{aiLabel}</span>
        </StatusItem>
      </div>

      {/* === 右侧：会话信息 === */}
      <div className="flex items-center gap-1">
        <StatusItem>
          <span>
            今日{' '}
            <span className="text-[var(--trae-text-default)]">
              {todayTokens.toLocaleString()}
            </span>{' '}
            tok
          </span>
        </StatusItem>
        <StatusItem>
          <span>UTF-8</span>
        </StatusItem>
        <StatusItem>
          <Code className="size-3" />
          <span>{activeServer ? activeServer.name || activeServer.host : '—'}</span>
        </StatusItem>
        <StatusItem>
          <Zap
            className="size-3"
            style={{
              color:
                connState === 'connected'
                  ? 'var(--trae-status-success-default)'
                  : 'var(--trae-text-tertiary)',
            }}
          />
          <span>{connState === 'connected' ? '在线' : '离线'}</span>
        </StatusItem>
      </div>
    </footer>
  )
}

/**
 * 聚焦当前活跃的 xterm 终端。
 *
 * xterm.js 会在终端容器内渲染一个隐藏但可聚焦的辅助 textarea
 * （class 含 "xterm-helper-textarea"），它负责接收键盘输入。将焦点移到该
 * textarea 上即可让用户继续在终端中键入命令。
 *
 * 说明：StatusBar 与 TerminalView 之间没有共享的 terminal ref / store action，
 * 因此这里通过 DOM 查询定位活跃终端的辅助 textarea。若终端尚未挂载（例如还未
 * 建立 SSH 会话），则查询不到元素，函数静默返回。
 */
function focusActiveTerminal(): void {
  const textarea = document.querySelector<HTMLElement>('.xterm-helper-textarea')
  textarea?.focus()
}

/** 状态栏项 */
interface StatusItemProps {
  children: React.ReactNode
  /** 文字颜色（默认 text-secondary） */
  color?: string
  /** 点击回调 */
  onClick?: () => void
  /** 悬浮提示（无障碍 / tooltip） */
  title?: string
}

function StatusItem({ children, color, onClick, title }: StatusItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-[var(--trae-radius-4)] px-1.5 transition-colors hover:bg-[var(--trae-bg-overlay-l2)]"
      style={color ? { color } : undefined}
    >
      {children}
    </button>
  )
}

export default StatusBar
