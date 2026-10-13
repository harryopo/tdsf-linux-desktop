/**
 * 调度器 IPC Handlers（Phase 6 Task 6.5）
 *
 * IPC 4 步同步铁律：
 *   1. 定义（shared/ipc-channels.ts）→ 2. 本文件注册 → 3. preload 暴露 → 4. 类型声明
 *
 * 通道列表：
 * - scheduler:list    invoke  查询所有定时任务状态 → SchedulerTaskStatus[]
 * - scheduler:toggle  invoke  启用/禁用指定任务 → SchedulerTaskStatus | null
 * - scheduler:trigger invoke  立即触发指定任务 → TaskResult
 * - scheduler:status  push    任务状态变更推送（主 → 渲染）→ SchedulerTaskStatus
 *
 * 初始化流程（initScheduler）：
 *   1. 获取 Scheduler 单例
 *   2. 注册 3 个定时任务（默认全部启用）
 *      - daily-health-check      cron `0 9 * * *`   每日 09:00 北京时间巡检
 *      - daily-decision-archive  cron `0 18 * * *`  每日 18:00 北京时间归档
 *      - weekly-ops-report       cron `0 9 * * 1`   每周一 09:00 北京时间周报
 *   3. 设置 EventEmitter 事件转发（task-start/done/error → scheduler:status push）
 *   4. 调用 start() 启动调度引擎
 *
 * 错误处理：所有 IPC handler try/catch 兜底，失败时返回结构化错误（不抛异常到渲染层）。
 * push 安全：BrowserWindow.getAllWindows() 可能为空，需检查 length > 0。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { logger } from '../services/log/logger'
import { Scheduler } from '../services/scheduler/scheduler'
import { createDailyHealthCheckTask } from '../services/scheduler/daily-health-check'
import { createDailyDecisionArchiveTaskWithRepos } from '../services/scheduler/daily-decision-archive'
import { createWeeklyOpsReportTaskWithRepos } from '../services/scheduler/weekly-ops-report'
import {
  ArchiveDecisionRepositoryAdapter,
  ArchiveKnowledgeRepositoryAdapter,
  DecisionWeeklyRepositoryAdapter,
  KnowledgeWeeklyRepositoryAdapter,
} from '../services/scheduler/archive-repo-adapter'
import { DecisionRepository } from '../services/db/decision-repo'
import { KnowledgeRepository } from '../services/db/knowledge-repo'
import { ConfigStore } from '../services/storage/config-store'
import type { DatabaseManager } from '../services/db/database'
import { SCHEDULER } from '@shared/ipc-channels'
import type {
  SchedulerTaskId,
  SchedulerTaskStatus,
  TaskResult,
  SchedulerEventName,
} from '@shared/scheduler-types'

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 受控 taskId 白名单（与 SchedulerTaskId 联合类型保持同步）
 *
 * TypeScript 类型在运行时丢失，渲染进程可传任意字符串。
 * 此白名单作为运行时校验依据，拦截非法/恶意 taskId。
 */
const VALID_TASK_IDS: readonly SchedulerTaskId[] = [
  'daily-health-check',
  'daily-decision-archive',
  'weekly-ops-report',
] as const

/**
 * taskId 运行时类型守卫
 *
 * 校验传入值是否为字符串且属于受控白名单。
 * 用于 IPC handler 入口拦截非法/恶意 taskId，防止调度引擎处理未受控 ID。
 */
function isValidTaskId(id: unknown): id is SchedulerTaskId {
  return typeof id === 'string' && (VALID_TASK_IDS as readonly string[]).includes(id)
}

/**
 * 安全推送事件到渲染进程
 *
 * BrowserWindow.getAllWindows() 可能为空（窗口未创建或已销毁），
 * 需检查每个窗口的 isDestroyed() 状态。
 * 多窗口场景下遍历所有非销毁窗口推送，确保每个窗口都能收到状态更新。
 */
