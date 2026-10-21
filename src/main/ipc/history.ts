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
import { AuditRepo } from '../services/db/audit-repo'
import { generateDecisionCard, validateDecision } from '../core/decision-engine'
import { logger } from '../services/log/logger'
import type { HistorySaveIntent } from '@shared/models'
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
   * 参数：(intent: HistorySaveIntent)
   * 返回：boolean（false = 入参不合法或校验未过，渲染层据此丢弃本地副本）
   *
   * P0-5：卡片由主进程构造，risk / confidence / id / timestamp 都不接收渲染层的值。
   * 如果 ID 已存在则覆盖更新（INSERT OR REPLACE）—— 但 id 是主进程生成的，
   * 渲染层无法指定。
   */
  ipcMain.handle(HISTORY.SAVE, async (_event, intent: HistorySaveIntent) => {
    try {
      if (!intent || typeof intent.command !== 'string' || !intent.command.trim()) return false

      // 1. 主进程构造：风险由 risk-engine 评、置信度由证据链按同一算法算、
      //    id 与时间戳在这里生成
      const card = generateDecisionCard(
        intent.problem ?? '',
        intent.hypothesis ?? '',
        intent.evidences ?? [],
        intent.command,
        intent.fixDescription
      )
      card.status = intent.executed ? 'executed' : 'pending'
      card.timestamp = Date.now()
      if (intent.sessionId) card.sessionId = intent.sessionId
      if (intent.serverId) card.serverId = intent.serverId
      if (typeof intent.durationMs === 'number') card.durationMs = intent.durationMs

      // 2. 落库前校验（此前 handler 是 repo.save(card) 一行，零校验）
      const check = validateDecision(card)
      if (!check.valid) {
        logger.warn('History', '拒绝保存不合法的决策卡片', {
          id: card.id,
          issues: check.issues,
        })
        return false
      }

      const repo = getDecisionRepo()
      return repo.save(card)
    } catch (err) {
      throw new Error(`保存决策卡片失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // history:stats — 决策统计聚合
  // ------------------------------------------------------------------

  /**
   * 参数：无
   * 返回：HistoryStats
   */
  ipcMain.handle(HISTORY.STATS, async () => {
    try {
      const repo = getDecisionRepo()
      return repo.getStats()
    } catch (err) {
      throw new Error(`获取决策统计失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // history:blocks — 高危命令拦截记录
  // ------------------------------------------------------------------

  /**
   * 参数：(limit?: number)
   * 返回：BlockedCommandRecord[]（按时间倒序）
   */
  ipcMain.handle(HISTORY.BLOCKS, async (_event, limit?: number) => {
    try {
      const safeLimit =
        typeof limit === 'number' && Number.isFinite(limit)
          ? Math.min(Math.max(Math.trunc(limit), 1), 1000)
          : 200
      return new AuditRepo(DatabaseManager.getInstance()).listBlocked(safeLimit)
    } catch (err) {
      throw new Error(`获取拦截记录失败: ${(err as Error).message}`)
    }
  })
}
