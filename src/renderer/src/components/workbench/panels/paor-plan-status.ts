/**
 * PAOR 任务步骤状态推导（v2.11 任务拆解可视化）
 *
 * 纯函数：给定计划步骤 + 已收到的迭代轨迹 + 是否运行中，
 * 推导每个步骤的可视化状态（待执行/进行中/完成/失败/已拦截）。
 * 与副作用解耦，便于单测锁死。
 */
import type { PaorIteration } from '@shared/paor-types'

/** 单步可视化状态 */
export type PaorStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked'

/**
 * 推导每个计划步骤的状态。
 *
 * 规则（PAOR 按顺序执行，成功才推进到下一步）：
 * - 该步有迭代记录：
 *   - 最新一轮 riskBlocked → 'blocked'（高危命令被人工审批拦截）
 *   - 最新一轮 observe.status==='success' → 'done'
 *   - 仍在运行且是当前最大步 → 'running'（可能正在重试）
 *   - 否则 → 'failed'
 * - 该步无迭代记录：
 *   - 索引 < 已到达的最大步 → 'done'（循环已推进过，视为完成的安全兜底）
 *   - 运行中且恰为下一步 → 'running'
 *   - 否则 → 'pending'
 *
 * @param steps 计划步骤文本列表（plan.steps）
 * @param iterations 已收到的迭代轨迹（可能只到中途）
 * @param isRunning PAOR 是否仍在运行
 */
export function derivePlanStepStatuses(
  steps: string[],
  iterations: PaorIteration[],
  isRunning: boolean,
): PaorStepStatus[] {
  const maxStep = iterations.reduce((m, it) => Math.max(m, it.stepIndex), -1)

  return steps.map((_, i): PaorStepStatus => {
    const its = iterations.filter((it) => it.stepIndex === i)
    if (its.length === 0) {
      if (i < maxStep) return 'done'
      // 仅“尚无任何步骤开始”时，第一步预览为 running；
      // 一旦某步已在进行（maxStep≥ 0），该步才是 running，后续步一律 pending
      if (maxStep === -1 && isRunning && i === 0) return 'running'
      return 'pending'
    }
    const latest = its[its.length - 1]
    if (latest.riskBlocked) return 'blocked'
    if (latest.observe?.status === 'success') return 'done'
    if (isRunning && i === maxStep) return 'running'
    return 'failed'
  })
}

/** 计划整体进度：已完成步数 / 总步数（供进度条与百分比） */
export function computePlanProgress(statuses: PaorStepStatus[]): {
  done: number
  total: number
  percent: number
} {
  const total = statuses.length
  const done = statuses.filter((s) => s === 'done').length
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return { done, total, percent }
}
