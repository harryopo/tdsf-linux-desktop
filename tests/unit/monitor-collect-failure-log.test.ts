/**
 * 监控采集失败要在日志里留痕（#257 的后半笔）
 *
 * 采集失败原本被 `catch(() => {})` 全吞：远端断链后定时器每 3 秒失败一次，
 * 界面上数据停住、日志里一个字都没有——用户报"监控不动了"时无从查起。
 *
 * 但也不能逐条写：3 秒一条会把日志环形缓冲冲干净。口径钉在这里：
 *   - 开始失败 → 记一条（带原因）
 *   - 继续失败 → 不再记
 *   - 恢复     → 记一条（带此前连续失败次数）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const log = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../src/main/services/log/logger', () => ({
  logger: { warn: log.warn, info: log.info, error: log.error, debug: log.debug },
}))

import { MONITOR_SEGMENT_SEP, SystemMonitor } from '../../src/main/services/ssh/monitor'

/** 一条能跑通解析的最小合并输出（7 段，顺序与采集探针一致） */
const OK_OUTPUT = [
  '%Cpu(s):  5.0 us,  2.0 sy,  0.0 ni, 92.0 id,  1.0 wa',
  '40.5',
  '37%',
  'eth0: 2000000 200 0 0 0 0 0 0 1000000 100 0 0 0 0 0 0',
  '0.52 0.58 0.59 1/234 5678',
  '123456.78 234567.89',
  '42',
].join(MONITOR_SEGMENT_SEP)

const net = { fail: true }

const fakeSource = {
  async exec(): Promise<{ exitCode: number; stdout: string; stderr: string; duration: number }> {
    if (net.fail) throw new Error('ECONNRESET 连接被远端重置')
    return { exitCode: 0, stdout: OK_OUTPUT, stderr: '', duration: 1 }
  },
  onSessionClosed: () => () => {},
}

describe('监控采集失败的日志口径', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    log.warn.mockClear()
    log.info.mockClear()
    net.fail = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('开始失败记一条、继续失败不刷屏、恢复时补一条', async () => {
    const monitor = new SystemMonitor(fakeSource)
    await monitor.startMonitoring('s-log', 1000)
    await vi.advanceTimersByTimeAsync(0)

    expect(log.warn, '第一次失败没留痕：日志里查不到"为什么停了"').toHaveBeenCalledTimes(1)
    const firstMsg = String(log.warn.mock.calls[0][1])
    expect(firstMsg).toContain('数据已停止更新')
    expect(firstMsg, '日志里要能定位是哪条会话').toContain('s-log')

    // 再失败三拍：一条都不许多写
    await vi.advanceTimersByTimeAsync(3000)
    expect(log.warn, '每 3 秒写一条会把日志缓冲冲干净').toHaveBeenCalledTimes(1)
    expect(log.info).not.toHaveBeenCalled()

    net.fail = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(log.info, '恢复了却没记录，日志读起来像一直断着').toHaveBeenCalledTimes(1)
    expect(String(log.info.mock.calls[0][1])).toContain('恢复')

    await monitor.stopMonitoring('s-log')
  })

  it('exec 整条失败时不许产出 0 值样本（那是"假健康"）', async () => {
    const monitor = new SystemMonitor(fakeSource)
    await expect(monitor.collectOnce('s-zero')).rejects.toThrow(/监控采集命令执行失败/)
    expect(
      monitor.latestSample('s-zero'),
      '失败的采集被记成样本后，界面和 AI 都会把 0% 当成"机器很闲"'
    ).toBeNull()
  })

  it('周期采集失败期间一条样本都不推，恢复后才继续推', async () => {
    const monitor = new SystemMonitor(fakeSource)
    const emitted: number[] = []
    monitor.onMonitorData((_sid, data) => emitted.push(data.timestamp))

    await monitor.startMonitoring('s-nosample', 1000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(emitted, '断链期间还在推样本＝界面永远等不到"停更"').toHaveLength(0)

    net.fail = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(emitted.length, '恢复后应重新有样本').toBeGreaterThan(0)

    await monitor.stopMonitoring('s-nosample')
  })
})
