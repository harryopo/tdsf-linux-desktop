/**
 * 定时任务"启停要活得过重启"判据（#94）
 *
 * 缺陷：Scheduler.toggle 只改内存，initScheduler 每次重启都按任务定义里的
 * `enabled: true` 重新注册。于是用户在界面上关掉"每日 09:00 巡检"，
 * 显示是关了，第二天照样跑——而且是会真动数据的那类（归档/周报）。
 *
 * 判据覆盖两头：
 *   写侧：scheduler:toggle 处理器必须把意图落进 ConfigStore，存不进去就返回失败；
 *   读侧：restorePersistedToggles 必须把 false 回灌成"真的不会排到"（enabled=false 且 nextRunAt 为空）。
 * 另配两条反向对照：没记录时不许自己关任务；陈旧 id 不许把启动搞崩。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── electron：只留判据要用的最小面 ─────────────────────────────────
const capturedHandlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      capturedHandlers.set(channel, fn)
    },
    removeHandler: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
  app: { isPackaged: false, getPath: () => '/tmp/tdsf-test' },
}))

// ── ConfigStore：内存替身，能断言"到底写没写进去" ───────────────────
const store = new Map<string, unknown>()
vi.mock('../../src/main/services/storage/config-store', () => ({
  ConfigStore: {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value)
    },
  },
}))

vi.mock('../../src/main/services/log/logger', () => {
  const noop = vi.fn()
  const fakeLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => fakeLogger,
  }
  return { logger: fakeLogger }
})

// 任务工厂与仓储替身：本判据只关"启停的持久与回灌"，不碰真实 DB
vi.mock('../../src/main/services/scheduler/daily-health-check', () => ({
  createDailyHealthCheckTask: () => fakeTask('daily-health-check'),
}))
vi.mock('../../src/main/services/scheduler/daily-decision-archive', () => ({
  createDailyDecisionArchiveTaskWithRepos: () => fakeTask('daily-decision-archive'),
}))
vi.mock('../../src/main/services/scheduler/weekly-ops-report', () => ({
  createWeeklyOpsReportTaskWithRepos: () => fakeTask('weekly-ops-report'),
}))
vi.mock('../../src/main/services/db/decision-repo', () => ({ DecisionRepository: class {} }))
vi.mock('../../src/main/services/db/knowledge-repo', () => ({ KnowledgeRepository: class {} }))

import { Scheduler, resetScheduler } from '../../src/main/services/scheduler/scheduler'
import { registerSchedulerIpcHandlers, restorePersistedToggles } from '../../src/main/ipc/scheduler'
import type { SchedulerTask } from '@shared/scheduler-types'

function fakeTask(id: SchedulerTask['id']): SchedulerTask {
  return {
    id,
    name: `测试任务 ${id}`,
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    handler: async () => ({ success: true, summary: 'ok', durationMs: 1 }),
  }
}

const TOGGLE_CHANNEL = 'scheduler:toggle'
const KEY = 'schedulerTaskEnabled'

function stored(): Record<string, boolean> {
  return (store.get(KEY) ?? {}) as Record<string, boolean>
}

describe('定时任务启停的持久与回灌', () => {
  beforeEach(() => {
    resetScheduler()
    store.clear()
    capturedHandlers.clear()
    registerSchedulerIpcHandlers()
  })
  afterEach(() => {
    resetScheduler()
    store.clear()
  })

  it('写侧：toggle 关掉任务，意图必须落进 ConfigStore', async () => {
    const s = Scheduler.getInstance()
    s.register(fakeTask('daily-health-check'))

    const handler = capturedHandlers.get(TOGGLE_CHANNEL)!
    const status = await handler(null, 'daily-health-check', false)

    expect((status as { enabled: boolean }).enabled).toBe(false)
    expect(stored()['daily-health-check']).toBe(false)
  })

  it('写侧反向对照：存不进去就不许报成功，内存改动也要退回', async () => {
    const s = Scheduler.getInstance()
    s.register(fakeTask('daily-health-check'))
    const cfg = await import('../../src/main/services/storage/config-store')
    const fail = vi.spyOn(cfg.ConfigStore, 'set').mockImplementation(() => {
      throw new Error('磁盘写不进')
    })

    const handler = capturedHandlers.get(TOGGLE_CHANNEL)!
    const status = await handler(null, 'daily-health-check', false)

    fail.mockRestore()
    expect(status, '存不进去却返回了状态 = 界面显示"已禁用"，重启后又开始跑').toBeNull()
    expect(s.list()[0].enabled, '落盘失败要退回内存，否则界面与重启后的真实行为不一致').toBe(true)
    expect(stored()['daily-health-check']).toBeUndefined()
  })

  it('读侧：重启后回灌，关掉的任务不再被排期（nextRunAt 必须为空）', () => {
    store.set(KEY, { 'daily-health-check': false })
    const s = Scheduler.getInstance()
    // 模拟 initScheduler：先按默认（enabled: true）注册，再回灌
    s.register(fakeTask('daily-health-check'))
    expect(s.list()[0].enabled, '反向对照：没回灌时它确实是开着的').toBe(true)

    restorePersistedToggles(s)

    const after = s.list()[0]
    expect(after.enabled).toBe(false)
    expect(after.nextRunAt, '禁用还留着排期 = 到点照样跑').toBeNull()
  })

  it('读侧：没有任何记录时不许自己关任务', () => {
    const s = Scheduler.getInstance()
    s.register(fakeTask('daily-health-check'))
    restorePersistedToggles(s)
    expect(s.list()[0].enabled).toBe(true)
    expect(s.list()[0].nextRunAt).not.toBeNull()
  })

  it('读侧：陈旧记录（任务已下线/改名）只忽略，不许把启动搞崩', () => {
    store.set(KEY, { 'no-such-task': false, 'weekly-ops-report': 'yes-please' })
    const s = Scheduler.getInstance()
    s.register(fakeTask('weekly-ops-report'))
    expect(() => restorePersistedToggles(s)).not.toThrow()
    // 非法值类型（非 boolean）在读取层就被丢掉，不该把开着的任务关掉
    expect(s.list()[0].enabled).toBe(true)
  })
})
