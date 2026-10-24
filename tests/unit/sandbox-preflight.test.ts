/**
 * 沙箱预检的判据（#202）
 *
 * 背景：教程页那颗「打开沙箱并执行」按钮以前只会问 `sandboxExecute` 这把键存不存在，
 * 然后直接 sandboxList → sandboxCreate。Docker 没开时用户看到的是一串
 * `沙箱创建失败：connect ECONNREFUSED ...` 之类的英文堆栈，
 * 而主进程早就有 `sandbox:status`（返回 dockerReady / openhandsRunning / error，
 * 类型注释自己写着"用于 UI 展示当前 OpenHands 集成是否可用"）与 `sandbox:start`
 * ——两个都注册了、都通了 IPC，唯独没人读。这一轮把它们接上，顺手把 `detect-docker`
 * 删掉（读状态的那条已经含 Docker 判定，留一把没人按的重复键只是多一个出口）。
 *
 * 这里钉的是"状态 → 人话 + 下一步"这份映射；界面接线本身由
 * renderer-calls 的真件判据与 audit:ipc 的只降不升刻度守着。
 */
import { describe, it, expect } from 'vitest'

import { planSandboxPreflight, waitSandboxReady } from '../../src/renderer/src/lib/sandbox-preflight'
import type { SandboxHealthStatus } from '../../src/renderer/src/types/electron'

describe('[sandbox-preflight] 四种状态各说各的话', () => {
  it('Docker 就绪且容器在跑 ⇒ 直接放行，不拦', () => {
    const p = planSandboxPreflight({
      dockerReady: true,
      dockerVersion: '27.3.1',
      openhandsRunning: true,
    })
    expect(p.kind).toBe('ready')
    expect(p.canStart).toBe(false)
  })

  it('Docker 没在跑 ⇒ 拦下来，给"需要 Docker"的人话，且不许提供"启动容器"这颗按钮', () => {
    const p = planSandboxPreflight({
      dockerReady: false,
      dockerVersion: null,
      openhandsRunning: false,
      error: 'Docker 未运行',
    })
    expect(p.kind).toBe('docker-missing')
    expect(p.canStart).toBe(false)
    expect(p.message).toContain('Docker')
  })

  it('Docker 在跑但容器没起 ⇒ 拦下来，但这一档可以一键启动', () => {
    const p = planSandboxPreflight({
      dockerReady: true,
      dockerVersion: '27.3.1',
      openhandsRunning: false,
    })
    expect(p.kind).toBe('container-stopped')
    expect(p.canStart).toBe(true)
    expect(p.message).toContain('容器')
  })

  it('读不到状态 ⇒ 不许当成"没问题"放行', () => {
    for (const s of [null, undefined]) {
      const p = planSandboxPreflight(s)
      expect(p.kind, `状态读不到时不能放行（传入 ${String(s)}）`).toBe('unknown')
      expect(p.canStart).toBe(false)
    }
  })

  it('容器那一档不许和 Docker 那一档共用一句话（成因不同，修法不同）', () => {
    const noDocker = planSandboxPreflight({
      dockerReady: false,
      dockerVersion: null,
      openhandsRunning: false,
    })
    const noContainer = planSandboxPreflight({
      dockerReady: true,
      dockerVersion: '27.3.1',
      openhandsRunning: false,
    })
    expect(noDocker.message).not.toBe(noContainer.message)
  })
})

/**
 * `sandbox:start` 是 `docker compose up -d`：命令回来不等于 App Server 已经能应答。
 * 只读一次就把"还没起来"说成"没能起来"，是拿瞬时末值当结局（本项目 toast 一族栽过第四次）。
 * 所以启动后必须**有界地等**，等到就绪或者等到时间用完，并且两种结果说的话不一样。
 */
describe('[sandbox-preflight] 启动之后要等，不许读一次就判死', () => {
  const STOPPED = { dockerReady: true, dockerVersion: '27.3.1', openhandsRunning: false }
  const READY = { dockerReady: true, dockerVersion: '27.3.1', openhandsRunning: true }

  it('容器慢慢起来：第二次读还没好、第三次好了 ⇒ 等到 ready，读的次数要说得清', async () => {
    const reads: SandboxHealthStatus[] = [STOPPED, STOPPED, READY]
    let clock = 0
    const plan = await waitSandboxReady(async () => reads.shift() as SandboxHealthStatus, {
      deadlineMs: 30_000,
      intervalMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
    })
    expect(plan.kind).toBe('ready')
    expect(reads, '三份读数都用掉了，没提前退出').toHaveLength(0)
  })

  it('容器始终没起：到点就停，并且不许读无限次', async () => {
    let clock = 0
    let calls = 0
    const plan = await waitSandboxReady(
      async () => {
        calls++
        return STOPPED
      },
      {
        deadlineMs: 3000,
        intervalMs: 1000,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms
        },
      },
    )
    expect(plan.kind).toBe('container-stopped')
    // 1 次首读 + 3 秒预算里每 1 秒一次 = 4 次；再多就是没有界
    expect(calls).toBe(4)
  })

  it('中途发现不是容器的问题（Docker 掉了）⇒ 立刻停等，别把 30 秒耗光', async () => {
    let clock = 0
    const reads: SandboxHealthStatus[] = [STOPPED, { dockerReady: false, dockerVersion: null, openhandsRunning: false }]
    const plan = await waitSandboxReady(async () => reads.shift() as SandboxHealthStatus, {
      deadlineMs: 30_000,
      intervalMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
    })
    expect(plan.kind).toBe('docker-missing')
    expect(reads, '第二次读完就该停，不该再等').toHaveLength(0)
    expect(clock, '没就绪时不该把预算睡满').toBe(1000)
  })
})
