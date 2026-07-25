/**
 * usePaorLoop — PAOR 自动循环 Hook（v0.9.5 P0-3 补全 IPC 4 步同步）
 *
 * 设计目标：
 * - 封装 agentPaor 启动 + onAgentPaorIteration 进度订阅 + paorApprove 审批响应
 * - 管理 isRunning / iterations / result / error 状态
 * - 自动订阅迭代事件，卸载时取消订阅
 * - 不与 useAgentChat 冲突（独立的 PAOR 流，不影响 agent:chat）
 *
 * 输入输出契约：
 *   输入：无（通过 start 方法传入 task / sshSessionId / maxIterations）
 *   输出：isRunning / iterations / result / error / start / cancel
 *
 * 与 useLoopEngineering 的区别：
 * - useLoopEngineering：v1.5 循环工程（7 步 HITL，前端编排）
 * - usePaorLoop：v0.9.5 PAOR（Plan→Act→Observe→Reflect，主进程 Supervisor 编排）
 *
 * 数据流：
 *   start(task, sessionId) → agentPaor invoke → 主进程 supervisor.runPaorLoop
 *   主进程每轮迭代 → agent:paor:iteration push → onAgentPaorIteration 回调 → iterations 更新
 *   主进程完成 → invoke 返回 PaorLoopResult → result 更新
 *   高危命令 → paor:approval-request push → AIPanel 弹窗 → paorApprove invoke
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PaorIteration,
  PaorLoopResult,
} from '@shared/paor-types'

/** usePaorLoop 返回值 */
export interface UsePaorLoopResult {
  /** PAOR 循环是否正在运行（invoke 未返回） */
  isRunning: boolean
  /** 已接收的迭代列表（按 iteration 升序） */
  iterations: PaorIteration[]
  /** 最终结果（invoke 返回后设置） */
  result: PaorLoopResult | null
  /** 错误信息（null 表示无错误） */
  error: string | null
  /** 已接收到的最大迭代序号（用于 UI 显示进度） */
  currentIteration: number
  /**
   * 启动 PAOR 自动循环
   *
   * @param task 运维任务描述
   * @param sshSessionId SSH 会话 ID
   * @param maxIterations 最大迭代次数（默认 5）
   * @returns 启动是否成功（false 表示环境不支持或参数无效）
   */
  start: (task: string, sshSessionId: string, maxIterations?: number) => Promise<boolean>
  /**
   * 重置 PAOR 状态（清空 iterations / result / error，便于下一次启动）
   *
   * 注意：不会取消正在运行的 PAOR（主进程目前不支持取消 PAOR，
   * 只能等迭代上限或人工 abort）
   */
  reset: () => void
}

/**
 * usePaorLoop Hook 实现
 *
 * 注意事项：
 * 1. 主进程目前不支持取消 PAOR（无 agent:paor:cancel 通道），所以本 hook 不提供 cancel 方法。
 *    用户如需中止，可通过 paorApprove(callId, false) 拒绝高危命令，主进程会标记 riskBlocked 并继续下一步。
 * 2. iterations 在 invoke 返回前实时更新，invoke 返回后 result.iterations 为完整列表（与 iterations 一致）。
 * 3. 卸载时自动取消订阅 onAgentPaorIteration，但不取消正在运行的 PAOR（主进程仍会执行完毕）。
 */
export function usePaorLoop(): UsePaorLoopResult {
  const [isRunning, setIsRunning] = useState(false)
  const [iterations, setIterations] = useState<PaorIteration[]>([])
  const [result, setResult] = useState<PaorLoopResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 当前活跃 SSH 会话 ID（用于过滤 iteration 事件，避免多会话混淆）
  const activeSessionIdRef = useRef<string | null>(null)

  /** 当前迭代序号（iterations 中最大的 iteration 字段，0 表示尚未收到） */
  const currentIteration = iterations.reduce((max, it) => Math.max(max, it.iteration), 0)

  // ===== 订阅 PAOR 迭代进度 =====
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onAgentPaorIteration) return
    const unsubscribe = api.onAgentPaorIteration((event) => {
      // 仅处理当前活跃会话的迭代事件（避免多会话混淆）
      if (
        activeSessionIdRef.current &&
        event.sshSessionId !== activeSessionIdRef.current
      ) {
        return
      }
      setIterations((prev) => {
        // 避免重复（同一 iteration 序号只保留最新）
        const existing = prev.find((it) => it.iteration === event.iteration.iteration)
        if (existing) {
          return prev.map((it) =>
            it.iteration === event.iteration.iteration ? event.iteration : it,
          )
        }
        return [...prev, event.iteration]
      })
    })
    return () => {
      unsubscribe()
    }
  }, [])

  // ===== start：启动 PAOR 循环 =====
  const start = useCallback(
    async (
      task: string,
      sshSessionId: string,
      maxIterations?: number,
    ): Promise<boolean> => {
      const api = window.electronAPI
      if (!api?.agentPaor) {
        setError('当前环境不支持 PAOR（非 Electron 环境或 preload 未暴露 agentPaor）')
        return false
      }
      if (!task.trim()) {
        setError('任务描述不能为空')
        return false
      }
      if (!sshSessionId) {
        setError('SSH 会话 ID 不能为空（请先连接 SSH 服务器）')
        return false
      }
      if (isRunning) {
        console.warn('[usePaorLoop] PAOR 已在运行中，忽略重复启动')
        return false
      }

      // 重置状态（清空上一次的结果）
      setIterations([])
      setResult(null)
      setError(null)
      setIsRunning(true)
      activeSessionIdRef.current = sshSessionId

      try {
        const paorResult = await api.agentPaor(task, sshSessionId, maxIterations)
        setResult(paorResult)
        // 用最终结果的 iterations 覆盖（确保完整性，主进程的最终结果包含所有迭代）
        if (paorResult?.iterations) {
          setIterations(paorResult.iterations)
        }
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[usePaorLoop] agentPaor failed:', err)
        setError(`PAOR 循环失败：${message}`)
        return false
      } finally {
        setIsRunning(false)
        activeSessionIdRef.current = null
      }
    },
    [isRunning],
  )

  // ===== reset：清空状态 =====
  const reset = useCallback(() => {
    setIterations([])
    setResult(null)
    setError(null)
    setIsRunning(false)
    activeSessionIdRef.current = null
  }, [])

  return {
    isRunning,
    iterations,
    result,
    error,
    currentIteration,
    start,
    reset,
  }
}

export default usePaorLoop
