/**
 * useLoopEngineering — 循环工程子 Agent React Hook
 *
 * // @ai-session: ai-glm-20260721-loop-eng
 * // @ai-task: loop-engineering-wire
 *
 * 设计目标：
 *   封装 loop:* IPC 通道，让 AIPanel 接入真实循环工程：
 *   1. start(problem, connId, opts?) — 启动循环工程
 *   2. 自动订阅 loop:llm-start / llm-done / step / decision / done / error 事件
 *   3. 暴露当前状态（llmHypothesis / currentStep / decisionCard / error）
 *   4. confirm(approved) / cancel() — 人工确认/取消
 *
 * 完整流程：
 *   [用户输入问题]
 *         ↓ start()
 *   [LLM 推理]  onLoopLlmStart → onLoopLlmDone
 *         ↓ hypothesis 就绪
 *   [7 步 HITL] onLoopStep × N（collect→analyze→reason→check→confirm→execute→verify）
 *         ↓ 等待用户确认
 *   [决策卡片]  onLoopDecision
 *         ↓ 用户点击批准/拒绝
 *   [执行+验证] onLoopStep × 2（execute→verify）
 *         ↓
 *   [完成]     onLoopDone
 *
 * 与 useAgentChat 的关系：
 *   - useAgentChat：单次 chat（agent:chat → Supervisor 流式文本）
 *   - useLoopEngineering：多步编排（loop:start → 完整 7 步 HITL）
 *   - 两者独立，由用户根据任务复杂度选择
 *
 * v2.3.7 修复：移除"演示模式"表述，统一为真实功能描述。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { isDecisionCard, type LoopStepState } from '@/pages/decision-loop-helpers'
import type { DecisionCard } from '@shared/models'

// ============================================================================
// 类型定义
// ============================================================================

/** LLM 推理结果（假设计阶段输出） */
export interface LlmHypothesis {
  hypothesis: string
  fixCommand: string
  confidence: number
}

// AgentWorkflowState / DecisionCard 不在这里另立一份。
// loop:* 事件的载荷类型与结构守卫由 @/pages/decision-loop-helpers 统一维护
// （LoopStepState / isDecisionCard），卡片类型以 @shared/models 为准。
// 这里原先有一份"精简版 DecisionCard"和一份本地 AgentWorkflowState，靠
// `as unknown as` 与 `as DecisionCard` 把 IPC 那侧的 unknown 硬按成本地形状——
// 产品改了字段名，这里不会红，只会读到 undefined。

/** 循环工程阶段 */
export type LoopPhase =
  | 'idle'         // 空闲
  | 'llm-thinking' // LLM 推理中
  | 'workflow'     // 7 步 HITL 执行中
  | 'awaiting'     // 等待用户确认
  | 'done'         // 完成
  | 'error'        // 出错
  | 'blocked'      // 被阻止（如 SSH 未连接）

/** Hook 返回值 */
export interface UseLoopEngineeringResult {
  /** 当前阶段 */
  phase: LoopPhase
  /** 关联 ID（启动后赋值） */
  correlationId: string | null
  /** LLM 推理结果 */
  hypothesis: LlmHypothesis | null
  /** 当前工作流状态 */
  workflowState: LoopStepState | null
  /** 决策卡片（confirm 步骤触发） */
  decisionCard: DecisionCard | null
  /** 最终决策卡片（done 事件携带） */
  finalCard: DecisionCard | null
  /** 错误信息 */
  error: string | null
  /** 被阻止的原因（blocked 阶段携带，如 'SSH_NO_CONNECTION'） */
  blockedReason: string | null
  /** 被阻止的提示消息（blocked 阶段携带） */
  blockedMessage: string | null
  /** 是否正在运行（llm-thinking / workflow / awaiting 三个阶段） */
  isRunning: boolean
  /** 启动循环工程 */
  start: (problem: string, connId: string, opts?: {
    providerId?: string
    strength?: 'fast' | 'standard' | 'deep'
  }) => Promise<void>
  /** 用户确认/拒绝 */
  confirm: (approved: boolean) => Promise<void>
  /** 取消工作流 */
  cancel: () => Promise<void>
  /** 重置状态 */
  reset: () => void
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useLoopEngineering(): UseLoopEngineeringResult {
  const [phase, setPhase] = useState<LoopPhase>('idle')
  const [correlationId, setCorrelationId] = useState<string | null>(null)
  const [hypothesis, setHypothesis] = useState<LlmHypothesis | null>(null)
  const [workflowState, setWorkflowState] = useState<LoopStepState | null>(null)
  const [decisionCard, setDecisionCard] = useState<DecisionCard | null>(null)
  const [finalCard, setFinalCard] = useState<DecisionCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)

  /** 用于在事件回调中读取最新 correlationId */
  const correlationRef = useRef<string | null>(null)

  /** 订阅 loop:* 事件 */
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    const api = window.electronAPI

    const offLlmStart = api.onLoopLlmStart((payload) => {
      if (payload.correlationId !== correlationRef.current) return
      setPhase('llm-thinking')
    })

