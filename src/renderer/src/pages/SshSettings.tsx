/**
 * SshSettings — SSH 连接管理（1:1 复刻 settings-ssh.html + 真 IPC）
 *
 * 路由：/settings/ssh
 * 设计稿：tdsf-linux-redesign/pages/settings-ssh.html
 *
 * 4 个 Card:
 * - Card 1: 已连接服务器（列表 + 添加按钮）
 * - Card 2: SSH 密钥管理（密钥列表 + 上传/生成按钮）
 * - Card 3: 连接默认设置（端口/用户/超时/Keep Alive/压缩/X11）
 * - Card 4: 安全设置（密码认证/Root/严格主机密钥/Known Hosts）
 *
 * H1 修复：通过 SettingsLayout 共享 9 项左导航（nav-ssh 激活）
 * H3 修复：密码字段脱敏
 *  - 服务器行只显示「密码」「密钥」标签，不显示密码值（设计稿如此）
 *  - ConnectDialog 中密码字段使用 antd Input.Password（脱敏 ••••••，眼睛图标切换可见）
 *  - Card 4「允许密码认证」默认关闭（更安全，对应设计稿 unchecked）
 *  - 服务器列表 password 字段永不在本页直接渲染
 *
 * 数据：useServerStore + useSettingsStore（真 IPC，无 mock）
 * IPC 不可用：Card 内显示 Empty 组件（spec REMOVED 要求）
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
  Upload,
  Loader2,
  Lock,
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
import { Empty } from '@/components/trae/Empty'
import ConnectDialog from '@/components/layout/ConnectDialog'
import { useServerStore } from '@/stores/server-store'
import { useSettingsStore } from '@/stores/settings-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { SshConfig } from '@shared/models'
import { cn } from '@/components/trae/utils'

/** 服务器连接状态 → 状态点颜色 + 中文标签 */
type ServerStatus = 'online' | 'connecting' | 'warning' | 'error' | 'offline'

function statusOf(
  serverId: string,
  connectionStates: Record<string, string>,
): ServerStatus {
  const st = connectionStates[serverId]
  if (st === 'connected') return 'online'
  if (st === 'connecting') return 'connecting'
  if (st === 'error') return 'error'
  return 'offline'
}

const STATUS_DOT_CLASS: Record<ServerStatus, string> = {
  online: 'bg-[var(--trae-status-success-default)]',
  connecting: 'bg-[var(--trae-status-alert-default)]',
  warning: 'bg-[var(--trae-status-alert-default)]',
  error: 'bg-[var(--trae-status-error-default)]',
  offline: 'bg-[var(--trae-text-tertiary)]',
}

const STATUS_LABEL: Record<ServerStatus, string> = {
  online: '已连接',
  connecting: '连接中',
  warning: '告警',
  error: '错误',
  offline: '未连接',
}

/** 从私钥路径提取 basename 作为密钥名（如 ~/.ssh/id_rsa → id_rsa） */
function keyNameFromPath(p: string | undefined): string {
  if (!p) return 'unknown_key'
  const trimmed = p.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || 'unknown_key'
}

/** 从私钥路径推断密钥类型（用于 meta 显示） */
function keyTypeFromPath(p: string | undefined): string {
  if (!p) return 'Private Key'
  const name = keyNameFromPath(p).toLowerCase()
  if (name.includes('ed25519')) return 'ED25519'
  if (name.includes('ecdsa')) return 'ECDSA'
  if (name.includes('dsa')) return 'DSA'
  if (name.includes('rsa')) return 'RSA'
  return 'Private Key'
}

