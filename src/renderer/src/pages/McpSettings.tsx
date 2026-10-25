/**
 * McpSettings — 外部 MCP 服务器（/settings/mcp）
 *
 * 这一页存在的意义：外部 MCP 以前是"字段有、主进程有、界面没有"的半态，
 * 想接一台自己的 MCP 服务器只能手改 config.json，而那正是 2026-10-22 越权收口
 * 把 mcpConfig 从 config:set 白名单里整键禁掉的原因（一条能被别处写入的
 * externalServers = 下次启动替你跑一个程序）。所以写入口是一条专用通道：
 * 入参由主进程当场判形状，拒绝原因原样回到这里显示。
 *
 * 前三块全是真读数：
 * - 已登记列表 ← mcp:external-list（形状里没有环境变量值，只有键名）
 * - 连接状态与工具数 ← mcp:external-status（连接池此刻的真实状态，不是"配了就等于在跑"）
 * - 工具清单 ← mcp:external-tools（每台服务器自己报上来的名字与说明）
 *
 * 第四块是这台机器自己的 MCP 网关（2026-10-24 #209 接上）：
 * - 当前健康状态 ← mcp:get-state（五态状态机的快照）+ mcp:state-changed（主进程一变更就推新的整份读数）
 * - 「重置失败计数」→ mcp:reset，按完再读一次，界面上摆的是重置之后的真值
 * 这台状态机以前是"主进程在跑、在推，界面一个字都没接"——外部调用的成败一直在喂它，
 * 但没人读，于是那盏灯等于没装。
 *
 * 界面不承诺它管不到的事：这一页不能让 AI 去调某个工具，也不写"AI 会自动使用"。
 * 每一次外部工具调用都要在审批卡上有人点头（见 docs/功能实景清单.md）。
 *
 * 工具清单那一格（2026-10-25 #217 接上）：每个工具带一个「试调用」，填参数→执行→
 * 回话原样显示。它开的是入口不是后门——按下去走的还是 mcp:external-call 那一条，
 * 主进程照样每次推审批卡，被拒或超时回 error:'not-approved'，界面把这叫"没有执行"，
 * 不和"对面回了话"共用一张脸。这一格以前是"看得见、点不动"，
 * 于是"审批到底拦不拦得住"只有 AI 那条路能验，用户自己验不了。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Gauge,
  Loader2,
  Play,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import type {
  ExternalMcpServer,
  ExternalMcpServerStatus,
  McpExternalTool,
  McpLifecycleState,
  McpStateContext,
} from '@shared/models'
import { Button, Chip, Field, Notice, TextInput } from '@/ui'
import { Empty } from '@/components/trae/Empty'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { settingsHeader } from './settings-sections'
import { cn } from '@/components/trae/utils'
import './Settings.css'

/** 三种传输在界面上的说法（stdio 是"本机起一个程序"，这条必须在文案里讲明白） */
const TRANSPORT_LABEL: Record<ExternalMcpServer['transport'], string> = {
  stdio: '本机命令（stdio）',
  sse: '远程 SSE',
  'streamable-http': '远程 HTTP',
}

/** 连接状态 → 标签与语义色（不写"在线"这种比真实状态更乐观的词） */
const STATE_LABEL: Record<ExternalMcpServerStatus['connectionState'], { text: string; className: string }> = {
  connected: { text: '已连接', className: 'text-(--status-success-text)' },
  connecting: { text: '连接中', className: 'text-(--accent-text)' },
  disconnected: { text: '未连接', className: 'text-ink-mute' },
  error: { text: '连接失败', className: 'text-(--status-error-text)' },
}

/** 网关状态机五态在界面上的说法。
 * 措辞只描述读数本身，不写"调用已被拦下"——这台状态机现在只做观测，
 * 真正拦下外部调用的是审批卡（见 src/main/ipc/mcp.ts 的 external-call）。
 */
const GATEWAY_STATE_LABEL: Record<
  McpLifecycleState,
  { text: string; tone: 'success' | 'warning' | 'error' | 'neutral' }
