/**
 * PAOR（Plan→Act→Observe→Reflect）自动循环 - 跨进程共享类型定义
 *
 * 主进程 Supervisor 通过 agent:paor:iteration 通道推送每轮迭代进度，
 * 渲染进程通过 onAgentPaorIteration 监听并展示实时进度。
 *
 * 通道列表：
 * - agent:paor             invoke  渲染 → 主：启动 PAOR 循环
 * - agent:paor:iteration   push    主 → 渲染：每轮迭代进度（Plan→Act→Observe→Reflect）
 * - paor:approval-request  push    主 → 渲染：高危命令审批请求（见 PaorApprovalRequest）
 * - paor:approve           invoke  渲染 → 主：响应审批请求
 *
 * 注意：本文件类型为 UI 层使用的最小子集，主进程 supervisor.ts 中的完整类型保留不变。
 *       字段命名与 supervisor.ts 一致，便于主进程直接透传。
 */

/** PAOR Plan 阶段输出的结构化执行计划（UI 子集） */
export interface PaorPlanObject {
  /** 任务目标 */
  goal: string
  /** 有序步骤列表（每条建议为可执行命令或操作描述） */
  steps: string[]
  /** 风险点列表 */
  risks: string[]
  /** 验证方法（如何确认任务成功） */
  verification: string
}

/** PAOR Act 阶段单步执行结果 */
export interface PaorActResult {
  /** 执行的步骤索引（对应 PlanObject.steps） */
  stepIndex: number
  /** 实际执行的命令 */
  command: string
  /** 命令输出（stdout/stderr 合并） */
  output: string
  /** 是否执行成功（exitCode === 0） */
  success: boolean
}

/** PAOR Observe 阶段观察结果 */
export interface PaorObserveResult {
  /** 观察状态 */
  status: 'success' | 'partial' | 'failed'
  /** 观察要点列表 */
  observations: string[]
  /** 是否建议重试当前步骤 */
  needsRetry: boolean
}

/** PAOR Reflect 阶段反思决策 */
export interface PaorReflectResult {
  /** 循环决策：继续下一步 / 重试 / 中止 / 计划完成 */
  decision: 'continue' | 'retry' | 'abort' | 'done'
  /** 决策理由 */
  reasoning: string
  /** 可选的更新后计划（如需要调整步骤） */
  updatedPlan?: PaorPlanObject
}

/** PAOR 单次迭代记录（Plan→Act→Observe→Reflect 一轮的完整轨迹） */
export interface PaorIteration {
  /** 迭代序号（从 1 开始） */
  iteration: number
  /** 执行的步骤索引 */
  stepIndex: number
  /** Act 阶段结果 */
  act: PaorActResult
  /** Observe 阶段结果 */
  observe: PaorObserveResult
  /** Reflect 阶段决策 */
  reflect: PaorReflectResult
  /** 是否因风险拦截而跳过执行（人工审批门） */
  riskBlocked?: boolean
}

/** PAOR 自动循环最终结果 */
export interface PaorLoopResult {
  /** 最终状态：done=计划完成，abort=中止，max_iterations=达到迭代上限 */
  status: 'done' | 'abort' | 'max_iterations'
  /** 结构化计划 */
  plan: PaorPlanObject
  /** 计划置信度 */
  planConfidence: number
  /** 完整迭代轨迹（可审计） */
  iterations: PaorIteration[]
  /** 最终结论摘要 */
  summary: string
  /** 总耗时（毫秒） */
  durationMs: number
}

/**
 * agent:paor:iteration 通道的载荷（主 → 渲染 push）
 *
 * 主进程在每轮迭代完成后通过 safeSend 推送，
 * 渲染进程订阅 onAgentPaorIteration 接收。
 */
export interface PaorIterationEvent {
  /** 关联的 SSH 会话 ID（用于多会话区分） */
  sshSessionId: string
  /** 本轮迭代轨迹 */
  iteration: PaorIteration
}
