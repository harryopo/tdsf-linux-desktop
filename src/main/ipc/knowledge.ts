/**
 * 知识库 IPC Handlers
 *
 * 注册知识库相关的 IPC 通道，桥接渲染进程与 KnowledgeRepository。
 *
 * 通道列表（与 IpcChannelMap 对应）：
 * - kb:search — 搜索知识（关键词，可选类型过滤）
 * - kb:add    — 添加知识条目
 * - kb:update — 更新知识条目（部分字段）
 * - kb:delete — 删除知识条目
 * - kb:import — 批量导入（自动去重）
 * - kb:export — 导出全部（可选类型过滤）
 *
 * 数据库依赖：
 *   所有操作通过 DatabaseManager 单例获取数据库连接。
 *   DatabaseManager 应在 app.whenReady() 后由主进程入口初始化。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { KNOWLEDGE } from '@shared/ipc-channels'
import { DatabaseManager } from '../services/db/database'
import { KnowledgeRepository } from '../services/db/knowledge-repo'
import type { KnowledgeEntry, KnowledgeType } from '@shared/models'

/**
 * 获取知识库仓储实例
 *
 * 每次调用都基于 DatabaseManager 单例创建新的仓储实例。
 * 仓储本身无状态，可以安全地重复创建。
 *
 * @returns KnowledgeRepository 实例
 */
function getKnowledgeRepo(): KnowledgeRepository {
  const db = DatabaseManager.getInstance()
  return new KnowledgeRepository(db)
}

/**
 * 注册知识库相关 IPC handlers
 *
 * @param _mainWindow 主窗口实例（当前未使用，保持签名一致性）
 */
export function registerKnowledgeHandlers(_mainWindow: BrowserWindow): void {
  // ------------------------------------------------------------------
  // kb:search — 搜索知识
  // ------------------------------------------------------------------

  /**
   * 参数：(query: string, type?: KnowledgeType, limit?: number)
   * 返回：KnowledgeEntry[]
   */
  ipcMain.handle(
    'kb:search',
    async (_event, query: string, type?: KnowledgeType, limit?: number) => {
      try {
        const repo = getKnowledgeRepo()
        return repo.search(query, type, limit)
      } catch (err) {
        throw new Error(`知识库搜索失败: ${(err as Error).message}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // kb:add — 添加知识
  // ------------------------------------------------------------------

  /**
   * 参数：(entry: KnowledgeEntry)
   * 返回：boolean
   */
  ipcMain.handle(KNOWLEDGE.ADD, async (_event, entry: KnowledgeEntry) => {
    try {
      const repo = getKnowledgeRepo()
      return repo.add(entry)
    } catch (err) {
      throw new Error(`知识库添加失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // kb:update — 更新知识
  // ------------------------------------------------------------------

  /**
   * 参数：(id: string, partial: Partial<KnowledgeEntry>)
   * 返回：boolean
   */
  ipcMain.handle(
    'kb:update',
    async (_event, id: string, partial: Partial<KnowledgeEntry>) => {
      try {
        const repo = getKnowledgeRepo()
        return repo.update(id, partial)
      } catch (err) {
        throw new Error(`知识库更新失败: ${(err as Error).message}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // kb:delete — 删除知识
  // ------------------------------------------------------------------

  /**
   * 参数：(id: string)
   * 返回：boolean
   */
  ipcMain.handle(KNOWLEDGE.DELETE, async (_event, id: string) => {
    try {
      const repo = getKnowledgeRepo()
      return repo.delete(id)
    } catch (err) {
      throw new Error(`知识库删除失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // kb:import — 批量导入
  // ------------------------------------------------------------------

  /**
   * 参数：(entries: KnowledgeEntry[])
   * 返回：number（成功导入的数量）
   */
  ipcMain.handle(KNOWLEDGE.IMPORT, async (_event, entries: KnowledgeEntry[]) => {
    try {
      const repo = getKnowledgeRepo()
      return repo.importEntries(entries)
    } catch (err) {
      throw new Error(`知识库导入失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // kb:export — 导出全部
  // ------------------------------------------------------------------

  /**
   * 参数：(type?: KnowledgeType)
   * 返回：KnowledgeEntry[]
   */
  ipcMain.handle(KNOWLEDGE.EXPORT, async (_event, type?: KnowledgeType) => {
    try {
      const repo = getKnowledgeRepo()
      return repo.exportAll(type)
    } catch (err) {
      throw new Error(`知识库导出失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // kb:view — 记录浏览（自增 useCount + 写浏览历史）
  // ------------------------------------------------------------------

  /**
   * 参数：(id: string)
   * 返回：boolean
   */
  ipcMain.handle(KNOWLEDGE.VIEW, async (_event, id: string) => {
    try {
      const repo = getKnowledgeRepo()
      repo.recordView(id)
      return true
    } catch (err) {
      throw new Error(`记录浏览失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // kb:get — 按 id 查询单条知识条目（M4 Task 1 新增，替代 kbExport 误用）
  // ------------------------------------------------------------------

  /**
   * 参数：(id: string)
   * 返回：KnowledgeEntry | null（未找到返回 null，不抛错）
   *
   * 使用场景：KnowledgeDetailPage 按 URL :id 精确加载单条知识条目，
   * 替代原 kbExport(undefined) + find by id 的低效全量查询。
   */
  ipcMain.handle(KNOWLEDGE.GET, async (_event, id: string): Promise<KnowledgeEntry | null> => {
    try {
      const repo = getKnowledgeRepo()
      return repo.getById(id)
    } catch (err) {
      throw new Error(`知识库查询失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // kb:hot — 热门知识（按 useCount 降序）
  // ------------------------------------------------------------------

  /**
   * 参数：(limit?: number)
   * 返回：KnowledgeEntry[]
   */
  ipcMain.handle(KNOWLEDGE.HOT, async (_event, limit?: number) => {
    try {
      const repo = getKnowledgeRepo()
      return repo.getHot(limit ?? 5)
    } catch (err) {
      throw new Error(`获取热门知识失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // kb:recentViews — 最近浏览记录
  // ------------------------------------------------------------------

  /**
   * 参数：(limit?: number)
   * 返回：KbViewHistoryEntry[]
   */
  ipcMain.handle(KNOWLEDGE.RECENT_VIEWS, async (_event, limit?: number) => {
    try {
      const repo = getKnowledgeRepo()
      return repo.getRecentViews(limit ?? 5)
    } catch (err) {
      throw new Error(`获取最近浏览失败: ${(err as Error).message}`)
    }
  })
}
