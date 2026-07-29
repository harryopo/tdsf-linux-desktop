/**
 * memory.ts — Agent 长期记忆 IPC handlers（v2.8）
 *
 * 通道（与 preload sidecar 方法一一对应，pnpm audit:ipc 三方对账）：
 * - memory:list    列出全部记忆（可按 type 过滤）
 * - memory:search  关键词检索
 * - memory:delete  按 id 删除（用户有权遗忘）
 * - memory:audit   沉淀审计日志（记忆从哪来、为什么被拒/淘汰）
 *
 * 记忆的写入不走 IPC —— 由主进程 supervisor 自动沉淀
 * （memory-extractor 对话后提取 + recordToolFailure 失败教训）。
 */
import { ipcMain } from 'electron'
import { MEMORY } from '@shared/ipc-channels'
import { DatabaseManager } from '../services/db/database'
import { MemoryRepository, type MemoryType } from '../services/db/memory-repo'
import { logger } from '../services/log/logger'

/** 惰性获取仓储（DatabaseManager 单例在 app ready 后初始化） */
function getRepo(): MemoryRepository {
  return new MemoryRepository(DatabaseManager.getInstance())
}

/**
 * 注册 Agent 长期记忆 IPC handlers
 */
export function registerMemoryIpcHandlers(): void {
  // 列出全部记忆（可按 type 过滤）
  ipcMain.handle(MEMORY.LIST, (_event, type?: MemoryType) => {
    try {
      return getRepo().list(type)
    } catch (err) {
      logger.error('IPC.Memory', `memory:list 失败：${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  })

  // 关键词检索
  ipcMain.handle(MEMORY.SEARCH, (_event, query: string, limit?: number) => {
    try {
      return getRepo().search(String(query ?? ''), limit ?? 5)
    } catch (err) {
      logger.error('IPC.Memory', `memory:search 失败：${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  })

  // 按 id 删除
  ipcMain.handle(MEMORY.DELETE, (_event, id: string) => {
    try {
      return getRepo().removeById(String(id ?? ''))
    } catch (err) {
      logger.error('IPC.Memory', `memory:delete 失败：${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  })

  // 沉淀审计日志
  ipcMain.handle(MEMORY.AUDIT, (_event, limit?: number) => {
    try {
      return getRepo().auditLog(limit ?? 50)
    } catch (err) {
      logger.error('IPC.Memory', `memory:audit 失败：${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  })

  logger.info('IPC.Memory', 'Agent 长期记忆 IPC handlers 注册完成')
}
