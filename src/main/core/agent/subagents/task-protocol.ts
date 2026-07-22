/**
 * Subagent 调度 14 步协议（v2.0 Phase D - 任务协议补齐）
 *
 * 借鉴 Kilo Code 的 task 工具 14 步 subagent 调度流程：
 *   d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §4.3
 *
 * 完整 14 步流程（与 Kilo Code task 工具完全一致）：
 *   1. validate-input        — 校验输入（taskId / subagentName / input）
 *   2. check-permission      — 检查权限（用户审批 subagent 调度）
 *   3. load-subagent-config  — 加载 Subagent 配置（SubagentRegistry / .tdsf/agent/*.md）
 *   4. derive-permissions    — 派生权限（继承父会话的 deny 规则 + external_directory）
 *   5. prepare-context       — 准备上下文（构建 attention context + 工具白名单）
 *   6. select-provider       — 选择 Provider（优先用 input.providerId，否则用默认）
 *   7. select-mode           — 选择 Mode（chat/ask/plan/code/debug，默认 chat）
 *   8. build-prompt          — 构建 prompt（system + user + attention + compaction）
 *   9. invoke-subagent       — 调用 Subagent（streamText / ClaudeSdkProvider.generate）
 *  10. stream-output         — 流式输出（提取 chatResult.text 到 ctx.output）
 *  11. collect-usage         — 收集 token usage（inputTokens / outputTokens / cost）
 *  12. validate-output       — 校验输出（非空 + finishReason 非 error）
 *  13. cleanup               — 清理资源（释放 abortController）
 *  14. return-result         — 返回结果（汇总 StepResult 列表 + 总耗时）
 *
 * v2.0 Phase D 重构：
 * - 文件拆分为 3 个文件，避免单文件超过 500 行（项目规范）
 * - task-protocol-types.ts：类型 + 常量（独立，避免循环依赖）
 * - task-protocol-steps.ts：14 步真实逻辑实现 + STEP_FUNCTIONS
 * - task-protocol.ts（本文件）：入口 + executeTaskProtocol + createTaskProtocolContext
 *
 * 设计要点：
 * - 每个步骤函数都是纯函数（不抛异常，异常 → success=false 的 StepResult）
 * - executeTaskProtocol 串行执行，失败立即返回，但保证 stepCleanup 总是被调用（try-finally）
 * - 步骤 1-8 是准备阶段，9-10 是执行阶段，11-14 是收尾阶段
 * - v2.0 Phase D：14 步全部补齐真实逻辑（不再仅是桩）
 *
 * 方案书依据：v0.9.4 §11 第 6 类（Subagent 调度）+ v2.0 Phase D
 */
// 类型与常量（re-export，保持 import 路径兼容）
export type {
  TaskProtocolStep,
  StepResult,
  TaskProtocolContext,
  StepFunction,
  SubagentMeta,
  DerivedPermissions,
  StepUsage,
  ProviderModelInstance,
} from './task-protocol-types'
export { TASK_PROTOCOL_STEPS } from './task-protocol-types'

// 步骤函数 + 注册表（re-export，保持 import 路径兼容）
export {
  stepValidateInput,
  stepCheckPermission,
  stepLoadSubagentConfig,
  stepDerivePermissions,
  stepPrepareContext,
  stepSelectProvider,
  stepSelectMode,
  stepBuildPrompt,
  stepInvokeSubagent,
  stepStreamOutput,
  stepCollectUsage,
  stepValidateOutput,
  stepCleanup,
  stepReturnResult,
  STEP_FUNCTIONS,
} from './task-protocol-steps'

// 内部依赖：仅执行器需要 STEP_FUNCTIONS / stepCleanup / stepReturnResult
import { STEP_FUNCTIONS, stepCleanup, stepReturnResult } from './task-protocol-steps'
import { TASK_PROTOCOL_STEPS } from './task-protocol-types'
import type { TaskProtocolContext, StepResult } from './task-protocol-types'
import { logger } from '../../../services/log/logger'
// P2-I: 任务记忆沉淀服务（step 14 之后调用，幂等 + 静默吞错）
import { sedimentTaskMemory } from '../../memory/task-sediment'

/**
 * 子日志器（自动注入协议前缀）
 */
const log = logger.child('AGENT.SUBAGENT.PROTOCOL')

/**
 * 执行 14 步 subagent 调度协议
 *
 * 借鉴 Kilo Code task 工具的完整流程：
 * 1. validate-input → 2. check-permission → 3. load-subagent-config
 * → 4. derive-permissions → 5. prepare-context → 6. select-provider
 * → 7. select-mode → 8. build-prompt → 9. invoke-subagent
 * → 10. stream-output → 11. collect-usage → 12. validate-output
 * → 13. cleanup → 14. return-result
 *
 * 设计要点：
 * - 串行执行 14 个步骤，每个步骤的 StepResult 追加到 ctx.completedSteps
 * - 任何步骤失败立即终止后续步骤，但 stepCleanup 总是通过 try-finally 调用
 * - 步骤函数不抛异常（异常 → success=false），所以 try-catch 主要用于防御性兜底
 * - 返回的 ctx 包含完整的 completedSteps 历史，调用方可提取最后一步的 output 作为最终结果
 *
 * @param ctx 初始上下文（调用方填充 taskId / subagentName / input）
 * @returns 完成后的上下文（包含全部 StepResult）
 */
