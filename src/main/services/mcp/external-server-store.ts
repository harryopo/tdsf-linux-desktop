/**
 * 外部 MCP 服务器配置的校验与增删（任务 #173）
 *
 * 这条通道以前不存在：`mcpConfig` 早在 2026-10-22 的越权收口里被 config:set 白名单禁掉
 * （那是对的——一条能被远端写入的 externalServers 就等于"下次启动替你跑一个程序"）。
 * 于是外部 MCP 变成"字段有、代码有、界面没有"的半态。这一步把它做成真功能：
 * 由用户自己在设置页填，写入口是一个专用通道，入参在这里当场判形状。
 *
 * 判的是形状不是意图：这里挡不住"用户自己想跑一个危险程序"，
 * 真正的处置是每一次工具调用都要有人点头（`ipc/mcp.ts` 的 mcp:external-call）。
 */
import type { ExternalMcpServer, ExternalMcpServerDraft } from '@shared/models'
import { MCP_ENV_NAME } from './child-env'

export const MAX_EXTERNAL_SERVERS = 32
const MAX_NAME = 60
const MAX_COMMAND = 500
const MAX_ARGS = 50
const MAX_ARG_LEN = 500
const MAX_ENV_KEYS = 40
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 600_000

export type DraftResult = { ok: true; server: ExternalMcpServer } | { ok: false; error: string }

/** 生成服务器 id：可读、唯一、不含用户输入 */
export function newExternalServerId(existing: readonly ExternalMcpServer[]): string {
  for (let i = 0; i < 64; i++) {
    const id = `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    if (!existing.some((s) => s.id === id)) return id
  }
  throw new Error('生成外部 MCP 服务器标识失败：连续 64 次碰撞')
}

/**
 * 判一份草稿。返回错误原因（界面直接显示，不吞掉）。
 *
 * 逐条判的理由都写在分支里：换行会被 shell 段解析成第二条命令；
 * `..` 之类由 cwd 决定；非 http(s) 的 URL 让 SDK 去猜协议只会得到看不懂的堆栈。
 */
export function validateDraft(
  draft: ExternalMcpServerDraft,
  existing: readonly ExternalMcpServer[],
  id: string
): DraftResult {
  if (existing.length >= MAX_EXTERNAL_SERVERS) {
    return { ok: false, error: `最多登记 ${MAX_EXTERNAL_SERVERS} 台外部 MCP 服务器，请先删掉不用的` }
  }

  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name) return { ok: false, error: '名称不能为空' }
  if (name.length > MAX_NAME) return { ok: false, error: `名称最长 ${MAX_NAME} 个字符` }
  if (existing.some((s) => s.name === name)) {
    return { ok: false, error: `已经有一台叫「${name}」的服务器，名称要唯一` }
  }

  if (draft.transport !== 'stdio' && draft.transport !== 'sse' && draft.transport !== 'streamable-http') {
    return { ok: false, error: `不支持的传输协议：${String(draft.transport)}` }
  }

  const server: ExternalMcpServer = {
    id,
    name,
    transport: draft.transport,
    enabled: draft.enabled !== false,
  }

  if (draft.transport === 'stdio') {
    const command = typeof draft.command === 'string' ? draft.command.trim() : ''
    if (!command) return { ok: false, error: 'stdio 模式要填可执行命令（例如 npx）' }
    if (command.length > MAX_COMMAND) return { ok: false, error: `命令最长 ${MAX_COMMAND} 个字符` }
    // 换行/回车会把一条配置变成两条 shell 语义，这里当场拒
    if (/[\r\n]/.test(command)) return { ok: false, error: '命令里不许出现换行' }
    server.command = command

    const args = draft.args ?? []
    if (!Array.isArray(args)) return { ok: false, error: '参数必须是字符串数组' }
    if (args.length > MAX_ARGS) return { ok: false, error: `参数最多 ${MAX_ARGS} 个` }
    for (const a of args) {
      if (typeof a !== 'string') return { ok: false, error: '参数里每一项都得是字符串' }
      if (a.length > MAX_ARG_LEN) return { ok: false, error: `单个参数最长 ${MAX_ARG_LEN} 个字符` }
    }
    if (args.length > 0) server.args = args

    if (typeof draft.cwd === 'string' && draft.cwd.trim()) {
      if (/[\r\n]/.test(draft.cwd)) return { ok: false, error: '工作目录里不许出现换行' }
      server.cwd = draft.cwd.trim()
    }
  } else {
    const url = typeof draft.url === 'string' ? draft.url.trim() : ''
    if (!url) return { ok: false, error: `${draft.transport} 模式要填 URL` }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, error: 'URL 解析不了，请填完整地址（含 http:// 或 https://）' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: `只接受 http/https 地址，收到的是 ${parsed.protocol}` }
    }
    server.url = url
  }

  const envKeys = draft.envKeys ?? []
  if (!Array.isArray(envKeys)) return { ok: false, error: '要继承的环境变量名必须是数组' }
  if (envKeys.length > MAX_ENV_KEYS) return { ok: false, error: `最多点名 ${MAX_ENV_KEYS} 个环境变量` }
  for (const key of envKeys) {
    if (typeof key !== 'string' || !MCP_ENV_NAME.test(key)) {
      return { ok: false, error: `环境变量名不合法：${String(key)}（只能用字母、数字、下划线，且不能以数字开头）` }
    }
  }
  if (envKeys.length > 0) server.envKeys = Array.from(new Set(envKeys))

  if (typeof draft.timeoutMs === 'number') {
    if (!Number.isFinite(draft.timeoutMs)) return { ok: false, error: '连接超时必须是数字' }
    if (draft.timeoutMs < MIN_TIMEOUT_MS || draft.timeoutMs > MAX_TIMEOUT_MS) {
      return { ok: false, error: `连接超时要在 ${MIN_TIMEOUT_MS / 1000}s 到 ${MAX_TIMEOUT_MS / 1000}s 之间` }
    }
    server.timeoutMs = Math.round(draft.timeoutMs)
  }

  return { ok: true, server }
}
