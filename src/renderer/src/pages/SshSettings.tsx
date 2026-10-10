/**
 * SshSettings — SSH 连接管理（1:1 复刻 settings-ssh.html + 真 IPC）
 * 路由：/settings/ssh ｜ 设计稿：tdsf-linux-redesign/pages/settings-ssh.html
 *
 * 4 个 Card（M5 Task 7 已拆分为独立组件）：
 * - ServerCard：已连接服务器（列表 + 添加/编辑/删除/连接/断开）
 * - KeyCard：SSH 密钥管理（列表 + 上传/生成/删除）
 * - DefaultsCard：连接默认设置（端口/用户/超时/Keep Alive/压缩/X11）
 * - SecurityCard：安全设置（密码认证/Root/严格主机密钥/Known Hosts）
 *
 * H1：通过 SettingsLayout 共享 9 项左导航（nav-ssh 激活）
 * H3：密码字段脱敏（口令只在 ConnectDialog 的 ui 层 Input 里输入，antd 已于 2026-10-07 退出渲染层；
 *     服务器行只显示「密码」「密钥」标签；
 *     Card 4「允许密码认证」默认 off；password 永不在本页直接渲染）
 *
 * 数据：useServerStore + useSettingsStore（真 IPC，无 mock）
 * IPC 不可用：Card 内显示 Empty 组件（spec REMOVED 要求）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Dialog, DialogContent, Field, Segmented, TextInput, confirmDialog } from '@/ui'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { settingsHeader } from './settings-sections'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import ConnectDialog from '@/components/layout/ConnectDialog'
import { ServerCard } from '@/components/settings/ssh/ServerCard'
import { KeyCard } from '@/components/settings/ssh/KeyCard'
import { DefaultsCard } from '@/components/settings/ssh/DefaultsCard'
import { SecurityCard } from '@/components/settings/ssh/SecurityCard'
import { useServerStore } from '@/stores/server-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { ensureShellForSession, shellTitleOf } from '@/terminal/shell-launcher'
import { useSettingsStore } from '@/stores/settings-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { usePersistentState } from '@/hooks/usePersistentState'
import type { ServerListItem, SshConfig, SshKeyPair, GenerateKeyPairRequest } from '@shared/models'
import './SshSettings.css'

/** 生成密钥弹窗的表单态（2026-10-07 从 antd Form 换成本地状态，规则一条没减） */
interface GenFormState {
  type: 'ed25519' | 'rsa'
  name: string
  passphrase: string
  comment: string
}

const BLANK_GEN_FORM: GenFormState = { type: 'ed25519', name: '', passphrase: '', comment: '' }

/** 密钥名称只允许文件安全的字符——生成出来的就是 ~/.ssh/<name>，带斜杠或空格会把密钥写到别处 */
const KEY_NAME_PATTERN = /^[a-zA-Z0-9_\-]+$/

