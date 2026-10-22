/**
 * 决策历史 IPC Handlers
 *
 * 注册决策历史相关的 IPC 通道，桥接渲染进程与 DecisionRepository。
 *
 * 通道列表（与 IpcChannelMap 对应）：
 * - history:list  — 分页列表（按时间倒序）
 * - history:get   — 获取详情
 * - history:save  — 保存决策卡片（并把审计链一并写进 decision_audit）
 * - history:audit — 读取某条决策的审计链与校验结论
 *
 * 数据库依赖：
 *   所有操作通过 DatabaseManager 单例获取数据库连接。
 *   审计仓储要的是原始 better-sqlite3 连接（事务尾插要用 transaction()），
 *   拿不到就是库处于降级模式：卡片照旧返回，但要在日志里留下一句话。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { HISTORY } from '@shared/ipc-channels'
import { DatabaseManager } from '../services/db/database'
import { DecisionRepository } from '../services/db/decision-repo'
import { DecisionAuditRepository } from '../services/db/decision-audit'
import { AuditRepo } from '../services/db/audit-repo'
import { buildAuditEvents, generateDecisionCard, validateDecision } from '../core/decision-engine'
import { logger } from '../services/log/logger'
import type { DecisionAuditView, DecisionCard, HistorySaveIntent } from '@shared/models'
/**
 * 获取决策历史仓储实例
 * @returns DecisionRepository 实例
 */
function getDecisionRepo(): DecisionRepository {
  const db = DatabaseManager.getInstance()
  return new DecisionRepository(db)
}

/** 链还没有一行时的结论：完好但界面得按"没有行"表态，不能拿 intact 当"校验通过" */
const EMPTY_AUDIT: DecisionAuditView = {
  rows: [],
  intact: true,
  brokenAtSeq: null,
  expectedHash: null,
  storedHash: null,
}

/**
 * 把审计链写进库（任务 #174）
 *
 * 只有尾插：卡片每次落库写一批事件，写坏了不许就地改——那是另一条链的事。
 */
function writeAuditTrail(card: DecisionCard): void {
  const db = DatabaseManager.getInstance().getRawConnection()
  if (!db) {
    logger.warn('History', '数据库处于降级模式，本次决策的审计链没有写进库', { id: card.id })
    return
  }
  try {
    new DecisionAuditRepository(db).append(card.id, buildAuditEvents(card))
  } catch (err) {
    // 记账失败不该让用户的执行动作失败；界面那条"没有审计链"的空态会替这里说话
    logger.warn('History', '决策审计链写入失败', {
      id: card.id,
      error: (err as Error).message,
    })
  }
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
      if (!repo.save(card)) return false
      writeAuditTrail(card)
      return true
    } catch (err) {
      throw new Error(`保存决策卡片失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // history:audit — 读取决策审计链
  // ------------------------------------------------------------------

  /**
   * 参数：(decisionId: string)
   * 返回：DecisionAuditView（库里存的行 + 主进程重算后的校验结论）
   *
   * 渲染层不再自己拼事件、也不再自己算哈希：那样得到的只是打开时的视图，
   * 改库里的卡改不出来（任务 #174）。这里给的是"存的那份"和它对不对得上。
   */
  ipcMain.handle(HISTORY.AUDIT, async (_event, decisionId: string) => {
    try {
      const db = DatabaseManager.getInstance().getRawConnection()
      if (!db) return EMPTY_AUDIT
      return new DecisionAuditRepository(db).verify(decisionId)
    } catch (err) {
      throw new Error(`获取决策审计链失败: ${(err as Error).message}`)
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
