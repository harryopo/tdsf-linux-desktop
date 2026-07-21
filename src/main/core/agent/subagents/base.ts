/**
 * Subagent 基础抽象类
 *
 * 职责：
 * - 定义所有 Subagent 的统一接口（Subagent）
 * - 提供 BaseSubagent 抽象基类（含公共日志/审计/审批闸门钩子）
 * - 定义 SubagentTask / SubagentResult 类型契约
 *
 * 设计要点：
 * - 每个特化 Subagent（编程/思考/运行/搜索/skill/方法论/历史/知识库）继承 BaseSubagent
 * - execute(task) 必须返回 SubagentResult（不抛异常，异常转为 success=false 的结果）
 * - 预留人工审批闸门接口（isApprovalRequired / requestApproval），Week 2 实现 UI
 *
 * 方案书依据：v0.9 §3.1（8 个特化 Subagent）+ §10 Hard Constraint 4（人工审批闸门）
 */
import { logger } from '../../../services/log/logger'
import type { ThinkingStrength } from '../providers/types'

/**
 * Subagent 任务输入
 *
 * 由 Supervisor 在 Plan 阶段生成，分发给对应 Subagent 执行。
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
  /** 是否需要人工审批（true 表示结果尚未生效，等待用户确认） */
  requiresApproval?: boolean
  /** 审批闸门提示（requiresApproval=true 时给用户看的预览文本） */
  approvalPreview?: string
}

/**
 * Subagent 接口（统一契约）
 *
 * 所有 Subagent 必须实现此接口，可通过 implements 或继承 BaseSubagent 实现。
 */
export interface Subagent {
  /** Subagent 名称（如 'coding' / 'thinking'） */
  name: string
  /** 显示名称（如 '编程 Subagent'） */
  displayName: string
  /** 简短描述 */
  description: string
  /** 执行任务 */
  execute(task: SubagentTask): Promise<SubagentResult>
}

/**
 * Subagent 类型枚举（8 个特化 Subagent）
 *
 * 方案书 §3.1 表
 */
export type SubagentName =
  | 'coding'
  | 'thinking'
  | 'running'
  | 'search'
  | 'skill'
  | 'methodology'
  | 'history'
  | 'knowledge'

/**
 * BaseSubagent 抽象基类
 *
 * 提供公共能力：
 * - 受保护日志器（自动注入 subagent name 前缀）
 * - 异常捕获包装（execute → safeExecute）
 * - 审批闸门接口（Week 2 实现 UI 联动）
 *
 * 子类只需实现 doExecute(task) 实现具体业务逻辑。
 */
export abstract class BaseSubagent implements Subagent {
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
   * 公共执行入口（异常捕获 + 日志 + 审批闸门钩子）
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

  /**
   * 判断任务是否需要人工审批（Week 2 实现具体规则）
   *
   * 默认 false，子类可覆盖（如运行高危命令的 running-subagent 应返回 true）
   *
   * @param _task 任务对象
   */
  protected isApprovalRequired(_task: SubagentTask): boolean {
    return false
  }

  /**
   * 请求人工审批（Week 2 实现 IPC 推送到 UI）
   *
   * 当前版本仅记录日志，返回一个 pending 状态的结果。
   *
   * @param task 任务对象
   * @param preview 审批预览文本
   */
  protected async requestApproval(
    task: SubagentTask,
    preview: string
  ): Promise<SubagentResult> {
    this.log.warn(`[${this.name}] 任务需要人工审批（Week 2 实现 UI 联动）`, {
      taskId: task.id,
      preview,
    })
    return {
      taskId: task.id,
      success: false,
      output: null,
      error: '等待人工审批（Week 2 实现具体 UI 联动）',
      durationMs: 0,
      requiresApproval: true,
      approvalPreview: preview,
    }
  }
}

/**
 * Subagent 注册表（Week 2 由 Supervisor 用于按 name 查找 Subagent）
 *
 * 当前版本仅提供类型契约，实际注册在 Week 2 实现。
 */
export interface SubagentRegistry {
  /** 按 name 查找 Subagent */
  get(name: SubagentName): Subagent | null
  /** 列出所有已注册 Subagent */
  list(): Subagent[]
}

/**
 * 生成 SubagentTask 的便捷工厂方法（Supervisor 调度时用）
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
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
