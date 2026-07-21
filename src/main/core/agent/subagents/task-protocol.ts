/**
 * Subagent 调度 14 步协议（v0.9.4 批次 4 - 任务 1）
 *
 * 借鉴 Kilo Code 的 task 工具 14 步 subagent 调度流程：
 *   d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §4.3
 *
 * 完整 14 步流程（与 Kilo Code task 工具完全一致）：
 *   1. validate-input        — 校验输入（taskId / subagentName / input）
 *   2. check-permission      — 检查权限（用户审批 subagent 调度）
 *   3. load-subagent-config  — 加载 Subagent 配置（MODE_CONFIGS 或 .tdsf/agent/*.md）
 *   4. derive-permissions    — 派生权限（继承父会话的 deny 规则 + external_directory）
 *   5. prepare-context       — 准备上下文（构建 system prompt + 工具白名单）
 *   6. select-provider       — 选择 Provider（优先用 task.providerId，否则用默认）
 *   7. select-mode           — 选择 Mode（chat/ask/plan/code/debug，默认 chat）
 *   8. build-prompt          — 构建 prompt（system + user + attention）
 *   9. invoke-subagent       — 调用 Subagent（启动 LLM streamText）
 *  10. stream-output         — 流式输出（onToken 回调）
 *  11. collect-usage         — 收集 token usage（inputTokens / outputTokens / cost）
 *  12. validate-output       — 校验输出（非空 + 符合预期结构）
 *  13. cleanup               — 清理资源（关闭 stream / 释放 abortController）
 *  14. return-result         — 返回结果（汇总 StepResult 列表 + 总耗时）
 *
 * 设计要点：
 * - 每个步骤函数都是纯函数（不抛异常，异常 → success=false 的 StepResult）
 * - executeTaskProtocol 串行执行，失败立即返回，但保证 stepCleanup 总是被调用（try-finally）
 * - 步骤 1-8 是准备阶段，9-10 是执行阶段，11-14 是收尾阶段
 * - 当前版本步骤实现是骨架（仅记录日志 + 返回 success=true），接口完整可测试
 *
 * 方案书依据：v0.9.4 §11 第 6 类（Subagent 调度）
 */
import { logger } from '../../../services/log/logger'

/**
 * Subagent 调度 14 步流程（借鉴 Kilo Code task 工具）
 *
 * 顺序固定，名称与 Kilo Code 完全一致：
 * 1. validate-input → 2. check-permission → 3. load-subagent-config
 * → 4. derive-permissions → 5. prepare-context → 6. select-provider
 * → 7. select-mode → 8. build-prompt → 9. invoke-subagent
 * → 10. stream-output → 11. collect-usage → 12. validate-output
 * → 13. cleanup → 14. return-result
 */
export type TaskProtocolStep =
  | 'validate-input'
  | 'check-permission'
  | 'load-subagent-config'
  | 'derive-permissions'
  | 'prepare-context'
  | 'select-provider'
  | 'select-mode'
  | 'build-prompt'
  | 'invoke-subagent'
  | 'stream-output'
  | 'collect-usage'
  | 'validate-output'
  | 'cleanup'
  | 'return-result'

/**
 * 14 步顺序常量（与 Kilo Code 完全一致）
 *
 * 用于 executeTaskProtocol 串行遍历，以及测试断言顺序一致性。
 */
export const TASK_PROTOCOL_STEPS: readonly TaskProtocolStep[] = [
  'validate-input',
  'check-permission',
  'load-subagent-config',
  'derive-permissions',
  'prepare-context',
  'select-provider',
  'select-mode',
  'build-prompt',
  'invoke-subagent',
  'stream-output',
  'collect-usage',
  'validate-output',
  'cleanup',
  'return-result',
] as const

/**
 * 单步执行结果
 */
export interface StepResult {
  /** 步骤名 */
  step: TaskProtocolStep
  /** 是否成功 */
  success: boolean
  /** 步骤输出（可选） */
  output?: unknown
  /** 错误信息（失败时填充） */
  error?: string
  /** 耗时（ms） */
  durationMs: number
}

