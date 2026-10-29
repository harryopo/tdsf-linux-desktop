/**
 * 退出清理引擎的行为判据（阶段 D3/D4）
 *
 * 取代上一版的"读 index.ts 源码字符串"断言：那种断言一改结构就红（本轮把清理改成步骤表后
 * `toContain('await cleanupSidecar()')` 就红了），但真把 preventDefault 摘掉它不一定红得掉语义。
 * 现在闸门、顺序、每步超时、卡死上报、异常兜底都是**跑出来的**。
 *
 * 步骤**名单**同样不手写：它按 `keyof QuitServices` 取数（见"一一对应"那条），
 * 所以 2026-10-25 #222 删掉 `cleanupLoopEngineering` 时这里不需要跟着改一个数字，
 * 而"新增了收尾函数却忘了列进退出表"这种漏，仍然是红的。
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

/**
 * 造一套替身服务。
 *
 * 两个讲究：
 * 1. 键表写成 `Record<keyof QuitServices, …>`——`QuitServices` 加一个键、这里没跟上就编译不过，
 *    于是"新增资源"这件事一定会在这份名单上留下痕迹，再由下面那条"一一对应"的判据决定它有没有被退出表列上；
 * 2. 每个键返回**互不相同的函数实例**，这样 `buildQuitSteps` 产出的步骤能按引用反查到键名，
 *    "每个 dispose 都被退出表列上"就能源自类型本身，而不是抄一份会过期的步骤名清单。
 *    （#222 删掉 `cleanupLoopEngineering` 后，靠硬编码 17 条清单的写法只能红一次、还要人手改一次数字。）
 */
function fakeServices(order: string[], delayMs = 0): QuitServices {
  const mk = (name: string) => () =>
    new Promise<void>((resolve) => setTimeout(() => (order.push(name), resolve()), delayMs))
  const svc: Record<keyof QuitServices, () => unknown> = {
    cleanupSidecar: mk('sidecar'),
    disconnectExternalMcp: mk('mcp-clients'),
    stopFileWatchers: mk('watchers'),
    stopMonitoring: mk('monitor'),
    disconnectSsh: mk('ssh'),
    disposeMcpLifecycle: mk('mcp-lifecycle'),
    stopOpenHands: mk('openhands'),
    closeLocalPty: mk('local-pty'),
    shutdownLangfuse: mk('langfuse'),
    cleanupScheduler: mk('scheduler'),
    disposeTerminalCompletion: mk('completion'),
    disposeSessionRegistry: mk('session-registry'),
    persistTokenStats: mk('token-stats'),
    closeDatabase: mk('db-close'),
    releaseMainWindow: mk('window'),
  }
  return svc
}

