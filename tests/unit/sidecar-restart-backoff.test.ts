/**
 * Sidecar 自动重启的退避间隔与健康状态推送（2026-11-01）
 *
 * 退避是纯函数，容易钉：1s → 2s → 4s → 8s → 16s → 30s（封顶）。
 * 但"推给界面"这件事只能在真 manager 上验：这里只造一个不启进程的实例，
 * 走 stop() 那条路径确认 state 事件真的带着 phase/attempt/exhausted 出来。
 */
import { describe, it, expect } from 'vitest'
import {
  SidecarManager,
  nextRestartDelayMs,
  type SidecarConfig,
} from '../../src/main/core/sidecar/sidecar-manager'
import type { SidecarHealthState } from '../../src/shared/sidecar-types'

const cfg: SidecarConfig = {
  id: 'test-health',
  name: '测试替身',
  pythonPath: process.execPath,
  workingDir: process.cwd(),
  entry: 'main.py',
  host: '127.0.0.1',
  port: 1,
  healthCheckIntervalMs: 500,
  startupTimeoutMs: 1000,
}

describe('nextRestartDelayMs', () => {
  it('从 1 秒开始逐次翻倍，封顶 30 秒', () => {
    expect([1, 2, 3, 4, 5, 6].map(nextRestartDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
    ])
    expect(nextRestartDelayMs(10), '封顶之后不许继续翻倍').toBe(30_000)
  })

  it('脏输入不抛也不返回 0（0 等于立刻重试，会把预算瞬间烧光）', () => {
    for (const bad of [0, -3, 1.9]) {
      expect(nextRestartDelayMs(bad)).toBeGreaterThanOrEqual(1_000)
      expect(nextRestartDelayMs(bad)).toBeLessThanOrEqual(30_000)
    }
  })

  it('单调不减：次数越多等得越久（否则退避没有意义）', () => {
    const seq = [1, 2, 3, 4, 5, 6, 7].map(nextRestartDelayMs)
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1])
  })
})

describe('健康状态推送', () => {
  it('停止后推一条 stopped，且没有"还要重试"的余数', async () => {
    const manager = new SidecarManager(cfg)
    const states: SidecarHealthState[] = []
    manager.on('state', (s: SidecarHealthState) => states.push(s))

    await manager.stop()

    const last = states[states.length - 1]
    expect(last, 'stop() 必须推一次健康状态，否则横幅永远停在崩溃态').toBeDefined()
    expect(last.phase).toBe('stopped')
    expect(last.nextRetryInMs).toBeNull()
    expect(last.exhausted).toBe(false)
  })
})
