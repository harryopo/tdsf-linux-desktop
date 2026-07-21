/**
 * 决策历史 IPC Handlers
 *
 * 注册决策历史相关的 IPC 通道，桥接渲染进程与 DecisionRepository。
 *
 * 通道列表（与 IpcChannelMap 对应）：
 * - history:list  — 分页列表（按时间倒序）
 * - history:get   — 获取详情
 * - history:save  — 保存决策卡片
 *
 * 数据库依赖：
 *   所有操作通过 DatabaseManager 单例获取数据库连接。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { HISTORY } from '@shared/ipc-channels'
import { DatabaseManager } from '../services/db/database'
import { DecisionRepository } from '../services/db/decision-repo'
import type { DecisionCard } from '@shared/models'

/**
 * 获取决策历史仓储实例
 * @returns DecisionRepository 实例
 */
function getDecisionRepo(): DecisionRepository {
  const db = DatabaseManager.getInstance()
  return new DecisionRepository(db)
}

/**
 * 注册决策历史相关 IPC handlers
 *
 * @param _mainWindow 主窗口实例（当前未使用，保持签名一致性）
 */
export function registerHistoryHandlers(_mainWindow: BrowserWindow): void {
  // ------------------------------------------------------------------
  // history:list — 分页列表
  // ------------------------------------------------------------------

  /**
   * 参数：(page?: number, pageSize?: number)
   * 返回：DecisionCard[]（按时间倒序）
   */
  ipcMain.handle(
    'history:list',
    async (_event, page?: number, pageSize?: number) => {
      try {
        const repo = getDecisionRepo()
        return repo.list(page, pageSize)
      } catch (err) {
        throw new Error(`获取决策历史失败: ${(err as Error).message}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // history:get — 获取详情
  // ------------------------------------------------------------------

  /**
   * 参数：(id: string)
   * 返回：DecisionCard | null
   */
  ipcMain.handle(HISTORY.GET, async (_event, id: string) => {
    try {
      const repo = getDecisionRepo()
      return repo.getById(id)
    } catch (err) {
      throw new Error(`获取决策详情失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // history:save — 保存决策卡片
  // ------------------------------------------------------------------

  /**
   * 参数：(card: DecisionCard)
   * 返回：boolean
   *
   * 如果 ID 已存在则覆盖更新（INSERT OR REPLACE）。
   */
  ipcMain.handle(HISTORY.SAVE, async (_event, card: DecisionCard) => {
    try {
      const repo = getDecisionRepo()
      return repo.save(card)
    } catch (err) {
      throw new Error(`保存决策卡片失败: ${(err as Error).message}`)
    }
  })
}