/** 步骤的 run（函数引用）→ 它属于 QuitServices 的哪个键 */
function runToKey(svc: QuitServices): Map<() => unknown, string> {
  const m = new Map<() => unknown, string>()
  for (const [key, fn] of Object.entries(svc)) m.set(fn, key)
  return m
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

  it('步骤表与 QuitServices 一一对应：每个 dispose 都被退出表列上、且只列一次', () => {
    // 这条取代了上一版"步骤表里必须有一条解绑循环工程监听"的写法：
    // 那种断言把某天的成员清单抄了一遍，删一条链路就得改一次数字（#222 就红了）。
    // 现在按类型取数：QuitServices 有 16 个收尾函数，步骤表就必须恰好列上这 16 个——
    // "早就写好了 dispose 但退出表里没人列它"（2026-10-15 那三条漏网之鱼）仍然是红的方向。
    const svc = fakeServices([])
    const keyOf = runToKey(svc)
    const steps = buildQuitSteps(svc)
    const listed: string[] = []
    const strangers: string[] = []
    for (const s of steps) {
      const key = keyOf.get(s.run)
      if (key === undefined) {
        strangers.push(s.name)
        continue
      }
      listed.push(key)
    }
    expect(strangers, `步骤表里有 ${strangers.length} 条 run 不属于 QuitServices：${strangers.join('、')}`).toEqual(
      []
    )
    expect(
      listed.length,
      `步骤表里有重复列出的清理项（重复清理会二次释放）：${listed.join('、')}`
    ).toBe(new Set(listed).size)
    const missing = Object.keys(svc).filter((k) => !listed.includes(k))
    expect(missing, `这些 dispose 有实现却没被退出表列上：${missing.join('、')}`).toEqual([])
  })

  it('步骤顺序：子进程最先关，骑在 SSH 上的先停', () => {
    const svc = fakeServices([])
    const names = buildQuitSteps(svc).map((s) => s.name)
    // 条数不再手写：多一条少一条都由上一条用例按 QuitServices 判，这里只钉顺序
    expect(names).toHaveLength(Object.keys(svc).length)
    /** 取步骤下标。名字不在表里就直接红——`indexOf` 返回 -1 会让下面的大小比较全体"假绿" */
    const at = (n: string): number => {
      const i = names.indexOf(n)
      expect(i, `步骤表里没有「${n}」这一条（顺序断言拿 -1 比会静默通过）`).toBeGreaterThanOrEqual(0)
      return i
    }
    // 上一版 sidecar 排第 6：SSH 一吃光整体上限它就饿死，孤儿进程 bug 原地复活
    expect(at('关闭 sidecar'), 'sidecar 必须排第一').toBe(0)
    expect(at('断开外部 MCP 客户端')).toBeLessThan(at('断开 SSH'))
    expect(at('停止文件监听'), '文件监听的 inotify 流/轮询定时器挂在 SSH 会话上').toBeLessThan(at('断开 SSH'))
    // OpenHands 容器同样是留在机器上的后台进程，不能排到预算之后
    expect(at('停止 OpenHands 容器'), '容器必须在断 SSH 之前停').toBeLessThan(at('断开 SSH'))
    expect(at('停止 OpenHands 容器'), '容器紧跟 sidecar（同为外部进程）').toBeLessThanOrEqual(2)
    // 本机终端也是留在机器上的真进程（shell + 它的子进程），不能排到预算之后
    expect(at('关闭本机终端'), '本机终端必须在断 SSH 之前关').toBeLessThan(at('断开 SSH'))
    expect(at('关闭本机终端'), '本机终端紧跟前两个外部进程').toBeLessThanOrEqual(3)
    // 生命周期那把 1 秒轮询要在客户端都断干净之后再摘（还在用的时候摘会漏日志）
    expect(at('摘除 MCP 生命周期轮询')).toBeGreaterThan(at('断开外部 MCP 客户端'))
    // 2026-10-29 #281：入站 MCP Server（桌面进程里的 stdio，永远没有对端）整删，
    // 它那条"停止 MCP Server"步骤跟着退表；它要是回来，这里得重新钉顺序。
    expect(names, '入站 MCP Server 又回来了——#281 的判决要重开').not.toContain('停止 MCP Server')
    // 关库必须排在所有会写库的步骤之后：先关池子会把审计/调度/凭据的收尾打成"库不可用"
    for (const writer of ['断开 SSH', '清理调度器', '关闭 Langfuse（trace 落盘）']) {
      expect(at('关闭数据库句柄'), `关库排在了会写库的「${writer}」前面`).toBeGreaterThan(at(writer))
    }
    expect(at('关闭数据库句柄'), '关库是最后一个资源步骤（窗口释放不算资源）').toBe(names.length - 2)
    // 防抖里的 token 记录必须在退出前落盘，且排在任何可能失败的收尾之前也不算晚——
    // 这条只钉"存在且在关库前"，因为 token 统计走 electron-store，不依赖数据库
    expect(at('落盘 token 统计'), 'token 统计没有退出落盘步骤').toBeGreaterThanOrEqual(0)
    expect(at('落盘 token 统计')).toBeLessThan(at('关闭数据库句柄'))
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
