/**
 * 目的地 URL 策略（渲染层递进来的地址一律不可信）
 *
 * 两条不同用途、同一份实现：
 * - `assertSafeApiBaseUrl`：LLM provider 的 baseUrl。渲染层能写 baseUrl 就等于能决定
 *   "真 API Key 发到哪里"，所以这里必须挡住"把真 key 递给攻击者主机"这条路。
 * - `assertSafeExternalUrl`：交给系统浏览器/`shell.openExternal` 的地址。
 *   `file://`、自定义协议（`wt-cli://`）、UNC（`\\srv\share`）都能借 Windows
 *   的 shell 关联直接启动本地程序，不是"打开网页"。
 *
 * 判据写成白名单而不是黑名单：黑名单（禁 javascript:、禁 file:…）永远缺一条。
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export interface UrlPolicy {
  ok: boolean
  reason?: string
}

function parse(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return new URL(raw.trim())
  } catch {
    return null
  }
}

/**
 * LLM provider baseUrl：必须 https；只有回环地址允许 http（本地 ollama/llama.cpp）；
 * 不许在 URL 里带凭据（`https://u:p@host`）或指向非 http(s) 协议。
 */
export function assertSafeApiBaseUrl(raw: unknown): UrlPolicy {
  const u = parse(raw)
  if (!u) return { ok: false, reason: 'baseUrl 不是合法 URL' }
  if (u.username || u.password) return { ok: false, reason: 'baseUrl 不允许内嵌账号口令' }
  if (u.protocol === 'https:') return { ok: true }
  if (u.protocol === 'http:') {
    return LOOPBACK_HOSTS.has(u.hostname)
      ? { ok: true }
      : { ok: false, reason: '明文 http 只允许本机回环地址（避免把 API Key 走明文发到远端）' }
  }
  return { ok: false, reason: `baseUrl 协议 ${u.protocol} 不被允许（只支持 http/https）` }
}

/**
 * 一般网页链接（交给系统浏览器的任意主机）：协议限 http/https、不许内嵌凭据。
 *
 * 与 `assertSafeExternalUrl` 的区别：那条要求主机在白名单内，用于"我们自己要打开的东西"；
 * 这条用于"用户/模型点了个外链"，主机没法预先枚举，但协议必须管住——
 * `file://` 与自定义协议在 Windows 上是"启动本地程序"，不是"打开网页"。
 */
export function isSafeWebUrl(raw: unknown): boolean {
  const u = parse(raw)
  if (!u) return false
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  return !u.username && !u.password
}

/**
 * 可交给系统打开的外部地址：默认只允许 https 且主机在白名单里。
 *
 * @param allowHosts 允许的主机名（小写、精确匹配；子域要显式列出）
 */
export function assertSafeExternalUrl(raw: unknown, allowHosts: readonly string[]): UrlPolicy {
  const u = parse(raw)
  if (!u) return { ok: false, reason: '地址不是合法 URL' }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, reason: `不允许 ${u.protocol} 协议（只允许 https 主机链接）` }
  }
  if (u.username || u.password) return { ok: false, reason: 'URL 不允许内嵌凭据' }
  const host = u.hostname.toLowerCase()
  if (!allowHosts.includes(host)) {
    return { ok: false, reason: `主机 ${host} 不在外部链接白名单里` }
  }
  if (u.protocol === 'http:') return { ok: false, reason: '外部链接必须走 https' }
  return { ok: true }
}
