/**
 * decision-loop-helpers — DecisionPage 的 loop 事件类型与守卫
 *
 * 抽离自 DecisionPage.tsx（M2 Task 3 review fix），将 loop 事件载荷类型 +
 * isDecisionCard 结构守卫集中维护，避免主页面文件超 500 行约束。
 *
 * 类型与 src/renderer/src/types/electron.d.ts 中 onLoop* 内联签名同步。
 */
import type { DecisionCard } from '@shared/models'

/** loop:step 事件载荷的 state 子结构（与 electron.d.ts 同步） */
export interface LoopStepState {
  currentStep: 'collect' | 'analyze' | 'reason' | 'check' | 'confirm' | 'execute' | 'verify'
  completedSteps: string[]
  stepDetails: Record<string, string>
  waitingForConfirmation: boolean
  decisionCard: unknown | null
  error: string | null
  timestamp: number
}

/** loop:blocked 事件载荷 */
export interface LoopBlockedPayload {
  type: 'loop:blocked'
  correlationId: string
  step: string
  reason: string
  message: string
}

/** loop 错误载荷 */
export interface LoopErrorPayload {
  type: 'loop:error'
  correlationId: string
  error: string
}

/** 校验 unknown 是否为 DecisionCard（结构最小校验，避免 any） */
export function isDecisionCard(value: unknown): value is DecisionCard {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.problem === 'string' &&
    typeof v.confidence === 'number' &&
    typeof v.fixCommand === 'string' &&
    typeof v.timestamp === 'number'
  )
}
