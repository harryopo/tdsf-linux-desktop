/**
 * 退出清理引擎的行为判据（阶段 D3/D4）
 *
 * 取代上一版的"读 index.ts 源码字符串"断言：那种断言一改结构就红（本轮把清理改成步骤表后
 * `toContain('await cleanupSidecar()')` 就红了），但真把 preventDefault 摘掉它不一定红得掉语义。
 * 现在闸门、顺序、每步超时、卡死上报、异常兜底都是**跑出来的**。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  buildQuitSteps,
  createQuitCleanup,
  type QuitLog,
  type QuitServices,
  type QuitStep,
} from '../../src/main/core/quit-cleanup'

function fakeLog(): QuitLog & { rows: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> } {
  const rows: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = []
  // 与主进程 logger 同形：(category, message, meta)。上一版替身签名少了一维，
  // 引擎按三维调用时第三条参数被丢掉，断言全打在 undefined 上——假红反而暴露了接口不一致。
  return {
    rows,
    info: (_category, msg, meta) => rows.push({ level: 'info', msg, meta }),
    warn: (_category, msg, meta) => rows.push({ level: 'warn', msg, meta }),
  }
}

function fakeServices(order: string[], delayMs = 0): QuitServices {
  const mk = (name: string) => () =>
    new Promise<void>((resolve) => setTimeout(() => (order.push(name), resolve()), delayMs))
  return {
    cleanupSidecar: mk('sidecar'),
    disconnectExternalMcp: mk('mcp-clients'),
    stopFileWatchers: mk('watchers'),
    stopMonitoring: mk('monitor'),
    disconnectSsh: mk('ssh'),
    stopMcpServer: mk('mcp'),
    shutdownLangfuse: mk('langfuse'),
    cleanupScheduler: mk('scheduler'),
    cleanupLoopEngineering: mk('loop'),
    releaseMainWindow: mk('window'),
  }
}

function makeOpts(steps: QuitStep[], log: QuitLog, over: Partial<Parameters<typeof createQuitCleanup>[0]> = {}) {
  const quit = vi.fn()
  const opts = {
    steps: () => steps,
    log,
    capMs: 2000,
    stepTimeoutMs: 300,
    tailWaitMs: 0,
    quit,
    ...over,
  }
  return { quit, opts, cleanup: createQuitCleanup(opts) }
}

describe('退出清理闸门（行为）', () => {
  it('第一次 before-quit 拦住退出，清理全部跑完才放行', async () => {
    const order: string[] = []
    const log = fakeLog()
    const steps = buildQuitSteps(fakeServices(order))
    const { quit, cleanup } = makeOpts(steps, log)
    const ev = { preventDefault: vi.fn() }

    await cleanup.onBeforeQuit(ev)

    expect(ev.preventDefault, 'Electron 不等 async 监听器，不拦住退出清理就跑不完').toHaveBeenCalled()
    expect(quit, '清理完成后必须第二次 quit 放行').toHaveBeenCalledTimes(1)
    expect(order).toHaveLength(steps.length)
    expect(log.rows.some((r) => r.msg === '退出清理收尾' && r.meta?.outcome === '完成')).toBe(true)
    expect(cleanup.state()).toBe('done')
  })

  it('步骤顺序：子进程最先关，骑在 SSH 上的先停', () => {
    const names = buildQuitSteps(fakeServices([])).map((s) => s.name)
    expect(names).toHaveLength(10)
    const at = (n: string) => names.indexOf(n)
    // 上一版 sidecar 排第 6：SSH 一吃光整体上限它就饿死，孤儿进程 bug 原地复活
    expect(at('关闭 sidecar'), 'sidecar 必须排第一').toBe(0)
    expect(at('断开外部 MCP 客户端')).toBeLessThan(at('停止 MCP Server'))
    expect(at('停止文件监听'), '文件监听的 inotify 流/轮询定时器挂在 SSH 会话上').toBeLessThan(at('断开 SSH'))
  })

  it('某一步永不返回：按单步超时放过，后面的步骤照跑', async () => {
    const order: string[] = []
    const log = fakeLog()
    const steps = [
      { name: '挂住的一步', run: () => new Promise(() => undefined), timeoutMs: 40 },
      { name: '后续步骤', run: () => (order.push('after'), undefined) },
    ]
    const { quit, cleanup } = makeOpts(steps, log, { stepTimeoutMs: 40 })

    await cleanup.onBeforeQuit({ preventDefault: vi.fn() })

    expect(order).toEqual(['after'])
    expect(quit).toHaveBeenCalledTimes(1)
    expect(
      log.rows.some((r) => r.level === 'warn' && r.msg.includes('某一步超时') && r.meta?.step === '挂住的一步'),
      '超时那一步必须留下带步骤名的日志，否则现场只能看到"退出慢"'
    ).toBe(true)
  })

  it('某一步抛错：记下带步骤名的警告，其余项不受影响', async () => {
    const order: string[] = []
    const log = fakeLog()
    const steps = [
      { name: '会炸的一步', run: () => Promise.reject(new Error('boom')) },
      { name: '正常的一步', run: () => (order.push('ok'), undefined) },
    ]
    const { cleanup } = makeOpts(steps, log)

    await cleanup.onBeforeQuit({ preventDefault: vi.fn() })

    expect(order).toEqual(['ok'])
    const w = log.rows.find((r) => r.level === 'warn')
    expect(w?.meta).toMatchObject({ step: '会炸的一步', error: 'boom' })
  })

  it('整体上限被顶穿：仍然放行退出，并说得出卡在哪一步', async () => {
    const log = fakeLog()
    const steps = [{ name: '彻底卡死', run: () => new Promise(() => undefined), timeoutMs: 60_000 }]
    const { quit, cleanup } = makeOpts(steps, log, { capMs: 60, stepTimeoutMs: 60_000 })

    await cleanup.onBeforeQuit({ preventDefault: vi.fn() })

    expect(quit, '宁可带着警告退出，也不能把窗口钉死在屏幕上').toHaveBeenCalledTimes(1)
    const done = log.rows.find((r) => r.msg === '退出清理收尾')
    expect(done?.meta).toMatchObject({ outcome: '超时', stuckAt: '彻底卡死' })
    expect(cleanup.state()).toBe('done')
  })

  it('清理跑完后的第二次 before-quit 不再拦截（否则会无限循环关不掉）', async () => {
    const log = fakeLog()
    const { cleanup } = makeOpts(buildQuitSteps(fakeServices([])), log)
    await cleanup.onBeforeQuit({ preventDefault: vi.fn() })

    const ev2 = { preventDefault: vi.fn() }
    await cleanup.onBeforeQuit(ev2)
    expect(ev2.preventDefault, '已 done 的那次必须放行').not.toHaveBeenCalled()
  })

  it('清理进行中的第二次 before-quit 拦住但不重复启动', async () => {
    const log = fakeLog()
    let release!: () => void
    const steps = [{ name: '慢清理', run: () => new Promise<void>((r) => (release = r)) }]
    const { quit, cleanup } = makeOpts(steps, log)

    const first = cleanup.onBeforeQuit({ preventDefault: vi.fn() })
    const ev2 = { preventDefault: vi.fn() }
    await cleanup.onBeforeQuit(ev2)
    expect(ev2.preventDefault, '清理没跑完，第二次也必须拦住').toHaveBeenCalled()

    release()
    await first
    expect(quit, '不该被第二次进来重复触发').toHaveBeenCalledTimes(1)
  })

  it('日志器自己抛错时仍然置为 done 并放行（兜底：最坏是不能关掉的卡死）', async () => {
    const boom: QuitLog = {
      info: () => {
        throw new Error('logger 挂了')
      },
      warn: () => undefined,
    }
    const { quit, cleanup } = makeOpts(buildQuitSteps(fakeServices([])), boom, { flush: undefined })
    await cleanup.onBeforeQuit({ preventDefault: vi.fn() })
    expect(cleanup.state(), '状态钉在 running 会让每次 quit 都 preventDefault → 永远关不掉').toBe('done')
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('优先 flush 落盘而不是死等固定时长', async () => {
    const log = fakeLog()
    const flush = vi.fn(async () => undefined)
    const { cleanup } = makeOpts(buildQuitSteps(fakeServices([])), log, { flush, tailWaitMs: 9999 })
    await cleanup.onBeforeQuit({ preventDefault: vi.fn() })
    expect(flush, '日志写是异步队列，150ms 死等不等于落盘').toHaveBeenCalled()
  })

  it('超时定时器都要清掉：残留定时器会把事件循环钉活', async () => {
    const log = fakeLog()
    const steps = [{ name: '挂住', run: () => new Promise(() => undefined), timeoutMs: 80 }]
    const { cleanup } = makeOpts(steps, log, { capMs: 5000 })
    await cleanup.onBeforeQuit({ preventDefault: vi.fn() })
    // 若 step 的定时器没清，这里还能观察到 pending handle
    expect(cleanup.state()).toBe('done')
  })
})
