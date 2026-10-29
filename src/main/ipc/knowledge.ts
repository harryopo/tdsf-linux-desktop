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
 *
 * 数据库依赖：
 *   所有操作通过 DatabaseManager 单例获取数据库连接。
 *   DatabaseManager 应在 app.whenReady() 后由主进程入口初始化。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { KNOWLEDGE } from '@shared/ipc-channels'
import { DatabaseManager } from '../services/db/database'
import { KnowledgeRepository } from '../services/db/knowledge-repo'
import type { KnowledgeDeleteResult, KnowledgeEntry, KnowledgeType } from '@shared/models'
import { pickExistingFiles } from '../services/security/dialog-paths'
import { IMPORT_FILE_EXTENSIONS } from '../services/db/knowledge-import'
import { importKnowledgeFiles } from '../services/knowledge/kb-import'
import { createOnnxKbEmbedder, reindexAllKnowledgeEmbeddings } from '../services/knowledge/kb-embedding'
import { logger } from '../services/log/logger'

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
 * @param mainWindow 主窗口实例（导入对话框的父窗口，保证对话框不跑到别的窗口后面）
 */
export function registerKnowledgeHandlers(mainWindow: BrowserWindow): void {
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
        // 「知识库检索」这一笔记在仓储层（KnowledgeRepository.search），不在这里：
        // 这里只是众多检索入口之一，记在入口会漏掉 AI 那一半、又把页面列表加载算成检索
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
   *
   * 详情页编辑（标题 / 问题描述 / 根因）走这一路；知识包导入的合并走仓储内部，
   * 不经过渲染层。
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
   * 返回：KnowledgeDeleteResult —— deleted / not-found / error 三种话（#203）
   *
   * 出口只留一种形状：仓储自己会把数据库错误报成 error，这一层再兜"连仓储都拿不到"，
   * 这样界面不需要同时处理"回包里的 error"和"IPC 抛出来的 reject"两条通道。
   */
  ipcMain.handle(
    KNOWLEDGE.DELETE,
    async (_event, id: string): Promise<KnowledgeDeleteResult> => {
      try {
        return getKnowledgeRepo().delete(id)
      } catch (err) {
        return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
      }
    }
  )

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

  // ------------------------------------------------------------------
  // kb:import-file — 弹打开框导入知识文件（#180）
  // ------------------------------------------------------------------

  /**
   * 参数：无（文件由用户在系统对话框里选）
   * 返回：{ ok, canceled?, files?, inserted?, updated?, unchanged?, embedded?, rejected?, note?, error? }
   *
   * 为什么把"选文件 + 读文件 + 解析"整条放在主进程：
   * 渲染层不该碰任意本地路径；对话框选中的路径会经 confinement 记入授权集，
   * 后缀与体积也在这里二次校验（对话框的过滤器只是提示，不是防线）。
   */
  ipcMain.handle(KNOWLEDGE.IMPORT_FILE, async () => {
    try {
      const picked = await pickExistingFiles({
        title: '导入运维知识',
        parent: mainWindow,
        multi: true,
        filters: [{ name: '笔记 / 知识包', extensions: [...IMPORT_FILE_EXTENSIONS] }],
      })
      if (picked.length === 0) return { ok: false, canceled: true }

      const result = await importKnowledgeFiles({
        paths: picked,
        repo: getKnowledgeRepo(),
        db: DatabaseManager.getInstance(),
        embedder: createOnnxKbEmbedder(),
      })
      return {
        ok: true,
        files: result.files,
        inserted: result.inserted,
        updated: result.updated,
        unchanged: result.unchanged,
        embedded: result.embedded,
        rejected: result.rejected,
        note: result.embedNote,
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.warn('KB.IMPORT', '知识文件导入失败', { error })
      return { ok: false, error }
    }
  })

  // ------------------------------------------------------------------
  // kb:reindex-embeddings — 补齐语义索引（#180）
  // ------------------------------------------------------------------

  /**
   * 参数：(allowDownload: boolean)
   * 返回：{ ok, needsDownload?, embedded?, failed?, remaining?, note?, error? }
   *
   * 内置种子与手填条目没有向量时，语义检索那条腿对它们等于不存在；
   * 这是唯一一条让它们"补上向量"的路径（启动时不自动下载模型）。
   * allowDownload=false 时缺模型只回 needsDownload，由界面先问用户要不要联网取一次；
   * 用户点头后带 true 再调一次。聊天里的检索永远不会走到下载。
   */
  ipcMain.handle(KNOWLEDGE.REINDEX_EMBEDDINGS, async (_event, allowDownload: boolean) => {
    try {
      if (typeof allowDownload !== 'boolean') {
        return { ok: false, error: '参数不对：allowDownload 必须是布尔值' }
      }
      const result = await reindexAllKnowledgeEmbeddings(
        DatabaseManager.getInstance(),
        createOnnxKbEmbedder({ allowDownload })
      )
      if (!allowDownload && result.note) {
        return { ok: true, needsDownload: true, remaining: result.remaining, note: result.note }
      }
      if (result.failed > 0) {
        return {
          ok: false,
          error: `有 ${result.failed} 条向量写入失败（已补 ${result.embedded} 条，还剩 ${result.remaining} 条）`,
          embedded: result.embedded,
          failed: result.failed,
          remaining: result.remaining,
        }
      }
      return { ok: true, ...result }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.warn('KB.EMBEDDING', '补齐语义索引失败', { error })
      return { ok: false, error }
    }
  })
}
