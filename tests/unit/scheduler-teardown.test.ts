/**
 * 调度器韧性与退出收尾判据（2026-10-09 安全审查 S4 / P1-7 + mcp-lifecycle）
 *
 * 两件各自独立但同属"收尾没做完"的事：
 * 1. `running` 标志原来在最后一行才复位，中间任何一个同步 emit 抛错（监听器是别人的代码）
 *    都会把它永久留在 true，此后该任务被 `if (entry.running) continue` 静默跳过——
 *    一次异常 = 永久失效，且没有一条 task-error 日志。
 * 2. MCP 生命周期管理器构造函数里那把 1 秒 setInterval 没存句柄，
 *    等于结构上永不退出：单测里钉住事件循环，实际退出时也白等。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler } from '../../src/main/services/scheduler/scheduler'
import { resetScheduler } from '../../src/main/services/scheduler/scheduler'
import { McpLifecycleManager } from '../../src/main/core/agent/mcp-lifecycle'
import type { SchedulerTask } from '@shared/scheduler-types'

function task(id: SchedulerTask['id'], handler: SchedulerTask['handler']): SchedulerTask {
  return {
    id,
    name: `测试任务 ${id}`,
    cron: '* * * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    handler,
  }
}

describe('调度器：一个坏监听器不能杀任务', () => {
  beforeEach(() => resetScheduler())
  afterEach(() => resetScheduler())

  it("task-done 监听器抛错后，任务下一轮仍然执行", async () => {
    const s = Scheduler.getInstance()
    let calls = 0
    s.register(
      task('daily-health-check', async () => {
        calls++
        return { success: true, summary: 'ok', durationMs: 1 }
      }),
    )
    s.on('task-done', () => {
      throw new Error('监听器自己炸了')
    })

    const first = await s.trigger('daily-health-check')
    expect(first.success, '任务本身是成功的').toBe(true)
    expect(calls).toBe(1)

    // 旧实现在这里就再也不跑了：running 永远停在 true，trigger 直接走"正在执行"分支
    const second = await s.trigger('daily-health-check')
    expect(calls, '监听器抛错不能把任务永久卡住').toBe(2)
    expect(second.success).toBe(true)
  })

  it('handler 卡住时有预算：超时记为失败并交还调度权', async () => {
    vi.useFakeTimers()
    const s = Scheduler.getInstance()
    s.register(task('weekly-ops-report', () => new Promise(() => undefined)))
    const pending = s.trigger('weekly-ops-report')
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
    const result = await pending
    expect(result.success).toBe(false)
    expect(result.error ?? result.summary, '必须说清是预算用尽，而不是静默失败').toMatch(/超时/)
    vi.useRealTimers()
  })

  it('正常路径仍按 handler 结果上报（超时兜底没把成功也吞掉）', async () => {
    const s = Scheduler.getInstance()
    s.register(
      task('daily-decision-archive', async () => ({
        success: true,
        summary: '归档 3 条',
        durationMs: 0,
      })),
    )
    const r = await s.trigger('daily-decision-archive')
    expect(r.success).toBe(true)
    expect(r.summary).toBe('归档 3 条')
  })
})

describe('MCP 生命周期：定时器必须可摘除', () => {
  it('dispose 之后事件循环上不再挂着 1 秒轮询', () => {
    // 假定时器要在 getInstance() 之前开：setInterval 是在构造函数里挂的，
    // 先建实例再开假定时器，量到的定时器数就不是那条轮询的
    vi.useFakeTimers()
    const m = McpLifecycleManager.getInstance()
    expect(m.isPolling(), '构造时就挂上了轮询').toBe(true)
    const withTimer = vi.getTimerCount()
    expect(withTimer, '这个用例的前提是有定时器在跑').toBeGreaterThan(0)

    m.dispose()
    expect(m.isPolling()).toBe(false)
    expect(vi.getTimerCount(), 'dispose 必须把 setInterval 清掉').toBeLessThan(withTimer)

    // 幂等：重复 dispose 不炸、不留下半个状态
    m.dispose()
    expect(m.isPolling()).toBe(false)
    vi.useRealTimers()
  })
})
