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
 *   2. 出：内部原文（主机端口、绝对路径、SQL 片段）留在主进程日志，跨边界只送安全的那一句；
 *      没显式抛 IpcError 的折成 E_INTERNAL，原话保留但统一过 redactSecrets 收口；
 *      渲染层拿到的是以 ` [E_CODE]` 结尾的定形字符串，preload 负责还原成干净的一句话。
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
      if (!(r instanceof Promise)) return r
      return r.catch((err: unknown) => {
        throw finalize(err, channel, opts.exposeDetail)
      })
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

/** 压平成一行、脱敏、限长；空串退回通用话术，避免界面上出现一句空白错误 */
export function safeUserText(raw: string): string {
  const oneLine = redactSecrets(raw).replace(/\s+/g, ' ').trim().slice(0, USER_TEXT_MAX)
  return oneLine || GENERIC_INTERNAL_TEXT
}
