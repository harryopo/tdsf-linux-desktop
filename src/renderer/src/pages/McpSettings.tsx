/**
 * McpSettings — 外部 MCP 服务器（/settings/mcp）
 *
 * 这一页存在的意义：外部 MCP 以前是"字段有、主进程有、界面没有"的半态，
 * 想接一台自己的 MCP 服务器只能手改 config.json，而那正是 2026-10-22 越权收口
 * 把 mcpConfig 从 config:set 白名单里整键禁掉的原因（一条能被别处写入的
 * externalServers = 下次启动替你跑一个程序）。所以写入口是一条专用通道：
 * 入参由主进程当场判形状，拒绝原因原样回到这里显示。
 *
 * 三块全是真读数：
 * - 已登记列表 ← mcp:external-list（形状里没有环境变量值，只有键名）
 * - 连接状态与工具数 ← mcp:external-status（连接池此刻的真实状态，不是"配了就等于在跑"）
 * - 工具清单 ← mcp:external-tools（每台服务器自己报上来的名字与说明）
 *
 * 界面不承诺它管不到的事：这一页不能让 AI 去调某个工具，也不写"AI 会自动使用"。
 * 每一次外部工具调用都要在审批卡上有人点头（见 docs/功能实景清单.md）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Activity, Loader2, Plug, Plus, RefreshCw, Server, ShieldAlert, Trash2 } from 'lucide-react'
import type { ExternalMcpServer, ExternalMcpServerStatus, McpExternalTool } from '@shared/models'
import { Button, Field, Notice, TextInput } from '@/ui'
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

export function McpSettings() {
  const [servers, setServers] = useState<ExternalMcpServer[]>([])
  const [statuses, setStatuses] = useState<ExternalMcpServerStatus[]>([])
  const [tools, setTools] = useState<McpExternalTool[]>([])
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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
                  <span className="text-sm font-medium text-ink">
                    {t.serverName} · {t.name}
                  </span>
                  {t.description && (
                    <span className="mt-0.5 block text-micro text-ink-mute">{t.description}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      </div>
    </main>
  )
}
