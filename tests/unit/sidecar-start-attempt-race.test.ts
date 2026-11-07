/**
 * sidecar 启动尝试的身份（2026-11-07 红测）
 *
 * 三条判据钉的都是同一件事：SidecarManager 缺少"当前这一次启动尝试"的身份。
 *
 * 1. `stop()` 不复位 `restartExhausted`：耗尽预算后停一次，`exhausted` 变成跨尝试的历史标记，
 *    下一次启动失败仍会被横幅读成「已停止自动重启」。
 * 2. 耗尽后再失败一次：终态是 `crashed + exhausted + detail`，横幅压过「没能启动」。
 * 3. 两代 `start()` 重叠：过期代的 catch 最后落地，把当前代的终态覆盖掉。
 *
 * 说明：第 1、2 条的前置"预算已耗尽"用直读私有状态构造。原因不是偷懒——修好 in-flight 互斥后，
 * 每次失败都会在 `stop()` 里清零预算，真实重启链已不可能在一轮测试里烧光；而这两条要证伪的是
 * "`stop()`/失败终态有没有复位 `exhausted`"，与预算是怎么烧光的无关。产品代码没有为它改一个字节。
 *
 * 没有可用 Python 时整条跳过（与 sidecar-process-lifecycle.test.ts 同一口径）。
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SidecarHealthState } from '../../src/shared/sidecar-types'
import {
  SidecarManager,
  type SidecarConfig,
} from '../../src/main/core/sidecar/sidecar-manager'

vi.setConfig({ testTimeout: 60000 })

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function findPython(): string | null {
  for (const cand of ['python', 'python3']) {
    const r = spawnSync(cand, ['--version'], { encoding: 'utf8' })
    if (r.status === 0) return cand
  }
  return null
}

const PYTHON = findPython()
if (!PYTHON) console.log('[sidecar-race] 跳过：本机没有可用的 python')

/** 启动即退出，用来制造"崩溃" */
const EXIT_MODULE = 'tdsf_race_exit_sidecar'
/** 写 PID 后长睡，用来制造"还活着的另一代进程" */
const SLEEP_MODULE = 'tdsf_race_sleep_sidecar'

let workDir = ''

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-sidecar-race-'))
  fs.writeFileSync(path.join(workDir, `${EXIT_MODULE}.py`), 'import sys\nsys.exit(1)\n', 'utf8')
  fs.writeFileSync(
    path.join(workDir, `${SLEEP_MODULE}.py`),
    [
      'import os, time',
      "with open(os.path.join(os.getcwd(), 'pids.log'), 'a') as f:",
      '    f.write(str(os.getpid()) + "\\n")',
      'for _ in range(600):',
      '    time.sleep(0.1)',
      '',
    ].join('\n'),
    'utf8'
  )
})

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

function baseConfig(overrides: Partial<SidecarConfig>): SidecarConfig {
  return {
    id: 'test-race-sidecar',
    name: '竞态测试替身',
    pythonPath: PYTHON as string,
    workingDir: workDir,
    entry: EXIT_MODULE,
    host: '127.0.0.1',
    // 没人监听的端口：health 必失败，启动尝试一定会走到失败分支
    port: 1,
    healthCheckIntervalMs: 5000,
    startupTimeoutMs: 20_000,
    ...overrides,
  }
}

function collectStates(mgr: SidecarManager): SidecarHealthState[] {
  const states: SidecarHealthState[] = []
  mgr.on('state', (s: SidecarHealthState) => states.push(s))
  return states
}

async function waitFor<T>(read: () => T | null | false, timeoutMs: number, label: string): Promise<T> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== null && value !== false) return value
    if (Date.now() > until) throw new Error(`等超时（${timeoutMs}ms）：${label}`)
    await sleep(20)
  }
}

function readPids(): number[] {
  try {
    return fs
      .readFileSync(path.join(workDir, 'pids.log'), 'utf8')
      .split(/\r?\n/)
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  } catch {
    return []
  }
}

/**
 * 直读私有状态的类型视图。
 * 只用于把"预算已耗尽"这一前置摆好，产品行为不受影响。
 */
interface Internals {
  status: string
  restartTimes: number[]
  restartCount: number
  restartExhausted: boolean
}

