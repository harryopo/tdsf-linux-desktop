/**
 * SshSettings — SSH 连接管理（真 IPC）
 *
 * // @ai-session: ai-claude-20260721-overnight
 * // @ai-task: ssh-settings-real-ipc
 *
 * 路由：/settings/ssh
 * 设计稿：settings-ssh.html 布局保留
 * 数据：useServerStore + ConnectDialog + sshConnect/sshDisconnect
 * 默认项：useSettingsStore sshDefaults / sshTimeout
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plug,
  Server,
  KeyRound,
  Settings,
  Shield,
  Plus,
  Pencil,
  Trash2,
  Link2,
  Unplug,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { message } from 'antd'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSlider } from '@/components/settings/SettingsSlider'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Switch } from '@/components/trae/Switch'
import { Input } from '@/components/trae/Input'
import ConnectDialog from '@/components/layout/ConnectDialog'
import { useServerStore } from '@/stores/server-store'
import { useSettingsStore } from '@/stores/settings-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { SshConfig } from '@shared/models'
import { cn } from '@/components/trae/utils'

function statusOf(
  serverId: string,
  connectionStates: Record<string, string>,
): 'online' | 'warning' | 'offline' | 'connecting' | 'error' {
  const st = connectionStates[serverId]
  if (st === 'connected') return 'online'
  if (st === 'connecting') return 'connecting'
  if (st === 'error') return 'error'
  return 'offline'
}

const STATUS_DOT: Record<string, string> = {
  online: 'bg-[var(--trae-status-success-default)]',
  connecting: 'bg-[var(--trae-status-alert-default)]',
  warning: 'bg-[var(--trae-status-alert-default)]',
  error: 'bg-[var(--trae-status-error-default)]',
  offline: 'bg-[var(--trae-text-tertiary)]',
}

const STATUS_LABEL: Record<string, string> = {
  online: '已连接',
  connecting: '连接中',
  warning: '告警',
  error: '错误',
  offline: '未连接',
}

export function SshSettings() {
  const servers = useServerStore((s) => s.servers)
  const connectionStates = useServerStore((s) => s.connectionStates)
  const sessionMap = useServerStore((s) => s.sessionMap)
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const addServer = useServerStore((s) => s.addServer)
  const updateServer = useServerStore((s) => s.updateServer)
  const removeServer = useServerStore((s) => s.removeServer)
  const setActiveSession = useServerStore((s) => s.setActiveSession)
  const setConnectionState = useServerStore((s) => s.setConnectionState)
  const setSessionMapping = useServerStore((s) => s.setSessionMapping)
  const clearSessionMapping = useServerStore((s) => s.clearSessionMapping)
  const hydrateFromMain = useServerStore((s) => s.hydrateFromMain)

  const sshDefaults = useSettingsStore((s) => s.sshDefaults)
  const sshTimeout = useSettingsStore((s) => s.sshTimeout)
  const setSshDefaults = useSettingsStore((s) => s.setSshDefaults)
  const setSshTimeout = useSettingsStore((s) => s.setSshTimeout)
  const saveSettings = useSettingsStore((s) => s.saveSettings)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SshConfig | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  // 默认连接参数（真 settings store）
  const [defaultPort, setDefaultPort] = useState(sshDefaults.port ?? 22)
  const [defaultUser, setDefaultUser] = useState(sshDefaults.username ?? 'root')
  const [connectTimeoutSec, setConnectTimeoutSec] = useState(
    Math.max(5, Math.round((sshTimeout || 30000) / 1000)),
  )
  const [keepAlive, setKeepAlive] = useState(60)
  const [compression, setCompression] = useState(true)
  const [x11Forward, setX11Forward] = useState(false)
  const [allowPasswordAuth, setAllowPasswordAuth] = useState(true)
  const [allowRootLogin, setAllowRootLogin] = useState(true)
  const [strictHostKeyCheck, setStrictHostKeyCheck] = useState(true)
  const [knownHostsPath, setKnownHostsPath] = useState('~/.ssh/known_hosts')

  useEffect(() => {
    void hydrateFromMain()
  }, [hydrateFromMain])

  useEffect(() => {
    setDefaultPort(sshDefaults.port ?? 22)
    setDefaultUser(sshDefaults.username ?? 'root')
    setConnectTimeoutSec(Math.max(5, Math.round((sshTimeout || 30000) / 1000)))
  }, [sshDefaults, sshTimeout])

  const showFb = useCallback((msg: string) => {
    setFeedback(msg)
    window.setTimeout(() => setFeedback(null), 2500)
  }, [])

  const connectOne = useCallback(
    async (server: SshConfig) => {
      if (!isElectronAPIAvailable()) {
        message.error('请在 Electron 桌面端运行')
        return
      }
      const existing = sessionMap[server.id]
      if (existing && connectionStates[server.id] === 'connected') {
        setActiveSession(existing)
        showFb(`已切换到 ${server.name || server.host}`)
        return
      }
      setBusyId(server.id)
      setConnectionState(server.id, 'connecting')
      try {
        const sessionId = await window.electronAPI.sshConnect(server)
        try {
          await window.electronAPI.sshShellStart(sessionId)
        } catch (e) {
          console.warn('[SshSettings] shell start', e)
          message.warning('Shell 启动失败，终端可能不可用')
        }
        setConnectionState(server.id, 'connected')
        setSessionMapping(server.id, sessionId)
        setActiveSession(sessionId)
        message.success(`已连接 ${server.name || server.host}`)
        showFb(`已连接 ${server.name || server.host}`)
      } catch (err) {
        setConnectionState(server.id, 'error')
        message.error(`连接失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusyId(null)
      }
    },
    [
      sessionMap,
      connectionStates,
      setActiveSession,
      setConnectionState,
      setSessionMapping,
      showFb,
    ],
  )

  const disconnectOne = useCallback(
    async (server: SshConfig) => {
      const sid = sessionMap[server.id]
      if (!sid) {
        setConnectionState(server.id, 'disconnected')
        showFb('该服务器未连接')
        return
      }
      setBusyId(server.id)
      try {
        if (isElectronAPIAvailable()) {
          await window.electronAPI.sshDisconnect(sid)
        }
        if (activeSessionId === sid) setActiveSession(null)
        clearSessionMapping(server.id)
        setConnectionState(server.id, 'disconnected')
        message.success(`已断开 ${server.name || server.host}`)
        showFb(`已断开 ${server.name || server.host}`)
      } catch (err) {
        message.error(`断开失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusyId(null)
      }
    },
    [
      sessionMap,
      activeSessionId,
      setActiveSession,
      clearSessionMapping,
      setConnectionState,
      showFb,
    ],
  )

  const handleSaveDialog = useCallback(
    async (config: SshConfig) => {
      const exists = servers.some((s) => s.id === config.id)
      if (exists) await updateServer(config.id, config)
      else await addServer(config)
      setDialogOpen(false)
      setEditing(null)
      showFb(exists ? '服务器已更新' : '服务器已添加')
      // 新建后直接连
      await connectOne(config)
    },
    [servers, addServer, updateServer, connectOne, showFb],
  )

  const handleDelete = useCallback(
    async (server: SshConfig) => {
      if (sessionMap[server.id] && connectionStates[server.id] === 'connected') {
        await disconnectOne(server)
      }
      await removeServer(server.id)
      showFb(`已删除 ${server.name || server.host}`)
    },
    [sessionMap, connectionStates, disconnectOne, removeServer, showFb],
  )

  const handleSaveDefaults = useCallback(async () => {
    setSshDefaults({
      ...sshDefaults,
      port: defaultPort,
      username: defaultUser,
      authType: allowPasswordAuth ? 'password' : 'privateKey',
    })
    setSshTimeout(connectTimeoutSec * 1000)
    await saveSettings()
    message.success('SSH 默认配置已保存')
    showFb('默认配置已保存')
  }, [
    sshDefaults,
    defaultPort,
    defaultUser,
    allowPasswordAuth,
    connectTimeoutSec,
    setSshDefaults,
    setSshTimeout,
    saveSettings,
    showFb,
  ])

  const sorted = useMemo(
    () =>
      [...servers].sort((a, b) =>
        (a.name || a.host).localeCompare(b.name || b.host),
      ),
    [servers],
  )

  return (
    <div>
      <SettingsPageHeader
        icon={Plug as LucideIcon}
        title="SSH 连接"
        desc="远程服务器连接与默认参数（已接真数据）"
      />

      <div className="flex flex-col gap-5 p-6">
        {/* Card 1: 服务器列表 — 真 store */}
        <SettingsCard
          icon={Server}
          title="服务器列表"
          tag={`${sorted.length} servers`}
        >
          {sorted.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-[var(--trae-text-tertiary)]">
              暂无服务器。点击下方添加并连接。
            </div>
          ) : (
            sorted.map((s, idx) => {
              const st = statusOf(s.id, connectionStates)
              const busy = busyId === s.id
              return (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center gap-3 py-3',
                    idx === sorted.length - 1
                      ? 'pb-0.5'
                      : 'border-b border-[var(--trae-border-neutral-l1)]',
                  )}
                >
                  <span
                    className={cn('size-2.5 shrink-0 rounded-full', STATUS_DOT[st])}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[var(--trae-text-default)]">
                      {s.name || s.host}
                    </div>
                    <div className="mt-0.5 font-mono text-[12px] text-[var(--trae-text-secondary)]">
                      {s.username}@{s.host}:{s.port}
                      <span className="ml-2 text-[var(--trae-text-tertiary)]">
                        {STATUS_LABEL[st]}
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-2 py-1 text-[11px] text-[var(--trae-text-secondary)]">
                    <KeyRound className="size-3.5 text-[var(--trae-icon-secondary)]" />
                    {s.authType === 'privateKey' ? '密钥' : '密码'}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    {st === 'online' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void disconnectOne(s)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] font-medium text-[var(--trae-status-error-default)] hover:bg-[var(--trae-status-error-surface-l1)] disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Unplug className="size-3.5" />
                        )}
                        断开
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void connectOne(s)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-3 text-[12px] font-medium text-[var(--trae-text-onbrand)] hover:bg-[var(--trae-bg-brand-hover)] disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Link2 className="size-3.5" />
                        )}
                        连接
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(s)
                        setDialogOpen(true)
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] font-medium text-[var(--trae-text-default)] hover:bg-[var(--trae-bg-overlay-l1)]"
                    >
                      <Pencil className="size-3.5" />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(s)}
                      className="inline-flex h-8 items-center gap-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-2.5 text-[12px] text-[var(--trae-status-error-default)] hover:bg-[var(--trae-status-error-surface-l1)]"
                      title="删除"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
          <div className="flex flex-wrap items-center gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-4 text-[13px] font-medium text-[var(--trae-text-onbrand)] hover:bg-[var(--trae-bg-brand-hover)]"
            >
              <Plus className="size-4" />
              添加服务器
            </button>
            {feedback && (
              <span className="text-[12px] text-[var(--trae-status-success-default)]">
                {feedback}
              </span>
            )}
          </div>
        </SettingsCard>

        {/* Card 2: 密钥说明（真实密钥走连接对话框路径字段） */}
        <SettingsCard icon={KeyRound} title="SSH 密钥" tag="via connect dialog">
          <div className="space-y-2 py-2 text-[13px] leading-5 text-[var(--trae-text-secondary)]">
            <p>
              密钥认证请在「添加/编辑服务器」中选择<strong className="text-[var(--trae-text-default)]">密钥文件</strong>，
              填写私钥路径与口令。凭证由主进程 safeStorage 加密保存，不落明文 localStorage。
            </p>
            <p className="text-[12px] text-[var(--trae-text-tertiary)]">
              工作台顶栏「新建连接」与本页共用同一套 ConnectDialog 与 server-store。
            </p>
          </div>
        </SettingsCard>

        {/* Card 3: 连接默认 — 真 settings store */}
        <SettingsCard icon={Settings} title="连接默认设置" tag="connection.defaults">
          <SettingsRow
            label="默认端口"
            desc="新建连接预填端口"
            control={
              <Input
                type="number"
                value={defaultPort}
                onChange={(e) => setDefaultPort(Number(e.target.value) || 22)}
                className="h-8 w-[96px] justify-center text-center font-mono text-[13px]"
              />
            }
          />
          <SettingsRow
            label="默认用户"
            desc="新建连接预填用户名"
            control={
              <Input
                value={defaultUser}
                onChange={(e) => setDefaultUser(e.target.value)}
                className="h-8 w-[160px] font-mono text-[13px]"
              />
            }
          />
          <SettingsRow
            label="连接超时"
            desc="建立连接超时（秒）"
            control={
              <SettingsSlider
                value={connectTimeoutSec}
                min={5}
                max={120}
                step={5}
                suffix="s"
                onValueChange={setConnectTimeoutSec}
              />
            }
          />
          <SettingsRow
            label="Keep Alive 间隔"
            desc="心跳间隔（展示项，连接层默认启用）"
            control={
              <SettingsSlider
                value={keepAlive}
                min={0}
                max={300}
                step={10}
                suffix="s"
                onValueChange={setKeepAlive}
              />
            }
          />
          <SettingsRow
            label="压缩传输"
            desc="SSH 数据压缩（展示偏好）"
            control={<Switch checked={compression} onCheckedChange={setCompression} />}
          />
          <SettingsRow
            label="X11 转发"
            desc="图形转发（展示偏好）"
            control={<Switch checked={x11Forward} onCheckedChange={setX11Forward} />}
            isLast
          />
        </SettingsCard>

        {/* Card 4: 安全偏好 */}
        <SettingsCard icon={Shield} title="安全设置" tag="security">
          <SettingsRow
            label="允许密码认证"
            desc="默认认证方式是否允许密码"
            control={
              <Switch checked={allowPasswordAuth} onCheckedChange={setAllowPasswordAuth} />
            }
          />
          <SettingsRow
            label="允许 Root 登录"
            desc="默认用户可为 root"
            control={<Switch checked={allowRootLogin} onCheckedChange={setAllowRootLogin} />}
          />
          <SettingsRow
            label="严格主机密钥检查"
            desc="展示偏好（连接层校验策略）"
            control={
              <Switch
                checked={strictHostKeyCheck}
                onCheckedChange={setStrictHostKeyCheck}
              />
            }
          />
          <SettingsRow
            label="Known Hosts 路径"
            desc="主机指纹文件（展示）"
            control={
              <Input
                value={knownHostsPath}
                onChange={(e) => setKnownHostsPath(e.target.value)}
                className="h-8 w-[280px] font-mono text-[12px]"
              />
            }
            isLast
          />
        </SettingsCard>

        <SettingsActionBar
          saveLabel="保存默认配置"
          onSave={() => {
            void handleSaveDefaults()
          }}
        />
      </div>

      <ConnectDialog
        open={dialogOpen}
        server={editing}
        onSave={(cfg) => void handleSaveDialog(cfg)}
        onCancel={() => {
          setDialogOpen(false)
          setEditing(null)
        }}
      />
    </div>
  )
}

export default SshSettings
