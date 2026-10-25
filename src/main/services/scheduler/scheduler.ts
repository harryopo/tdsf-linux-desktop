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
// S5：原来用的是 core/logger（只写 console、不落盘）。打包后的 Windows 没有控制台，
// 调度器的降级与失败就只能出现在界面上，日志文件里一行都查不到，所以并进主 logger。
import { logger as appLogger } from '../log/logger'
import { callWithTimeout } from '../../core/with-timeout'

const logger = appLogger.child('SCHEDULER')

/**
 * 单个任务 handler 的执行预算（毫秒）
 *
 * 每日巡检/归档这类任务本来就在分钟级，给 10 分钟足够宽；
 * 真正的意义是"必须有上限"——没有上限时一个卡住的 handler 会永久占住这个任务。
 */
const TASK_HANDLER_TIMEOUT_MS = 10 * 60 * 1000
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

  /**
   * 重置单例（仅用于测试）
   *
   * 若实例存在则销毁并清空引用；若不存在则无操作。
   * 与 getInstance() 不同，不会在无实例时创建新实例。
   *
   * 单例复位这件事以前照的是那条工作流子 agent 的写法；那份实现已随 #222 整删，这里的 resetInstance 自己就是范本。
   */
  static resetInstance(): void {
    if (Scheduler.instance) {
      Scheduler.instance.destroy()
      // destroy() 内部已设置 instance = null，这里冗余但更明确
      Scheduler.instance = null
    }
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

    // 复位放在 finally：旧写法把 `running = false` 写在最后一行，
    // 中间任何一步抛错（包括 emit 时某个监听器抛错）都会把它永久留在 true，
    // 于是 tick 里的 `if (entry.running) continue` 从此每次都跳过这个任务，
    // 而且一条 task-error 日志都没有——任务静默死亡。
    try {
      // 1. 推送 task-start 事件（监听器抛错不能拖垮任务本身）
      this.safeEmit('task-start', { id: taskId, startedAt } as SchedulerTaskStartPayload)
      logger.info(`[Scheduler] 任务开始: ${taskId}`)

      // 2. 执行 handler：带预算 + 异常兜底
      //    旧写法只 catch 不超时，一个卡在 await 上的 handler 会永久占住这个任务
      const outcome = await callWithTimeout(
        () => entry.task.handler(),
        TASK_HANDLER_TIMEOUT_MS
      )
      let result: TaskResult
      if (outcome.timedOut) {
        result = {
          success: false,
          summary: `任务超时（预算 ${TASK_HANDLER_TIMEOUT_MS}ms）`,
          // 带上"任务超时"前缀：原始那串只说"超过 X ms 未完成"，落到 task-error 事件里没人知道是谁
          error: `任务超时：${outcome.error ?? `超过 ${TASK_HANDLER_TIMEOUT_MS}ms 未完成`}`,
          durationMs: Date.now() - startedAt,
        }
        logger.error(
          `[Scheduler] 任务超时: ${taskId} — 预算 ${TASK_HANDLER_TIMEOUT_MS}ms 用尽，本轮放弃`
        )
      } else if (outcome.ok) {
        // handler 返回的 durationMs 可能不准（含 await 调度延迟），用实际耗时覆盖
        result = { ...(outcome.value as TaskResult), durationMs: Date.now() - startedAt }
      } else {
        result = {
          success: false,
          summary: `任务异常: ${outcome.error}`,
          error: outcome.error ?? '未知异常',
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
        this.safeEmit('task-done', { id: taskId, result } as SchedulerTaskDonePayload)
        logger.info(
          `[Scheduler] 任务完成: ${taskId} (${result.durationMs}ms) - ${result.summary}`
        )
      } else {
        this.safeEmit('task-error', {
          id: taskId,
          error: result.error || result.summary,
          result,
        } as SchedulerTaskErrorPayload)
        logger.error(`[Scheduler] 任务失败: ${taskId} - ${result.error || result.summary}`)
      }

      return result
    } finally {
      entry.running = false
    }
  }

  /**
   * 广播事件，且不让监听器的异常回流到调度主流程
   *
   * EventEmitter 的 emit 是同步的：任一监听器抛错，就会从 emit 现场抛回 runTask，
   * 旧实现因此会跳过最后的 running 复位（任务永久卡死）。监听器异常在这里单独记日志。
   */
  private safeEmit(event: string, payload: unknown): void {
    for (const listener of this.listeners(event)) {
      try {
        (listener as (p: unknown) => void)(payload)
      } catch (e) {
        logger.error(
          `[Scheduler] 事件监听器抛错（不影响任务）: ${event} - ${(e as Error).message}`
        )
      }
    }
  }
}

// ============================================================================
// 模块级单例工厂函数
// ============================================================================

/**
 * 重置调度引擎单例（仅用于测试）
 *
 * 销毁当前实例（停止轮询、清空任务、移除监听器、清空 instance 引用）。
 * 下次调用 `Scheduler.getInstance()` 会创建新实例。
 *
 * 与上面的 resetInstance 同一档：测试用复位，不在生产路径上被调用。
 */
export function resetScheduler(): void {
  Scheduler.resetInstance()
}
