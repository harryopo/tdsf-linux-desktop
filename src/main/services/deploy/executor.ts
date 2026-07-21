/**
 * 部署执行器
 *
 * 职责：
 * - 串行执行部署计划中的每一步（SSH exec）
 * - 实时推送日志到渲染进程（stdout / stderr / system）
 * - 失败时根据配置自动回滚（可选）
 * - 收集每步结果，最终返回 DeployResult
 *
 * 关键设计：
 * - 状态保存在内存 Map<planId, PlanState>
 * - 主进程通过 webContents.send 推送 deploy:log / deploy:stepUpdate / deploy:done
 * - 失败时如需回滚，rollback 步骤也用同一通道推送日志
 */

import { BrowserWindow } from 'electron'
import { SshConnectionManager } from '../ssh/connection-manager'
import type {
  DeployPlan,
  DeployStep,
  DeployStepResult,
  DeployResult,
  DeployLogEvent
} from './types'

/** 事件通道 */
const CH_LOG = 'deploy:log'
const CH_STEP = 'deploy:stepUpdate'
const CH_DONE = 'deploy:done'

/** 计划状态（运行时） */
interface PlanState {
  plan: DeployPlan
  results: DeployStepResult[]
  currentIndex: number
  aborted: boolean
  startedAt: number
  window: BrowserWindow
}

/** 执行器单例状态 */
const planStates = new Map<string, PlanState>()

/**
 * 安全推送（窗口可能已销毁）
 */
function safeSend(window: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (window.isDestroyed()) return
  try {
    window.webContents.send(channel, ...args)
  } catch {
    // 忽略序列化错误
  }
}

/**
 * 推送日志事件
 */
function emitLog(state: PlanState, stepId: string, stream: 'stdout' | 'stderr' | 'system', data: string): void {
  const event: DeployLogEvent = {
    planId: state.plan.id,
    stepId,
    stream,
    data,
    timestamp: Date.now()
  }
  safeSend(state.window, CH_LOG, event)
}

/**
 * 推送步骤更新
 */
function emitStepUpdate(state: PlanState, result: DeployStepResult): void {
  safeSend(state.window, CH_STEP, {
    planId: state.plan.id,
    step: result
  })
}

/**
 * 执行单条 SSH 命令并收集结果
 *
 * @param state 计划状态
 * @param step 步骤定义
 * @returns 步骤执行结果
 */
async function runStep(state: PlanState, step: DeployStep): Promise<DeployStepResult> {
  const stepResult: DeployStepResult = {
    stepId: step.id,
    description: step.description,
    command: step.command,
    risk: step.risk,
    exitCode: null,
    stdout: '',
    stderr: '',
    durationMs: 0,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null
  }

  emitLog(state, step.id, 'system', `\n▶️ [${step.id}] ${step.description}\n$ ${step.command}\n`)
  emitStepUpdate(state, stepResult)

  const sshManager = SshConnectionManager.getInstance()
  const start = Date.now()

  try {
    const cmdResult = await sshManager.exec(
      // 从 plan.targetHost 解析 sessionId 需要额外信息；
      // 这里通过附加的 sessionId 字段传递
      (state as unknown as { sessionId: string }).sessionId,
      step.command
    )

    stepResult.exitCode = cmdResult.exitCode
    stepResult.stdout = cmdResult.stdout
    stepResult.stderr = cmdResult.stderr
    stepResult.durationMs = Date.now() - start
    stepResult.finishedAt = Date.now()

    if (cmdResult.stdout) emitLog(state, step.id, 'stdout', cmdResult.stdout)
    if (cmdResult.stderr) emitLog(state, step.id, 'stderr', cmdResult.stderr)

    if (cmdResult.exitCode === 0) {
      stepResult.status = 'success'
      emitLog(state, step.id, 'system', `✅ 完成 (${stepResult.durationMs}ms)\n`)
    } else {
      stepResult.status = 'failed'
      stepResult.error = `退出码 ${cmdResult.exitCode}`
      emitLog(state, step.id, 'system', `❌ 失败 (退出码 ${cmdResult.exitCode}, ${stepResult.durationMs}ms)\n`)
    }
  } catch (err) {
    stepResult.status = 'failed'
    stepResult.error = (err as Error).message
    stepResult.durationMs = Date.now() - start
    stepResult.finishedAt = Date.now()
    emitLog(state, step.id, 'system', `💥 异常: ${stepResult.error}\n`)
  }

  emitStepUpdate(state, stepResult)
  return stepResult
}

