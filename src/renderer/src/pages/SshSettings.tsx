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
import { message, Modal, Form, Input as AntdInput, Select } from 'antd'
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
import type { SshConfig, SshKeyPair, GenerateKeyPairRequest } from '@shared/models'
import { cn } from '@/components/trae/utils'
import './SshSettings.css'

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
  online: 'ssh-dot-online',
  connecting: 'ssh-dot-connecting',
  warning: 'ssh-dot-warning',
  error: 'ssh-dot-error',
  offline: 'ssh-dot-offline',
}

const STATUS_LABEL: Record<ServerStatus, string> = {
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

  // Phase M：SSH 密钥管理状态
  // keyPairs 来自主进程扫描 ~/.ssh/（真实文件列表），非派生自服务器配置
  const [keyPairs, setKeyPairs] = useState<SshKeyPair[]>([])
  const [genModalOpen, setGenModalOpen] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [genForm] = Form.useForm<GenerateKeyPairRequest>()

  // Card 3: 连接默认设置（真 settings store）
  const [defaultPort, setDefaultPort] = useState(sshDefaults.port ?? 22)
  const [defaultUser, setDefaultUser] = useState(sshDefaults.username ?? 'root')
  const [connectTimeoutSec, setConnectTimeoutSec] = useState(
    Math.max(5, Math.round((sshTimeout || 30000) / 1000)),
  )
  // K.3：keepAlive 直接联动 store（不再使用本地 state），与后端默认 30s 对齐
  const keepAliveIntervalSec = sshDefaults.keepAliveIntervalSec ?? 30
  const [compression, setCompression] = useState(true)
  const [x11Forward, setX11Forward] = useState(false)

  // Card 4: 安全设置（设计稿默认：密码认证 off / Root on / 严格 on / known_hosts 路径）
  const [allowPasswordAuth, setAllowPasswordAuth] = useState(false)
  const [allowRootLogin, setAllowRootLogin] = useState(true)
  // Phase L：strictHostKeyCheck / knownHostsPath 从 store 初始化，handleSaveDefaults 时写回 store
  const [strictHostKeyCheck, setStrictHostKeyCheck] = useState(
    sshDefaults.strictHostKeyCheck ?? true,
  )
  const [knownHostsPath, setKnownHostsPath] = useState(
    sshDefaults.knownHostsPath ?? '~/.ssh/known_hosts',
  )

  useEffect(() => {
    void hydrateFromMain()
  }, [hydrateFromMain])

  useEffect(() => {
    setDefaultPort(sshDefaults.port ?? 22)
    setDefaultUser(sshDefaults.username ?? 'root')
    setConnectTimeoutSec(Math.max(5, Math.round((sshTimeout || 30000) / 1000)))
    // Phase L：同步 store 中的主机密钥校验配置
    setStrictHostKeyCheck(sshDefaults.strictHostKeyCheck ?? true)
    setKnownHostsPath(sshDefaults.knownHostsPath ?? '~/.ssh/known_hosts')
  }, [sshDefaults, sshTimeout])

  const showFb = useCallback((msg: string) => {
    setFeedback(msg)
    window.setTimeout(() => setFeedback(null), 2500)
  }, [])

  /**
   * 刷新 SSH 密钥列表（Phase M）
   *
   * 调用 ssh:list-keypairs IPC 扫描 ~/.ssh/ 目录，获取真实密钥文件列表。
   * 在删除/上传/生成操作后调用以反映最新状态。
   */
  const refreshKeys = useCallback(async () => {
    if (!isElectronAPIAvailable()) return
    try {
      const list = await window.electronAPI.sshListKeypairs()
      setKeyPairs(list)
    } catch (err) {
      console.error('[SshSettings] 加载密钥列表失败:', err)
    }
  }, [])

  // Phase M：首次加载时扫描 ~/.ssh/ 密钥列表
  useEffect(() => {
    void refreshKeys()
  }, [refreshKeys])

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
        // K.3：合并 keepAlive 配置到 SshConfig（滑块值 > 0 才启用心跳）
        // Phase L：合并 strictHostKeyCheck / knownHostsPath 到 SshConfig，
        //          主进程 buildConnectOptions 会据此注入 hostVerifier
        const mergedConfig: SshConfig = {
          ...server,
          keepAlive: keepAliveIntervalSec > 0,
          keepAliveIntervalSec,
          strictHostKeyCheck,
          knownHostsPath,
        }
        const sessionId = await window.electronAPI.sshConnect(mergedConfig)
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
      keepAliveIntervalSec,
      strictHostKeyCheck,
      knownHostsPath,
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
      // Phase L：主机密钥校验配置写回 store
      strictHostKeyCheck,
      knownHostsPath,
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
    strictHostKeyCheck,
    knownHostsPath,
    setSshDefaults,
    setSshTimeout,
    saveSettings,
    showFb,
  ])

  const handleResetDefaults = useCallback(() => {
    setDefaultPort(22)
    setDefaultUser('root')
    setConnectTimeoutSec(30)
    // K.3：重置 keepAlive 到后端默认 30s（与 DEFAULT_SSH_DEFAULTS 一致）
    setSshDefaults({ keepAliveIntervalSec: 30 })
    setCompression(true)
    setX11Forward(false)
    setAllowPasswordAuth(false)
    setAllowRootLogin(true)
    setStrictHostKeyCheck(true)
    setKnownHostsPath('~/.ssh/known_hosts')
  }, [setSshDefaults])

  /** 按名称排序的服务器列表 */
  const sortedServers = useMemo(
    () =>
      [...servers].sort((a, b) =>
        (a.name || a.host).localeCompare(b.name || b.host),
      ),
    [servers],
  )

  const ipcAvailable = isElectronAPIAvailable()

  return (
    <div>
      <SettingsPageHeader
        icon={Plug as LucideIcon}
        title="SSH 连接"
        desc="远程服务器连接与密钥管理"
      />

      <div className="ssh-panel-content">
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
                    'ssh-server-row',
                    idx === sortedServers.length - 1 && 'ssh-server-row--last',
                  )}
                >
                  <span
                    className={cn('ssh-server-row__dot', STATUS_DOT_CLASS[st])}
                    aria-label={STATUS_LABEL[st]}
                  />
                  <div className="ssh-server-row__main">
                    <div className="ssh-server-row__name">
                      {s.name || s.host}
                    </div>
                    <div className="ssh-server-row__ip">
                      {s.host}
                      <span className="ssh-server-row__ip-status">
                        {STATUS_LABEL[st]}
                      </span>
                    </div>
                  </div>
                  <span className="ssh-server-row__type">
                    {isKeyAuth ? (
                      <KeyRound className="size-3" />
                    ) : (
                      <Lock className="size-3" />
                    )}
                    {isKeyAuth ? '密钥' : '密码'}
                  </span>
                  <div className="ssh-server-row__actions">
                    {st === 'online' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void disconnectOne(s)}
                        aria-label={`断开 ${s.name || s.host}`}
                        className="ssh-btn-danger ssh-btn-press"
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
                        className="ssh-btn-primary ssh-btn-primary-sm ssh-btn-press"
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
                      className="ssh-btn-ghost ssh-btn-press"
                    >
                      <Pencil className="size-3" />
                      编辑
                    </button>
                    {/* M.1：删除服务器按钮（Modal.confirm 确认后调用 removeServer） */}
                    <button
                      type="button"
                      onClick={() => {
                        Modal.confirm({
                          title: '删除服务器',
                          content: `确定要删除服务器「${s.name || s.host}」吗？此操作不可撤销。`,
                          okText: '删除',
                          okType: 'danger',
                          cancelText: '取消',
                          onOk: async () => {
                            await removeServer(s.id)
                            message.success('服务器已删除')
                            showFb('服务器已删除')
                          },
                        })
                      }}
                      aria-label={`删除 ${s.name || s.host}`}
                      className="ssh-btn-danger ssh-btn-press"
                    >
                      <Trash2 className="size-3" />
                      删除
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {/* 添加服务器按钮 */}
          <div className="ssh-card-footer">
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
              className="ssh-btn-primary ssh-btn-press"
            >
              <Plus className="size-3.5" />
              添加服务器
            </button>
            {feedback && (
              <span className="ssh-feedback">
                {feedback}
              </span>
            )}
          </div>
        </SettingsCard>

        {/* ===== Card 2: SSH 密钥管理 ===== */}
        <SettingsCard
          icon={KeyRound}
          title="SSH 密钥管理"
          tag={`${keyPairs.length} keys`}
        >
          {!ipcAvailable ? (
            <Empty
              icon={KeyRound}
              title="无法加载密钥"
              description="Electron IPC 不可用，请在桌面端运行以管理 SSH 密钥。"
            />
          ) : keyPairs.length === 0 ? (
            <Empty
              icon={KeyRound}
              title="暂无 SSH 密钥"
              description="点击下方「上传密钥」或「生成新密钥」来管理 ~/.ssh/ 目录下的 SSH 密钥。"
            />
          ) : (
            keyPairs.map((k, idx) => (
              <div
                key={k.name}
                className={cn(
                  'ssh-key-row',
                  idx === keyPairs.length - 1 && 'ssh-key-row--last',
                )}
              >
                <div className="ssh-key-row__icon">
                  <KeyRound className="size-4" />
                </div>
                <div className="ssh-key-row__main">
                  <div className="ssh-key-row__name">
                    {k.name}
                  </div>
                  <div className="ssh-key-row__meta">
                    {k.type.toUpperCase()} · {k.privateKeyPath}
                  </div>
                </div>
                {/* M.2：删除密钥按钮（Modal.confirm + sshDeleteKeyring + refreshKeys） */}
                <button
                  type="button"
                  onClick={() => {
                    Modal.confirm({
                      title: '删除密钥',
                      content: `确定要删除密钥「${k.name}」吗？使用该密钥的服务器连接将受影响。`,
                      okText: '删除',
                      okType: 'danger',
                      cancelText: '取消',
                      onOk: async () => {
                        try {
                          const res = await window.electronAPI.sshDeleteKeyring(k.name)
                          if (res.success) {
                            message.success('密钥已删除')
                            await refreshKeys()
                          } else {
                            message.error(`删除失败: ${res.error || '未知错误'}`)
                          }
                        } catch (err) {
                          message.error(
                            `删除失败: ${err instanceof Error ? err.message : String(err)}`,
                          )
                        }
                      },
                    })
                  }}
                  aria-label={`删除密钥 ${k.name}`}
                  className="ssh-btn-danger ssh-btn-press"
                >
                  <Trash2 className="size-3" />
                  删除
                </button>
              </div>
            ))
          )}

          {/* 上传 / 生成按钮 */}
          <div className="ssh-card-footer-row">
            {/* M.3：上传私钥按钮（sshUploadKeypair，用户取消静默处理） */}
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await window.electronAPI.sshUploadKeypair()
                  if (res.canceled) return // 用户取消文件选择，静默
                  if (res.success) {
                    message.success('密钥上传成功')
                    await refreshKeys()
                  } else {
                    message.error(`上传失败: ${res.error || '未知错误'}`)
                  }
                } catch (err) {
                  message.error(
                    `上传失败: ${err instanceof Error ? err.message : String(err)}`,
                  )
                }
              }}
              className="ssh-btn-secondary ssh-btn-press"
            >
              <Upload className="size-3.5" />
              上传密钥
            </button>
            {/* M.4：生成新密钥按钮（打开 Form Modal → sshGenerateKeypair） */}
            <button
              type="button"
              onClick={() => {
                genForm.resetFields()
                setGenModalOpen(true)
              }}
              className="ssh-btn-primary ssh-btn-press"
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
                className="ssh-input-num"
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
                className="ssh-input-user"
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
            desc="心跳包发送间隔（0 = 关闭，重启连接后生效）"
            control={
              <SettingsSlider
                value={keepAliveIntervalSec}
                min={0}
                max={300}
                step={10}
                suffix="s"
                onValueChange={(v) =>
                  setSshDefaults({ keepAliveIntervalSec: v })
                }
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
                className="ssh-input-path"
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

      {/* M.4：生成 SSH 密钥对 Modal（Form + sshGenerateKeypair） */}
      <Modal
        title="生成 SSH 密钥"
        open={genModalOpen}
        onCancel={() => setGenModalOpen(false)}
        confirmLoading={genLoading}
        okText="生成"
        cancelText="取消"
        onOk={async () => {
          try {
            const values = await genForm.validateFields()
            setGenLoading(true)
            const res = await window.electronAPI.sshGenerateKeypair({
              type: values.type,
              name: values.name,
              passphrase: values.passphrase || undefined,
              comment: values.comment || undefined,
            })
            if (res.success && res.keyPair) {
              message.success(`密钥 ${res.keyPair.name} 已生成`)
              setGenModalOpen(false)
              await refreshKeys()
            } else {
              message.error(`生成失败: ${res.error || '未知错误'}`)
            }
          } catch (err) {
            // antd Form.validateFields reject 时返回 errorFields 对象，不关闭弹窗
            if (err && typeof err === 'object' && 'errorFields' in err) {
              return
            }
            message.error(
              `生成失败: ${err instanceof Error ? err.message : String(err)}`,
            )
          } finally {
            setGenLoading(false)
          }
        }}
      >
        <Form
          form={genForm}
          layout="vertical"
          initialValues={{ type: 'ed25519' }}
          className="ssh-gen-form"
        >
          <Form.Item
            name="type"
            label="密钥类型"
            rules={[{ required: true, message: '请选择密钥类型' }]}
          >
            <Select
              options={[
                { value: 'ed25519', label: 'ED25519（推荐，更安全更快）' },
                { value: 'rsa', label: 'RSA 4096（兼容性最好）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="密钥名称"
            rules={[
              { required: true, message: '请输入密钥名称' },
              {
                pattern: /^[a-zA-Z0-9_\-]+$/,
                message: '仅允许字母、数字、下划线、连字符',
              },
            ]}
          >
            <AntdInput placeholder="例如 id_ed25519" />
          </Form.Item>
          <Form.Item name="passphrase" label="口令（可选）">
            <AntdInput.Password placeholder="留空表示无口令" />
          </Form.Item>
          <Form.Item name="comment" label="注释（可选）">
            <AntdInput placeholder="例如 user@host" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default SshSettings
