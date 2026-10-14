/**
 * 空闲退出握手（D3：idle_shutdown_request 先征求宿主同意再退）
 *
 * 计划原本要求"心跳 15s / 超时 45s"这套推送式探活；本仓的实现是宿主每 5s 拉一次 /health
 * （比 45s 才发现死亡更严），因此**死亡检测**沿用现有形状。这里补的是缺的那一半：
 * 侧车空闲时不得自己消失，必须提请求、由宿主批准。
 *
 * 三条各守一个真实风险：
 *   1. 有在途业务时批准 = 用户拿不到结果 ⇒ 必须拒
 *   2. 批准却没把这次退出标成"有意停止" = 重启预算会立刻再拉一个，空闲退出反而变成拉锯
 *   3. 旧版侧车不带这个字段 ⇒ 不许猜成批准（缺字段就是没有请求）
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SidecarManager, type SidecarConfig } from '../../src/main/core/sidecar/sidecar-manager'

const cfg: SidecarConfig = {
  id: 'test-idle',
  name: '测试替身',
  pythonPath: process.execPath,
  workingDir: process.cwd(),
  entry: 'main.py',
  host: '127.0.0.1',
  port: 1,
  healthCheckIntervalMs: 500,
  startupTimeoutMs: 1000,
}

/** 造一个 fetch 响应 */
function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => '' } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('侧车空闲退出握手', () => {
  it('没有在途业务时批准，并把退出标成有意停止（不会被自动重启拉起）', async () => {
    const calls: { path: string; body: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        calls.push({ path: String(url), body: String(init?.body ?? '') })
        return json({ ok: true, exiting: true })
      })
    )
    const mgr = new SidecarManager(cfg)
    expect(await mgr.answerIdleShutdownRequest(900)).toBe('approve')
    expect(calls[0]!.path).toContain('/host/idle-shutdown-consent')
    expect(JSON.parse(calls[0]!.body)).toEqual({ approve: true })
    // 关键：批准之后必须是"有意停止"状态，否则进程一退就落进崩溃重启分支
    expect(mgr.getStatus().intentionalStop, '批准后没标成有意停止 ⇒ 重启预算会立刻再拉一个').toBe(true)
  })

  it('有在途业务请求时拒绝，且不许标成有意停止', async () => {
    const bodies: string[] = []
    // 用数组收集 resolve：写成 let release = null 再在 fetch 替身里赋值，
    // TS 的控制流看不见那次赋值，收尾调 release?.() 会报"这个表达式不可调用"
    const resolvers: Array<() => void> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
      const raw = String(init?.body ?? '')
      // 第一个调用是业务请求（挂住不放 ⇒ 制造在途），第二个是宿主的答复
      if (!raw.includes('approve')) {
        await new Promise<void>((r) => {
          resolvers.push(r)
        })
        return json({ parse: { templates: [] } })
      }
      bodies.push(raw)
      return json({ ok: true, exiting: false })
    }))

    const mgr = new SidecarManager(cfg)
    const inFlight = mgr.parseLogs(['a', 'b']) // 占住一个在途业务
    expect(await mgr.answerIdleShutdownRequest(900)).toBe('refuse')
    expect(JSON.parse(bodies[0]!), '有在途业务时不许批准').toEqual({ approve: false })
    expect(mgr.getStatus().intentionalStop, '拒绝时不许把侧车标成要停').toBe(false)
    for (const r of resolvers.splice(0)) r()
    await inFlight.catch(() => undefined)
  })

  it('侧车没带这个字段（旧版）时，健康轮询不许凭空发答复', async () => {
    const paths: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      paths.push(String(url))
      return json({ status: 'ok', version: '1.5.0', adapters: {}, uptime_seconds: 1 })
    }))
    const mgr = new SidecarManager(cfg)
    // 直接跑一次健康检查，确认字段缺失被判成"没有请求"
    const h = await mgr.health()
    expect(h.idle_shutdown_request, '缺字段必须当没有请求').toBeUndefined()
    expect(paths.some((p) => p.includes('idle-shutdown-consent')), '没有请求就不该答复').toBe(false)
  })

  it('答复发不出去（侧车半死）时按拒绝处理，不许当作已批准', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, false)))
    const mgr = new SidecarManager(cfg)
    expect(await mgr.answerIdleShutdownRequest(10)).toBe('refuse')
    expect(mgr.getStatus().intentionalStop).toBe(false)
  })
})