/**
 * 执行回滚
 *
 * 从后往前执行成功步骤的 rollback 命令。
 * 不抛出异常（回滚失败不影响主流程状态）。
 */
async function runRollback(state: PlanState): Promise<void> {
  emitLog(state, 'rollback', 'system', '\n🔄 开始执行回滚...\n')

  // 从后往前找成功的步骤
  for (let i = state.results.length - 1; i >= 0; i--) {
    const result = state.results[i]
    if (result.status !== 'success') continue

    const step = state.plan.steps.find((s) => s.id === result.stepId)
    if (!step || !step.rollback) continue

    emitLog(state, 'rollback', 'system', `\n↩️ 回滚: ${step.description}\n$ ${step.rollback}\n`)
    try {
      const sshManager = SshConnectionManager.getInstance()
      const r = await sshManager.exec(
        (state as unknown as { sessionId: string }).sessionId,
        step.rollback
      )
      if (r.exitCode === 0) {
        emitLog(state, 'rollback', 'system', `✅ 回滚成功\n`)
      } else {
        emitLog(state, 'rollback', 'system', `⚠️ 回滚退出码 ${r.exitCode}\n`)
      }
    } catch (err) {
      emitLog(state, 'rollback', 'system', `⚠️ 回滚异常: ${(err as Error).message}\n`)
    }
  }

  emitLog(state, 'rollback', 'system', '\n🏁 回滚流程结束\n')
}

/**
 * 执行部署计划
 *
 * @param plan 部署计划
 * @param sessionId SSH 会话 ID
 * @param window 主窗口（用于推送事件）
 * @param onStep 每步完成后的回调（用于 UI 更新）
 * @returns 部署结果
 */
export async function executePlan(
  plan: DeployPlan,
  sessionId: string,
  window: BrowserWindow
): Promise<DeployResult> {
  const state: PlanState & { sessionId: string } = {
    plan,
    results: [],
    currentIndex: 0,
    aborted: false,
    startedAt: Date.now(),
    window,
    sessionId
  }
  planStates.set(plan.id, state)
  plan.status = 'running'

  emitLog(state, 'init', 'system', `🚀 开始执行部署计划: ${plan.templateName}\n📡 目标: ${plan.targetHost}\n📋 共 ${plan.steps.length} 步\n`)

  for (let i = 0; i < plan.steps.length; i++) {
    state.currentIndex = i
    const step = plan.steps[i]
    const result = await runStep(state, step)
    state.results.push(result)

    if (result.status === 'failed' || state.aborted) {
      plan.status = state.aborted ? 'cancelled' : 'failed'
      emitLog(state, 'done', 'system', `\n❌ 部署${state.aborted ? '已取消' : '失败'}，开始回滚...\n`)
      await runRollback(state)
      if (state.aborted) {
        plan.status = 'cancelled'
      }
      break
    }
  }

  if (plan.status === 'running') {
    plan.status = 'success'
    emitLog(state, 'done', 'system', `\n🎉 全部 ${plan.steps.length} 步执行成功！\n`)
  }

  const successCount = state.results.filter((r) => r.status === 'success').length
  const failedCount = state.results.filter((r) => r.status === 'failed').length
  const result: DeployResult = {
    planId: plan.id,
    templateName: plan.templateName,
    targetHost: plan.targetHost,
    totalDurationMs: Date.now() - state.startedAt,
    steps: state.results,
    status: plan.status,
    successCount,
    failedCount,
    finishedAt: Date.now()
  }

  safeSend(window, CH_DONE, result)
  planStates.delete(plan.id)
  return result
}

/**
 * 取消正在执行的部署
 *
 * @param planId 计划 ID
 * @returns 是否找到并取消
 */
export function cancelPlan(planId: string): boolean {
  const state = planStates.get(planId)
  if (!state) return false
  state.aborted = true
  emitLog(state, 'cancel', 'system', '\n⚠️ 用户请求取消...\n')
  return true
}

/**
 * 获取计划当前状态
 */
export function getPlanState(planId: string): { status: string; currentIndex: number; total: number } | null {
  const state = planStates.get(planId)
  if (!state) return null
  return {
    status: state.plan.status,
    currentIndex: state.currentIndex,
    total: state.plan.steps.length
  }
}