export async function executeTaskProtocol(
  ctx: TaskProtocolContext
): Promise<TaskProtocolContext> {
  log.info('开始执行 14 步 subagent 调度协议', {
    taskId: ctx.taskId,
    subagentName: ctx.subagentName,
    parentSessionId: ctx.parentSessionId,
  })

  // 标记开始时间（step 14 用于计算总耗时）
  if (ctx.startTime === undefined) {
    ctx.startTime = Date.now()
  }

  let failedStep: StepResult | null = null

  try {
    // 串行执行 14 个步骤
    for (let i = 0; i < TASK_PROTOCOL_STEPS.length; i++) {
      const stepName = TASK_PROTOCOL_STEPS[i]

      // 如果已取消，跳过非 cleanup 步骤
      if (ctx.cancelled && stepName !== 'cleanup' && stepName !== 'return-result') {
        log.info('协议已取消，跳过步骤', { step: stepName, index: i })
        continue
      }

      ctx.currentStep = i
      const stepFn = STEP_FUNCTIONS[stepName]

      let result: StepResult
      try {
        result = await stepFn(ctx)
      } catch (err) {
        // 步骤函数理论上不抛异常，此处防御性兜底
        const errMsg = err instanceof Error ? err.message : String(err)
        result = {
          step: stepName,
          success: false,
          error: errMsg,
          durationMs: 0,
        }
      }

      ctx.completedSteps.push(result)
      ctx.currentStep = i + 1

      if (!result.success) {
        log.warn('step failed', {
          step: stepName,
          error: result.error,
          taskId: ctx.taskId,
        })
        failedStep = result
        break // 退出 for 循环，转 finally 执行 cleanup
      }
    }
  } finally {
    // 保证 cleanup 总是被调用（即使前面步骤失败）
    // 检查是否已执行过 cleanup（如果失败发生在 cleanup 自身则不再重复）
    const hasCleanup = ctx.completedSteps.some((s) => s.step === 'cleanup')
    if (!hasCleanup) {
      try {
        const cleanupResult = await stepCleanup(ctx)
        ctx.completedSteps.push(cleanupResult)
        if (!cleanupResult.success) {
          log.warn('cleanup step failed', {
            error: cleanupResult.error,
            taskId: ctx.taskId,
          })
        }
      } catch (err) {
        log.warn('cleanup step exception', {
          error: err instanceof Error ? err.message : String(err),
          taskId: ctx.taskId,
        })
      }
    }

    // 同样保证 return-result 总是被调用
    const hasReturn = ctx.completedSteps.some((s) => s.step === 'return-result')
    if (!hasReturn && !ctx.cancelled) {
      try {
        const returnResult = await stepReturnResult(ctx)
        ctx.completedSteps.push(returnResult)
      } catch (err) {
        log.warn('return-result step exception', {
          error: err instanceof Error ? err.message : String(err),
          taskId: ctx.taskId,
        })
      }
    }

    // P2-I: 任务记忆沉淀（step 14 之后调用）
    // 双轨写入：知识库 + Markdown；幂等 + 错误降级链 + AttentionTracker.reset()
    // 静默吞错：沉淀失败绝不影响主任务返回
    if (!ctx.cancelled) {
      try {
        const sedimentResult = await sedimentTaskMemory(ctx)
        log.info('任务记忆沉淀完成', {
          taskId: ctx.taskId,
          sedimentId: sedimentResult.sedimentId,
          writtenTo: sedimentResult.writtenTo,
          reason: sedimentResult.reason,
          lessonsCount: sedimentResult.lessons.length,
          attentionArchived: sedimentResult.attentionArchived,
        })
      } catch (err) {
        // 静默吞错：仅记录日志，不影响主任务返回
        log.warn('任务记忆沉淀异常（静默吞错）', {
          taskId: ctx.taskId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  log.info('14 步 subagent 调度协议完成', {
    taskId: ctx.taskId,
    completedSteps: ctx.completedSteps.length,
    failedStep: failedStep?.step ?? null,
  })

  return ctx
}

/**
 * 工厂函数：创建初始协议上下文
 *
 * @param taskId 任务 ID
 * @param subagentName Subagent 名称
 * @param input 任务输入
 * @param parentSessionId 父会话 ID（可选）
 */
export function createTaskProtocolContext(
  taskId: string,
  subagentName: string,
  input: unknown,
  parentSessionId?: string
): TaskProtocolContext {
  return {
    taskId,
    parentSessionId,
    subagentName,
    input,
    completedSteps: [],
    currentStep: 0,
    cancelled: false,
  }
}
