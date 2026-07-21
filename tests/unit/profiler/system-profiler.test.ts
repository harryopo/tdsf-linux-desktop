/**
 * SystemProfiler 单元测试
 *
 * 覆盖：
 * - PROBE_CATALOG 数量与分组正确
 * - 探查结果聚合（items + errors）
 * - 总耗时计算
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock SshConnectionManager
const { mockProbe } = vi.hoisted(() => ({ mockProbe: vi.fn() }))

vi.mock('../../../src/main/services/profiler/command-probe', () => ({
  commandProbe: mockProbe
}))

import { runProfiler, PROBE_CATALOG, GROUP_LABELS } from '../../../src/main/services/profiler/system-profiler'

describe('SystemProfiler', () => {
  beforeEach(() => {
    mockProbe.mockReset()
  })

  it('PROBE_CATALOG 包含 26 项探查（覆盖 10 个组）', () => {
    expect(PROBE_CATALOG.length).toBe(26)
    const groups = new Set(PROBE_CATALOG.map((p) => p.group))
    expect(groups.size).toBe(10)
  })

  it('每组探查项都有 cmd 和 groupLabel', () => {
    for (const probe of PROBE_CATALOG) {
      expect(probe.cmd).toBeTruthy()
      expect(probe.groupLabel).toBeTruthy()
      expect(probe.group).toBeTruthy()
    }
  })

  it('GROUP_LABELS 覆盖所有 10 个组', () => {
    expect(Object.keys(GROUP_LABELS).length).toBe(10)
    expect(GROUP_LABELS.system).toBe('系统标识')
    expect(GROUP_LABELS['cpu-memory']).toBe('CPU 与内存')
  })

  it('runProfiler 聚合所有探查项结果', async () => {
    mockProbe.mockImplementation(async (_sess, group, label, cmd) => ({
      group,
      groupLabel: label,
      cmd,
      stdout: `output for ${cmd}`,
      stderr: '',
      exitCode: 0,
      durationMs: 50,
      ok: true
    }))

    const result = await runProfiler('sess-1', 'test-host')

    expect(result.host).toBe('test-host')
    expect(result.sessionId).toBe('sess-1')
    expect(result.items.length).toBe(PROBE_CATALOG.length)
    expect(result.errors.length).toBe(0)
    expect(result.generatedAt).toBeGreaterThan(0)
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
  })

  it('失败项进入 errors 列表', async () => {
    mockProbe.mockImplementation(async (_sess, group, label, cmd, _opts) => ({
      group,
      groupLabel: label,
      cmd,
      stdout: '',
      stderr: '',
      exitCode: -1,
      durationMs: 10,
      ok: false,
      error: 'simulated failure'
    }))

    const result = await runProfiler('sess-1', 'test-host')

    expect(result.items.length).toBe(PROBE_CATALOG.length)
    expect(result.errors.length).toBe(PROBE_CATALOG.length)
    expect(result.errors[0].error).toBe('simulated failure')
  })

  it('混合成功/失败：errors 仅包含失败项', async () => {
    let callCount = 0
    mockProbe.mockImplementation(async (_sess, group, label, cmd) => {
      callCount++
      const ok = callCount % 2 === 0
      return {
        group,
        groupLabel: label,
        cmd,
        stdout: ok ? 'success' : '',
        stderr: '',
        exitCode: ok ? 0 : -1,
        durationMs: 10,
        ok,
        error: ok ? undefined : 'failed'
      }
    })

    const result = await runProfiler('sess-1', 'test-host')

    expect(result.items.length).toBe(PROBE_CATALOG.length)
    expect(result.errors.length).toBe(Math.floor(PROBE_CATALOG.length / 2))
  })

  it('按 CONCURRENCY=6 分批并发', async () => {
    let concurrent = 0
    let maxConcurrent = 0

    mockProbe.mockImplementation(async (_sess, group, label, cmd) => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      // 模拟 50ms 延迟
      await new Promise((r) => setTimeout(r, 50))
      concurrent--
      return {
        group,
        groupLabel: label,
        cmd,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
        ok: true
      }
    })

    await runProfiler('sess-1', 'test-host')

    // 最大并发应该 <= 6
    expect(maxConcurrent).toBeLessThanOrEqual(6)
    expect(maxConcurrent).toBeGreaterThan(1)  // 至少有 2 个并发
  })
})