function validateGenForm(f: GenFormState): Partial<Record<keyof GenFormState, string>> {
  const errors: Partial<Record<keyof GenFormState, string>> = {}
  if (!f.name.trim()) errors.name = '请输入密钥名称'
  else if (!KEY_NAME_PATTERN.test(f.name.trim())) errors.name = '仅允许字母、数字、下划线、连字符'
  return errors
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
  // 编辑目标是 ServerListItem：里面没有凭据，对话框因此永远从空白开始（P0-3）
  const [editing, setEditing] = useState<ServerListItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Phase M：SSH 密钥管理状态
  // keyPairs 来自主进程扫描 ~/.ssh/（真实文件列表），非派生自服务器配置
  const [keyPairs, setKeyPairs] = useState<SshKeyPair[]>([])
  const [genModalOpen, setGenModalOpen] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [genForm, setGenForm] = useState<GenFormState>(BLANK_GEN_FORM)
  const [genErrors, setGenErrors] = useState<Partial<Record<keyof GenFormState, string>>>({})

  // Card 3: 连接默认设置（真 settings store）
  const [defaultPort, setDefaultPort] = useState(sshDefaults.port ?? 22)
  const [defaultUser, setDefaultUser] = useState(sshDefaults.username ?? 'root')
  const [connectTimeoutSec, setConnectTimeoutSec] = useState(
    Math.max(5, Math.round((sshTimeout || 30000) / 1000)),
  )
  // K.3：keepAlive 直接联动 store（不再使用本地 state），与后端默认 30s 对齐
  const keepAliveIntervalSec = sshDefaults.keepAliveIntervalSec ?? 30
  // Card 4: 安全设置（strictHostKeyCheck / knownHostsPath 从 store 初始化，保存时写回）
  const [allowPasswordAuth, setAllowPasswordAuth] = usePersistentState<boolean>('ssh.allowPasswordAuth', false)
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

  /**
   * 建立会话并接上交互式 shell —— 两条连接路径共用的收尾
   *
   * @param server 连接目标：id 用于状态登记，name/host 只用于提示文案
   * @param obtain 真正去主进程换 sessionId 的那一步（两条路只差在这里传什么）
   */
  const openSession = useCallback(
    async (server: { id: string; name: string; host: string }, obtain: () => Promise<string>) => {
      if (!isElectronAPIAvailable()) {
        toast.error('请在 Electron 桌面端运行')
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
        const sessionId = await obtain()
        try {
          // 连接成功后顺手开一个终端；已有终端就复用（不再叠一条转发）
          const shell = await ensureShellForSession(
            sessionId,
            shellTitleOf(server.name ?? server.host),
          )
          if (!shell.ok) toast.warning(`终端没能打开：${shell.reason}`)
        } catch (e) {
          console.warn('[SshSettings] shell start', e)
          toast.warning('Shell 启动失败，终端可能不可用')
        }
        setConnectionState(server.id, 'connected')
        setSessionMapping(server.id, sessionId)
        setActiveSession(sessionId)
        toast.success(`已连接 ${server.name || server.host}`)
        showFb(`已连接 ${server.name || server.host}`)
      } catch (err) {
        setConnectionState(server.id, 'error')
        toast.error(`连接失败: ${err instanceof Error ? err.message : String(err)}`)
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

  /**
   * 连接"已保存的服务器"：只交 ID（2026-10-09 安全审查 P0-3）
   *
   * 这里拿到的是 ServerListItem —— 凭据三键在主进程下发时就不存在了，
   * 口令/私钥由主进程自己从 SecureStore 取，永不跨进程边界。
   *
   * 顺带说明一处行为差别：原先这里会把 Card 3 的心跳滑块、Card 4 的
   * strictHostKeyCheck / knownHostsPath 合并进连接配置，connectById 没有口子带这三项，
   * 于是它们变成"只影响新保存的记录，不再逐次覆盖连接"。安全上不会放松：
   * 主进程 connection-manager 判定的是 `strictHostKeyCheck !== false`，
   * 记录里没写这个字段时校验照旧开启，只是 Card 4 那个"关掉校验"的开关不再对
   * 已保存服务器生效（要恢复应由主进程在 connect-by-id 里兜底读 sshDefaults）。
   */
  const connectOne = useCallback(
    (server: ServerListItem): Promise<void> =>
      openSession(server, () => window.electronAPI.sshConnectById(server.id)),
    [openSession],
  )

  /**
   * 连接"刚在对话框里填好的新服务器"：走 sshConnect
   *
   * 这份凭据是用户此刻现填的、只属于这一次操作，直接交出去不算越界；
   * 保存成功之后，这台机器以后的重连只认 ID（见 connectOne）。
   */
  const connectFresh = useCallback(
    (config: SshConfig): Promise<void> =>
      openSession(config, () => window.electronAPI.sshConnect(config)),
    [openSession],
  )

  const disconnectOne = useCallback(
    async (server: ServerListItem) => {
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
        // 通道随连接一起没了：它名下的终端标签必须整批摘掉，
        // 否则回到工作台看到的是一排点不动的死标签
        useTerminalStore.getState().dropSession(sid)
        toast.success(`已断开 ${server.name || server.host}`)
        showFb(`已断开 ${server.name || server.host}`)
      } catch (err) {
        toast.error(`断开失败: ${err instanceof Error ? err.message : String(err)}`)
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
      // 列表里已有同一个 id = 已保存的服务器；对话框现填的凭据先交给主进程存好，
      // 之后这次连接仍然只报 ID（updateServer 是 await 的，主进程那份记录已经更新）。
      const existing = servers.find((s) => s.id === config.id)
      if (existing) {
        await updateServer(config.id, config)
        setDialogOpen(false)
        setEditing(null)
        showFb('服务器已更新')
        // 用刚存进去的 name/host 做提示文案，连接本身只认 id
        await connectOne({ ...existing, name: config.name, host: config.host })
      } else {
        await addServer(config)
        setDialogOpen(false)
        setEditing(null)
        showFb('服务器已添加')
        // 新建那一条：凭据是用户此刻在表单里现填的，直接 sshConnect
        await connectFresh(config)
      }
    },
    [servers, addServer, updateServer, connectOne, connectFresh, showFb],
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
    toast.success('SSH 默认配置已保存')
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
    setAllowPasswordAuth(false)
    setStrictHostKeyCheck(true)
    setKnownHostsPath('~/.ssh/known_hosts')
  }, [setSshDefaults])

  // ===== ServerCard 事件回调（从原内联 JSX 抽取） =====

  const handleEditServer = useCallback((s: ServerListItem) => {
    setEditing(s)
    setDialogOpen(true)
  }, [])

  const handleAddServer = useCallback(() => {
    setEditing(null)
    setDialogOpen(true)
  }, [])

  const handleDeleteServer = useCallback(
    async (s: ServerListItem) => {
      const ok = await confirmDialog({
        title: '删除服务器',
        description: `确定要删除服务器「${s.name || s.host}」吗？此操作不可撤销。`,
        okText: '删除',
        danger: true,
      })
      if (!ok) return
      await removeServer(s.id)
      toast.success('服务器已删除')
      showFb('服务器已删除')
    },
    [removeServer, showFb],
  )

  // ===== KeyCard 事件回调（从原内联 JSX 抽取） =====

  const handleDeleteKey = useCallback(
    async (k: SshKeyPair) => {
      const ok = await confirmDialog({
        title: '删除密钥',
        description: `确定要删除密钥「${k.name}」吗？使用该密钥的服务器连接将受影响。`,
        okText: '删除',
        danger: true,
      })
      if (!ok) return
      try {
        const res = await window.electronAPI.sshDeleteKeyring(k.name)
        if (res.success) {
          toast.success('密钥已删除')
          await refreshKeys()
        } else {
          toast.error(`删除失败: ${res.error || '未知错误'}`)
        }
      } catch (err) {
        toast.error(
          `删除失败: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },
    [refreshKeys],
  )

  const handleUploadKey = useCallback(async () => {
    try {
      const res = await window.electronAPI.sshUploadKeypair()
      if (res.canceled) return // 用户取消文件选择，静默
      if (res.success) {
        toast.success('密钥上传成功')
        await refreshKeys()
      } else {
        toast.error(`上传失败: ${res.error || '未知错误'}`)
      }
    } catch (err) {
      toast.error(
        `上传失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [refreshKeys])

  const handleOpenGenModal = useCallback(() => {
    setGenForm(BLANK_GEN_FORM)
    setGenErrors({})
    setGenModalOpen(true)
  }, [])

  const handleGenKeySubmit = useCallback(async () => {
    const found = validateGenForm(genForm)
    setGenErrors(found)
    if (Object.keys(found).length > 0) return
    setGenLoading(true)
    try {
      const res = await window.electronAPI.sshGenerateKeypair({
        type: genForm.type,
        name: genForm.name.trim(),
        passphrase: genForm.passphrase || undefined,
        comment: genForm.comment || undefined,
      } satisfies GenerateKeyPairRequest)
      if (res.success && res.keyPair) {
        toast.success(`密钥 ${res.keyPair.name} 已生成`)
        setGenModalOpen(false)
        await refreshKeys()
      } else {
        toast.error(`生成失败: ${res.error || '未知错误'}`)
      }
    } catch (err) {
      toast.error(`生成失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGenLoading(false)
    }
  }, [genForm, refreshKeys])

  const handleGenModalCancel = useCallback(() => {
    setGenModalOpen(false)
    setGenLoading(false)
    setGenForm(BLANK_GEN_FORM)
    setGenErrors({})
  }, [])

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
    <div className="set-subpage">
      <SettingsPageHeader {...settingsHeader('/settings/ssh')} />

      <div className="set-subpage__body">
        <ServerCard
          servers={sortedServers}
          connectionStates={connectionStates}
          busyId={busyId}
          feedback={feedback}
          ipcAvailable={ipcAvailable}
          onConnect={(s) => void connectOne(s)}
          onDisconnect={(s) => void disconnectOne(s)}
          onEdit={handleEditServer}
          onAdd={handleAddServer}
          onDelete={handleDeleteServer}
        />

        <KeyCard
          keyPairs={keyPairs}
          ipcAvailable={ipcAvailable}
          onDelete={handleDeleteKey}
          onUpload={() => void handleUploadKey()}
          onGenerate={handleOpenGenModal}
        />

        <DefaultsCard
          defaultPort={defaultPort}
          onPortChange={setDefaultPort}
          defaultUser={defaultUser}
          onUserChange={setDefaultUser}
          connectTimeoutSec={connectTimeoutSec}
          onTimeoutChange={setConnectTimeoutSec}
          keepAliveIntervalSec={keepAliveIntervalSec}
          onKeepAliveChange={(v) => setSshDefaults({ keepAliveIntervalSec: v })}
        />

        <SecurityCard
          allowPasswordAuth={allowPasswordAuth}
          onAllowPasswordAuthChange={setAllowPasswordAuth}
          strictHostKeyCheck={strictHostKeyCheck}
          onStrictHostKeyCheckChange={setStrictHostKeyCheck}
          knownHostsPath={knownHostsPath}
          onKnownHostsPathChange={setKnownHostsPath}
        />

        {/* ===== ActionBar ===== */}
        <SettingsActionBar
          saveLabel="保存设置"
          onSave={() => {
            void handleSaveDefaults()
          }}
          onReset={handleResetDefaults}
        />
      </div>

      {/* ===== SSH 连接对话框（H3 脱敏：口令只在这个弹窗里输入，服务器行只显示「密码」「密钥」标签） ===== */}
      <ConnectDialog
        open={dialogOpen}
        server={editing}
        onSave={(cfg) => void handleSaveDialog(cfg)}
        onCancel={() => {
          setDialogOpen(false)
          setEditing(null)
        }}
      />

      {/* M.4：生成 SSH 密钥对（自研 Dialog + 本地表单 → sshGenerateKeypair） */}
      <Dialog open={genModalOpen} onOpenChange={(next) => !next && handleGenModalCancel()}>
        <DialogContent
          title="生成 SSH 密钥"
          description="密钥会写到 ~/.ssh/ 下，公钥可直接复制到服务器。"
          className="w-[min(520px,92vw)]"
          closeOnOverlayClick={!genLoading}
          footer={
            <>
              <Button variant="outline" onClick={handleGenModalCancel}>
                取消
              </Button>
              <Button variant="solid" disabled={genLoading} onClick={() => void handleGenKeySubmit()}>
                {genLoading ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
                生成
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="密钥类型">
              {() => (
                <Segmented
                  ariaLabel="密钥类型"
                  value={genForm.type}
                  onValueChange={(v) => setGenForm((p) => ({ ...p, type: v }))}
                  items={[
                    { value: 'ed25519', label: 'ED25519（推荐，更安全更快）' },
                    { value: 'rsa', label: 'RSA 4096（兼容性最好）' },
                  ]}
                />
              )}
            </Field>
            <Field label="密钥名称" required hint={genErrors.name}>
              {(id) => (
                <TextInput
                  id={id}
                  value={genForm.name}
                  invalid={!!genErrors.name}
                  placeholder="例如 id_ed25519"
                  onChange={(e) => setGenForm((p) => ({ ...p, name: e.target.value }))}
                />
              )}
            </Field>
            <Field label="口令（可选）" hint="留空表示无口令">
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  value={genForm.passphrase}
                  autoComplete="off"
                  onChange={(e) => setGenForm((p) => ({ ...p, passphrase: e.target.value }))}
                />
              )}
            </Field>
            <Field label="注释（可选）" hint="例如 user@host">
              {(id) => (
                <TextInput
                  id={id}
                  value={genForm.comment}
                  onChange={(e) => setGenForm((p) => ({ ...p, comment: e.target.value }))}
                />
              )}
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SshSettings
