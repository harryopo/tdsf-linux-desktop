/**
 * Budget Alerter - 预算告警触发器（v2.4 Phase B 新增）
 *
 * 职责：
 * - LLM 响应慢告警（>5000ms）
 * - LLM 连续失败告警（>=3 次）
 * - Token 日消耗超阈值告警（当日去重，避免刷屏）
 *
 * 设计原则：
 * - 模块级状态，无需注入 db（直接 DatabaseManager.getInstance()）
 * - 静默失败：db 未初始化或不可用时不影响主流程
 * - 当日去重：token 告警每天最多一次，避免每次查询都告警
 *
 * 关联文档：docs/v2.4-backend-completion-plan.md Phase B
 */

import { DatabaseManager } from '../db/database'
import { recordBudgetAlert } from '../../ipc/model-stats'

/** LLM 响应慢阈值（毫秒），超过此值记录 alert 级告警 */
const LLM_SLOW_THRESHOLD_MS = 5000

/** LLM 连续失败告警阈值（次），达到此值记录 error 级告警 */
const LLM_FAILURE_THRESHOLD = 3

/** 模块级状态：LLM 连续失败计数（成功时重置为 0） */
let llmFailureCount = 0

/** 模块级状态：上次 token 告警日期（YYYY-MM-DD），避免当日重复告警 */
let lastTokenAlertDate = ''

/**
 * 记录 LLM 响应慢告警
 *
 * @param method 调用方法名（chat / chatStream / analyze）
 * @param durationMs 响应耗时（毫秒）
 */
export function alertLlmSlowResponse(method: string, durationMs: number): void {
  if (durationMs < LLM_SLOW_THRESHOLD_MS) return
  try {
    const db = DatabaseManager.getInstance()
    recordBudgetAlert(
      db,
      'alert',
      `LLM ${method} 响应较慢：${durationMs}ms（阈值 ${LLM_SLOW_THRESHOLD_MS}ms）`
    )
  } catch {
    // 静默失败：db 未初始化时不影响主流程
  }
}

/**
 * 记录 LLM 调用失败（累计计数，达到阈值时告警）
 *
 * @param method 调用方法名
 * @param error 错误信息
 */
export function alertLlmFailure(method: string, error: string): void {
  llmFailureCount++
  if (llmFailureCount < LLM_FAILURE_THRESHOLD) return
  try {
    const db = DatabaseManager.getInstance()
    recordBudgetAlert(
      db,
      'error',
      `LLM ${method} 连续失败 ${llmFailureCount} 次：${error}`
    )
    // 记录后重置，避免每次失败都告警（下一轮 3 次再告警）
    llmFailureCount = 0
  } catch {
    // 静默失败
  }
}

/**
 * 记录 LLM 调用成功（重置连续失败计数）
 */
export function alertLlmSuccess(): void {
  llmFailureCount = 0
}

/**
 * 记录 Token 成本超阈值告警（当日去重）
 *
 * @param currentCost 当前累计成本（USD，可以是日/周/月维度）
 * @param threshold 告警阈值（USD）
 * @param dimension 成本维度描述（"日"/"月"等，用于告警文本）
 */
export function alertTokenBudgetExceeded(
  currentCost: number,
  threshold: number,
  dimension: '日' | '月' = '月'
): void {
  const today = new Date().toISOString().slice(0, 10)
  if (today === lastTokenAlertDate) return // 当日已告警，避免刷屏
  try {
    const db = DatabaseManager.getInstance()
    recordBudgetAlert(
      db,
      'alert',
      `Token ${dimension}消耗 $${currentCost.toFixed(4)} 已超阈值 $${threshold.toFixed(2)}`
    )
    lastTokenAlertDate = today
  } catch {
    // 静默失败
  }
}
