/**
 * 本地路径 confinement
 *
 * 渲染层递进来的绝对路径一律不可信：`upload(~/.ssh/id_rsa)` 是外泄闭环，
 * `exportPdf('C:\\Users\\x\\Start Menu\\...\\start.lnk')` 是持久化。同仓的正解样板是
 * `ipc/fs.ts` 这类——路径只来自 `dialog.showOpenDialog` 的返回值，渲染层根本不传。
 *
 * 本模块把那条正解推广成一条策略，两条合法来源：
 * 1. **对话框授权**：主进程弹对话框拿到的路径记进 `DIALOG_APPROVED`，一次性、精确匹配；
 * 2. **受管目录**：落在 `configurePathConfinement()` 登记的根（userData 子树）之下。
 *
 * 其余一律拒：相对路径、`..` 逃逸、UNC（`\\srv\share`，Windows 会走 SMB 带出凭据）、
 * NUL 截断、大小写变体（Windows 文件系统不分大小写，比较时必须归一，否则
 * `C:\Windows\…` 写成 `c:\windows\…` 就绕过前缀判断的是我们自己的闸）。
 */

import * as nodePath from 'node:path'

export type PathMode = 'read' | 'write'

export interface ConfinementOptions {
  /** 覆盖登记的根目录（单测注入用） */
  roots?: readonly string[]
  /** 覆盖对话框授权集（单测注入用） */
  approved?: readonly string[]
  /** 覆盖大小写敏感性，默认按当前平台（win32 不敏感） */
  caseInsensitive?: boolean
  /**
   * 覆盖路径语义（默认当前平台）。
   * 存在的理由：攻击串是 Windows 形态的（盘符、反斜杠、UNC），而 CI 可能跑在 Linux 上。
   * 注入 `nodePath.win32` 让同一批 Windows 用例在任何主机上都被真的判一遍，
   * 而不是"在 Linux 上测不到、在 Windows 上没人测"。
   */
  pathApi?: nodePath.PlatformPath
}

export interface ConfinementVerdict {
  ok: boolean
  reason?: string
  /** 规范化后的绝对路径；不合法时为 undefined */
  resolved?: string
}

let rootsProvider: () => readonly string[] = () => []

/**
 * 登记受管根目录（主进程启动时调一次，传 `() => [app.getPath('userData')]`）。
 * 用函数而不是数组：userData 在 app ready 前不可取，且单测要能换。
 */
export function configurePathConfinement(provider: () => readonly string[]): void {
  rootsProvider = provider
}

/** 对话框授权集上限：只留最近选中的路径，防长会话无界增长 */
const MAX_APPROVED = 200
const dialogApproved = new Set<string>()
const approvedOrder: string[] = []

function keyOf(absPath: string, caseInsensitive: boolean): string {
  return caseInsensitive ? absPath.toLowerCase() : absPath
}

/**
 * 主进程对话框拿到路径后调用——这是"用户亲手选的"唯一凭证。
 * 返回规范化绝对路径，调用方直接用返回值，不要再信任原串。
 */
export function approveDialogPath(rawPath: string): string {
  const resolved = nodePath.resolve(rawPath)
  const key = keyOf(resolved, process.platform === 'win32')
  if (!dialogApproved.has(key)) {
    dialogApproved.add(key)
    approvedOrder.push(key)
    while (approvedOrder.length > MAX_APPROVED) {
      dialogApproved.delete(approvedOrder.shift() as string)
    }
  }
  return resolved
}

/** 仅供单测：清掉授权集，避免用例间互相污染 */
export function resetDialogApprovalsForTest(): void {
  dialogApproved.clear()
  approvedOrder.length = 0
}

/**
 * 判定一个渲染层传来的路径是否可用（不抛异常，返回结论）。
 *
 * @param raw 渲染层原样传来的值（任何类型都先当作不可信）
 * @param mode 读还是写——目前两者策略一致，参数是为了让调用点自解释
 */
export function checkLocalPath(
  raw: unknown,
  mode: PathMode,
  opts: ConfinementOptions = {},
): ConfinementVerdict {
  const p = opts.pathApi ?? nodePath
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: '路径必须是非空字符串' }
  }
  if (raw.includes('\0')) {
    return { ok: false, reason: '路径含 NUL 字符' }
  }
  if (!p.isAbsolute(raw)) {
    return { ok: false, reason: `只接受绝对路径（收到相对路径用于${mode === 'write' ? '写' : '读'}）` }
  }
  // 反斜杠开头的 UNC：Windows 会按 SMB 发起连接，把当前用户凭据递给远端主机。
  // 双斜杠开头的 POSIX 路径是实现自定义语义的边角，一并拒（我们没有任何合法用例需要它）
  if (raw.startsWith('\\\\') || raw.startsWith('//')) {
    return { ok: false, reason: '不允许 UNC 路径' }
  }
  if (/(^|[/\\])\.\.([/\\]|$)/.test(raw)) {
    return { ok: false, reason: '路径含 .. 段' }
  }

  const caseInsensitive = opts.caseInsensitive ?? process.platform === 'win32'
  const resolved = p.resolve(raw)
  const key = keyOf(resolved, caseInsensitive)

  const approved = opts.approved
    ? new Set(opts.approved.map((a) => keyOf(p.resolve(a), caseInsensitive)))
    : dialogApproved
  if (approved.has(key)) return { ok: true, resolved }

  const roots = opts.roots ?? rootsProvider()
  for (const root of roots) {
    const rootKey = keyOf(p.resolve(root), caseInsensitive)
    const withSep = rootKey.endsWith(p.sep) ? rootKey : rootKey + p.sep
    if (key === rootKey || key.startsWith(withSep)) {
      return { ok: true, resolved }
    }
  }
  return { ok: false, reason: `路径不在受管目录或对话框授权范围内（${mode === 'write' ? '写入' : '读取'}被拒）` }
}

/** 判定 + 抛错版本，供 IPC handler 直接挡在门口 */
export function assertWithinConfinement(
  raw: unknown,
  mode: PathMode,
  opts: ConfinementOptions = {},
): string {
  const verdict = checkLocalPath(raw, mode, opts)
  if (!verdict.ok) {
    throw new Error(verdict.reason ?? '路径不合法')
  }
  return verdict.resolved as string
}
