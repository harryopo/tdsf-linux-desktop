/**
 * IPC 错误信封（P1-2）
 *
 * 要解决的事：Electron 的 ipcMain.handle 没有错误边界 —— handler 抛什么，
 * 渲染层就原样收到 `Error invoking remote method 'x': <内部 message>`。
 * `src/main` 下 287 处 `throw new Error(...)`（152 处直接写在 IPC 层）各写各的，
 * 没人保证一致：有的带 SSH 主机与端口、有的带本地绝对路径、有的带 SQL 片段，
 * 而渲染层是攻击面 —— 这些都不该越过进程边界。
 *
 * 约定（一条通道一个信封，跨边界只走 Error.message 这个字符串）：
 *   message = "给人看的一句话（详情：…）[E_CODE]"
 *   详情只在开发态出现，生产一律不带；`[E_CODE]` 放在**末尾**。
 *   详情本身也必须是脱敏后的 —— 决定"带不带详情"在这里，决定"详情里能不能有密钥形状"
 *   在主进程收口处（`src/main/ipc/error-boundary.ts` 调 redactSecrets），两层都要有。
 *
 * 为什么码在末尾而不是开头：跨边界的载体只有 `Error.message` 这一个字符串，而渲染层
 * 大量组件是直接 `err.message` 展示的。码在前，用户第一眼看见的就是 "[E_CONNECTION] 连接失败"；
 * 码在末尾，读起来仍是一句正常的话，报障时那个码也还在。
 * （preload 侧 `installIpcErrorUnwrap` 会把末尾的码解掉；那道闸装在 `ipcRenderer.invoke`
 * 本身上，覆盖实测的 214 处直接调用。解出来的码只活在 preload 里 —— `contextBridge`
 * 不带自定义属性过隔离世界，实测渲染层读不到 `ipcCode`，所以渲染层不许依赖它。）
 *
 * 为什么是 text 而不是 messageKey：本项目没有 i18n 层，键名没有消费者，
 * 多一层查表只会让"这句话到底是什么"更难追。等真做多语言时再换成键。
 */

export type IpcErrorCode =
  /** 入参不合契约（P1-3 的落点） */
  | 'E_INVALID_INPUT'
  /** 资源不存在（会话、文件、记录） */
  | 'E_NOT_FOUND'
  /** 权限或审批被拒（P0-4 的审批链） */
  | 'E_PERMISSION'
  /** 高危命令闸拦截（P0-1/P0-2） */
  | 'E_BLOCKED'
  /** 外部命令或网络超时（P1-9） */
  | 'E_TIMEOUT'
  /** 连接类失败：SSH / HTTP / sidecar 端口 */
  | 'E_CONNECTION'
  /** 能力降级：功能在但这条路径暂时不可用 */
  | 'E_UNAVAILABLE'
  /** 未分类内部错误 —— 只出现在没显式抛 IpcError 的路径上 */
  | 'E_INTERNAL'

/** 未分类错误的统一对外话术：内部原文一律不外送 */
export const GENERIC_INTERNAL_TEXT = '操作未完成，请重试；持续失败请看「系统日志」'

const DETAIL_MARK = '（详情：'
const CODE_RE = / \[(E_[A-Z_]+)\]$/
/**
 * Electron 把 handler 的 reject 包成 `Error invoking remote method 'x': Error: <message>`，
 * 于是渲染层看到的整串前面带着这句英文。前缀在 parse 时就摘掉，而不是让每个调用点
 * 自己去正则 —— 因为 90 处直接 `ipcRenderer.invoke` 的老调用点不会去解包，
 * 它们至少还能拿到一句人话，而不是半句英文脚手架。
 */
const ELECTRON_WRAP_RE = /^Error invoking remote method '[^']+': (?:Error:\s*)?/

export interface ParsedIpcError {
  code: IpcErrorCode
  /** 给人看的那句话（不含开发态详情与末尾的码） */
  text: string
  /** 开发态详情原文；生产为 undefined */
  detail?: string
}

/** handler 里显式抛出的、已经写好对外话术的错误 */
export class IpcError extends Error {
  readonly isIpcError = true as const

  constructor(
    readonly code: IpcErrorCode,
    /** 给用户看的一句话；不要拼主机名、绝对路径、SQL、凭据 */
    readonly text: string,
    /**
     * 只进开发态的调试详情，允许含内部信息（原始 message、堆栈片段）。
     * 但它不是免检通道：主进程收口处（ipc/error-boundary.ts）会先过 redactSecrets，
     * 生产态再整段丢掉。所以这里写进去的东西最多以"脱敏后的内部原文"出现在开发控制台。
     */
    readonly detail?: string,
    readonly retryable = false
  ) {
    super(`[${code}] ${text}`)
    this.name = 'IpcError'
  }
}

export function isIpcError(e: unknown): e is IpcError {
  return typeof e === 'object' && e !== null && (e as { isIpcError?: boolean }).isIpcError === true
}

/** 把任意异常折成跨边界的那一句字符串 */
export function encodeIpcError(e: unknown, exposeDetail: boolean): string {
  const code: IpcErrorCode = isIpcError(e) ? e.code : 'E_INTERNAL'
  const text = isIpcError(e) ? e.text : GENERIC_INTERNAL_TEXT
  const raw = isIpcError(e) ? e.detail : e instanceof Error ? e.message : String(e)
  const detail = exposeDetail && raw ? `${DETAIL_MARK}${String(raw).slice(0, 500)}）` : ''
  return `${text}${detail} [${code}]`
}

/** 解出信封；不是信封（老代码直接抛的 Error）就返回 null */
export function parseIpcError(message: string | undefined): ParsedIpcError | null {
  if (!message) return null
  const wire = message.replace(ELECTRON_WRAP_RE, '')
  const m = CODE_RE.exec(wire)
  if (!m) return null
  const body = wire.slice(0, m.index)
  const at = body.indexOf(DETAIL_MARK)
  if (at < 0) return { code: m[1] as IpcErrorCode, text: body }
  const detail = body.slice(at + DETAIL_MARK.length, body.endsWith('）') ? -1 : undefined)
  return { code: m[1] as IpcErrorCode, text: body.slice(0, at), detail }
}

/** 渲染层用：只要给人看的那句 */
export function ipcErrorUserText(message: string | undefined): string {
  return parseIpcError(message)?.text ?? message ?? ''
}