> = {
  connected: { text: '连接正常', tone: 'success' },
  degraded: { text: '部分能力受损', tone: 'warning' },
  recovering: { text: '恢复中…', tone: 'neutral' },
  failed: { text: '连接失败', tone: 'error' },
  backoff: { text: '冷却中…', tone: 'warning' },
}

/** 状态机给的是毫秒时间戳，界面按本地时区原样念出来（不折算成"3 分钟前"那种猜测） */
function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

/** 参数一栏让用户用空格分隔，交给主进程切成数组 */
function splitArgs(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 环境变量名一栏用逗号或空格分隔，去重后交给主进程逐个判名字 */
function splitKeys(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  )
}

/** IPC 抛回来的原因就是给人看的（"命令里不许出现换行"这种），不翻译也不吞 */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 参数框里的 JSON：要么给出对象，要么给出当场说得清的原因 */
type ParsedArgs = { ok: true; args: Record<string, unknown> } | { ok: false; msg: string }

/**
 * 把参数框里的文本切成 mcpExternalCall 要的那个形状。
 *
 * 留空等于没有参数（对面大多数工具本来就是无参的），但半截 JSON 必须当场拦下：
 * 发出去等于把用户没写完的东西喂给第三方程序，而那一步一旦审批点了头就收不回来。
 */
function parseArgsJson(raw: string): ParsedArgs {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, args: {} }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch (err) {
    return { ok: false, msg: `参数不是合法 JSON，所以一个请求都没发出去：${messageOf(err)}` }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, msg: '参数不是一个 JSON 对象（形如 {"键":"值"}），所以一个请求都没发出去' }
  }
  return { ok: true, args: value as Record<string, unknown> }
}

/** mcpExternalCall 的回包形状（preload 里手写的返回类型，这里只用到这三项） */
type CallEnvelope = {
  success: boolean
  content?: Array<{ type: 'text'; text: string }>
  error?: string
}

/** 三种结果在界面上的说法与颜色。分开写是因为它们三件是根本不同的事：没跑、跑了但报错、跑了且有回话 */
function describeCall(toolName: string, res: CallEnvelope): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  const echoed = (res.content ?? [])
    .map((c) => c.text)
    .join('\n')
    .trim()
  if (res.error === 'not-approved') {
    return {
      tone: 'warn',
      text: `${toolName}：没有执行。审批卡上没点头（被拒绝或超时未响应），那台服务器的程序一次都没跑起来。`,
    }
  }
  if (res.success) {
    return {
      tone: 'ok',
      text: `${toolName} 回了：${echoed ? displayEcho(echoed) : '（对面回的是空内容）'}`,
    }
  }
  return {
    tone: 'bad',
    text: `${toolName} 没有回话。原因：${echoed ? displayEcho(echoed) : res.error || '对面没给原因'}`,
  }
}

/**
 * 回话长度由对面那个服务器决定，本机不封顶，所以这一格只限制"显示多少"。
 * 截的是显示，不是数据：结果行如实写出完整长度，不让人以为回的就这么多。
 */
const MAX_ECHO_DISPLAY = 2000

/** 只在"回话本身要显示"这两条路上套截断（没批准那条没有回话可截） */
function displayEcho(text: string): string {
  if (text.length <= MAX_ECHO_DISPLAY) return text
  return `${text.slice(0, MAX_ECHO_DISPLAY)}…（这里只显示前 ${MAX_ECHO_DISPLAY} 字，对面一共回了 ${text.length} 字）`
}

const RESULT_TONE_CLASS: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'text-ink',
  warn: 'text-warning-text',
  bad: 'text-error-text',
}

interface DraftForm {
  name: string
  transport: ExternalMcpServer['transport']
  command: string
  args: string
  cwd: string
  url: string
  envKeys: string
}

const EMPTY_FORM: DraftForm = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  cwd: '',
  url: '',
  envKeys: '',
}

