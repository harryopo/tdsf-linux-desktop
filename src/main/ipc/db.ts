/**
 * DB IPC Handlers（A4：SQLite 降级可见化）
 *
 * 注册数据库状态查询通道，把主进程的降级事实（better-sqlite3 未加载 /
 * 库文件打不开 / schema 迁移中断）交给渲染层全局横幅显示。
 *
 * 通道：
 * - db:status — 读取 DbStatus，纯只读，不抛错
 *
 * 设计说明：
 * - 本通道是启动期就可能需要的第一批查询，因此 handler 内不做任何可能失败的操作，
 *   只调用 DatabaseManager.getStatus()（该方法不触碰 SQL）。
 * - 设计依据：IPC 4 步同步铁律（shared 常量 → main handler → preload 暴露 → 渲染层类型）
 */

import { ipcMain } from 'electron'
import { DB } from '@shared/ipc-channels'
import type { DbStatus } from '@shared/db-types'
import type { DatabaseManager } from '../services/db/database'

/**
 * 注册数据库状态 IPC handlers
 *
 * @param db 已在 app.whenReady() 中用 userData 路径初始化好的单例
 */
export function registerDbHandlers(db: DatabaseManager): void {
  ipcMain.handle(DB.STATUS, (): DbStatus => db.getStatus())
}
