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
 * - 新建连接：ConnectDialog → 保存配置 → sshConnect（凭据是用户现填的）+ shellStart
 * - 已有服务器：菜单内一键连接 → sshConnectById(id)，只交 ID，凭据不过渲染层（P0-3）
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
  AppWindow,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useServerStore } from '@/stores/server-store'
import { useServerConnect } from '@/hooks/useServerConnect'
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
  /** 当前是否已停在终端 tab（按钮据此显示按下态，重复点击无变化才不算假按钮） */
  terminalActive?: boolean
  /** P1-3：全部保存按钮回调（一键保存所有未保存文件） */
  onSaveAll?: () => void
  /** P1-3：是否存在未保存文件（用于按钮高亮提示） */
  hasUnsavedFiles?: boolean
  /**
   * #170：AI 面板里正在等人回答的审批条数。
   * 面板可以收起，而请求不会丢（队列在全局 store）——收起期间总得有个地方说"里面有话等你答"，
   * 否则用户看到的是一个不动的图标，和"没发生任何事"长得一模一样。
   */
  aiApprovalCount?: number
}

export function WorkbenchTitlebar({
  onToggleAI,
  aiPanelVisible = true,
  aiApprovalCount = 0,
  onToggleTerminal,
  terminalActive = false,
  onSaveAll,
  hasUnsavedFiles = false,
}: WorkbenchTitlebarProps) {
  const navigate = useNavigate()
  const servers = useServerStore((s) => s.servers)
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const sessionMap = useServerStore((s) => s.sessionMap)
  const connectionStates = useServerStore((s) => s.connectionStates)
  const addServer = useServerStore((s) => s.addServer)
  const updateServer = useServerStore((s) => s.updateServer)

  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
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

  /*
   * 连接本身（换 sessionId / 开终端 / 登记会话映射）在 useServerConnect 里，
   * 与启动页的快速连接共用一份实现；这里只负责连上之后把菜单收起。
   */
  const { connectingId, connectSavedServer, connectFreshConfig } = useServerConnect({
    onConnected: () => setMenuOpen(false),
  })

  const handleDialogSave = useCallback(
    async (config: SshConfig) => {
      const exists = servers.some((s) => s.id === config.id)
      if (exists) {
        await updateServer(config.id, config)
        // 已在列表里 = 已保存的服务器：重连只交 ID，外加用户这次真的重打了的口令
        await connectSavedServer(config, config.password || undefined)
      } else {
        await addServer(config)
        await connectFreshConfig(config)
      }
      setDialogOpen(false)
    },
    [servers, addServer, updateServer, connectSavedServer, connectFreshConfig],
  )

  /** W4：再开一个应用窗口（并排看两台机器，或一边跑日志一边改文件） */
  const handleNewWindow = useCallback(async () => {
    if (!isElectronAPIAvailable() || !window.electronAPI?.windowOpenSecondary) {
      toast.warning('当前环境不支持多窗口（非 Electron 环境）')
      return
    }
    try {
      const count = await window.electronAPI.windowOpenSecondary()
      // 新窗口在另一个窗口里，当前窗口不给句话就等于"点了没反应"（按钮普查会红）
      toast.success(`已新建窗口，当前共 ${count} 个窗口`)
    } catch (err) {
      toast.error(`新建窗口失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

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
            <Server className="size-3.5 shrink-0 text-ink-dim" />
            <span
              className={cn(
                'max-w-[160px] truncate font-mono text-caption tabular-nums',
                connState === 'connected'
                  ? 'text-ink'
                  : 'text-ink-mute',
              )}
            >
              {activeServer ? activeServer.host : '未连接'}
            </span>
            {activeServer && (
              <>
                <span className="text-micro text-ink-mute">·</span>
                <span className="text-micro text-ink-dim">
                  {activeServer.username}
                </span>
              </>
            )}
            <ChevronDown className={cn('size-3 shrink-0 text-ink-mute transition-transform', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[320px] overflow-hidden rounded-(--ui-radius-card) border border-line-strong bg-raised shadow-(--shadow-md)">
              {/* 搜索栏：整块是"字段壳"，焦点由壳的描边表达，里面的 input 不再自己画方框环 */}
              <div className="border-b border-line px-3 py-3">
                <div
                  data-field-shell
                  className="flex items-center gap-2 rounded-(--ui-radius-control) border border-line-strong bg-sunken px-2.5 py-1.5"
                >
                  <Search className="size-3.5 shrink-0 text-ink-mute" />
                  <input
                    type="text"
                    placeholder="搜索服务器..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-mute"
                    autoFocus
                  />
                </div>
              </div>
              {/* 服务器列表 */}
              <div className="max-h-[280px] overflow-y-auto p-1">
                {filteredServers.length === 0 ? (
                  <div className="px-3 py-6 text-center text-caption text-ink-mute">
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
                          'flex w-full items-center gap-2.5 rounded-(--ui-radius-control) px-3 py-2.5 text-left transition-colors hover:bg-hover disabled:opacity-60',
                          active && 'bg-hover',
                        )}
                        onClick={() => void connectSavedServer(srv)}
                      >
                        {busy ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-ink-mute" />
                        ) : (
                          <Server
                            className={cn(
                              'size-4 shrink-0',
                              st === 'connected'
                                ? 'text-(--accent-text)'
                                : 'text-ink-mute',
                            )}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-md font-medium text-ink">
                            {srv.name || srv.host}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-caption tabular-nums text-ink-mute">
                            {srv.host}:{srv.port} · {srv.username}
                          </div>
                        </div>
                        <span
                          className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium tabular-nums',
                            st === 'connected' && 'bg-[rgba(51,193,146,0.14)] text-(--status-success-text)',
                            st === 'connecting' && 'bg-[rgba(210,157,0,0.14)] text-[var(--trae-status-alert-default)]',
                            st === 'error' && 'bg-[rgba(246,90,90,0.14)] text-(--status-error-text)',
                            st === 'disconnected' && 'text-ink-mute',
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
              <div className="border-t border-line px-3 py-2.5">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-(--ui-radius-control) border border-dashed border-line-strong py-2 text-sm text-ink-dim transition-colors hover:bg-[var(--trae-bg-overlay-l1)] hover:text-(--accent-text)"
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
          {/* W4：第二个窗口。开完不需要提示——新窗口自己会出现在屏幕上 */}
          <IconButton title="新建窗口" domId="btn-new-window" onClick={() => void handleNewWindow()}>
            <AppWindow className="size-4" />
          </IconButton>
          {/* 搜索按钮(设计稿 workbench-ai.html 第 2376-2378 行 / workbench-disconnected.html 第 286-288 行) */}
          <IconButton title="搜索 (Cmd+K)" onClick={() => setSearchOpen(true)}>
            <Search className="size-4" />
          </IconButton>
          <IconButton
            title={
              aiApprovalCount > 0
                ? `AI面板（${aiApprovalCount} 条命令等你批准）`
                : 'AI面板'
            }
            onClick={onToggleAI}
            active={aiPanelVisible}
            domId="btn-toggle-ai"
            badge={aiApprovalCount}
          >
            <PanelRight className="size-4" />
          </IconButton>
          <IconButton
            title="终端面板"
            onClick={onToggleTerminal}
            active={terminalActive}
            domId="btn-toggle-terminal"
          >
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
  badge,
}: {
  children: React.ReactNode
  title: string
  onClick?: () => void
  active?: boolean
  /** data-dom-id 标识（用于 E2E 测试 / 自动化接入） */
  domId?: string
  /** 角标数字（>0 才画）。#170：AI 面板收起时审批请求不丢，靠这颗数字告诉用户"里面在等人回答" */
  badge?: number
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      data-dom-id={domId}
      data-badge={badge && badge > 0 ? String(badge) : undefined}
      className={cn(
        'wb-icon-btn',
        active && 'is-active',
      )}
    >
      {children}
      {badge && badge > 0 ? (
        <span
          aria-hidden
          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-solid px-1 text-caption font-semibold text-[var(--trae-text-onbrand)]"
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}