/**
 * 单个工具的试调用（#217）
 *
 * 为什么要有这一格：mcpExternalCall 这条路一直在跑，但只有 AI 对话走得通——
 * 用户自己看得见工具名却点不动，于是"这套审批到底拦不拦得住"变成只能相信、不能验证。
 * 这里不开新通道也不加"跳过审批"的开关：按下去走的就是原来那条 external-call，
 * 主进程照样每次推审批卡，没点头就回 not-approved，界面上把"没有执行"单独说清。
 */
function ToolTryout({ tool }: { tool: McpExternalTool }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [badJson, setBadJson] = useState<string | null>(null)
  const [calling, setCalling] = useState(false)
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)

  async function run(): Promise<void> {
    const parsed = parseArgsJson(raw)
    if (!parsed.ok) {
      setBadJson(parsed.msg)
      return
    }
    const api = window.electronAPI
    if (!api?.mcpExternalCall) {
      setResult({
        tone: 'bad',
        text: `${tool.name}：这个窗口没有拿到外部 MCP 的调用接口（mcpExternalCall 不存在），没有发出任何请求。`,
      })
      return
    }
    setBadJson(null)
    setCalling(true)
    try {
      setResult(describeCall(tool.name, await api.mcpExternalCall(tool.serverId, tool.name, parsed.args)))
    } catch (err) {
      setResult({ tone: 'bad', text: `${tool.name}：这条请求没走通。原因：${messageOf(err)}` })
    } finally {
      setCalling(false)
    }
  }

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-dom-id="mcp-tool-tryout"
      >
        <Play className="h-3.5 w-3.5" aria-hidden />
        {open ? '收起' : '试调用'}
      </Button>

      {open && (
        <div className="mt-2 space-y-2">
          <Field
            label="参数（JSON 对象）"
            hint="留空等于没有参数。这段 JSON 原样发给那台服务器，不由本机解释。"
          >
            {(id) => (
              <TextInput
                id={id}
                value={raw}
                invalid={badJson !== null}
                onChange={(e) => {
                  setRaw(e.target.value)
                  setBadJson(null)
                }}
                placeholder='{"path":"/etc/hosts"}'
                className="font-mono"
                data-dom-id="mcp-tool-args"
              />
            )}
          </Field>

          {badJson && (
            <Notice tone="error" title="没发出去">
              {badJson}
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="solid"
              size="sm"
              onClick={() => void run()}
              disabled={calling}
              data-dom-id="mcp-tool-exec"
            >
              {calling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              执行
            </Button>
            <p className="text-micro text-ink-mute">按下去先弹审批卡，点了批准才真的发出去</p>
          </div>

          {result && (
            <p
              className={cn(
                'whitespace-pre-wrap break-words text-caption leading-relaxed',
                RESULT_TONE_CLASS[result.tone]
              )}
              data-dom-id="mcp-tool-call-result"
            >
              {result.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function McpSettings() {
  const [servers, setServers] = useState<ExternalMcpServer[]>([])
  const [statuses, setStatuses] = useState<ExternalMcpServerStatus[]>([])
  const [tools, setTools] = useState<McpExternalTool[]>([])
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [gateway, setGateway] = useState<McpStateContext | null>(null)
  const [gatewayError, setGatewayError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const reload = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.mcpExternalList) {
      setLoadError('这个窗口没有拿到外部 MCP 的接口（mcpExternalList 不存在）')
      setLoading(false)
      return
    }
    // 顺序是有意的：列工具那一次才会把连接建立起来，所以状态必须最后读。
    // 三次并发读会得到自相矛盾的一屏——状态列说"未连接 · 0 个工具"，工具清单却列着东西。
    try {
      setServers(await api.mcpExternalList())
      setLoadError(null)
    } catch (err) {
      setLoadError(`读取已登记的外部服务器失败：${messageOf(err)}`)
    }
    try {
      setTools(await api.mcpExternalTools())
    } catch (err) {
      setTools([])
      setLoadError(`读取外部工具清单失败：${messageOf(err)}`)
    }
    try {
      setStatuses(await api.mcpExternalStatus())
    } catch (err) {
      setStatuses([])
      setLoadError(`读取连接状态失败：${messageOf(err)}`)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * 读一次网关状态机的快照。
   * 窗口没有这把键就直说没有——下面的数字宁可空着，也不许摆一个"连接正常"上去。
   */
  const readGateway = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.mcpGetState) {
      setGateway(null)
      setGatewayError('这个窗口没有拿到 MCP 网关状态接口（mcpGetState 不存在），下面的读数无从取起。')
      return
    }
    try {
      setGateway(await api.mcpGetState())
      setGatewayError(null)
    } catch (err) {
      setGateway(null)
      setGatewayError(`${messageOf(err)}；点「重读」再试一次。`)
    }
  }, [])

  useEffect(() => {
    void readGateway()
    const api = window.electronAPI
    if (!api?.onMcpStateChanged) return
    // 主进程状态一变就推整份新读数，界面不用自己再去问一次
    const off = api.onMcpStateChanged((next) => {
      setGateway(next)
      setGatewayError(null)
    })
    // 返回的卸载函数必须交出去：不摘的话每进一次这页就多叠一个监听，
    // 同一次状态变更会被推 N 次（W0 定下的规矩：回调不许叠加）
    return off
  }, [readGateway])

  async function resetGateway(): Promise<void> {
    const api = window.electronAPI
    if (!api?.mcpReset) return
    setResetting(true)
    try {
      await api.mcpReset()
      // 按完重新读：界面上摆的是重置之后的真值，不是"按了就当成功"
      await readGateway()
    } finally {
      setResetting(false)
    }
  }

  const set = (patch: Partial<DraftForm>) => setForm((f) => ({ ...f, ...patch }))

  async function submit(): Promise<void> {
    const api = window.electronAPI
    if (!api?.mcpExternalAdd) return
    setSaving(true)
    setActionError(null)
    try {
      await api.mcpExternalAdd({
        name: form.name.trim(),
        transport: form.transport,
        ...(form.transport === 'stdio'
          ? {
              command: form.command.trim(),
              args: splitArgs(form.args),
              ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
            }
          : { url: form.url.trim() }),
        ...(splitKeys(form.envKeys).length > 0 ? { envKeys: splitKeys(form.envKeys) } : {}),
      })
      setForm(EMPTY_FORM)
      await reload()
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove(serverId: string): Promise<void> {
    const api = window.electronAPI
    if (!api?.mcpExternalRemove) return
    setActionError(null)
    try {
      const removed = await api.mcpExternalRemove(serverId)
      if (!removed) setActionError('这台服务器已经不在登记列表里了（可能刚被另一个窗口删掉）')
      await reload()
    } catch (err) {
      setActionError(messageOf(err))
    }
  }

  async function reconnect(serverId: string): Promise<void> {
    const api = window.electronAPI
    if (!api?.mcpExternalReconnect) return
    setActionError(null)
    try {
      await api.mcpExternalReconnect(serverId)
      await reload()
    } catch (err) {
      setActionError(messageOf(err))
    }
  }

  const isStdio = form.transport === 'stdio'
  const canSubmit =
    form.name.trim().length > 0 && (isStdio ? form.command.trim().length > 0 : form.url.trim().length > 0)

  return (
    <main className="set-page">
      <SettingsPageHeader {...settingsHeader('/settings/mcp')} />

      <div className="set-subpage__body">
        <SettingsCard icon={Server} title="已登记的外部服务器">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-micro text-ink-mute">
              状态来自连接池此刻的真实读数：没连上就写没连上，工具数为 0 就是 0。
            </p>
            <Button variant="ghost" size="sm" onClick={() => void reload()} data-dom-id="mcp-reload">
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              刷新
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取登记列表
            </div>
          ) : loadError ? (
            <Notice tone="error" title="读不到登记列表">
              {loadError}
            </Notice>
          ) : servers.length === 0 ? (
            <Empty
              icon={Plug}
              title="还没有登记外部 MCP 服务器"
              description="在下面这张卡里加一台；只登记你信任的来源。"
            />
          ) : (
            <table className="set-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>传输</th>
                  <th>本机命令 / 远程地址</th>
                  <th>状态</th>
                  <th>工具数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => {
                  const st = statuses.find((x) => x.id === s.id)
                  const badge = STATE_LABEL[st?.connectionState ?? 'disconnected']
                  return (
                    <tr key={s.id} data-dom-id={`mcp-server-row-${s.id}`}>
                      <td className="font-medium text-ink">{s.name}</td>
                      <td className="text-ink-dim">{TRANSPORT_LABEL[s.transport]}</td>
                      <td className="max-w-[22ch] truncate font-mono text-micro text-ink-dim">
                        {s.transport === 'stdio' ? [s.command, ...(s.args ?? [])].join(' ') : s.url}
                      </td>
                      <td>
                        <span className={cn('text-micro font-medium', badge.className)}>
                          {st?.error ? `${badge.text} · ${st.error.slice(0, 40)}` : badge.text}
                        </span>
                        {!s.enabled && <span className="ml-2 text-micro text-ink-mute">已停用</span>}
                      </td>
                      <td className="font-mono text-sm tabular-nums text-ink">{st?.toolCount ?? 0}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void reconnect(s.id)}
                            aria-label={`重连 ${s.name}`}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void remove(s.id)}
                            aria-label={`移除 ${s.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </SettingsCard>

        <SettingsCard icon={Gauge} title="本机 MCP 网关此刻的健康状态">
          <p className="mb-3 text-micro text-ink-mute">
            这一格只统计 MCP 这条链路：调用外部工具的成败，与本机 MCP Server 的启动结果。
            某台外部服务器连没连上，看上面「已登记的外部服务器」那张表的状态列。
          </p>

          {gatewayError ? (
            <Notice
              tone="error"
              title="读不到网关状态"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void readGateway()}
                  aria-label="重新读取网关状态"
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  重读
                </Button>
              }
            >
              {gatewayError}
            </Notice>
          ) : gateway === null ? (
            <div className="flex items-center gap-2 py-2 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取网关状态
            </div>
          ) : (
            <>
              <Chip tone={GATEWAY_STATE_LABEL[gateway.state].tone}>
                {GATEWAY_STATE_LABEL[gateway.state].text}
              </Chip>
              <ul className="mt-2 space-y-1">
                <li className="text-sm text-ink-dim">
                  {`连续失败 ${gateway.consecutiveFailures} 次 · 本轮重试 ${gateway.retryAttempts} 次`}
                </li>
                <li className="text-sm text-ink-dim">
                  {`最近失败 ${gateway.lastFailureAt === null ? '—' : formatClock(gateway.lastFailureAt)}`}
                </li>
                <li className="break-words text-sm text-ink-dim">
                  {`原因：${gateway.lastFailureReason ?? '—'}`}
                </li>
                {gateway.backoffUntil !== null && (
                  <li className="text-sm text-ink-dim">{`冷却至 ${formatClock(gateway.backoffUntil)}`}</li>
                )}
              </ul>
              {gateway.state !== 'connected' && (
                <p className="mt-3 text-micro text-ink-mute">
                  下一步：先在「已登记的外部服务器」那张表里核对那台服务器的命令或地址；
                  确认已经修好，再点下面这颗「重置失败计数」，把连续失败与冷却清零。
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-micro text-ink-mute">
                  这个读数只用于观测：即使写着冷却中，网关也不会因此拒掉调用
                  ——每一次外部调用真正把关的是审批卡。
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void resetGateway()}
                  disabled={resetting}
                  data-dom-id="mcp-gateway-reset"
                >
                  {resetting ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  )}
                  重置失败计数
                </Button>
              </div>
            </>
          )}
        </SettingsCard>

        <SettingsCard icon={Plus} title="添加一台">
          <p className="mb-4 text-micro text-ink-mute">
            stdio 模式会在本机启动一个程序，并把"这个工具说什么"的话语权交给它——只登记你信任的来源。
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="名称" required>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="例如：本地文件服务器"
                  data-dom-id="mcp-add-name"
                />
              )}
            </Field>

            <Field label="传输方式" hint="远程两种地址只接受 http / https">
              {() => (
                <div className="flex flex-wrap gap-2" role="group" aria-label="传输方式">
                  {(['stdio', 'sse', 'streamable-http'] as const).map((t) => (
                    <Button
                      key={t}
                      type="button"
                      size="sm"
                      variant={form.transport === t ? 'solid' : 'outline'}
                      aria-pressed={form.transport === t}
                      onClick={() => set({ transport: t })}
                    >
                      {TRANSPORT_LABEL[t]}
                    </Button>
                  ))}
                </div>
              )}
            </Field>

            {isStdio ? (
              <>
                <Field label="可执行命令" required hint="不允许换行；一条命令一个程序">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={form.command}
                      onChange={(e) => set({ command: e.target.value })}
                      placeholder="例如 npx"
                      className="font-mono"
                      data-dom-id="mcp-add-command"
                    />
                  )}
                </Field>
                <Field label="参数（空格分隔）">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={form.args}
                      onChange={(e) => set({ args: e.target.value })}
                      placeholder="-y @modelcontextprotocol/server-filesystem"
                      className="font-mono"
                      data-dom-id="mcp-add-args"
                    />
                  )}
                </Field>
                <Field label="工作目录（可选）">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={form.cwd}
                      onChange={(e) => set({ cwd: e.target.value })}
                      className="font-mono"
                      data-dom-id="mcp-add-cwd"
                    />
                  )}
                </Field>
                <Field
                  label="要继承的环境变量名（可选）"
                  hint="只填名字：值不落盘也不回显；不填则子进程只拿到一组可安全继承的基础变量"
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={form.envKeys}
                      onChange={(e) => set({ envKeys: e.target.value })}
                      placeholder="PATH, HOME"
                      className="font-mono"
                      data-dom-id="mcp-add-env-keys"
                    />
                  )}
                </Field>
              </>
            ) : (
              <Field label="服务器地址" required hint="完整 URL，含 http:// 或 https://">
                {(id) => (
                  <TextInput
                    id={id}
                    value={form.url}
                    onChange={(e) => set({ url: e.target.value })}
                    placeholder="http://127.0.0.1:8931/sse"
                    className="font-mono"
                    data-dom-id="mcp-add-url"
                  />
                )}
              </Field>
            )}
          </div>

          {actionError && (
            <div className="mt-4">
              <Notice tone="error" title="没能登记">
                {actionError}
              </Notice>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="flex items-center gap-2 text-micro text-ink-mute">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              登记不等于放行：每一次调用它的工具，都会先弹审批卡等人点头
            </p>
            <Button
              onClick={() => void submit()}
              disabled={saving || !canSubmit}
              data-dom-id="mcp-add-submit"
            >
              {saving ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3.5 w-3.5" />
              )}
              添加
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard icon={Activity} title="这些服务器提供的工具">
          <p className="mb-3 text-micro text-ink-mute">
            「试调用」走的是和 AI 完全同一条出口：每次都弹审批卡，不点头就不执行。
            它只替你验证这一次拦不拦得住，不会把工具装进任何自动流程。
          </p>
          {tools.length === 0 ? (
            <p className="text-sm text-ink-mute">
              现在没有可读到的工具。原因写在上面那张表的状态列里，不代表这个功能没做。
            </p>
          ) : (
            <ul className="space-y-2">
              {tools.map((t) => (
                <li
                  key={`${t.serverId}-${t.name}`}
                  className="rounded-(--ui-radius-control) border border-line px-3 py-2"
                  data-dom-id="mcp-tool-row"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-ink">
                        {t.serverName} · {t.name}
                      </span>
                      {t.description && (
                        <span className="mt-0.5 block text-micro text-ink-mute">{t.description}</span>
                      )}
                    </div>
                    <ToolTryout tool={t} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      </div>
    </main>
  )
}
