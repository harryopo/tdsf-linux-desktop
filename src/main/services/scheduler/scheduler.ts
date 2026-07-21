/**
 * 定时任务调度引擎主类
 *
 * 设计依据：
 *   - DEC-7：使用 Asia/Shanghai 时区解析 cron 表达式
 *   - DEC-8：基于 setInterval + 自实现 cron 表达式解析，不引入 node-cron
 *
 * 核心能力：
 *   1. 单例 + 懒初始化（`Scheduler.getInstance()`）
 *   2. 基于 setInterval 每分钟轮询，触发到期任务
 *   3. 任务异常 try/catch 兜底，不中断调度引擎
 *   4. extends EventEmitter，推送 task-start / task-done / task-error 事件
 *   5. 时区支持：通过 Intl.DateTimeFormat（cron-parser 内部）
 *
 * 使用方式：
 *   ```ts
 *   const sched = Scheduler.getInstance()
 *   sched.register({ id: 'daily-health-check', name: '...', cron: '0 9 * * *',
 *                    timezone: 'Asia/Shanghai', enabled: true, handler: async () => {...} })
 *   sched.start()
 *   ```
 *
 * 事件名遵循 spec：小写中横线（task-start / task-done / task-error）
 */

import { EventEmitter } from 'node:events'
import { getNextRun } from './cron-parser'
import { logger } from '../../core/logger'
import type {
  SchedulerTask,
  SchedulerTaskId,
  SchedulerTaskStatus,
  TaskResult,
  SchedulerTaskStartPayload,
  SchedulerTaskDonePayload,
  SchedulerTaskErrorPayload,
} from '@shared/scheduler-types'

/** 调度引擎内部任务条目（含运行时状态） */
interface TaskEntry {
  /** 任务定义（含 handler，禁止通过 IPC 传递） */
  task: SchedulerTask
  /** 上次执行时间（epoch ms，未执行过为 null） */
  lastRunAt: number | null
  /** 下次预计执行时间（epoch ms，禁用或解析失败为 null） */
  nextRunAt: number | null
  /** 上次执行结果（未执行过为 null） */
  lastResult: TaskResult | null
  /** 是否正在执行（防止 cron 触发与手动 trigger 并发重复执行） */
  running: boolean
}

/** 轮询间隔（毫秒）：spec 要求每分钟检查一次 */
const TICK_INTERVAL_MS = 60 * 1000
/** 默认时区：DEC-7 决策 */
const DEFAULT_TIMEZONE = 'Asia/Shanghai'

/**
 * 定时任务调度引擎（单例）
 *
 * 继承 EventEmitter，事件名小写中划线：
 *   - `task-start`  payload: { id, startedAt }
 *   - `task-done`   payload: { id, result }
 *   - `task-error`  payload: { id, error, result }
 */
export class Scheduler extends EventEmitter {
  private static instance: Scheduler | null = null

  /** 已注册任务（按 ID 索引） */
  private readonly tasks = new Map<SchedulerTaskId, TaskEntry>()

  /** 轮询定时器 */
  private timer: NodeJS.Timeout | null = null

  /** 默认时区（任务自带 timezone 时优先使用任务时区） */
  private readonly timezone: string

  private constructor(timezone: string = DEFAULT_TIMEZONE) {
    super()
    this.timezone = timezone
  }

