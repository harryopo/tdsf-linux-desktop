/**
 * 窗口导航策略（`will-navigate` 的判定核心）
 *
 * 上一版在这里比 `new URL(u).origin`，看起来是"同源才放行"，实际在打包态恒真：
 * `file://` 文档的 origin 就是字符串 `'null'`，于是"任意本地 HTML 都同源"，
 * 渲染层一旦被攻陷，导航到 `C:\temp\evil.html` 也照样放行。
 *
 * 所以这里的规则不是"比 origin"，而是**按协议分别定目的地**：
 * - `file:`  → 目标必须真的落在 `app.getAppPath()` 之内（打包后是 app.asar 子树）；
 * - `http(s)`→ 只允许与当前文档同 origin（开发态 HMR 走这条）；origin 为 `'null'` 直接拒；
 * - 其它（`javascript:` / `data:` / 自定义协议）→ 拒。
 */

import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface NavigationVerdict {
  ok: boolean
  reason?: string
}

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    return new URL(raw.trim())
  } catch {
    return null
  }
}

function isInsideDir(targetPath: string, rootDir: string, caseInsensitive: boolean): boolean {
  const norm = (s: string): string => {
    const resolved = resolve(s)
    return caseInsensitive ? resolved.toLowerCase() : resolved
  }
  const t = norm(targetPath)
  const r = norm(rootDir)
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep)
}

/**
 * @param targetUrl 将要导航到的地址
 * @param currentUrl 当前文档地址（`webContents.getURL()`）
 * @param appPath `app.getAppPath()`；缺失时 file: 一律拒（宁可白屏也不放开本地）
 */
export function checkNavigation(
  targetUrl: unknown,
  currentUrl: unknown,
  appPath: string | undefined,
  caseInsensitive: boolean = process.platform === 'win32',
): NavigationVerdict {
  const target = parseUrl(targetUrl)
  if (!target) return { ok: false, reason: '目标地址无法解析' }

  if (target.protocol === 'file:') {
    // 跨协议不放行：开发态文档是 http，它没有理由跳到本地文件；
    // 打包态文档是 file，同协议内的目的地再由下面的应用目录校验把关
    const current = parseUrl(currentUrl)
    if (!current || current.protocol !== 'file:') {
      return { ok: false, reason: '当前文档不是 file:，不允许跳本地文件' }
    }
    if (!appPath) return { ok: false, reason: '缺少应用根目录，file: 导航一律拒' }
    let asPath: string
    try {
      asPath = fileURLToPath(target)
    } catch {
      return { ok: false, reason: 'file: 地址不合法' }
    }
    return isInsideDir(asPath, appPath, caseInsensitive)
      ? { ok: true }
      : { ok: false, reason: 'file: 目标不在应用目录内' }
  }

  if (target.protocol === 'http:' || target.protocol === 'https:') {
    const current = parseUrl(currentUrl)
    if (!current) return { ok: false, reason: '当前地址无法解析' }
    if (current.protocol !== target.protocol) {
      return { ok: false, reason: '协议跨域切换被拒' }
    }
    if (target.origin === 'null' || current.origin === 'null') {
      return { ok: false, reason: 'origin 为 null 时不做同源比较' }
    }
    return target.origin === current.origin
      ? { ok: true }
      : { ok: false, reason: `目标 origin ${target.origin} 与当前不同` }
  }

  return { ok: false, reason: `不允许 ${target.protocol} 协议导航` }
}
