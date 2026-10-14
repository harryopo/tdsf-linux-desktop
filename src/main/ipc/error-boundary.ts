import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { encodeIpcError, GENERIC_INTERNAL_TEXT, isIpcError, IpcError } from '@shared/ipc-errors'
import { redactSecrets } from '../core/agent/providers/redact'
import { logger } from '../services/log/logger'
import { assertContractArgsAtBoundary } from './contract-guard'

/**
 * ipcMain.handle 的边界（P1-2 错误收口 + P1-3 入参契约）
 *
 * 为什么打补丁而不是逐个包 handler：注册点散在 20 多个域文件里共 239 个 `ipcMain.handle`，
 * 逐个包要改 239 处，而且下一个新加的 handler 一定会忘记包 —— 那正是"`src/main/ipc/*.ts`
 * 里 152 处各写各的 throw"这件事的成因。边界装在注册函数本身上，新 handler 自动被覆盖。
 *
 * 装了之后，进出两个方向各有一件事：
 *   1. 进：入参按 `src/shared/ipc-contract.ts` 那张表判形状（contract-guard.ts），
 *      不合契约就 E_INVALID_INPUT 挡在 handler 之前 —— 契约不再靠调用方自觉；
 *   2. 出：两条通道都收口。
 *      2a. 抛错：内部原文（主机端口、绝对路径、SQL 片段）留在主进程日志，跨边界只送安全的那一句；
 *          没显式抛 IpcError 的折成 E_INTERNAL，原话保留但统一过 redactSecrets 收口；
 *          渲染层拿到的是以 ` [E_CODE]` 结尾的定形字符串，preload 负责还原成干净的一句话。
 *      2b. 把失败当数据返回（实测 39 处 `success: false` + 32 处 `ok: false`）：渲染层要按
 *          `code` 分支、也要能显示那句人话，改成抛错会破坏界面，所以这类返回体是**合法的**。
 *          但它们绕过了 2a —— `error: toErrorString(err)` 这种写法把底层原文直接塞进**已 resolve 的值**里，
 *          而 `redactSecrets` 原先只装在 reject 路径上。边界在返回处补同一道脱敏，
 *          于是"每条返回体各自决定要不要拼内部信息"这件事不再由 71 个返回点各写一遍。
 */

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type Handle = (channel: string, listener: Listener) => void

let installed = false

export function installIpcErrorBoundary(opts: { exposeDetail: boolean }): void {
  if (installed) return
  installed = true

  const original = ipcMain.handle.bind(ipcMain) as unknown as Handle

  const patched: Handle = (channel, listener) => {
    original(channel, (event, ...args) => {
      let r: unknown
      try {
        // 入参先按契约表判（P1-3）：装在边界里，是因为这里是唯一必经之路 ——
        // preload 那层的 assertContractArgs 会被 214 处直接 invoke 绕过去。
        assertContractArgsAtBoundary(channel, args)
        // 参数必须原样展开转发：这里少写一个展开号，239 个注册点的第二个形参
        // 就全部收到「长度为 1 的数组」，而 TS 看不出来（listener 已被断言成通用签名）。
        r = listener(event, ...args)
      } catch (err) {
        throw finalize(err, channel, opts.exposeDetail)
      }
      if (!(r instanceof Promise)) return guardDataError(r, channel)
      return r.then(
        (value) => guardDataError(value, channel),
        (err: unknown) => {
          throw finalize(err, channel, opts.exposeDetail)
        }
      )
    })
  }

  ipcMain.handle = patched as unknown as typeof ipcMain.handle
}

export function finalize(err: unknown, channel: string, exposeDetail: boolean): Error {
  // 日志里留全貌：IpcError 的 detail，或原始异常本身
  const internal = isIpcError(err)
    ? (err.detail ?? err.message)
    : err instanceof Error
      ? err.message
      : String(err)
  logger.error('IPC', `handler 抛错已折进信封：${internal}`, { channel })
  return new Error(encodeIpcError(toEnvelope(err, internal), exposeDetail))
}

const USER_TEXT_MAX = 300

/**
 * 没显式抛 IpcError 的异常：折成 E_INTERNAL，但**保留原话**（只做脱敏与压平）。
 *
 * 为什么不干脆换成 GENERIC_INTERNAL_TEXT：实测 `src/main/ipc/*.ts` 有 152 处
 * `throw new Error(...)`，其中 43 处把底层 `.message` 拼了进去（"远程端口 22 没开"
 * "文件不存在"）。全量折成一句"操作未完成"是把这 152 处报错一次性砸平 ——
 * 那是可用性回退，不是安全收益。安全收益来自收口处的统一脱敏：私钥块、
 * .env/.ssh 路径、API Key、password= 赋值这些形态由 redactSecrets 兜掉，
 * 比原先"每条消息各自决定要不要拼内部信息"严格得多。
 */