function pushToRenderer(channel: string, ...args: unknown[]): void {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) return
  for (const win of windows) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(channel, ...args)
    } catch (err) {
      logger.warn('IPC.SCHEDULER', `推送状态到窗口失败: channel=${channel}`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * 查找指定任务的当前状态
 *
 * 从 Scheduler.list() 返回的列表中查找匹配 taskId 的状态。
 * 未找到时返回 null（任务可能未注册或已被销毁）。
 */
function findTaskStatus(taskId: SchedulerTaskId): SchedulerTaskStatus | null {
  const statuses = Scheduler.getInstance().list()
  return statuses.find((s) => s.id === taskId) ?? null
}

// ============================================================================
// IPC Handler 注册（3 个 invoke 通道）
// ============================================================================

/**
 * 注册调度器 IPC handlers
 *
 * 注册 3 个 invoke handler（list / toggle / trigger）。
 * push 通道（scheduler:status）不在此注册，由 setupSchedulerStatusPush 设置。
 *
 * 必须在 app.whenReady() 后调用（由 registerAllIpcHandlers 调用）。
 */
/**
 * 用户启停意图的持久化（`schedulerTaskEnabled`）
 *
 * 为什么必须有：Scheduler.toggle 只改内存里的 task.enabled，重启后 initScheduler
 * 又按任务定义里的 `enabled: true` 重新注册。于是界面上关掉"每日 09:00 巡检"，
 * 用户以为关了，第二天它照跑——这是假 affordance，而且是会真的动数据的那种
 * （归档任务会把不该归档的窗口归档掉）。
 *
 * 只存"与默认值不同"的意图，键固定是三个任务 id 的量级，不会长。
 */
const SCHEDULER_ENABLED_KEY = 'schedulerTaskEnabled'

/** 读回灌用的启停意图；结构不对就当作没有（不给陈旧数据开后门） */
function readEnabledOverrides(): Record<string, boolean> {
  const raw = ConfigStore.get(SCHEDULER_ENABLED_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}

/** 写一条启停意图（抛错由调用方处理：没存进去就不许报成功） */
function writeEnabledOverride(taskId: string, enabled: boolean): void {
  const cur = readEnabledOverrides()
  cur[taskId] = enabled
  ConfigStore.set(SCHEDULER_ENABLED_KEY, cur)
}

/**
 * 把持久化的启停意图回灌进调度器（initScheduler 在 register 之后、start 之前调用）。
 *
 * 单独导出是为了能被判据直接驱动：真实链路里这一步决定
 * "用户关掉的定时任务，重启后到底还跑不跑"。
 */
export function restorePersistedToggles(scheduler: Scheduler): void {
  for (const [taskId, enabled] of Object.entries(readEnabledOverrides())) {
    if (!isValidTaskId(taskId)) continue
    try {
      scheduler.toggle(taskId, enabled)
      logger.info('IPC.SCHEDULER', '已回灌定时任务启停状态', { taskId, enabled })
    } catch {
      // 任务改名/下线留下的陈旧记录：忽略，不影响本次启动
      logger.warn('IPC.SCHEDULER', '启停记录对应的任务不存在，忽略', { taskId })
    }
  }
}

export function registerSchedulerIpcHandlers(): void {
  // ─── scheduler:list → 查询所有任务状态 ───────────────────────────
  ipcMain.handle(SCHEDULER.LIST, async (): Promise<SchedulerTaskStatus[]> => {
    try {
      return Scheduler.getInstance().list()
    } catch (err) {
      logger.error('IPC.SCHEDULER', 'scheduler:list 失败', {
        error: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  })

  // ─── scheduler:toggle → 启用/禁用任务 ────────────────────────────
  ipcMain.handle(
    SCHEDULER.TOGGLE,
    async (
      _event,
      taskId: unknown,
      enabled: boolean
    ): Promise<SchedulerTaskStatus | null> => {
      // 运行时校验 taskId（TS 类型在 IPC 边界丢失，渲染进程可传任意值）
      if (!isValidTaskId(taskId)) {
        logger.warn('IPC.SCHEDULER', `非法 taskId: ${String(taskId)}`)
        return null
      }
      try {
        const scheduler = Scheduler.getInstance()
        scheduler.toggle(taskId, enabled)
        // 内存改完必须落盘：只改内存的话，界面上"已禁用"到下次重启就失效，
        // 而定时任务（归档/周报）会照跑不误。存不进去就不报成功，并把内存改回去，
        // 让界面显示的与重启后真实发生的是一致的。
        try {
          writeEnabledOverride(taskId, enabled)
        } catch (persistErr) {
          scheduler.toggle(taskId, !enabled)
          throw persistErr
        }
        const status = findTaskStatus(taskId)
        if (!status) {
          logger.warn('IPC.SCHEDULER', `toggle 后未找到任务: ${taskId}`)
          return null
        }
        // 推送状态变更到渲染层（用户手动 toggle 也触发推送，保持 UI 同步）
        pushToRenderer(SCHEDULER.STATUS, status)
        return status
      } catch (err) {
        logger.error('IPC.SCHEDULER', 'scheduler:toggle 失败', {
          taskId,
          enabled,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    }
  )

  // ─── scheduler:trigger → 立即触发任务 ────────────────────────────
  ipcMain.handle(
    SCHEDULER.TRIGGER,
    async (_event, taskId: unknown): Promise<TaskResult> => {
      // 运行时校验 taskId（TS 类型在 IPC 边界丢失，渲染进程可传任意值）
      if (!isValidTaskId(taskId)) {
        const errMsg = `非法 taskId: ${String(taskId)}`
        logger.warn('IPC.SCHEDULER', errMsg)
        return {
          success: false,
          summary: errMsg,
          error: errMsg,
          durationMs: 0,
        }
      }
      try {
        const scheduler = Scheduler.getInstance()
        return await scheduler.trigger(taskId)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.error('IPC.SCHEDULER', 'scheduler:trigger 失败', {
          taskId,
          error: errorMsg,
        })
        return {
          success: false,
          summary: `触发任务失败: ${errorMsg}`,
          error: errorMsg,
          durationMs: 0,
        }
      }
    }
  )

  logger.info('IPC.SCHEDULER', '调度器 IPC handlers 已注册', {
    invokeChannels: [SCHEDULER.LIST, SCHEDULER.TOGGLE, SCHEDULER.TRIGGER],
    pushChannel: SCHEDULER.STATUS,
  })
}

// ============================================================================
// Push 通道：Scheduler 事件 → 渲染层
// ============================================================================

/**
 * 设置调度器状态推送
 *
 * 监听 Scheduler 的 task-start / task-done / task-error 事件，
 * 通过 scheduler:status push 通道转发任务最新状态到渲染层。
 *
 * 事件触发时从 Scheduler.list() 查询最新状态并推送，
 * 确保渲染层收到的是完整 SchedulerTaskStatus（含 lastRunAt / lastResult / nextRunAt）。
 */
export function setupSchedulerStatusPush(): void {
  const scheduler = Scheduler.getInstance()

  // 三个事件转发逻辑相同：查最新状态 → 推送渲染层
  // 使用高阶函数消除重复，避免后续维护时遗漏同步修改。
  const forwardSchedulerEvent = (eventName: SchedulerEventName): void => {
    scheduler.on(eventName, (payload: { id: SchedulerTaskId }) => {
      const status = findTaskStatus(payload.id)
      if (status) {
        pushToRenderer(SCHEDULER.STATUS, status)
      }
    })
  }

  // task-start：任务开始执行（推送状态，running 字段不在 status 中但 lastRunAt 未变）
  // task-done：任务成功完成（lastRunAt / lastResult / nextRunAt 已更新）
  // task-error：任务失败或异常（lastRunAt / lastResult 已更新）
  forwardSchedulerEvent('task-start')
  forwardSchedulerEvent('task-done')
  forwardSchedulerEvent('task-error')

  logger.info('IPC.SCHEDULER', '调度器状态推送已设置', {
    events: ['task-start', 'task-done', 'task-error'],
    pushChannel: SCHEDULER.STATUS,
  })
}

// ============================================================================
// 调度器初始化（主进程启动时调用）
// ============================================================================

/**
 * 初始化调度器
 *
 * 在 app.whenReady() 后调用（确保 Electron API 可用，BrowserWindow 已创建）。
 *
 * 流程：
 *   1. 获取 Scheduler 单例
 *   2. 注册 3 个定时任务（默认全部启用）
 *   3. 设置 EventEmitter 事件转发（task-start/done/error → scheduler:status push）
 *   4. 调用 start() 启动调度引擎（每分钟轮询）
 *
 * 3 个定时任务（DEC-7 时区决策，均使用 Asia/Shanghai）：
 *   - daily-health-check      cron `0 9 * * *`   每日 09:00 巡检
 *   - daily-decision-archive  cron `0 18 * * *`  每日 18:00 归档
 *   - weekly-ops-report       cron `0 9 * * 1`   每周一 09:00 周报
 */
export function initScheduler(db: DatabaseManager): void {
  const scheduler = Scheduler.getInstance()

  // 1. 注册 3 个定时任务（默认全部启用）
  scheduler.register(createDailyHealthCheckTask())

  // P0-1 修复：注入真实 DecisionRepository / KnowledgeRepository 适配器，
  // 让每日决策归档真正查询并写入知识库。
  const decisionRepo = new DecisionRepository(db)
  const knowledgeRepo = new KnowledgeRepository(db)
  scheduler.register(
    createDailyDecisionArchiveTaskWithRepos(
      new ArchiveDecisionRepositoryAdapter(decisionRepo),
      new ArchiveKnowledgeRepositoryAdapter(knowledgeRepo, db)
    )
  )

  // P0-2 修复：注入真实周报仓储适配器，让运维周报基于真实数据统计。
  scheduler.register(
    createWeeklyOpsReportTaskWithRepos(
      new DecisionWeeklyRepositoryAdapter(db),
      new KnowledgeWeeklyRepositoryAdapter(db)
    )
  )

  // 1.5 回灌用户上次保存的启停意图（任务定义里的 enabled 是默认值，不是用户意志）
  restorePersistedToggles(scheduler)

  // 2. 设置事件转发（task-start/done/error → scheduler:status push）
  setupSchedulerStatusPush()

  // 3. 启动调度引擎（每分钟轮询）
  scheduler.start()

  const tasks = scheduler.list()
  logger.info('IPC.SCHEDULER', '调度器已初始化', {
    taskCount: tasks.length,
    tasks: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      enabled: t.enabled,
      cron: t.cron,
    })),
  })
}

/**
 * 清理调度器（应用退出时调用）
 *
 * 停止轮询、清空任务、移除 EventEmitter 监听、清空单例引用。
 * 与 cleanupSidecar / cleanupLoopEngineering 模式一致。
 */
export function cleanupScheduler(): void {
  Scheduler.getInstance().destroy()
  logger.info('IPC.SCHEDULER', '调度器已清理')
}