/**
 * 14 步调度上下文（贯穿整个流程）
 *
 * 由调用方（如 ExploreSubagent）在启动协议时初始化，
 * executeTaskProtocol 在执行过程中不断将 StepResult 追加到 completedSteps，
 * 同时递增 currentStep。
 */
export interface TaskProtocolContext {
  /** 任务 ID */
  taskId: string
  /** 父会话 ID（用于权限继承） */
  parentSessionId?: string
  /** 目标 Subagent 名称 */
  subagentName: string
  /** 任务输入 */
  input: unknown
  /** 已完成的步骤 */
  completedSteps: StepResult[]
  /** 当前步骤索引 */
  currentStep: number
  /** 是否已取消 */
  cancelled: boolean
}

/**
 * 子日志器（自动注入协议前缀）
 */
const log = logger.child('AGENT.SUBAGENT.PROTOCOL')

/**
 * 步骤函数签名
 *
 * 每个步骤函数接收当前上下文，返回 StepResult（不抛异常）。
 */
type StepFunction = (ctx: TaskProtocolContext) => Promise<StepResult> | StepResult

// ============================================================================
// 14 个步骤函数（骨架实现，仅记录日志 + 返回 success=true）
// ============================================================================

/**
 * 步骤 1：校验输入
 *
 * 检查 ctx.taskId / ctx.subagentName / ctx.input 是否合法。
 * - taskId 必须为非空字符串
 * - subagentName 必须为非空字符串
 * - input 允许任意值（包括 undefined / null）
 *
 * 当前版本：仅校验非空，返回 success=true。
 * 后续增强：根据 subagentName 查找已注册 Subagent，校验 input 结构。
 *
 * @param ctx 协议上下文
 */
