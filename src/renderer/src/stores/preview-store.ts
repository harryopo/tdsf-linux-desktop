/**
 * 预览标签表（W5）
 *
 * 与终端标签同一取向：标签只是投影，真正能读什么是主进程句柄表说了算。
 * 这里存的是"用户开过哪些预览"，句柄本身（token）过期或被会话关闭作废后，
 * 面板里那一页会直接显示主进程给的 plainly 文案，刷新/重新预览由用户点。
 *
 * 为什么不自动关死标签：会话断开与"网络抖一下"在渲染层分不开，
 * 自动收标签会在重连后把用户正在看的页面一起带走。
 */
import { create } from 'zustand'
import type { PreviewHandleInfo, PreviewTarget } from '@shared/models'

export interface PreviewTab extends PreviewHandleInfo {
  /** 标题：文件取 basename，端口取 port N */
  title: string
  /** 铸句柄时用的目标，留着给"重新预览"再铸一次 */
  target: PreviewTarget
}

interface PreviewState {
  previews: PreviewTab[]
  add: (tab: PreviewTab) => void
  remove: (token: string) => void
}

export const usePreviewStore = create<PreviewState>((set) => ({
  previews: [],
  add: (tab) =>
    set((state) => {
      // 同一个目标重复开只保留一个标签：句柄是新的，旧的顺手作废，不留孤儿
      const same = state.previews.find(
        (p) => JSON.stringify(p.target) === JSON.stringify(tab.target),
      )
      if (!same) return { previews: [...state.previews, tab] }
      void window.electronAPI?.previewClose?.(same.token)
      return { previews: state.previews.map((p) => (p === same ? tab : p)) }
    }),
  remove: (token) => set((state) => ({ previews: state.previews.filter((p) => p.token !== token) })),
}))

/** 工作台标签 id 里预览那一族的前缀 */
const PREFIX = 'preview:'

/**
 * 预览标签 id。
 *
 * 返回模板字面量类型，好让 EditorArea 的 WorkbenchTabId 联合直接收得下；
 * 参数也接 WorkbenchTabId（`file:${string}` 那一路），否则把已有标签 id 传进来会报类型不兼容。
 */
export function previewTabId(token: string): `preview:${string}` {
  return `preview:${token}`
}

export function tokenOfPreviewTab(tabId: string | null): string | null {
  return tabId && tabId.startsWith(PREFIX) ? tabId.slice(PREFIX.length) : null
}/** 能预览的远端文件类型：HTML 走 iframe，Markdown 走渲染层的安全渲染器 */
const PREVIEWABLE_FILE = /\.(html?|md|markdown)$/i

export function isPreviewableFile(remotePath: string | null | undefined): boolean {
  return Boolean(remotePath && PREVIEWABLE_FILE.test(remotePath))
}

/** Markdown 用渲染层显示（不套 iframe），其余文件与端口都进 iframe */
export function rendersAsMarkdown(remotePath: string | null): boolean {
  return Boolean(remotePath && /\.(md|markdown)$/i.test(remotePath))
}

export function previewTitle(target: PreviewTarget): string {
  if (target.kind === 'port') return `端口 ${target.port}`
  const base = target.path.slice(target.path.lastIndexOf('/') + 1)
  return base || target.path
}