  /**
   * 获取单例（懒初始化）
   *
   * 首次调用时构造实例；之后所有调用返回同一实例。
   * 应用退出时调用 `destroy()` 清理资源。
   */
  static getInstance(): Scheduler {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler()
    }
    return Scheduler.instance
  }

  /**
   * 启动调度引擎
   *
   * 启动 setInterval 每分钟轮询，并立即执行一次 tick（避免错过当前分钟）。
   * 重复调用安全（已启动时直接返回）。
   */
  start(): void {
    if (this.timer) {
      logger.warn('[Scheduler] 调度引擎已在运行，忽略重复 start')
      return
    }
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS)
    logger.info('[Scheduler] 调度引擎已启动（每分钟轮询）')
    // 立即触发一次 tick：避免启动时错过当前分钟（如 09:00:30 启动会立刻检查 09:00 是否到期）
    this.tick()
  }

  /**
   * 停止调度引擎
   *
   * 清理 setInterval；已注册任务保留，下次 start 时继续轮询。
   * 正在执行的任务不会被中断（async handler 自然完成）。
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      logger.info('[Scheduler] 调度引擎已停止')
    }
  }

  /**
   * 注册任务
   *
   * 重复注册同一 ID 会覆盖原任务（便于热更新 handler）。
   * 注册时立即计算 nextRunAt（若 enabled）。
   *
   * @param task 任务定义
   */
  register(task: SchedulerTask): void {
    if (this.tasks.has(task.id)) {
      logger.warn(`[Scheduler] 任务 ${task.id} 已存在，覆盖注册`)
    }

    let nextRunAt: number | null = null
    if (task.enabled) {
      try {
        const tz = task.timezone || this.timezone
        const next = getNextRun(task.cron, new Date(), tz)
        nextRunAt = next.getTime()
      } catch (e) {
        logger.error(
          `[Scheduler] 任务 ${task.id} cron 解析失败: ${(e as Error).message}`
        )
        nextRunAt = null
      }
    }

    this.tasks.set(task.id, {
      task,
      lastRunAt: null,
      nextRunAt,
      lastResult: null,
      running: false,
    })
    logger.info(
      `[Scheduler] 任务已注册: ${task.id} (${task.name}) · next=${nextRunAt ? new Date(nextRunAt).toISOString() : 'N/A'}`
    )
  }

  /**
   * 启停任务
   *
   * 启用时重算 nextRunAt；禁用时清空 nextRunAt。
   * 正在执行的任务不受影响（自然完成）。
   *
   * @param taskId 任务 ID
   * @param enabled 是否启用
   * @throws 任务不存在时抛错
   */
  toggle(taskId: SchedulerTaskId, enabled: boolean): void {
    const entry = this.tasks.get(taskId)
    if (!entry) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    // 更新 enabled 标记（保留原 task 其他字段，包括 handler）
    entry.task = { ...entry.task, enabled }

    if (enabled) {
      try {
        const tz = entry.task.timezone || this.timezone
        const next = getNextRun(entry.task.cron, new Date(), tz)
        entry.nextRunAt = next.getTime()
      } catch (e) {
        logger.error(
          `[Scheduler] 任务 ${taskId} cron 解析失败: ${(e as Error).message}`
        )
        entry.nextRunAt = null
      }
    } else {
      entry.nextRunAt = null
    }

    logger.info(`[Scheduler] 任务 ${taskId} 已 ${enabled ? '启用' : '禁用'}`)
  }

  /**
   * 立即触发任务（不等 cron 时间）
   *
   * 用于演示 / 手动重试场景。会推送 task-start / task-done|task-error 事件。
   * 与 cron 触发共享同一执行路径（runTask），若任务正在执行则返回上次结果避免并发重复。
   *
   * @param taskId 任务 ID
   * @returns 执行结果
   * @throws 任务不存在时抛错
   */
  async trigger(taskId: SchedulerTaskId): Promise<TaskResult> {
    const entry = this.tasks.get(taskId)
    if (!entry) {
      throw new Error(`任务不存在: ${taskId}`)
    }
    if (entry.running) {
      logger.warn(`[Scheduler] 任务 ${taskId} 正在执行，跳过本次 trigger`)
      return (
        entry.lastResult ?? {
          success: false,
          summary: '任务正在执行中',
          durationMs: 0,
        }
      )
    }
    return this.runTask(entry)
  }

  /**
   * 查询所有任务状态
   *
   * 返回浅拷贝列表，不含 handler 函数，可安全通过 IPC 传递到渲染层。
   */
  list(): SchedulerTaskStatus[] {
    return Array.from(this.tasks.values()).map((entry) => ({
      id: entry.task.id,
      name: entry.task.name,
      cron: entry.task.cron,
      enabled: entry.task.enabled,
      lastRunAt: entry.lastRunAt,
      nextRunAt: entry.nextRunAt,
      lastResult: entry.lastResult,
    }))
  }

  /**
   * 销毁单例（应用退出时调用）
   *
   * 停止轮询、清空任务、移除所有 EventEmitter 监听、清空 instance 引用。
   */
  destroy(): void {
    this.stop()
    this.tasks.clear()
    this.removeAllListeners()
    Scheduler.instance = null
    logger.info('[Scheduler] 已销毁')
  }

  // ────────── 内部方法 ──────────

  /**
   * 每分钟触发一次的 tick
   *
   * 遍历所有 enabled 且 nextRunAt 到期的任务，异步触发 runTask。
   * 不 await handler，避免慢任务阻塞下次 tick。
   */
  private tick(): void {
    const now = Date.now()
    for (const entry of this.tasks.values()) {
      if (!entry.task.enabled) continue
      if (entry.nextRunAt === null) continue
      if (entry.running) continue // 上次执行未完成，跳过
      if (now >= entry.nextRunAt) {
        // 异步触发，不等待（避免阻塞 tick）
        void this.runTask(entry)
      }
    }
  }

  /**
   * 执行任务（cron 触发与 trigger 共用此路径）
   *
   * 流程：
   *   1. 标记 running = true
   *   2. 推送 task-start 事件
   *   3. try/catch 执行 handler，异常转换为 TaskResult
   *   4. 更新 lastRunAt / lastResult
   *   5. 重算 nextRunAt（若 enabled）
   *   6. 推送 task-done / task-error 事件
   *   7. 标记 running = false
   *
   * 任何步骤异常都不会影响调度引擎主循环。
   */
  private async runTask(entry: TaskEntry): Promise<TaskResult> {
    const startedAt = Date.now()
    const taskId = entry.task.id
    entry.running = true

    // 1. 推送 task-start 事件
    const startPayload: SchedulerTaskStartPayload = { id: taskId, startedAt }
    this.emit('task-start', startPayload)
    logger.info(`[Scheduler] 任务开始: ${taskId}`)

    // 2. 执行 handler（异常兜底）
    let result: TaskResult
    try {
      const raw = await entry.task.handler()
      // handler 返回的 durationMs 可能不准（含 await 调度延迟），用实际耗时覆盖
      result = { ...raw, durationMs: Date.now() - startedAt }
    } catch (e) {
      const err = e as Error
      result = {
        success: false,
        summary: `任务异常: ${err.message}`,
        error: err.message,
        durationMs: Date.now() - startedAt,
      }
    }

    // 3. 更新运行时状态
    entry.lastRunAt = startedAt
    entry.lastResult = result

    // 4. 重算 nextRunAt（cron 表达式变更或闰年导致失效时降级为 null）
    if (entry.task.enabled) {
      try {
        const tz = entry.task.timezone || this.timezone
        const next = getNextRun(entry.task.cron, new Date(), tz)
        entry.nextRunAt = next.getTime()
      } catch (e) {
        logger.error(
          `[Scheduler] 任务 ${taskId} cron 重算失败: ${(e as Error).message}`
        )
        entry.nextRunAt = null
      }
    } else {
      entry.nextRunAt = null
    }

    // 5. 推送 task-done / task-error 事件
    if (result.success) {
      const donePayload: SchedulerTaskDonePayload = { id: taskId, result }
      this.emit('task-done', donePayload)
      logger.info(
        `[Scheduler] 任务完成: ${taskId} (${result.durationMs}ms) - ${result.summary}`
      )
    } else {
      const errPayload: SchedulerTaskErrorPayload = {
        id: taskId,
        error: result.error || result.summary,
        result,
      }
      this.emit('task-error', errPayload)
      logger.error(`[Scheduler] 任务失败: ${taskId} - ${errPayload.error}`)
    }

    entry.running = false
    return result
  }
}
