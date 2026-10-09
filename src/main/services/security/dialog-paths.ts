/**
 * 对话框取路径的唯一入口
 *
 * 目的：把"用户亲手选的路径"变成一个可以查证的事实，而不是渲染层递过来的一个字符串。
 * 所有 `dialog.showOpenDialog` / `showSaveDialog` 都从这里走，返回值自动进 confinement
 * 授权集；反过来，任何没经这里的本地路径都不被 confinement 承认。
 *
 * 取消不是错误：调用方拿到 null 应当安静地什么也不做（界面把队列占位摘掉）。
 */

import { dialog, type BrowserWindow } from 'electron'
import { approveDialogPath } from './path-confinement'

/** 与 Electron `FileFilter` 同形（extensions 必给，否则不满足它的类型） */
export interface DialogFileFilter {
  name: string
  extensions: string[]
}

export interface PickExistingFileOptions {
  title: string
  parent?: BrowserWindow
  filters?: DialogFileFilter[]
  /** 允许多选（返回数组走 pickExistingFiles） */
  multi?: boolean
}

export interface PickSaveFileOptions {
  title: string
  parent?: BrowserWindow
  /** 建议文件名或起始目录（另存为的默认落点） */
  defaultPath?: string
  filters?: DialogFileFilter[]
}

function ownerWindow(parent?: BrowserWindow): BrowserWindow | undefined {
  return parent && !parent.isDestroyed() ? parent : undefined
}

/** 用户选中的既有文件；取消返回空数组 */
export async function pickExistingFiles(opts: PickExistingFileOptions): Promise<string[]> {
  const properties: Array<'openFile' | 'multiSelections'> = opts.multi
    ? ['openFile', 'multiSelections']
    : ['openFile']
  const config = {
    title: opts.title,
    properties,
    filters: opts.filters,
  }
  // 有父窗口走 (browserWindow, options) 重载，没有就走 (options)——传 undefined 占位会抛
  const parent = ownerWindow(opts.parent)
  const result = parent ? await dialog.showOpenDialog(parent, config) : await dialog.showOpenDialog(config)
  if (result.canceled) return []
  return result.filePaths.map((p) => approveDialogPath(p))
}

/** 用户确定的保存目标；取消返回 null */
export async function pickSavePath(opts: PickSaveFileOptions): Promise<string | null> {
  const config = {
    title: opts.title,
    defaultPath: opts.defaultPath,
    filters: opts.filters,
  }
  const parent = ownerWindow(opts.parent)
  const result = parent ? await dialog.showSaveDialog(parent, config) : await dialog.showSaveDialog(config)
  if (result.canceled || !result.filePath) return null
  return approveDialogPath(result.filePath)
}