function internalsOf(mgr: SidecarManager): Internals {
  return mgr as unknown as Internals
}

describe('sidecar 启动尝试的身份（红测）', () => {
  it('stop() 之后 restartExhausted 必须复位：exhausted 不能跨尝试粘连', async () => {
    if (!PYTHON) return
    const mgr = new SidecarManager(baseConfig({ startupTimeoutMs: 400 }))
    const states = collectStates(mgr)
    const inside = internalsOf(mgr)
    // 前置：窗口内已经崩了 3 次，下一次崩溃就会耗尽预算
    inside.status = 'crashed'
    inside.restartTimes = [Date.now(), Date.now(), Date.now()]
    inside.restartCount = 3

    void mgr.start().catch(() => undefined)
    // 进程秒退 → exit 回调走"预算耗尽"分支，把 exhausted 置位
    await waitFor(() => states.some((s) => s.exhausted), 4000, '等预算耗尽')
    await mgr.stop()
    // 让在途 start 的 catch 落地，拿到最后一条 health
    await sleep(700)

    const last = states[states.length - 1]
    expect(
      last.exhausted,
      `stop() 之后最后一条 health 仍带 exhausted=true：${JSON.stringify(last)}`
    ).toBe(false)
  })

  it('预算耗尽之后再失败一次：最终 health 不得带 exhausted，且落在「没能启动」分支', async () => {
    if (!PYTHON) return
    const mgr = new SidecarManager(baseConfig({ startupTimeoutMs: 400 }))
    const states = collectStates(mgr)
    const inside = internalsOf(mgr)
    // 前置：预算已经烧光（下一次 start 是新的第一次尝试）
    inside.status = 'crashed'
    inside.restartTimes = [Date.now(), Date.now(), Date.now()]
    inside.restartCount = 3
    inside.restartExhausted = true

    await mgr.start().catch(() => undefined)
    await sleep(100)

    const leaked = states.filter(
      (s) => s.phase === 'crashed' && s.exhausted === true && (s.detail ?? '').startsWith('启动失败：')
    )
    expect(
      leaked,
      `过期的 exhausted 仍写进了启动失败终态：${JSON.stringify(leaked)}`
    ).toEqual([])

    const last = states[states.length - 1]
    expect(last.phase, `最终终态应落在「没能启动」的 stopped 分支，实际=${last.phase}`).toBe('stopped')
    expect(last.exhausted, `最终 health 仍带 exhausted：${JSON.stringify(last)}`).toBe(false)
    expect(last.detail ?? '', '「没能启动」分支要求 detail 非空').toMatch(/^启动失败：/)
  })

  it('重叠启动时，过期代的 catch 不得覆盖当前代的终态', async () => {
    if (!PYTHON) return
    const cfg = baseConfig({ entry: SLEEP_MODULE, startupTimeoutMs: 900 })
    const mgr = new SidecarManager(cfg)
    const states = collectStates(mgr)

    // 第 1 代开始，进程写 PID 后长睡；它会在 0.9 秒后判失败
    void mgr.start().catch(() => undefined)
    await waitFor(() => readPids().length >= 1, 8000, '等第 1 代进程')
    await sleep(100)

    // 用户在这期间主动停止，且第 1 代的 waitForReady 还没结束 → 在途
    await mgr.stop()
    // 第 2 代（新的一次尝试）用更长的预算：过期代先落地，当前代后落地
    cfg.startupTimeoutMs = 1500
    void mgr.start().catch(() => undefined)
    await waitFor(() => readPids().length >= 2, 8000, '等第 2 代进程')

    // 两代都落地：第 1 代约 1 秒，第 2 代约 1.6 秒
    await sleep(2200)

    const lastError = mgr.getStatus().lastError ?? ''
    expect(
      lastError,
      `最终终态应来自当前代（1500ms 那次），实际 lastError=${JSON.stringify(lastError)}，` +
        `state 尾部=${JSON.stringify(states.slice(-3))}`
    ).toContain('1500ms')
    expect(lastError, '过期代（900ms 那次）的失败覆盖了当前代终态').not.toContain('900ms')

    await mgr.stop()
  })
})