function toEnvelope(err: unknown, internalMessage: string): unknown {
  // 两条分支都要过脱敏：encodeIpcError 只决定"带不带详情"，不负责"详情里能不能带密钥形状"。
  // 收口放在这里（主进程），是因为 redactSecrets 属于 main/core，shared 层不该反向依赖它。
  if (isIpcError(err)) {
    return new IpcError(err.code, err.text, deduped(err.detail, err.text), err.retryable)
  }
  const text = safeUserText(internalMessage)
  return new IpcError('E_INTERNAL', text, deduped(internalMessage, text))
}

/**
 * 详情与原话相同就别重说一遍：渲染层开发态是把 `err.message` 直接弹出来的，
 * `预览句柄不存在或已过期\n预览句柄不存在或已过期` 这种重复是真机实测到的
 * （钉在 tests/e2e/ipc-error-envelope.spec.ts）。
 *
 * 比较对象必须是"未压平的原文 vs 已经展示的那句话"，不能两边都压平：
 * 压平会吃掉换行与超长那部分差异，结果对所有单行未知异常都不给详情 ——
 * 那不是"去重"，那是把开发态唯一的线索关掉。
 */
function deduped(detail: string | undefined, text: string): string {
  if (!detail) return ''
  const redacted = redactSecrets(detail)
  return redacted.trim() === text ? '' : redacted
}

/** 压平成一行、脱敏、限长（不补通用话术）——抛错路径与 data 型错误共用同一个变换 */
function flattenForWire(raw: string): string {
  return redactSecrets(raw).replace(/\s+/g, ' ').trim().slice(0, USER_TEXT_MAX)
}

/** 空串退回通用话术，避免界面上出现一句空白错误 */
export function safeUserText(raw: string): string {
  return flattenForWire(raw) || GENERIC_INTERNAL_TEXT
}

/**
 * 「把失败当数据返回」的返回体（出方向 2b）
 *
 * 为什么不是把它们改成抛错：渲染层要按 `code` 分支（ModelSettings 读 `result.code` 拼提示前缀）、
 * 有些拒绝是"按设计不执行"而不是"出故障"（审批被拒、用户取消选择），抛错会让界面把它显示成崩了。
 * 所以契约是：**这类返回体合法，但信封里的诊断文本必须和抛错路径过同一道脱敏**。
 *
 * 收口装在边界而不是逐个改 71 个返回点，理由与 2a 相同：下一个 handler 一定会忘记脱敏。
 */
const DATA_ERROR_TEXT_KEYS = new Set(['error', 'message', 'summary'])
/** 只认普通对象：Date/Map/Set/TypedArray 用 Object.entries 复制会掉内容 */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** 顶层带 `success: false` 或 `ok: false` 的普通对象就是失败信封（两种写法实测都有） */
export function isDataErrorEnvelope(v: unknown): v is Record<string, unknown> {
  return isPlainRecord(v) && (v.success === false || v.ok === false)
}

/**
 * 递归改写失败信封里的字符串。
 *
 * 两个强度：登记过的诊断字段（`error`/`message`/`summary`）走与抛错路径完全相同的变换
 * （脱敏 + 压平 + 限长 300）；**没登记的键只要带出密钥形状也一律涂掉**，并在日志里点名那个键 ——
 * 这样"以后有人新加一个 `{success:false, detail: 原文}`"不会变成一条没人发现的漏网通道。
 *
 * 没改到任何字段时**返回原引用**（多数 handler 自己已经脱敏，等于零复制）；
 * 改到时逐层新建容器而不是就地写 —— `tutorial:crawlStart` 会把服务内部的 history
 * 数组直接放进失败信封返回，就地改写等于把别人的状态涂了。
 */
function redactTextFields(node: unknown, at: string, touched: string[]): unknown {
  if (Array.isArray(node)) {
    let changed = false
    const out = node.map((item, i) => {
      const next = redactTextFields(item, `${at}[${i}]`, touched)
      if (next !== item) changed = true
      return next
    })
    return changed ? out : node
  }
  if (!isPlainRecord(node)) return node
  let changed = false
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      const registered = DATA_ERROR_TEXT_KEYS.has(key)
      const safe = registered ? flattenForWire(value) : redactSecrets(value)
      out[key] = safe
      if (safe !== value) {
        changed = true
        touched.push(registered ? `${at}.${key}` : `${at}.${key}(未登记为诊断字段)`)
      }
      continue
    }
    const next = redactTextFields(value, `${at}.${key}`, touched)
    out[key] = next
    if (next !== value) changed = true
  }
  return changed ? out : node
}

/**
 * 只动失败信封。成功返回的业务数据一个字都不改：日志正文、文件预览、命令输出是用户点名要看的
 * 字节，按密钥形状涂掉等于把功能做坏（真要防的是"凭据进日志"，那是 redactSecrets 在 logger 收口处的事）。
 */
export function guardDataError<T>(value: T, channel: string): T {
  if (!isDataErrorEnvelope(value)) return value
  const touched: string[] = []
  const next = redactTextFields(value, '', touched)
  if (touched.length === 0) return value
  logger.warn(
    'IPC',
    `handler 把未脱敏的内部原文当数据外送，已在边界兜掉 ${touched.length} 处`,
    { channel, paths: touched.join('、') }
  )
  return next as T
}
