/**
 * WorkbenchTitlebar — 工作台顶部栏（40px）
 *
 * // @ai-session: ai-claude-20260720-wb3
 * // @ai-task: overnight-phase-C-ssh-connect
 *
 * - 服务器列表 / 切换来自 useServerStore
 * - 新建连接：ConnectDialog → 保存配置 → sshConnect + shellStart
 * - 已有服务器：菜单内一键连接
 */
import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import {
  Folder,
  ChevronDown,
  Search,
  PanelRight,
  LayoutGrid,
  Settings,
  Plus,
  Loader2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import { useServerStore } from '@/stores/server-store'
import { cn } from '@/components/trae/utils'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import ConnectDialog from '@/components/layout/ConnectDialog'
import type { SshConfig } from '@shared/models'

export interface WorkbenchTitlebarProps {
  onToggleAI?: () => void
  aiPanelVisible?: boolean
}

export function WorkbenchTitlebar({
  onToggleAI,
  aiPanelVisible = true,
}: WorkbenchTitlebarProps) {
  const navigate = useNavigate()
  const servers = useServerStore((s) => s.servers)
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const sessionMap = useServerStore((s) => s.sessionMap)
  const connectionStates = useServerStore((s) => s.connectionStates)
  const setActiveSession = useServerStore((s) => s.setActiveSession)
  const setConnectionState = useServerStore((s) => s.setConnectionState)
  const setSessionMapping = useServerStore((s) => s.setSessionMapping)
  const addServer = useServerStore((s) => s.addServer)
  const updateServer = useServerStore((s) => s.updateServer)

  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeServer = useMemo(() => {
    if (activeSessionId) {
      const entry = Object.entries(sessionMap).find(([, sid]) => sid === activeSessionId)
      if (entry) {
        const found = servers.find((s) => s.id === entry[0])
        if (found) return found
      }
    }
    const connected = servers.find((s) => connectionStates[s.id] === 'connected')
    if (connected) return connected
    return servers[0] ?? null
  }, [activeSessionId, sessionMap, servers, connectionStates])

  const serverLabel = activeServer
    ? activeServer.name || activeServer.host
    : '未连接服务器'

  const connState = activeServer
    ? connectionStates[activeServer.id] ?? 'disconnected'
    : 'disconnected'

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const connectServer = useCallback(
    async (server: SshConfig) => {
      if (!isElectronAPIAvailable()) {
        message.error('请在 Electron 桌面端运行')
        return
      }
      // 已有会话直接切换
      const existing = sessionMap[server.id]
      if (existing && connectionStates[server.id] === 'connected') {
        setActiveSession(existing)
        setMenuOpen(false)
        return
      }

      setConnectingId(server.id)
      setConnectionState(server.id, 'connecting')
      try {
        const sessionId = await window.electronAPI.sshConnect(server)
        try {
          await window.electronAPI.sshShellStart(sessionId)
        } catch (shellErr) {
          console.warn('[WorkbenchTitlebar] shell start failed', shellErr)
          message.warning('Shell 启动失败，终端可能不可用')
        }
        setConnectionState(server.id, 'connected')
        setSessionMapping(server.id, sessionId)
        setActiveSession(sessionId)
        setMenuOpen(false)
        message.success(`已连接 ${server.name || server.host}`)
      } catch (err) {
        setConnectionState(server.id, 'error')
        message.error(`连接失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setConnectingId(null)
      }
    },
    [
      sessionMap,
      connectionStates,
      setActiveSession,
      setConnectionState,
      setSessionMapping,
    ],
  )

  const handleDialogSave = useCallback(
    async (config: SshConfig) => {
      const exists = servers.some((s) => s.id === config.id)
      if (exists) await updateServer(config.id, config)
      else await addServer(config)
      setDialogOpen(false)
      await connectServer(config)
    },
    [servers, addServer, updateServer, connectServer],
  )

  return (
    <>
      <header
        className="wb-titlebar"
        aria-label="工作台顶部栏"
      >
        <div className="wb-titlebar-left">
          <div className="wb-titlebar-dots" aria-hidden>
            <span className="wb-titlebar-dot" style={{ background: 'var(--trae-status-error-default)' }} />
            <span className="wb-titlebar-dot" style={{ background: 'var(--trae-status-alert-default)' }} />
            <span className="wb-titlebar-dot" style={{ background: 'var(--trae-status-success-default)' }} />
          </div>
          <div className="relative flex items-center gap-2" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="wb-server-picker"
            title="切换 / 连接服务器"
          >
            <Folder className="size-4" />
            <span
              className={cn(
                'max-w-[180px] truncate',
                connState === 'connected'
                  ? 'text-[var(--trae-text-default)]'
                  : 'text-[var(--trae-text-tertiary)]',
              )}
            >
              {serverLabel}
            </span>
            <span
              className={cn(
                'inline-block size-1.5 rounded-full',
                connState === 'connected' && 'bg-[var(--trae-status-success-default)]',
                connState === 'connecting' && 'bg-[var(--trae-status-alert-default)]',
                connState === 'error' && 'bg-[var(--trae-status-error-default)]',
                (connState === 'disconnected' || !activeServer) &&
                  'bg-[var(--trae-text-tertiary)]',
              )}
            />
            <ChevronDown className="size-3.5" />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[260px] rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] py-1 shadow-xl">
              {servers.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-[var(--trae-text-tertiary)]">
                  暂无服务器，请新建连接
                </div>
              ) : (
                servers.map((srv) => {
                  const st = connectionStates[srv.id] ?? 'disconnected'
                  const active = activeServer?.id === srv.id
                  const busy = connectingId === srv.id
                  return (
                    <button
                      key={srv.id}
                      type="button"
                      disabled={busy}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] disabled:opacity-60',
                        active && 'bg-[var(--trae-bg-overlay-l1)]',
                      )}
                      onClick={() => void connectServer(srv)}
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin" />
                      ) : (
                        <span
                          className={cn(
                            'inline-block size-1.5 shrink-0 rounded-full',
                            st === 'connected' &&
                              'bg-[var(--trae-status-success-default)]',
                            st === 'connecting' &&
                              'bg-[var(--trae-status-alert-default)]',
                            st === 'error' && 'bg-[var(--trae-status-error-default)]',
                            st === 'disconnected' && 'bg-[var(--trae-text-tertiary)]',
                          )}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[var(--trae-text-default)]">
                        {srv.name || srv.host}
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--trae-text-tertiary)]">
                        {st === 'connected' ? '已连接' : srv.host}
                      </span>
                    </button>
                  )
                })
              )}
              <div className="my-1 border-t border-[var(--trae-border-neutral-l1)]" />
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--trae-text-brand)] hover:bg-[var(--trae-bg-overlay-l2)]"
                onClick={() => {
                  setMenuOpen(false)
                  setDialogOpen(true)
                }}
              >
                <Plus className="size-3.5" />
                新建连接…
              </button>
              <button
                type="button"
                className="flex w-full px-3 py-2 text-left text-[12px] text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)]"
                onClick={() => {
                  setMenuOpen(false)
                  navigate('/settings/ssh')
                }}
              >
                打开 SSH 设置…
              </button>
            </div>
          )}
        </div>
        </div>

        <div className="wb-titlebar-right">
          <IconButton title="搜索（开发中）" onClick={() => message.warning('全局搜索需要连接 SSH 服务器后使用')}>
            <Search className="size-4" />
          </IconButton>
          <IconButton title="AI面板" onClick={onToggleAI} active={aiPanelVisible} domId="collapse-ai">
            <PanelRight className="size-4" />
          </IconButton>
          <IconButton title="布局（开发中）" onClick={() => message.warning('分屏布局暂未上线，可在设置中调整面板宽度')}>
            <LayoutGrid className="size-4" />
          </IconButton>
          <IconButton title="设置" onClick={() => navigate('/settings')}>
            <Settings className="size-4" />
          </IconButton>
        </div>
      </header>

      <ConnectDialog
        open={dialogOpen}
        server={null}
        onSave={(cfg) => void handleDialogSave(cfg)}
        onCancel={() => setDialogOpen(false)}
      />
    </>
  )
}

function IconButton({
  children,
  title,
  onClick,
  active,
  domId,
}: {
  children: React.ReactNode
  title: string
  onClick?: () => void
  active?: boolean
  /** data-dom-id 标识（用于 E2E 测试 / 自动化接入） */
  domId?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      data-dom-id={domId}
      className={cn(
        'wb-icon-btn',
        active && 'is-active',
      )}
    >
      {children}
    </button>
  )
}

export default WorkbenchTitlebar
