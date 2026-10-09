/**
 * SSH 连接对话框组件 - ConnectDialog
 *
 * 职责：
 * - 表单：名称 / 主机 / 端口 / 用户名 / 认证方式
 * - 认证方式切换：密码 / 密钥文件（两选一用 Segmented，不必点开下拉才知道有几种）
 * - 密钥文件：文件路径输入 + 口令输入
 * - 高级选项：跳板机配置（可折叠）
 * - 测试连接：真的走 ssh:connect + ssh:disconnect，不猜结果
 *
 * 2026-10-07：从 antd Modal+Form+Input+Select+Collapse 换成 ui 层原语
 * （Dialog / Field / TextInput / Segmented / Collapse）+ 本地表单状态。
 * 校验规则一条没减：名称、主机、用户名必填，端口必须是 1–65535 的整数。
 * 宽度从 480px 收到 DESIGN.md §5 的表单档 520px。
 *
 * 2026-10-09 安全审查 P0-3：编辑已保存的服务器时**不再回填凭据**。
 * 主进程下发的 ServerListItem 里根本没有 password/privateKey/passphrase 这三键，
 * 输入框一律从空白开始；留空 = 沿用主进程存好的那份凭据（界面用 hasCredential 提示"已保存"）。
 * 因此"测试连接"也分两条路：已保存的走 sshConnectById（只交 ID），新建的走 sshConnect。
 */
import { useEffect, useState } from 'react'
import { FolderOpen, Plug, Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Collapse, Dialog, DialogContent, Field, IconButton, Segmented, TextInput } from '@/ui'
import { Checkbox } from '@/components/trae/Checkbox'
import type { ServerListItem, SshConfig } from '@shared/models'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import '../../pages/SshSettings.css'

/** 已存凭据的输入框统一提示：留空不代表清空，主进程那份原样保留 */
const KEPT_HINT = '已保存（留空则不修改）'

/** ConnectDialog 组件 Props */
interface ConnectDialogProps {
  /** 对话框是否打开 */
  open: boolean
  /** 编辑模式时的服务器（null 表示新建模式）。类型是 ServerListItem：不含任何凭据 */
  server: ServerListItem | null
  /** 保存回调 */
  onSave: (config: SshConfig) => void
  /** 取消回调 */
  onCancel: () => void
}

/** 表单态：端口用字符串承接输入，提交时才校验并转成数字 */
interface FormState {
  name: string
  host: string
  port: string
  username: string
  authType: 'password' | 'privateKey'
  password: string
  privateKeyPath: string
  passphrase: string
  jumpHostEnabled: boolean
  jumpHostHost: string
  jumpHostPort: string
  jumpHostUsername: string
  jumpHostPassword: string
  keepAlive: boolean
}

const BLANK: FormState = {
  name: '',
  host: '',
  port: '22',
  username: 'root',
  authType: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  jumpHostEnabled: false,
  jumpHostHost: '',
  jumpHostPort: '22',
  jumpHostUsername: '',
  jumpHostPassword: '',
  keepAlive: false,
}

