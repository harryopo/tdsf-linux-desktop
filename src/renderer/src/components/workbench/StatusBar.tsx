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
import { Terminal, Sparkles, Code } from 'lucide-react'
import { useMemo } from 'react'
import { useServerStore } from '@/stores/server-store'
import { useAgentStore } from '@/stores/agent-store'
import { useEditorStore } from '@/stores/editor-store'
import { useTerminalStore, visibleShells } from '@/stores/terminal-store'

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
  const commandBlocks = useTerminalStore((s) => s.commandBlocks)
  const shells = useTerminalStore((s) => s.shells)
  const activeShellId = useTerminalStore((s) => s.activeShellId)

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
        ? 'AI已激活'
        : 'AI未配置'

  const aiColor = isStreaming
    ? 'var(--trae-text-brand)'
    : provider
      ? 'var(--trae-text-brand)'
      : 'var(--trae-text-tertiary)'

  // 光标位置来自 editor-store（MonacoEditor onDidChangeCursorPosition 实时写入）
  // 终端 tab 或无激活文件时为 null，回退到 Ln 1, Col 1
  const cursorPosition = useEditorStore((s) => s.cursorPosition)
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const cursorLine = cursorPosition?.lineNumber ?? 1
  const cursorColumn = cursorPosition?.column ?? 1
  // 文件名优先取激活文件路径的 basename，无激活文件时回退到服务器名或占位符
  const fileName = activeFilePath
    ? activeFilePath.split('/').pop() || activeFilePath
    : activeServer?.name || activeServer?.host || '—'

  // 保留 tokenStats 引用以备未来在状态栏扩展（如本次会话消耗）
  void tokenStats

  // 这一格原先只看 activeSessionId：本机终端（不挂 SSH 会话）开着也报"无终端"。
  // 改成与标签栏同一份投影（visibleShells），活跃终端是谁就写谁，不再分本机/远端两套口径。
  const activeShell =
    visibleShells(shells, activeSessionId).find((sh) => sh.shellId === activeShellId) ?? null

  return (
    <footer
      className="wb-statusbar"
      aria-label="状态栏"
    >
      <div className="wb-statusbar-group">
        {/* 没有终端时这里根本没挂 xterm，「聚焦终端」点了只会什么也不发生，
            所以无终端时降级成只读读数，不再写成一个能点的按钮 */}
        <StatusItem
          onClick={activeShell ? focusActiveTerminal : undefined}
          title={activeShell ? '聚焦终端' : '还没打开终端'}
        >
          <Terminal className="size-3" />
          <span>{activeShell?.title || '无终端'}</span>
        </StatusItem>

        <StatusItem color={sshColor}>
          <span className="wb-status-item-dot" style={{ background: sshColor }} />
          <span>{sshLabel}</span>
          {activeServer && (
            <span className="max-w-[100px] truncate text-ink-mute">
              {activeServer.host}
            </span>
          )}
        </StatusItem>


        <StatusItem color={aiColor}>
          <Sparkles className="size-3" />
          <span className="max-w-[140px] truncate">{aiLabel}</span>
        </StatusItem>
      </div>

      <div className="wb-statusbar-group">
        <StatusItem title="光标位置（编辑器集成后自动更新）">
          <span>
            Ln <span className="tabular-nums">{cursorLine}</span>, Col{' '}
            <span className="tabular-nums">{cursorColumn}</span>
          </span>
        </StatusItem>
        <StatusItem title="文件编码">
          <span>UTF-8</span>
        </StatusItem>
        <StatusItem title="当前文件">
          <Code className="size-3" />
          <span className="max-w-[120px] truncate">{fileName}</span>
        </StatusItem>
        {/* 命令块：OSC 133/633 切出来的真实计数（远端没装 shell integration 时就是 0） */}
        <StatusItem
          title={
            commandBlocks?.context
              ? `最近命令：
${commandBlocks.context}`
              : '尚无命令块（需要远端 shell 发送 OSC 133/633 序列）'
          }
        >
          <Terminal className="size-3" />
          <span className="tabular-nums">{commandBlocks?.count ?? 0} 命令块</span>
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

/**
 * 状态栏项。
 *
 * 只有传了 onClick 才是按钮——其余格子是只读读数（SSH 状态、光标位置、
 * 命令块计数等）。把它们写成 <button> 会让读屏报出一个按了没反应的控件，
 * 也让按钮普查把它们误判成死按钮。
 */
function StatusItem({ children, color, onClick, title }: StatusItemProps) {
  const cls = 'wb-status-item' + (onClick ? ' wb-status-item--action' : '')
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={cls} style={color ? { color } : undefined}>
        {children}
      </button>
    )
  }
  return (
    <span title={title} className={cls} style={color ? { color } : undefined}>
      {children}
    </span>
  )
}

export default StatusBar
