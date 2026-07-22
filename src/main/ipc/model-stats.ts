/**
 * 模型统计 + 预算告警 IPC Handlers（v2.3.2 新增）
 *
 * 补齐 ModelSettings 最后两处静态数据：
 * - model:toolCalls  — 工具调用统计（按工具名聚合 count + percent）
 * - budget:alerts     — 预算告警历史（最近 N 条）
 *
 * 数据源：
 * - tool_call_log 表：由主进程其他模块在工具调用时写入（如 ssh:exec / kb:search / 联网搜索等）
 * - budget_alerts 表：由主进程在检测到超阈值时写入（如 token 日消耗 > 阈值 / API 响应 > 500ms）
 *
 * 设计原则：
 * - 表为空时返回空数组，不返回 mock 数据（前端显示"暂无数据"）
 * - percent 计算：count / totalCount * 100，四舍五入到整数
 * - 降级：数据库不可用时返回空数组
 *
 * 关联文档：v2.3.2-backend-ipc-archive/tasks.md
 */

import { ipcMain } from 'electron'
import { MODEL_STATS, BUDGET } from '@shared/ipc-channels'
import type { DatabaseManager } from '../services/db/database'
import type { ToolCallStat, BudgetAlert } from '@shared/models'
import { logger } from '../services/log/logger'

/**
 * 注册模型统计 + 预算告警 IPC handlers
 *
 * @param db 数据库管理器
 */
export function registerModelStatsHandlers(db: DatabaseManager): void {
  // ------------------------------------------------------------------
  // model:toolCalls — 工具调用统计聚合
  // ------------------------------------------------------------------
  // 返回 ToolCallStat[]（按 count 降序，percent = count / totalCount * 100）
  // 表为空时返回空数组，前端显示"暂无工具调用数据"
  ipcMain.handle(MODEL_STATS.TOOL_CALLS, (): ToolCallStat[] => {
    try {
      if (!db.isAvailable()) {
        return []
      }
      const rows = db
        .prepare(
          `SELECT toolName, COUNT(*) as cnt
           FROM tool_call_log
           GROUP BY toolName
           ORDER BY cnt DESC`
        )
        .all() as Array<{ toolName: string; cnt: number }>

      if (rows.length === 0) {
        return []
      }

      const totalCount = rows.reduce((sum, r) => sum + r.cnt, 0)
      return rows.map((r) => ({
        name: r.toolName,
        count: r.cnt,
        percent: totalCount > 0 ? Math.round((r.cnt / totalCount) * 100) : 0,
      }))
    } catch (err) {
      logger.error('IPC.MODEL_STATS', `model:toolCalls 失败: ${(err as Error).message}`)
      return []
    }
  })

  // ------------------------------------------------------------------
  // budget:alerts — 预算告警历史查询
  // ------------------------------------------------------------------
  // 参数：limit（可选，默认 20，最多 100）
  // 返回 BudgetAlert[]（按 timestamp 降序）
  ipcMain.handle(
    BUDGET.ALERTS,
    (_event, limit?: number): BudgetAlert[] => {
      try {
        if (!db.isAvailable()) {
          return []
        }
        const safeLimit = Math.min(Math.max(limit ?? 20, 1), 100)
        const rows = db
          .prepare(
            `SELECT level, text, timestamp
             FROM budget_alerts
             ORDER BY timestamp DESC
             LIMIT ?`
          )
          .all(safeLimit) as Array<{ level: string; text: string; timestamp: number }>

        return rows.map((r) => ({
          level: r.level === 'error' ? 'error' : 'alert',
          text: r.text,
          timestamp: r.timestamp,
        }))
      } catch (err) {
        logger.error('IPC.MODEL_STATS', `budget:alerts 失败: ${(err as Error).message}`)
        return []
      }
    }
  )

  logger.info('IPC.MODEL_STATS', '模型统计 + 预算告警 IPC handlers 已注册', {
    channels: [MODEL_STATS.TOOL_CALLS, BUDGET.ALERTS],
  })
}

// ============================================================================
// 写入辅助函数（供主进程其他模块调用）
// ============================================================================

/**
 * 记录一次工具调用（供主进程其他模块调用）
 *
 * 使用场景：
 * - ssh:exec 执行时记录「终端命令执行」
 * - kb:search 执行时记录「知识库检索」
 * - 联网搜索执行时记录「联网搜索」
 * - Skill 调用执行时记录「Skill调用」
 * - 方法论应用执行时记录「方法论应用」
 *
 * @param db 数据库管理器
 * @param toolName 工具名称（与 ModelSettings 显示一致）
 */
export function recordToolCall(db: DatabaseManager, toolName: string): void {
  try {
    if (!db.isAvailable()) return
    db.prepare('INSERT INTO tool_call_log (toolName, timestamp) VALUES (?, ?)').run(
      toolName,
      Date.now()
    )
  } catch (err) {
    logger.warn('IPC.MODEL_STATS', `recordToolCall 失败: ${(err as Error).message}`)
  }
}

/**
 * 记录一条预算告警（供主进程其他模块调用）
 *
 * 使用场景：
 * - token:stats 检测到日消耗 > 阈值时
 * - LLM 响应时间 > 500ms 时
 * - 连续失败 3 次时
 *
 * @param db 数据库管理器
 * @param level 告警级别（'alert' / 'error'）
 * @param text 告警文本
 */
export function recordBudgetAlert(
  db: DatabaseManager,
  level: 'alert' | 'error',
  text: string
): void {
  try {
    if (!db.isAvailable()) return
    db.prepare('INSERT INTO budget_alerts (level, text, timestamp) VALUES (?, ?, ?)').run(
      level,
      text,
      Date.now()
    )
  } catch (err) {
    logger.warn('IPC.MODEL_STATS', `recordBudgetAlert 失败: ${(err as Error).message}`)
  }
}
