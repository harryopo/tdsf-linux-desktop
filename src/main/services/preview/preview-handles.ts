/**
 * 预览句柄表（W5）——纯逻辑，不 import electron，便于单测
 *
 * 为什么是"句柄"而不是让渲染层直接报路径/端口：
 * 渲染层一旦被注入一段脚本，能调 IPC 就能读任意远端文件（SFTP 通道早就暴露给界面了，
 * 但它每次读的是用户点开的路径）。预览这一路是给不可信的网页内容用的：iframe 里的页面
 * 会连着请求几十个相对路径，若每个请求都让渲染层拼，等于把"远端文件系统 + 内网端口"
 * 变成一张随便填的表单。所以这里在**开窗那一刻**把目标钉死成一个随机 token，
 * 之后所有子资源请求只能在这个 token 的笼子里走。
 *
 * 笼子规则：
 * - file：入口文件的所在目录是唯一可访问范围，`..` 一律拒（跨出目录就不是预览这个页面了）
 * - port：只允许隧道到远端的 127.0.0.1，端口在铸句柄时定死，请求里换不了
 */
import { randomUUID } from 'node:crypto'
import * as posix from 'node:path/posix'
import type { PreviewTarget } from '@shared/models'

export type { PreviewTarget }

export interface PreviewHandle {
  token: string
  target: PreviewTarget
  /** 入口文件的绝对路径（file 才有），用于把 '/' 映射到它 */
  entryPath: string | null
  /** 允许访问的目录前缀（file 才有），带尾部分隔符 */
  rootPrefix: string | null
  lastUsedAt: number
}

/** 闲置多久就作废：预览面板关了没人清也没关系，超时自己失效 */
const IDLE_TTL_MS = 30 * 60 * 1000

/** 句柄上限：防着把 token 表当成无限增长的缓存 */
const MAX_HANDLES = 64

export type ConfineResult =
  | { ok: true; remotePath: string }
  | { ok: false; reason: string }

/**
 * 把 iframe 请求的 URL 路径映射回远端文件路径。
 *
 * URL 路径是**相对预览根**的：`tdsf-preview://token/assets/app.js` 指的是
 * `<rootDir>/assets/app.js`，不是远端绝对路径 `/assets/app.js`。
 * 拼接后必须先 normalize 再判前缀——顺序反了的话 `/../` 这类串会在规范化之后
 * 才跑出根外，而裸 startsWith 又会被 `/var/www` 放过 `/var/www-apple` 这种兄弟目录，
 * 所以根前缀一律带尾部分隔符。
 */
export function confineToDir(handle: PreviewHandle, urlPath: string): ConfineResult {
  if (handle.target.kind !== 'file') return { ok: false, reason: '端口预览不该走文件解析' }
  const root = handle.rootPrefix
  if (!root) return { ok: false, reason: '句柄缺少目录边界' }
  if (!urlPath.startsWith('/')) return { ok: false, reason: '只接受绝对路径' }
  if (urlPath.includes('\0')) return { ok: false, reason: '路径含非法字符' }

  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return { ok: false, reason: 'URL 编码非法' }
  }
  if (decoded === '/') {
    return handle.entryPath ? { ok: true, remotePath: handle.entryPath } : { ok: false, reason: '缺少入口文件' }
  }
  const resolved = posix.normalize(`${root}${decoded.slice(1)}`)
  if (resolved.includes('\0')) return { ok: false, reason: '路径含非法字符' }
  if (!resolved.startsWith(root)) return { ok: false, reason: '越出预览目录' }
  return { ok: true, remotePath: resolved }
}

/** 铸句柄时就校验目标；不合法直接抛，调用方（IPC 层）把它变成可见错误 */
export function validateTarget(target: PreviewTarget): void {
  if (!target.sessionId) throw new Error('预览缺少会话')
  if (target.kind === 'port') {
    if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
      throw new Error(`预览端口非法: ${String(target.port)}`)
    }
    return
  }
  if (!posix.isAbsolute(target.path)) throw new Error(`预览文件必须是绝对路径: ${target.path}`)
  if (target.path.endsWith('/')) throw new Error('预览目标必须是文件，不是目录')
}

export class PreviewHandleRegistry {
  private readonly handles = new Map<string, PreviewHandle>()
  private readonly now: () => number

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  mint(target: PreviewTarget): PreviewHandle {
    validateTarget(target)
    this.evictExpired(this.now())
    const handle: PreviewHandle = {
      token: randomUUID(),
      target,
      entryPath: target.kind === 'file' ? target.path : null,
      rootPrefix: target.kind === 'file' ? `${posix.dirname(target.path)}/` : null,
      lastUsedAt: this.now(),
    }
    this.handles.set(handle.token, handle)
    // 超上限时丢最久没用的：预览面板本来就一次只看一个
    while (this.handles.size > MAX_HANDLES) {
      const oldest = [...this.handles.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0]
      if (!oldest) break
      this.handles.delete(oldest[0])
    }
    return handle
  }

  /** 取句柄并续期；不存在或已过期回 null（过期顺手删掉） */
  resolve(token: string): PreviewHandle | null {
    const handle = this.handles.get(token)
    if (!handle) return null
    const age = this.now() - handle.lastUsedAt
    if (age > IDLE_TTL_MS) {
      this.handles.delete(token)
      return null
    }
    handle.lastUsedAt = this.now()
    return handle
  }

  revoke(token: string): void {
    this.handles.delete(token)
  }

  /** 会话断了，它名下所有句柄必须一起作废：不然重连后同 token 还能读到新会话的文件 */
  revokeSession(sessionId: string): number {
    let n = 0
    for (const [token, handle] of this.handles) {
      if (handle.target.sessionId === sessionId) {
        this.handles.delete(token)
        n += 1
      }
    }
    return n
  }

  get size(): number {
    return this.handles.size
  }

  private evictExpired(now: number): void {
    for (const [token, handle] of this.handles) {
      if (now - handle.lastUsedAt > IDLE_TTL_MS) this.handles.delete(token)
    }
  }
}

/** 进程内唯一句柄表 */
export const previewHandles = new PreviewHandleRegistry()
