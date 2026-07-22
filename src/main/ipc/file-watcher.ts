/**
 * 文件监听 IPC Handlers（v2.0 Phase C Task C.3）
 *
 * 注册 file:watch:start / file:watch:stop 两个 invoke 通道，
 * 委托给 FileWatcherAdapter 单例处理实际监听逻辑。
 * file:changed 推送事件由 FileWatcherAdapter.emitChanged 直接发送到渲染层。
 *
 * IPC 4 步同步：
 *   1. 通道常量：src/shared/ipc-channels.ts FILE_WATCH
 *   2. handler 注册：本文件
 *   3. preload 暴露：src/preload/index.ts fileWatchStart / fileWatchStop / onFileChanged
 *   4. 类型声明：src/preload/index.d.ts ElectronAPI
 */

import { ipcMain } from 'electron'
import { FILE_WATCH } from '@shared/ipc-channels'
import { FileWatcherAdapter } from '../services/ssh/file-watcher'

/**
 * 注册文件监听相关 IPC handlers
 *
 * 不需要 mainWindow 参数：file:changed 通过 FileWatcherAdapter 内部
 * 调用 BrowserWindow.getAllWindows() 广播到所有渲染进程。
 */
export function registerFileWatcherIpcHandlers(): void {
  const adapter = FileWatcherAdapter.getInstance()

  /** file:watch:start — 开始监听远程路径，返回 { watchId } */
  ipcMain.handle(
    FILE_WATCH.WATCH_START,
    async (_event, sessionId: string, path: string): Promise<{ watchId: string }> => {
      const watchId = await adapter.start(sessionId, path)
      return { watchId }
    }
  )

  /** file:watch:stop — 停止指定 watch */
  ipcMain.handle(
    FILE_WATCH.WATCH_STOP,
    async (_event, watchId: string): Promise<{ success: boolean }> => {
      return { success: adapter.stop(watchId) }
    }
  )
}

/** 导出类型供 preload / 渲染层引用 */
export type { FileChangedPayload, FileChangeEvent } from '../services/ssh/file-watcher'
