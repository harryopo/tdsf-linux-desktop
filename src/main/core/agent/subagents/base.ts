/**
 * Subagent 基础抽象类
 *
 * 现在只有一个使用者：`loop-engineering-subagent`（由 `ipc/loop-engineering.ts` 起）。
 * 这里留的是那条链真正需要的三件东西——统一的任务/结果形状、异常包装、计时与日志。
 *
 * 职责：
 * - 提供 BaseSubagent 抽象基类（公共日志 + 异常不外抛的 execute 包装）
 * - 定义 SubagentTask / SubagentResult 类型契约
 *
 * 设计要点：
 * - execute(task) 必须返回 SubagentResult（不抛异常，异常转为 success=false 的结果）
 * - **这里没有审批闸门**。2026-10-25 #218 摘掉了原来那段：它先 `await doExecute()` 把任务真的跑完，
 *   再按强度把结果丢掉、换成一个 `{success:false, error:'等待人工审批'}` 的占位返回，
 *   而那个 requestApproval 只写日志、从不推卡片——拦不住任何东西，还会把跑完的结论吃掉。
 *   循环工程真正把关的地方是 `agent-workflow.ts` 的 confirm 步：它在 execute **之前**暂停，
 *   把决策卡推给界面等人点（见 src/main/core/agent-workflow.ts 的 waitForConfirmation）。
 */
import { randomUUID } from 'node:crypto'
import { logger } from '../../../services/log/logger'
import type { ThinkingStrength } from '../providers/types'

/**
 * Subagent 任务输入
 *
 * 由调用方构造（现在只有 `ipc/loop-engineering.ts` 用 createSubagentTask 造一份）。
 */
export interface SubagentTask {
  /** 任务唯一 ID（便于审计与日志追踪） */
  id: string
  /** 任务类型（与 Subagent name 对应，如 'coding' / 'thinking' / 'running'） */
  type: string
  /** 任务描述（自然语言，由 Supervisor 生成） */
  description: string
  /** 任务输入（任意结构化数据，由各 Subagent 自行解析） */
  input: unknown
  /** 关联的会话 ID（用于 SSH 命令执行、文件读写等） */
  sessionId?: string
  /** 关联的 Provider ID（决定使用哪个 LLM 后端） */
  providerId?: string
  /** 思考强度（影响 maxSubagents / reflectRounds） */
  strength?: ThinkingStrength
  /** 最大 token 预算（可选，超出时 Subagent 应主动停止） */
  maxTokens?: number
  /** 截止时间（ms 时间戳，超出时 Subagent 应主动停止） */
  deadline?: number
  /** 关联 ID（用于跨调用日志追踪） */
  correlationId?: string
}

/**
 * Subagent 执行结果
 *
 * 约定：execute 不抛异常，所有异常都转为 success=false 的 SubagentResult。
 */
export interface SubagentResult {
  /** 关联的任务 ID */
  taskId: string
  /** 是否成功 */
  success: boolean
  /** 输出内容（结构化或字符串，由各 Subagent 自行约定） */
  output: unknown
  /** 错误信息（success=false 时有值） */
  error?: string
  /** Token 使用（用于统计） */
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  /** 自评置信度 [0, 1]（用于 v1.1 可信度融合） */
  confidence?: number
  /** 执行耗时（ms） */
  durationMs: number
}

/**
 * BaseSubagent 抽象基类
 *
 * 提供公共能力：
 * - 受保护日志器（自动注入 subagent name 前缀）
 * - 异常捕获包装（execute → 失败结果，绝不外抛）
 *
 * 子类只需实现 doExecute(task) 实现具体业务逻辑。
 */
export abstract class BaseSubagent {
  /** Subagent 名称（如 'coding'） */
  abstract readonly name: string
  /** 显示名称（如 '编程 Subagent'） */
  abstract readonly displayName: string
  /** 简短描述 */
  abstract readonly description: string

  /**
   * 受保护的日志器（自动注入 subagent name 前缀）
   */
  protected readonly log = logger.child(`AGENT.SUBAGENT`)

  /**
   * 子类实现的具体业务逻辑
   *
   * 异常会被 safeExecute 包装为 success=false 的 SubagentResult。
   */
  protected abstract doExecute(task: SubagentTask): Promise<SubagentResult>

  /**
   * 公共执行入口（异常捕获 + 日志 + 计时）
   *
   * 不应被子类覆盖。
   */
  async execute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()
    this.log.info(`[${this.name}] 任务开始`, {
      taskId: task.id,
      description: task.description,
      sessionId: task.sessionId,
      providerId: task.providerId,
      strength: task.strength,
    })

    try {
      // 检查截止时间
      if (task.deadline && Date.now() > task.deadline) {
        throw new Error(`任务已超时（deadline=${task.deadline}）`)
      }

      // 子类执行
      const result = await this.doExecute(task)
      const durationMs = Date.now() - startTime

      // 补全 taskId 和 durationMs（子类可能未填）
      const finalResult: SubagentResult = {
        ...result,
        taskId: result.taskId || task.id,
        durationMs: result.durationMs || durationMs,
      }

      this.log.info(`[${this.name}] 任务完成`, {
        taskId: task.id,
        success: finalResult.success,
        durationMs: finalResult.durationMs,
        confidence: finalResult.confidence,
      })

      return finalResult
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.error(`[${this.name}] 任务异常`, {
        taskId: task.id,
        error: errorMsg,
        durationMs,
      })
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: errorMsg,
        durationMs,
      }
    }
  }
}

/**
 * 生成 SubagentTask 的便捷工厂方法（由调用方构造任务，现在只有 ipc/loop-engineering.ts 在用）
 */
export function createSubagentTask(
  type: string,
  description: string,
  input: unknown,
  options?: {
    sessionId?: string
    providerId?: string
    strength?: ThinkingStrength
    maxTokens?: number
    deadline?: number
    correlationId?: string
  }
): SubagentTask {
  return {
    id: `task_${Date.now()}_${randomUUID().slice(0, 8)}`,
    type,
    description,
    input,
    sessionId: options?.sessionId,
    providerId: options?.providerId,
    strength: options?.strength,
    maxTokens: options?.maxTokens,
    deadline: options?.deadline,
    correlationId: options?.correlationId,
  }
}
