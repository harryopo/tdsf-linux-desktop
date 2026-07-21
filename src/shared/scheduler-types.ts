/**
 * 定时任务调度器 - 共享类型定义
 *
 * 主进程（scheduler.ts）、Preload、渲染进程（GeneralSettings.tsx）三端共享。
 *
 * 数据流：
 *   SchedulerTask（注册）→ Scheduler 引擎（cron 触发）→ TaskResult（回写）
 *                       ↓                                   ↓
 *   SchedulerTaskStatus（查询/推送） ←─── IPC 4 步同步铁律 ─── 渲染层
 *
 * 任务 ID 枚举对应 spec Section E 三类运维自动化：
 *   - daily-health-check：每日 09:00 北京时间巡检
 *   - daily-decision-archive：每日 18:00 北京时间归档
 *   - weekly-ops-report：每周一 09:00 北京时间周报
 */

/**
 * 定时任务 ID（受控枚举）
 *
 * 当前 spec 仅定义三类运维自动化任务，使用字面量联合类型而非 string，
 * 避免 Register 时传入未受控 ID 导致调度引擎与渲染层状态不一致。
 */
export type SchedulerTaskId =
  | 'daily-health-check'
  | 'daily-decision-archive'
  | 'weekly-ops-report'

/**
 * 任务执行结果
 *
 * Scheduler handler 必须返回此结构；调度引擎依据 `success` 判断任务成败，
 * 依据 `durationMs` 上报耗时，依据 `summary` 在 UI 显示一行摘要。
 */
export interface TaskResult {
  /** 是否执行成功（true=成功 / false=失败，由 handler 自行判定） */
  success: boolean
  /** 一行中文摘要（例：「检查 3 台服务器，发现 1 个告警」） */
  summary: string
  /** 详细数据（自由结构，用于审计 / 周报生成 / 调试） */
  details?: Record<string, unknown>
  /** 失败原因（success=false 时必填，便于 UI 红字展示与日志归档） */
  error?: string
  /** 执行耗时（毫秒，由 Scheduler 在 handler 外包裹计时） */
  durationMs: number
}

/**
 * 定时任务定义（注册时传入）
 *
 * `handler` 为异步函数，由调度引擎在 cron 触发或手动 trigger 时调用；
 * 异常会被调度引擎 try/catch 捕获并转换为 TaskResult.error，不中断引擎。
 */
export interface SchedulerTask {
  /** 任务 ID（受控枚举，唯一） */
  id: SchedulerTaskId
  /** 任务显示名（中文，用于 UI 卡片标题） */
  name: string
  /** 5 字段 cron 表达式（minute hour day-of-month month day-of-week） */
  cron: string
  /** IANA 时区（如 'Asia/Shanghai'，DEC-7 决策） */
  timezone: string
  /** 是否启用（false 时不会被 cron 触发，但可手动 trigger） */
  enabled: boolean
  /** 异步任务函数（异常由 Scheduler 兜底） */
  handler: () => Promise<TaskResult>
}

/**
 * 定时任务运行时状态（查询 / 推送时返回）
 *
 * 不含 handler 函数，可安全通过 IPC 传递到渲染层。
 * 时间字段使用 epoch 毫秒（number）便于 JSON 序列化与跨时区显示。
 */
export interface SchedulerTaskStatus {
  /** 任务 ID */
  id: SchedulerTaskId
  /** 任务显示名 */
  name: string
  /** cron 表达式 */
  cron: string
  /** 是否启用 */
  enabled: boolean
  /** 上次执行时间（epoch ms，未执行过为 null） */
  lastRunAt: number | null
  /** 下次预计执行时间（epoch ms，禁用或解析失败为 null） */
  nextRunAt: number | null
  /** 上次执行结果（未执行过为 null） */
  lastResult: TaskResult | null
}

/**
 * Scheduler EventEmitter 事件名（小写中横线，spec 要求）
 *
 * - task-start：任务开始执行时推送，payload = { id, startedAt }
 * - task-done：任务成功完成时推送，payload = { id, result }
 * - task-error：任务失败或异常时推送，payload = { id, error, result? }
 */
export type SchedulerEventName = 'task-start' | 'task-done' | 'task-error'

/**
 * task-start 事件 payload
 */
export interface SchedulerTaskStartPayload {
  /** 任务 ID */
  id: SchedulerTaskId
  /** 开始时间（epoch ms） */
  startedAt: number
}

/**
 * task-done 事件 payload
 */
export interface SchedulerTaskDonePayload {
  /** 任务 ID */
  id: SchedulerTaskId
  /** 执行结果 */
  result: TaskResult
}

/**
 * task-error 事件 payload
 */
export interface SchedulerTaskErrorPayload {
  /** 任务 ID */
  id: SchedulerTaskId
  /** 错误信息（异常 message 或 handler 返回的 error 字段） */
  error: string
  /** 执行结果（若 handler 抛异常则为兜底 TaskResult） */
  result: TaskResult
}