/** 生成唯一 ID */
const generateId = (): string => `server_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

/**
 * 已有配置 -> 表单态（编辑模式回填）
 *
 * 只回填非敏感字段：ServerListItem 里没有 password/privateKey/passphrase，
 * 三个凭据框永远从空白开始，用户填了就当作"这次要用的新凭据"，留空就沿用主进程存的那份。
 * 这样界面上任何时刻都不存在别人能读走的口令。
 */
function toForm(server: ServerListItem | null): FormState {
  if (!server) return BLANK
  return {
    ...BLANK,
    name: server.name ?? '',
    host: server.host ?? '',
    port: String(server.port ?? 22),
    username: server.username ?? 'root',
    authType: server.authType === 'privateKey' ? 'privateKey' : 'password',
    password: '',
    privateKeyPath: server.privateKeyPath ?? '',
    passphrase: '',
    jumpHostEnabled: !!server.jumpHost,
    jumpHostHost: server.jumpHost?.host ?? '',
    jumpHostPort: String(server.jumpHost?.port ?? 22),
    jumpHostUsername: server.jumpHost?.username ?? '',
    jumpHostPassword: '',
    keepAlive: server.keepAlive ?? false,
  }
}

/** 校验：返回字段 -> 错误文案，空对象表示通过 */
function validate(f: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {}
  if (!f.name.trim()) errors.name = '请输入服务器名称'
  if (!f.host.trim()) errors.host = '请输入主机地址'
  if (!f.username.trim()) errors.username = '请输入用户名'
  const port = Number(f.port)
  if (!f.port.trim()) errors.port = '请输入端口'
  else if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = '端口得是 1–65535 的整数'
  if (f.jumpHostEnabled) {
    if (!f.jumpHostHost.trim()) errors.jumpHostHost = '填了跳板机就要写地址'
    if (!f.jumpHostUsername.trim()) errors.jumpHostUsername = '填了跳板机就要写用户名'
    const jp = Number(f.jumpHostPort)
    if (!Number.isInteger(jp) || jp < 1 || jp > 65535) errors.jumpHostPort = '跳板机端口得是 1–65535 的整数'
  }
  return errors
}

/** 表单态 -> 提交给主进程的配置（只在校验通过后调用） */
function toConfig(f: FormState, id: string): SshConfig {
  const config: SshConfig = {
    id,
    name: f.name.trim(),
    host: f.host.trim(),
    port: Number(f.port),
    username: f.username.trim(),
    authType: f.authType,
  }
  if (f.authType === 'password') config.password = f.password
  else {
    config.privateKeyPath = f.privateKeyPath.trim()
    if (f.passphrase) config.passphrase = f.passphrase
  }
  if (f.jumpHostEnabled) {
    config.jumpHost = {
      host: f.jumpHostHost.trim(),
      port: Number(f.jumpHostPort),
      username: f.jumpHostUsername.trim(),
      authType: 'password',
      password: f.jumpHostPassword,
    }
  }
  if (f.keepAlive) config.keepAlive = true
  return config
}

/** ConnectDialog SSH 连接对话框 */
const ConnectDialog: React.FC<ConnectDialogProps> = ({ open, server, onSave, onCancel }) => {
  const [form, setForm] = useState<FormState>(() => toForm(server))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [testing, setTesting] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // 每次打开都按当前 server 回填，避免上一次编辑的残留
  useEffect(() => {
    if (open) {
      setForm(toForm(server))
      setErrors({})
      setShowSecret(false)
    } else {
      setTesting(false)
    }
  }, [open, server])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  /** 校验并给出配置；不通过时把错误写到字段上 */
  const collect = (): SshConfig | null => {
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return null
    return toConfig(form, server?.id ?? generateId())
  }

  /** 选择密钥文件（浏览器文件选择器，Electron 下 file.path 是绝对路径） */
  const handleSelectKeyFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pem,.key,.id_rsa,.id_ed25519,*'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        const filePath = (file as File & { path: string }).path || file.name
        set('privateKeyPath', filePath)
      }
    }
    input.click()
  }

  /**
   * 连接测试：真的连一次再断开，成功失败都以主进程返回为准
   *
   * 两条路（2026-10-09 P0-3）：
   * - 编辑已保存的服务器（server 非 null，有 ID）→ sshConnectById(server.id, 一次性口令)。
   *   渲染层没有它的凭据，只能交 ID 让主进程自己去 SecureStore 取；
   *   用户这一秒在框里重输的口令作为一次性参数带过去（只用于本次连接，界面不回显、不落盘）。
   *   代价要说清楚：这条路测的是主进程里**已保存的那份**配置，
   *   刚改的主机/端口/用户名要先保存才会生效，所以编辑态在表单下方给了提示。
   * - 新建连接（server 为 null）→ sshConnect(config)。config 里的凭据是用户现填的，
   *   本来就属于这一次操作，直接交出去不算越界。
   */
  const handleTest = async () => {
    const config = collect()
    if (!config) return
    if (!isElectronAPIAvailable()) {
      toast.error('electronAPI 不可用，无法测试连接')
      return
    }
    setTesting(true)
    try {
      const oneTimePassword = config.password || undefined
      const sessionId = server
        ? await window.electronAPI.sshConnectById(server.id, oneTimePassword)
        : await window.electronAPI.sshConnect(config)
      await window.electronAPI.sshDisconnect(sessionId)
      toast.success('连接测试成功')
    } catch (err) {
      toast.error(err instanceof Error && err.message ? `连接测试失败: ${err.message}` : '连接测试失败')
    } finally {
      setTesting(false)
    }
  }

  const handleSave = () => {
    const config = collect()
    if (config) onSave(config)
  }

  const errorKeys = Object.keys(errors).filter((k) => errors[k as keyof FormState])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        title={server ? '编辑服务器' : '新建连接'}
        description={
          server
            ? '凭据不在本机界面上回显：留空表示沿用已保存的那份，填了才覆盖。「测试连接」连的是已保存的配置，改了主机/端口请先保存再测。'
            : '填好后可以先测试连接，再保存到服务器列表。'
        }
        className="w-[min(520px,92vw)]"
        closeOnOverlayClick={!testing}
        footer={
          <>
            <Button variant="outline" disabled={testing} onClick={handleTest} className="mr-auto">
              {testing ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Plug aria-hidden className="size-3.5" />}
              测试连接
            </Button>
            <Button variant="outline" onClick={onCancel}>
              取消
            </Button>
            <Button variant="solid" onClick={handleSave}>
              保存
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="名称" required hint={errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                invalid={!!errors.name}
                placeholder="如：生产服务器-01"
                onChange={(e) => set('name', e.target.value)}
              />
            )}
          </Field>

          <Field label="主机地址" required hint={errors.host}>
            {(id) => (
              <TextInput
                id={id}
                value={form.host}
                invalid={!!errors.host}
                placeholder="如：192.168.1.100 或 example.com"
                onChange={(e) => set('host', e.target.value)}
              />
            )}
          </Field>

          <div className="flex gap-3">
            <Field label="端口" required hint={errors.port} className="w-[120px]">
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={65535}
                  value={form.port}
                  invalid={!!errors.port}
                  onChange={(e) => set('port', e.target.value)}
                />
              )}
            </Field>
            <Field label="用户名" required hint={errors.username} className="min-w-0 flex-1">
              {(id) => (
                <TextInput
                  id={id}
                  value={form.username}
                  invalid={!!errors.username}
                  placeholder="如：root"
                  onChange={(e) => set('username', e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label="认证方式">
            {() => (
              <Segmented
                ariaLabel="认证方式"
                value={form.authType}
                onValueChange={(v) => set('authType', v)}
                items={[
                  { value: 'password', label: '密码认证' },
                  { value: 'privateKey', label: '密钥文件认证' },
                ]}
              />
            )}
          </Field>

          {form.authType === 'password' ? (
            <Field label="密码">
              {(id) => (
                <div className="flex items-center gap-1.5">
                  <TextInput
                    id={id}
                    type={showSecret ? 'text' : 'password'}
                    value={form.password}
                    placeholder={server?.hasCredential ? KEPT_HINT : '输入登录密码'}
                    autoComplete="off"
                    onChange={(e) => set('password', e.target.value)}
                  />
                  <IconButton label={showSecret ? '隐藏密码' : '显示密码'} onClick={() => setShowSecret((v) => !v)}>
                    {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </IconButton>
                </div>
              )}
            </Field>
          ) : (
            <>
              <Field label="密钥文件路径">
                {(id) => (
                  <div className="flex items-center gap-1.5">
                    <TextInput
                      id={id}
                      value={form.privateKeyPath}
                      placeholder="如：~/.ssh/id_rsa"
                      onChange={(e) => set('privateKeyPath', e.target.value)}
                    />
                    <IconButton label="选择密钥文件" onClick={handleSelectKeyFile}>
                      <FolderOpen className="size-4" />
                    </IconButton>
                  </div>
                )}
              </Field>
              <Field label="密钥口令（可选）">
                {(id) => (
                  <TextInput
                    id={id}
                    type={showSecret ? 'text' : 'password'}
                    value={form.passphrase}
                    placeholder={server?.hasCredential ? KEPT_HINT : '如果密钥有口令则输入'}
                    autoComplete="off"
                    onChange={(e) => set('passphrase', e.target.value)}
                  />
                )}
              </Field>
            </>
          )}

          <div className="rounded-(--ui-radius-control) border border-line">
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-md text-ink-dim hover:bg-hover"
            >
              高级选项（跳板机）
              <span className="ml-auto text-caption text-ink-mute">{advancedOpen ? '收起' : '展开'}</span>
            </button>
            <Collapse open={advancedOpen}>
              <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
                <label className="flex items-center gap-2 text-md text-ink-dim">
                  <Checkbox
                    checked={form.jumpHostEnabled}
                    onCheckedChange={(v) => set('jumpHostEnabled', v === true)}
                  />
                  通过跳板机连接
                </label>
                {form.jumpHostEnabled ? (
                  <>
                    <Field label="跳板机地址" required hint={errors.jumpHostHost}>
                      {(id) => (
                        <TextInput
                          id={id}
                          value={form.jumpHostHost}
                          invalid={!!errors.jumpHostHost}
                          placeholder="跳板机主机地址"
                          onChange={(e) => set('jumpHostHost', e.target.value)}
                        />
                      )}
                    </Field>
                    <div className="flex gap-3">
                      <Field label="跳板机端口" hint={errors.jumpHostPort} className="w-[120px]">
                        {(id) => (
                          <TextInput
                            id={id}
                            type="number"
                            min={1}
                            max={65535}
                            value={form.jumpHostPort}
                            invalid={!!errors.jumpHostPort}
                            onChange={(e) => set('jumpHostPort', e.target.value)}
                          />
                        )}
                      </Field>
                      <Field label="跳板机用户名" required hint={errors.jumpHostUsername} className="min-w-0 flex-1">
                        {(id) => (
                          <TextInput
                            id={id}
                            value={form.jumpHostUsername}
                            invalid={!!errors.jumpHostUsername}
                            onChange={(e) => set('jumpHostUsername', e.target.value)}
                          />
                        )}
                      </Field>
                    </div>
                    <Field label="跳板机密码">
                      {(id) => (
                        <TextInput
                          id={id}
                          type={showSecret ? 'text' : 'password'}
                          value={form.jumpHostPassword}
                          placeholder={server?.hasCredential ? KEPT_HINT : '跳板机登录密码'}
                          autoComplete="off"
                          onChange={(e) => set('jumpHostPassword', e.target.value)}
                        />
                      )}
                    </Field>
                  </>
                ) : null}
              </div>
            </Collapse>
          </div>

          <label className="flex items-center gap-2 text-md text-ink-dim">
            <Checkbox checked={form.keepAlive} onCheckedChange={(v) => set('keepAlive', v === true)} />
            保持连接（心跳保活）
          </label>

          {errorKeys.length > 0 ? (
            <p role="alert" className="text-caption text-(--status-error-text)">
              还有 {errorKeys.length} 项要改：{errors[errorKeys[0] as keyof FormState]}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ConnectDialog