export function SshSettings() {
  const servers = useServerStore((s) => s.servers)
  const connectionStates = useServerStore((s) => s.connectionStates)
  const sessionMap = useServerStore((s) => s.sessionMap)
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const addServer = useServerStore((s) => s.addServer)
  const updateServer = useServerStore((s) => s.updateServer)
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

  // Card 3: 连接默认设置（真 settings store）
  const [defaultPort, setDefaultPort] = useState(sshDefaults.port ?? 22)
  const [defaultUser, setDefaultUser] = useState(sshDefaults.username ?? 'root')
  const [connectTimeoutSec, setConnectTimeoutSec] = useState(
    Math.max(5, Math.round((sshTimeout || 30000) / 1000)),
  )
  const [keepAlive, setKeepAlive] = useState(60)
  const [compression, setCompression] = useState(true)
  const [x11Forward, setX11Forward] = useState(false)

  // Card 4: 安全设置（设计稿默认：密码认证 off / Root on / 严格 on / known_hosts 路径）
  const [allowPasswordAuth, setAllowPasswordAuth] = useState(false)
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
      await connectOne(config)
    },
    [servers, addServer, updateServer, connectOne, showFb],
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

  const handleResetDefaults = useCallback(() => {
    setDefaultPort(22)
    setDefaultUser('root')
    setConnectTimeoutSec(30)
    setKeepAlive(60)
    setCompression(true)
    setX11Forward(false)
    setAllowPasswordAuth(false)
    setAllowRootLogin(true)
    setStrictHostKeyCheck(true)
    setKnownHostsPath('~/.ssh/known_hosts')
  }, [])

  /** 按名称排序的服务器列表 */
  const sortedServers = useMemo(
    () =>
      [...servers].sort((a, b) =>
        (a.name || a.host).localeCompare(b.name || b.host),
      ),
    [servers],
  )

  /** 派生密钥列表：从 authType=privateKey 的服务器提取（去重，按路径） */
  const derivedKeys = useMemo(() => {
    const map = new Map<string, { name: string; type: string; path: string }>()
    for (const s of servers) {
      if (s.authType === 'privateKey' && s.privateKeyPath) {
        const path = s.privateKeyPath
        const name = keyNameFromPath(path)
        if (!map.has(name)) {
          map.set(name, { name, type: keyTypeFromPath(path), path })
        }
      }
    }
    return Array.from(map.values())
  }, [servers])

  const ipcAvailable = isElectronAPIAvailable()

  return (
    <div>
      <SettingsPageHeader
        icon={Plug as LucideIcon}
        title="SSH 连接"
        desc="远程服务器连接与密钥管理"
      />

      <div className="flex flex-col gap-5 p-6">
        {/* ===== Card 1: 已连接服务器 ===== */}
        <SettingsCard
          icon={Server}
          title="已连接服务器"
          tag={`${sortedServers.length} servers`}
        >
          {!ipcAvailable ? (
            <Empty
              icon={Server}
              title="无法访问服务器列表"
              description="Electron IPC 不可用，请在桌面端运行以管理 SSH 连接。"
            />
          ) : sortedServers.length === 0 ? (
            <Empty
              icon={Server}
              title="暂无服务器"
              description="点击下方「添加服务器」开始配置 SSH 连接。"
            />
          ) : (
            sortedServers.map((s, idx) => {
              const st = statusOf(s.id, connectionStates)
              const busy = busyId === s.id
              const isKeyAuth = s.authType === 'privateKey'
              return (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center gap-3 py-3',
                    idx === sortedServers.length - 1
                      ? 'pb-0.5'
                      : 'border-b border-[var(--trae-border-neutral-l1)]',
                  )}
                >
                  {/* 状态点 */}
                  <span
                    className={cn('size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[st])}
                    aria-label={STATUS_LABEL[st]}
                  />
                  {/* 名称 + IP（脱敏：不显示密码值，仅显示主机信息） */}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium leading-[16px] text-[var(--trae-text-default)]">
                      {s.name || s.host}
                    </div>
                    <div className="mt-px font-mono text-[10px] leading-[14px] text-[var(--trae-text-secondary)]">
                      {s.host}
                      <span className="ml-2 text-[var(--trae-text-tertiary)]">
                        {STATUS_LABEL[st]}
                      </span>
                    </div>
                  </div>
                  {/* 类型标签：密钥 / 密码（H3 修复：只显示标签，不显示密码值） */}
                  <span className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-2 py-1 text-[10px] text-[var(--trae-text-secondary)]">
                    {isKeyAuth ? (
                      <KeyRound className="size-3 text-[var(--trae-icon-secondary)]" />
                    ) : (
                      <Lock className="size-3 text-[var(--trae-icon-secondary)]" />
                    )}
                    {isKeyAuth ? '密钥' : '密码'}
                  </span>
                  {/* 操作按钮 */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {st === 'online' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void disconnectOne(s)}
                        aria-label={`断开 ${s.name || s.host}`}
                        className="inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-2.5 text-[10px] font-medium text-[var(--trae-status-error-default)] transition-colors hover:bg-[var(--trae-status-error-surface-l1)] disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Unplug className="size-3" />
                        )}
                        断开
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void connectOne(s)}
                        aria-label={`连接 ${s.name || s.host}`}
                        className="inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-2.5 text-[10px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)] disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Link2 className="size-3" />
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
                      aria-label={`编辑 ${s.name || s.host}`}
                      className="inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-2 text-[10px] font-medium text-[var(--trae-text-default)] transition-colors hover:bg-[var(--trae-bg-overlay-l1)]"
                    >
                      <Pencil className="size-3" />
                      编辑
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {/* 添加服务器按钮 */}
          <div className="flex flex-wrap items-center gap-3 pt-3">
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-4 text-[11px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)]"
            >
              <Plus className="size-3.5" />
              添加服务器
            </button>
            {feedback && (
              <span className="text-[11px] text-[var(--trae-status-success-default)]">
                {feedback}
              </span>
            )}
          </div>
        </SettingsCard>

        {/* ===== Card 2: SSH 密钥管理 ===== */}
        <SettingsCard
          icon={KeyRound}
          title="SSH 密钥管理"
          tag={`${derivedKeys.length} keys`}
        >
          {!ipcAvailable ? (
            <Empty
              icon={KeyRound}
              title="无法加载密钥"
              description="Electron IPC 不可用，请在桌面端运行以管理 SSH 密钥。"
            />
          ) : derivedKeys.length === 0 ? (
            <Empty
              icon={KeyRound}
              title="暂无 SSH 密钥"
              description="添加服务器时选择「密钥文件认证」并填写私钥路径，密钥将自动出现在此列表。"
            />
          ) : (
            derivedKeys.map((k, idx) => (
              <div
                key={k.name}
                className={cn(
                  'flex items-center gap-3 py-3',
                  idx === derivedKeys.length - 1
                    ? 'pb-0.5'
                    : 'border-b border-[var(--trae-border-neutral-l1)]',
                )}
              >
                {/* 密钥图标 */}
                <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)]">
                  <KeyRound className="size-4 text-[var(--trae-icon-brand)]" />
                </div>
                {/* 密钥名 + meta */}
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] font-medium text-[var(--trae-text-default)]">
                    {k.name}
                  </div>
                  <div className="mt-px text-[10px] text-[var(--trae-text-secondary)]">
                    {k.type} · {k.path}
                  </div>
                </div>
                {/* 删除按钮 */}
                <button
                  type="button"
                  aria-label={`删除密钥 ${k.name}`}
                  className="inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-2.5 text-[10px] font-medium text-[var(--trae-status-error-default)] transition-colors hover:bg-[var(--trae-status-error-surface-l1)]"
                >
                  <Trash2 className="size-3" />
                  删除
                </button>
              </div>
            ))
          )}

          {/* 上传 / 生成按钮 */}
          <div className="flex gap-2 pt-3">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3.5 text-[11px] font-medium text-[var(--trae-text-default)] transition-colors hover:bg-[var(--trae-bg-overlay-l1)]"
            >
              <Upload className="size-3.5" />
              上传密钥
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-3.5 text-[11px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)]"
            >
              <Plus className="size-3.5" />
              生成新密钥
            </button>
          </div>
        </SettingsCard>

        {/* ===== Card 3: 连接默认设置 ===== */}
        <SettingsCard
          icon={Settings}
          title="连接默认设置"
          tag="connection.defaults"
        >
          <SettingsRow
            label="默认端口"
            desc="SSH 连接使用的默认端口号"
            control={
              <Input
                type="number"
                value={defaultPort}
                onChange={(e) => setDefaultPort(Number(e.target.value) || 22)}
                className="h-[30px] w-[88px] justify-center text-center font-mono text-[13px]"
              />
            }
          />
          <SettingsRow
            label="默认用户"
            desc="SSH 连接使用的默认用户名"
            control={
              <Input
                value={defaultUser}
                onChange={(e) => setDefaultUser(e.target.value)}
                className="h-[30px] min-w-[140px] font-mono text-[13px]"
              />
            }
          />
          <SettingsRow
            label="连接超时"
            desc="建立连接的超时时间"
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
            desc="心跳包发送间隔"
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
            desc="启用 SSH 连接数据压缩"
            control={<Switch checked={compression} onCheckedChange={setCompression} />}
          />
          <SettingsRow
            label="X11 转发"
            desc="允许 X11 图形界面转发"
            control={<Switch checked={x11Forward} onCheckedChange={setX11Forward} />}
            isLast
          />
        </SettingsCard>

        {/* ===== Card 4: 安全设置 ===== */}
        <SettingsCard
          icon={Shield}
          title="安全设置"
          tag="security"
        >
          <SettingsRow
            label="允许密码认证"
            desc="允许使用密码方式登录服务器"
            control={
              <Switch checked={allowPasswordAuth} onCheckedChange={setAllowPasswordAuth} />
            }
          />
          <SettingsRow
            label="允许 Root 登录"
            desc="允许以 root 用户身份直接登录"
            control={<Switch checked={allowRootLogin} onCheckedChange={setAllowRootLogin} />}
          />
          <SettingsRow
            label="严格主机密钥检查"
            desc="首次连接时严格验证服务器指纹"
            control={
              <Switch
                checked={strictHostKeyCheck}
                onCheckedChange={setStrictHostKeyCheck}
              />
            }
          />
          <SettingsRow
            label="Known Hosts 文件路径"
            desc="已知主机指纹存储文件位置"
            control={
              <Input
                value={knownHostsPath}
                onChange={(e) => setKnownHostsPath(e.target.value)}
                className="h-[30px] min-w-[280px] bg-[var(--trae-bg-base-default)] font-mono text-[12px] text-[var(--trae-text-secondary)]"
              />
            }
            isLast
          />
        </SettingsCard>

        {/* ===== ActionBar ===== */}
        <SettingsActionBar
          saveLabel="保存设置"
          onSave={() => {
            void handleSaveDefaults()
          }}
          onReset={handleResetDefaults}
        />
      </div>

      {/* ===== SSH 连接对话框（密码字段使用 antd Input.Password，H3 修复） ===== */}
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