export async function stepValidateInput(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    if (!ctx.taskId || typeof ctx.taskId !== 'string') {
      return {
        step: 'validate-input',
        success: false,
        error: 'taskId 必须为非空字符串',
        durationMs: Date.now() - start,
      }
    }
    if (!ctx.subagentName || typeof ctx.subagentName !== 'string') {
      return {
        step: 'validate-input',
        success: false,
        error: 'subagentName 必须为非空字符串',
        durationMs: Date.now() - start,
      }
    }
    log.debug('step 1/14 validate-input 通过', {
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
    })
    return {
      step: 'validate-input',
      success: true,
      output: { taskId: ctx.taskId, subagentName: ctx.subagentName },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'validate-input',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 2：检查权限
 *
 * 借鉴 Kilo Code：ctx.ask({ permission: "task", patterns: [subagent_type] })
 * - 用户审批 subagent 调度（可保存永久规则，下次同类自动通过）
 *
 * 当前版本：骨架，返回 success=true（默认允许）。
 * 后续增强：通过 IPC 推送审批请求到 UI，等待用户响应。
 *
 * @param ctx 协议上下文
 */
export async function stepCheckPermission(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 2/14 check-permission 通过（骨架实现，默认允许）', {
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
    })
    return {
      step: 'check-permission',
      success: true,
      output: { approved: true, source: 'skeleton-default' },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'check-permission',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 3：加载 Subagent 配置
 *
 * 借鉴 Kilo Code：agent.get(subagent_type) → 验证 agent 存在
 * - 从 MODE_CONFIGS / .tdsf/agent/*.md / 内置 Subagent 注册表加载配置
 *
 * 当前版本：骨架，返回 success=true。
 *
 * @param ctx 协议上下文
 */
export async function stepLoadSubagentConfig(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 3/14 load-subagent-config 通过（骨架实现）', {
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
    })
    return {
      step: 'load-subagent-config',
      success: true,
      output: {
        subagentName: ctx.subagentName,
        loaded: true,
        source: 'skeleton',
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'load-subagent-config',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 4：派生权限
 *
 * 借鉴 Kilo Code：deriveSubagentSessionPermission({ parentSessionPermission, subagent })
 * - 继承父 session 的 deny 规则和 external_directory 规则
 *
 * 当前版本：骨架，返回 success=true。
 *
 * @param ctx 协议上下文
 */
export async function stepDerivePermissions(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 4/14 derive-permissions 通过（骨架实现）', {
      taskId: ctx.taskId,
      parentSessionId: ctx.parentSessionId,
    })
    return {
      step: 'derive-permissions',
      success: true,
      output: {
        parentSessionId: ctx.parentSessionId ?? null,
        inherited: true,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'derive-permissions',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 5：准备上下文
 *
 * 借鉴 Kilo Code：KiloTask.inherited + KiloTask.merge
 * - 继承父 agent 的 edit/bash/MCP 限制，合并所有 permission ruleset
 *
 * 当前版本：骨架，返回 success=true。
 *
 * @param ctx 协议上下文
 */
export async function stepPrepareContext(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 5/14 prepare-context 通过（骨架实现）', {
      taskId: ctx.taskId,
    })
    return {
      step: 'prepare-context',
      success: true,
      output: {
        prepared: true,
        inputType: typeof ctx.input,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'prepare-context',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 6：选择 Provider
 *
 * 借鉴 Kilo Code：KiloTask.resolveModel({ name, agent, config, parent, variant, provider })
 * - subagent 可继承父 model 或自定义
 *
 * 当前版本：骨架，返回 success=true。
 * 后续增强：通过 provider-registry.getProvider(task.providerId) 解析。
 *
 * @param ctx 协议上下文
 */
export async function stepSelectProvider(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 6/14 select-provider 通过（骨架实现）', {
      taskId: ctx.taskId,
    })
    return {
      step: 'select-provider',
      success: true,
      output: {
        providerId: 'default',
        resolved: true,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'select-provider',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 7：选择 Mode
 *
 * 借鉴 Kilo Code：mode 即 primary agent，subagent 用 ask/chat 只读模式
 * - Explore Subagent 默认用 chat 模式（只读）
 *
 * 当前版本：骨架，返回 success=true。
 *
 * @param ctx 协议上下文
 */
export async function stepSelectMode(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 7/14 select-mode 通过（骨架实现）', {
      taskId: ctx.taskId,
    })
    return {
      step: 'select-mode',
      success: true,
      output: {
        mode: 'chat',
        source: 'skeleton-default',
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'select-mode',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 8：构建 prompt
 *
 * - system prompt（来自 mode config）+ user prompt（来自 task.input）
 * - 注入 attention context（如果存在）
 *
 * 当前版本：骨架，返回 success=true。
 *
 * @param ctx 协议上下文
 */
export async function stepBuildPrompt(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 8/14 build-prompt 通过（骨架实现）', {
      taskId: ctx.taskId,
    })
    return {
      step: 'build-prompt',
      success: true,
      output: {
        systemPrompt: '(skeleton)',
        userPrompt: typeof ctx.input === 'string' ? ctx.input : JSON.stringify(ctx.input),
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'build-prompt',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 9：调用 Subagent
 *
 * 借鉴 Kilo Code：ops.prompt({ sessionID, tools: { question: false, interactive_terminal: false } })
 * - 在子 session 中执行，subagent 不能 question、不能 interactive_terminal
 *
 * 当前版本：骨架，返回 success=true。
 * 后续增强：实际调用 streamText / Claude SDK。
 *
 * @param ctx 协议上下文
 */
export async function stepInvokeSubagent(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 9/14 invoke-subagent 通过（骨架实现）', {
      taskId: ctx.taskId,
    })
    return {
      step: 'invoke-subagent',
      success: true,
      output: {
        invoked: true,
        sessionId: ctx.parentSessionId ?? null,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'invoke-subagent',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 10：流式输出
 *
 * 借鉴 Kilo Code：foreground 等待结果，返回给父 agent
 * - 通过 onToken 回调推送增量到 UI
 *
 * 当前版本：骨架，返回 success=true。
 *
 * @param ctx 协议上下文
 */
export async function stepStreamOutput(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 10/14 stream-output 通过（骨架实现）', {
      taskId: ctx.taskId,
    })
    return {
      step: 'stream-output',
      success: true,
      output: {
        chunksCount: 0,
        totalLength: 0,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'stream-output',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 11：收集 token usage
 *
 * 借鉴 Kilo Code：KiloCostPropagation.propagate(parentSessionID, costDelta)
 * - 子 session 成本传播到父 session
 *
 * 当前版本：骨架，返回 success=true。
 * 后续增强：实际从 streamText result.usage 读取 + 通过 recordTokenUsage 记录。
 *
 * @param ctx 协议上下文
 */
export async function stepCollectUsage(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 11/14 collect-usage 通过（骨架实现）', {
      taskId: ctx.taskId,
    })
    return {
      step: 'collect-usage',
      success: true,
      output: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'collect-usage',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 12：校验输出
 *
 * - 检查 stream-output 步骤的输出是否非空
 * - 检查输出结构是否符合预期（不同 Subagent 有不同结构）
 *
 * 当前版本：骨架，返回 success=true。
 *
 * @param ctx 协议上下文
 */
export async function stepValidateOutput(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 12/14 validate-output 通过（骨架实现）', {
      taskId: ctx.taskId,
    })
    return {
      step: 'validate-output',
      success: true,
      output: {
        valid: true,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'validate-output',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 13：清理资源
 *
 * - 关闭 stream（如果还在运行）
 * - 释放 abortController
 * - 释放其他临时资源
 *
 * 当前版本：骨架，返回 success=true。
 * 注意：此步骤在 executeTaskProtocol 中通过 try-finally 保证总是被调用。
 *
 * @param ctx 协议上下文
 */
export async function stepCleanup(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    log.debug('step 13/14 cleanup 通过（骨架实现）', {
      taskId: ctx.taskId,
      completedSteps: ctx.completedSteps.length,
    })
    return {
      step: 'cleanup',
      success: true,
      output: {
        cleaned: true,
        completedStepCount: ctx.completedSteps.length,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'cleanup',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 14：返回结果
 *
 * - 汇总所有 StepResult
 * - 计算总耗时
 * - 构造最终 SubagentResult
 *
 * 当前版本：骨架，返回 success=true。
 *
 * @param ctx 协议上下文
 */
export async function stepReturnResult(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    const totalDurationMs = ctx.completedSteps.reduce((sum, s) => sum + s.durationMs, 0)
    const allSuccess = ctx.completedSteps.every((s) => s.success)
    log.debug('step 14/14 return-result 通过（骨架实现）', {
      taskId: ctx.taskId,
      completedSteps: ctx.completedSteps.length,
      totalDurationMs,
      allSuccess,
    })
    return {
      step: 'return-result',
      success: true,
      output: {
        totalDurationMs,
        completedSteps: ctx.completedSteps.length,
        allSuccess,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'return-result',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

// ============================================================================
// 步骤函数注册表（按 14 步顺序）
// ============================================================================

/**
 * 14 个步骤函数的有序映射表
 *
 * 用于 executeTaskProtocol 串行执行，以及测试单独调用某步骤。
 */
export const STEP_FUNCTIONS: Record<TaskProtocolStep, StepFunction> = {
  'validate-input': stepValidateInput,
  'check-permission': stepCheckPermission,
  'load-subagent-config': stepLoadSubagentConfig,
  'derive-permissions': stepDerivePermissions,
  'prepare-context': stepPrepareContext,
  'select-provider': stepSelectProvider,
  'select-mode': stepSelectMode,
  'build-prompt': stepBuildPrompt,
  'invoke-subagent': stepInvokeSubagent,
  'stream-output': stepStreamOutput,
  'collect-usage': stepCollectUsage,
  'validate-output': stepValidateOutput,
  'cleanup': stepCleanup,
  'return-result': stepReturnResult,
}

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
