/**
 * preload 的共用小工具（从 index.ts 搬出）：契约校验后再 invoke、事件监听的注册/退订封装。
 * 搬出来的理由是域文件也要用它们——留在 index.ts 里就只能把函数再抄一遍。
 */
import { IpcRendererEvent, ipcRenderer } from 'electron'
import { assertContractArgs } from '../shared/ipc-contract'
import { parseIpcError } from '../shared/ipc-errors'

// ============================================================================
// v0.9.6 Sprint 7 任务 E：混合检索结果类型（内联定义，与 main/services/tutorial/hybrid-search.ts 保持一致）
// ============================================================================
// 注意：这里不直接从主进程导入（preload 不能依赖主进程模块），
//      也不放到 @shared/hybrid-search-types.ts（避免新增 shared 文件）。
//      类型结构与主进程 HybridSearchResult 接口保持一致。

/**
 * 混合检索单条结果
 *
 * 同时包含原始分数和融合分数，便于 UI 展示和调试：
 *   - ftsScore：BM25 原始分（负值，越小越相关；未参与 FTS 时为 0）
 *   - vecDistance：余弦距离（0-2，越小越相关；未参与 vec 时为 -1）
 *   - rrfScore：RRF 融合分（越大越相关，最终排序依据）
 *   - source：标记该条目由哪一路召回（fts / vec / both）
 */

/**
 * 走契约的 invoke：先按 src/shared/ipc-contract.ts 校验入参，再转发。
 * 校验放在最近的一层——传歪了这里就抛，不必等主进程 handler 里某个 undefined 炸开再回头猜。
 * 返回值不做强校验：真实返回被一条过紧的 schema 拦死，那是拿功能换形式。
 *
 * 这里不再 catch 错误：解包统一装在 `ipcRenderer.invoke` 本身上（installIpcErrorUnwrap），
 * 两处都包会二次解包 —— 第二处拿不到信封码，等于把 `ipcCode` 抹掉。
 */
export function invokeChecked<T>(api: string, channel: string, ...args: unknown[]): Promise<T> {
  assertContractArgs(api, args)
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

/**
 * 把主进程错误边界送过来的定形字符串还原成结构化错误（P1-2）。
 *
 * Electron 会把 reject 包成 `Error invoking remote method 'x': Error: <message>`，
 * 信封的 `[E_CODE]` 在整串末尾，所以解析照样成立。还原后 `message` 是给人看的那句
 * （不带英文前缀、不带码、不带开发态详情之外的杂物），旧的"直接显示 err.message"仍然能读。
 *
 * `ipcCode` 说清楚它的边界：真机实测（tests/e2e/ipc-error-envelope.spec.ts）
 * `contextBridge` 只把 message 带过隔离世界，**自定义属性过不去**，所以这个码是给
 * preload 内部（以及单元测试）分支用的；渲染层要按失败类型分流时，判据得另找载体
 * （例如主进程把类型放进返回值里的那个通道），别指望读 err.ipcCode。
 */
export interface RendererIpcError extends Error {
  ipcCode?: string
}

function toIpcError(err: unknown): RendererIpcError {
  const raw = err instanceof Error ? err.message : String(err)
  const parsed = parseIpcError(raw)
  const out: RendererIpcError = new Error(parsed ? parsed.text : raw)
  if (parsed) {
    out.ipcCode = parsed.code
    if (parsed.detail) out.message += `\n${parsed.detail}`
  }
  return out
}

let unwrapInstalled = false

/**
 * 给 `ipcRenderer.invoke` 装解包（P1-2 的渲染层那一半）。
 *
 * 为什么也打补丁：实测 `src/preload` 有 214 处直接 `ipcRenderer.invoke(...)`，
 * 走 `invokeChecked` 的只有 11 处。逐个包要么改 214 处，要么新写的调用点必然漏 ——
 * 和主进程那侧是同一个理由。装在方法本身上，两类调用点自动都拿到结构化错误。
 * `ipcRenderer` 是 Electron 的单例对象，各域文件 import 到的是同一个引用，改这一处生效全局。
 */
export function installIpcErrorUnwrap(): void {
  if (unwrapInstalled) return
  unwrapInstalled = true

  const original = ipcRenderer.invoke.bind(ipcRenderer) as (
    channel: string,
    ...args: unknown[]
  ) => Promise<unknown>

  const patched = (channel: string, ...args: unknown[]): Promise<unknown> =>
    original(channel, ...args).catch((err: unknown) => {
      throw toIpcError(err)
    })

  ipcRenderer.invoke = patched as unknown as typeof ipcRenderer.invoke
}

// ============================================================================
// 事件监听封装（主 → 渲染，单向推送）
// ============================================================================

/**
 * 创建事件监听器，返回取消监听函数
 *
 * 每个监听器注册一个 ipcRenderer.on 回调，
 * 返回的 cleanup 函数调用 ipcRenderer.removeListener 移除监听，
 * 便于 React useEffect 在组件卸载时清理。
 *
 * @param channel IPC 事件通道名
 * @param callback 事件回调
 * @returns 取消监听函数
 */
export function createListener<T extends unknown[]>(
  channel: string,
  callback: (...args: T) => void
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]): void => {
    callback(...(args as T))
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}
