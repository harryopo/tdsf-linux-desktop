/**
 * preload 的共用小工具（从 index.ts 搬出）：契约校验后再 invoke、事件监听的注册/退订封装。
 * 搬出来的理由是域文件也要用它们——留在 index.ts 里就只能把函数再抄一遍。
 */
import { IpcRendererEvent, ipcRenderer } from 'electron'
import { assertContractArgs } from '../shared/ipc-contract'

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
 * 返回值不做强校验：真实返回被一条过紧的 schema 拦死，那是拿契约砸功能。
 */
export function invokeChecked<T>(
  api: string,
  channel: string,
  ...args: unknown[]
): Promise<T> {
  assertContractArgs(api, args)
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
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
