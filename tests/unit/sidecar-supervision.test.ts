/**
 * Sidecar 监督测试（D3）
 *
 * 覆盖这次真正补上的三件事：
 *   1. 重启预算改成 30 秒滚动窗口（以前"累计 3 次、成功即清零"，
 *      每 30 秒崩一次的 sidecar 能无限重启）
 *   2. 退出清理真的被接上（以前 cleanupSidecar 只挂到 global 上，没人调用，
 *      应用关了 Python 进程还留在机器上）
 *   3. 状态里带 stderr 尾部（崩溃现场不能只剩一句"退出了"）
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  RESTART_BUDGET_MAX,
  RESTART_BUDGET_WINDOW_MS,
  STDERR_RING_SIZE,
  canRestartWithinBudget,
  remainingRestartBudget,
} from '../../src/main/core/sidecar/sidecar-manager'

const ROOT = path.resolve(__dirname, '../..')

describe('重启预算：30 秒滚动窗口', () => {
  const T0 = 1_700_000_000_000

  it('空预算给满 3 次', () => {
    expect(remainingRestartBudget([], T0)).toBe(RESTART_BUDGET_MAX)
    expect(canRestartWithinBudget([], T0)).toBe(true)
  })

  it('窗口内连崩 3 次后不再重启', () => {
    const times = [T0, T0 + 1000, T0 + 2000]
    expect(remainingRestartBudget(times, T0 + 3000)).toBe(0)
    expect(canRestartWithinBudget(times, T0 + 3000)).toBe(false)
  })

  it('超出窗口的旧崩溃不计入（慢速崩溃不会被误判成崩溃风暴）', () => {
    const times = [T0, T0 + 1000]
    // 两次崩溃都满 30 秒出去之后，预算应完全恢复
    const muchLater = T0 + RESTART_BUDGET_WINDOW_MS + 1000
    expect(remainingRestartBudget(times, muchLater)).toBe(RESTART_BUDGET_MAX)
    expect(canRestartWithinBudget(times, muchLater)).toBe(true)
  })

  it('只有一部分崩溃出窗时按剩余计', () => {
    const times = [T0, T0 + 1000]
    const partlyAged = T0 + RESTART_BUDGET_WINDOW_MS + 1
    expect(remainingRestartBudget(times, partlyAged)).toBe(RESTART_BUDGET_MAX - 1)
  })

  it('窗口边界按半开区间算：刚好 30 秒的不算在内', () => {
    const times = [T0]
    expect(remainingRestartBudget(times, T0 + RESTART_BUDGET_WINDOW_MS)).toBe(RESTART_BUDGET_MAX)
    expect(remainingRestartBudget(times, T0 + RESTART_BUDGET_WINDOW_MS - 1)).toBe(RESTART_BUDGET_MAX - 1)
  })

  it('预算不会变成负数', () => {
    const times = Array.from({ length: 10 }, (_, i) => T0 + i)
    expect(remainingRestartBudget(times, T0 + 100)).toBe(0)
  })
})

describe('退出清理接线（S15）', () => {
  const mainIndex = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8')
  const ipcIndex = fs.readFileSync(path.join(ROOT, 'src/main/ipc/index.ts'), 'utf8')

  it('handleBeforeQuit 里真的 await cleanupSidecar()', () => {
    const body = mainIndex.slice(mainIndex.indexOf('function handleBeforeQuit'))
    expect(body).toContain('await cleanupSidecar()')
    expect(body).toContain('cleanupLoopEngineering()')
  })

  it('不再用 global 中转清理函数（那条路从来没人调用）', () => {
    expect(ipcIndex).not.toContain('__cleanupSidecar')
    expect(ipcIndex).not.toContain('__cleanupLoopEngineering')
  })

  it('before-quit 必须先拦住退出，清理跑完才放行', () => {
    // Electron 不等 async 监听器：只 await 不 preventDefault 的话，清理停在第一个 await 上，
    // 源码看着接好了，运行时一行没跑（行为判据在 tests/e2e/app-quit-cleanup.spec.ts，这里钉结构）
    const body = mainIndex.slice(
      mainIndex.indexOf('async function handleBeforeQuit'),
      mainIndex.indexOf('async function runQuitCleanup')
    )
    expect(body.length, '没找到 handleBeforeQuit → runQuitCleanup 这段').toBeGreaterThan(20)
    expect(body).toContain('event.preventDefault()')
    expect(body).toContain('app.quit()')
    expect(body).toContain('QUIT_CLEANUP_CAP_MS')
  })
})

describe('状态形状与 stderr 环形缓冲', () => {
  it('getStatus 暴露 restartsInWindow 与 stderrTail，未启动时为空', async () => {
    const { SidecarManager, SIDECAR_CONFIGS } = await import(
      '../../src/main/core/sidecar/sidecar-manager'
    )
    const mgr = new SidecarManager(SIDECAR_CONFIGS.sre)
    const s = mgr.getStatus()
    expect(s.status).toBe('stopped')
    expect(s.restartsInWindow).toBe(0)
    expect(s.stderrTail).toEqual([])
    expect(s.lastError).toBeNull()
  })

  it('stderr 缓冲上限是 40 行', () => {
    expect(STDERR_RING_SIZE).toBe(40)
  })
})
