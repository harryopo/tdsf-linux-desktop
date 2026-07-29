/**
 * WorkbenchTitlebar — 工作台顶部栏（40px）
 *
 * // @ai-session: ai-claude-20260720-wb3
 * // @ai-task: overnight-phase-C-ssh-connect
 * // @redesign: 2026-07-23 1:1 对齐 workbench-ai.html / workbench-disconnected.html
 *
 * 设计稿结构（workbench-ai.html 第 2289-2388 行）:
 * - 左侧: TDSF Logo(shield.svg + "TDSF" 字) + 服务器选择器
 * - 右侧 4 按钮(28×28): 搜索 / AI面板 / 终端面板 / 设置
 * - 未连接态(workbench-disconnected.html 第 284-292 行): 仅 搜索 + 设置 2 按钮
 * - 设计稿无红黄绿窗口控制点,已移除
 *
 * - 服务器列表 / 切换来自 useServerStore
 * - 新建连接：ConnectDialog → 保存配置 → sshConnect + shellStart
 * - 已有服务器：菜单内一键连接
 */
import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import {
  ChevronDown,
  PanelRight,
  Settings,
  Plus,
  Loader2,
  Search,
  Server,
  SquareTerminal,
  Shield,
  Save,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import { useServerStore } from '@/stores/server-store'
import { cn } from '@/components/trae/utils'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import ConnectDialog from '@/components/layout/ConnectDialog'
import CommandPalette from '@/components/workbench/CommandPalette'
import type { SshConfig } from '@shared/models'

export interface WorkbenchTitlebarProps {
  onToggleAI?: () => void
  aiPanelVisible?: boolean
  /** 终端面板按钮回调（切换到终端 tab） */
  onToggleTerminal?: () => void
  /** P1-3：全部保存按钮回调（一键保存所有未保存文件） */
  onSaveAll?: () => void
  /** P1-3：是否存在未保存文件（用于按钮高亮提示） */
  hasUnsavedFiles?: boolean
}

export function WorkbenchTitlebar({
  onToggleAI,
  aiPanelVisible = true,
  onToggleTerminal,
  onSaveAll,
  hasUnsavedFiles = false,
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
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
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

  const connState = activeServer
    ? connectionStates[activeServer.id] ?? 'disconnected'
    : 'disconnected'

  const filteredServers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (s) =>
        (s.name ?? '').toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q),
    )
  }, [servers, searchQuery])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  // Cmd+K / Ctrl+K 全局快捷键打开搜索面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        try {
          await window.electronAPI.monitorStart(sessionId, 3)
        } catch (err) {
          console.warn('[WorkbenchTitlebar] monitorStart failed:', err)
        }
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
          {/* TDSF Logo: shield + "TDSF" 字（设计稿 workbench-ai.html 第 2290-2294 行） */}
          <div className="wb-titlebar-logo" aria-hidden>
            <span className="wb-titlebar-logo-mark">
              <Shield className="size-4" />
            </span>
            <span className="wb-titlebar-logo-text">TDSF</span>
          </div>
          <div className="relative flex items-center gap-2" ref={menuRef}>
          <button
            type="button"
            onClick={() => {
              setMenuOpen((v) => !v)
              setSearchQuery('')
            }}
            className="wb-server-picker"
            title="切换 / 连接服务器"
          >
            <span
              className={cn(
                'inline-block size-1.5 shrink-0 rounded-full',
                connState === 'connected' && 'bg-[var(--trae-status-success-default)]',
                connState === 'connecting' && 'bg-[var(--trae-status-alert-default)]',
                connState === 'error' && 'bg-[var(--trae-status-error-default)]',
                (connState === 'disconnected' || !activeServer) &&
                  'bg-[var(--trae-text-tertiary)]',
              )}
              title={connState === 'connected' ? '已连接' : connState === 'connecting' ? '连接中' : connState === 'error' ? '连接失败' : '未连接'}
            />
            <Server className="size-3.5 shrink-0 text-[var(--trae-text-secondary)]" />
            <span
              className={cn(
                'max-w-[160px] truncate font-mono text-[11px] tabular-nums',
                connState === 'connected'
                  ? 'text-[var(--trae-text-default)]'
                  : 'text-[var(--trae-text-tertiary)]',
              )}
            >
              {activeServer ? activeServer.host : '未连接'}
            </span>
            {activeServer && (
              <>
                <span className="text-[10px] text-[var(--trae-text-tertiary)]">·</span>
                <span className="text-[10px] text-[var(--trae-text-secondary)]">
                  {activeServer.username}
                </span>
              </>
            )}
            <ChevronDown className={cn('size-3 shrink-0 text-[var(--trae-text-tertiary)] transition-transform', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[320px] rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
              {/* 搜索栏 */}
              <div className="flex items-center gap-1.5 border-b border-[var(--trae-border-neutral-l1)] px-3 py-3">
                <div className="flex flex-1 items-center gap-2 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-2.5 py-1.5">
                  <Search className="size-3.5 shrink-0 text-[var(--trae-text-tertiary)]" />
                  <input
                    type="text"
                    placeholder="搜索服务器..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent text-[12px] text-[var(--trae-text-default)] outline-none placeholder:text-[var(--trae-text-tertiary)]"
                    autoFocus
                  />
                </div>
              </div>
              {/* 服务器列表 */}
              <div className="max-h-[280px] overflow-y-auto py-1">
                {filteredServers.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[11px] text-[var(--trae-text-tertiary)]">
                    {servers.length === 0 ? '暂无服务器，请新建连接' : '未找到匹配的服务器'}
                  </div>
                ) : (
                  filteredServers.map((srv) => {
                    const st = connectionStates[srv.id] ?? 'disconnected'
                    const active = activeServer?.id === srv.id
                    const busy = connectingId === srv.id
                    return (
                      <button
                        key={srv.id}
                        type="button"
                        disabled={busy}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--trae-bg-overlay-l2)] disabled:opacity-60',
                          active && 'bg-[var(--trae-bg-overlay-l3)]',
                        )}
                        onClick={() => void connectServer(srv)}
                      >
                        {busy ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-[var(--trae-text-tertiary)]" />
                        ) : (
                          <Server
                            className={cn(
                              'size-4 shrink-0',
                              st === 'connected'
                                ? 'text-[var(--trae-bg-brand)]'
                                : 'text-[var(--trae-text-tertiary)]',
                            )}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-[var(--trae-text-default)]">
                            {srv.name || srv.host}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-[var(--trae-text-tertiary)]">
                            {srv.host}:{srv.port} · {srv.username}
                          </div>
                        </div>
                        <span
                          className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums',
                            st === 'connected' && 'bg-[rgba(51,193,146,0.14)] text-[var(--trae-status-success-default)]',
                            st === 'connecting' && 'bg-[rgba(210,157,0,0.14)] text-[var(--trae-status-alert-default)]',
                            st === 'error' && 'bg-[rgba(246,90,90,0.14)] text-[var(--trae-status-error-default)]',
                            st === 'disconnected' && 'text-[var(--trae-text-tertiary)]',
                          )}
                          title={st === 'connected' ? '已连接' : st === 'connecting' ? '连接中' : st === 'error' ? '连接失败' : '未连接'}
                        >
                          <span
                            className={cn(
                              'inline-block size-1.5 rounded-full',
                              st === 'connected' && 'bg-[var(--trae-status-success-default)]',
                              st === 'connecting' && 'bg-[var(--trae-status-alert-default)]',
                              st === 'error' && 'bg-[var(--trae-status-error-default)]',
                              st === 'disconnected' && 'bg-[var(--trae-text-tertiary)]',
                            )}
                          />
                          {st === 'connected' ? '在线' : st === 'connecting' ? '连接中' : st === 'error' ? '超时' : '未连接'}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
              {/* 底部：添加新连接 */}
              <div className="border-t border-[var(--trae-border-neutral-l1)] px-3 py-2.5">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-[var(--trae-radius-4)] border border-dashed border-[var(--trae-border-neutral-l2)] py-2 text-[12px] text-[var(--trae-text-secondary)] transition-colors hover:border-[var(--trae-bg-brand)] hover:text-[var(--trae-text-brand)] hover:bg-[var(--trae-bg-overlay-l1)]"
                  onClick={() => {
                    setMenuOpen(false)
                    setDialogOpen(true)
                  }}
                >
                  <Plus className="size-3.5" />
                  添加新连接
                </button>
              </div>
            </div>
          )}
        </div>
        </div>

        <div className="wb-titlebar-right">
          {/* P1-3：全部保存按钮（仅当有未保存文件时显示，并在 onSaveAll 可用时） */}
          {onSaveAll && hasUnsavedFiles && (
            <button
              type="button"
              title="全部保存（一键保存所有未保存文件）"
              aria-label="全部保存"
              onClick={onSaveAll}
              data-dom-id="btn-save-all"
              className={cn(
                'wb-icon-btn',
                'has-unsaved',
              )}
            >
              <Save className="size-4" />
            </button>
          )}
          {/* 搜索按钮(设计稿 workbench-ai.html 第 2376-2378 行 / workbench-disconnected.html 第 286-288 行) */}
          <IconButton title="搜索 (Cmd+K)" onClick={() => setSearchOpen(true)}>
            <Search className="size-4" />
          </IconButton>
          <IconButton
            title="AI面板"
            onClick={onToggleAI}
            active={aiPanelVisible}
            domId="btn-toggle-ai"
          >
            <PanelRight className="size-4" />
          </IconButton>
          <IconButton title="终端面板" onClick={onToggleTerminal}>
            <SquareTerminal className="size-4" />
          </IconButton>
          <IconButton title="设置" onClick={() => navigate('/settings')} domId="nav-settings-top">
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

      <CommandPalette visible={searchOpen} onClose={() => setSearchOpen(false)} />
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