    const offLlmDone = api.onLoopLlmDone((payload) => {
      if (payload.correlationId !== correlationRef.current) return
      setHypothesis(payload.hypothesis)
      setPhase('workflow')
    })

    const offStep = api.onLoopStep((payload) => {
      if (payload.correlationId !== correlationRef.current) return
      setWorkflowState(payload.state)
      // 如果当前是 confirm 步骤且 waitingForConfirmation，标记为 awaiting
      if (payload.state.currentStep === 'confirm' && payload.state.waitingForConfirmation) {
        setPhase('awaiting')
      } else if (payload.state.currentStep !== 'confirm') {
        // 其他步骤如果之前是 awaiting，回到 workflow
        setPhase((p) => (p === 'awaiting' ? 'workflow' : p))
      }
    })

    const offDecision = api.onLoopDecision((payload) => {
      if (payload.correlationId !== correlationRef.current) return
      // 结构守卫与 DecisionPage 同一条：卡片形状不对就留着上一张，不硬铸成 DecisionCard
      if (isDecisionCard(payload.decisionCard)) setDecisionCard(payload.decisionCard)
      setPhase('awaiting')
    })

    const offDone = api.onLoopDone((payload) => {
      if (payload.correlationId !== correlationRef.current) return
      // 这一路的 decisionCard 在契约上就是 unknown | null，原先 `as DecisionCard` 直接按成卡片，
      // 主进程少发一个字段也不会红 —— 现在按守卫收窄，不合格的当"没有最终卡片"
      setFinalCard(isDecisionCard(payload.decisionCard) ? payload.decisionCard : null)
      setPhase('done')
    })

    const offError = api.onLoopError((payload) => {
      if (payload.correlationId !== correlationRef.current) return
      setError(payload.error)
      setPhase('error')
    })

    const offBlocked = api.onLoopBlocked((payload) => {
      if (payload.correlationId !== correlationRef.current) return
      setBlockedReason(payload.reason)
      setBlockedMessage(payload.message)
      setPhase('blocked')
    })

    return () => {
      offLlmStart()
      offLlmDone()
      offStep()
      offDecision()
      offDone()
      offError()
      offBlocked()
    }
  }, [])

  /** 启动循环工程 */
  const start = useCallback(
    async (
      problem: string,
      connId: string,
      opts?: { providerId?: string; strength?: 'fast' | 'standard' | 'deep' }
    ): Promise<void> => {
      if (!isElectronAPIAvailable() || !window.electronAPI.loopStart) {
        setError('electronAPI / loopStart 不可用。请在 Electron 桌面端运行。')
        setPhase('error')
        return
      }

      // 重置状态
      setPhase('llm-thinking')
      setHypothesis(null)
      setWorkflowState(null)
      setDecisionCard(null)
      setFinalCard(null)
      setError(null)
      setBlockedReason(null)
      setBlockedMessage(null)

      try {
        const result = await window.electronAPI.loopStart({
          problem,
          connId,
          providerId: opts?.providerId,
          strength: opts?.strength,
        })

        if (result.status === 'error' || !result.correlationId) {
          setError(result.error ?? '启动循环工程失败')
          setPhase('error')
          return
        }

        setCorrelationId(result.correlationId)
        correlationRef.current = result.correlationId
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(`启动循环工程失败: ${msg}`)
        setPhase('error')
      }
    },
    []
  )

  /** 用户确认/拒绝 */
  const confirm = useCallback(
    async (approved: boolean): Promise<void> => {
      const cid = correlationRef.current
      if (!cid || !isElectronAPIAvailable() || !window.electronAPI.loopConfirm) return
      try {
        await window.electronAPI.loopConfirm(cid, approved)
        setDecisionCard(null)
        setPhase('workflow')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(`确认失败: ${msg}`)
      }
    },
    []
  )

  /** 取消工作流 */
  const cancel = useCallback(async (): Promise<void> => {
    const cid = correlationRef.current
    if (!cid || !isElectronAPIAvailable() || !window.electronAPI.loopCancel) return
    try {
      await window.electronAPI.loopCancel(cid)
      setPhase('idle')
      setCorrelationId(null)
      correlationRef.current = null
      setDecisionCard(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`取消失败: ${msg}`)
    }
  }, [])

  /** 重置状态 */
  const reset = useCallback(() => {
    setPhase('idle')
    setCorrelationId(null)
    correlationRef.current = null
    setHypothesis(null)
    setWorkflowState(null)
    setDecisionCard(null)
    setFinalCard(null)
    setError(null)
    setBlockedReason(null)
    setBlockedMessage(null)
  }, [])

  const isRunning = phase === 'llm-thinking' || phase === 'workflow' || phase === 'awaiting'

  return {
    phase,
    correlationId,
    hypothesis,
    workflowState,
    decisionCard,
    finalCard,
    error,
    blockedReason,
    blockedMessage,
    isRunning,
    start,
    confirm,
    cancel,
    reset,
  }
}
