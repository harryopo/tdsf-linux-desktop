/**
 * AI 的 monitor_get 只能开一个 SSH channel（2026-10-12 真机反馈"进程监控失败"）
 *
 * 两处历史缺陷一起钉：
 *   1. 工具自己并发 7 条 exec，每条开一个 channel；叠加界面轮询与交互 shell 就撞满
 *      OpenSSH 默认 MaxSessions=10，报 "Channel open failure"、指标全 0；
 *   2. 工具复制了一份解析函数，和界面那份漂了（CPU 一个按 100−idle、一个按 us；
 *      进程数一份减了 ps 的表头、一份没减）——AI 报的数和用户在监控页看的不是同一个数。
 * 现在采集与解析只有 SystemMonitor 一份实现，本文件用假 SSH 源跑真解析。
 */
import { describe, it, expect, vi } from 'vitest'
import type { CommandResult, MonitorData } from '@shared/models'
import { MONITOR_SEGMENT_SEP, SystemMonitor } from '../../src/main/services/ssh/monitor'

/** 假 SSH 源：记下每次 exec 的命令，并按采集探针返回真实形状的输出 */
const execCalls: string[] = []
const PROBE_OUTPUT: Record<string, string> = {
  'top -bn1 | grep "Cpu(s)" | head -1':
    '%Cpu(s):  5.0 us,  2.0 sy,  0.0 ni, 92.0 id,  1.0 wa,  0.0 hi,  0.0 si,  0.0 st',
  "free -b | grep Mem | awk '{print $3/$2 * 100}'": '40.5',
  "df -h / | awk 'NR==2{print $5}'": '37%',
  'cat /proc/net/dev': [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo:  1000       10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0',
    '  eth0: 2000000    200    0    0    0     0          0         0  1000000     100    0    0    0     0       0          0',
  ].join('\n'),
  'cat /proc/loadavg': '0.52 0.58 0.59 1/234 5678',
  'cat /proc/uptime': '123456.78 234567.89',
  'ps aux | wc -l': '42',
}

/** 把合并命令拆回各探针，逐个给输出，再按分隔符拼回去（和真 sshd 的回流形状一致） */
function respondTo(combined: string): string {
  return combined
    .split(` ; echo '${MONITOR_SEGMENT_SEP}' ; `)
    .map((probe) => PROBE_OUTPUT[probe.trim()] ?? '')
    .join(MONITOR_SEGMENT_SEP)
}

const fakeSource = {
  async exec(_sessionId: string, command: string): Promise<CommandResult> {
    execCalls.push(command)
    return { exitCode: 0, stdout: respondTo(command), stderr: '', duration: 1 }
  },
  onSessionClosed: () => () => {},
}

/** 连接状态由用例控制：'connected' 之外都应让工具直接失败 */
let connectionState = 'connected'
vi.mock('../../src/main/services/ssh/connection-manager', () => ({
  SshConnectionManager: {
    getInstance: () => ({
      getConnectionState: () => connectionState,
      exec: async (_sid: string, cmd: string): Promise<CommandResult> => {
        execCalls.push(cmd)
        return { exitCode: 0, stdout: respondTo(cmd), stderr: '', duration: 1 }
      },
    }),
  },
}))

async function runMonitorGet(sessionId: string) {
  const { executeMonitorGet } = await import('../../src/main/services/llm/tools/monitor-get')
  return executeMonitorGet({ sessionId })
}

describe('monitor_get 走单一采集出口', () => {
  it('一次调用只开一个 channel，且这一条里确实带着七个探针', async () => {
    execCalls.length = 0
    const monitor = SystemMonitor.getInstance(fakeSource)
    const data = await monitor.collectOnce('s-one')
    expect(execCalls, `并发采集会撞满 MaxSessions，本次却发了 ${execCalls.length} 条 exec`).toHaveLength(1)
    const only = execCalls[0]
    for (const probe of Object.keys(PROBE_OUTPUT)) {
      expect(only, `合并命令里少了探针：${probe}`).toContain(probe)
    }
    // 解析必须是界面那一份：CPU 按 100−idle、进程数减掉 ps 表头
    expect(data.cpuUsage).toBeCloseTo(8, 5)
    expect(data.memoryUsage).toBeCloseTo(40.5, 5)
    expect(data.diskUsage).toBe(37)
    expect(data.loadAverage).toBe(0.52)
    expect(data.uptime).toBe(123456)
    expect(data.processCount).toBe(41)
  })

  it('工具优先读刚采过的那一份，不再另开 channel', async () => {
    execCalls.length = 0
    const monitor = SystemMonitor.getInstance(fakeSource)
    const sample: MonitorData = await monitor.collectOnce('s-cached')
    expect(execCalls).toHaveLength(1)

    const first = await runMonitorGet('s-cached')
    expect(first.success).toBe(true)
    expect(first.data?.source).toBe('cached')
    expect(first.data?.cpuUsage).toBeCloseTo(sample.cpuUsage, 5)
    expect(first.data?.processCount).toBe(sample.processCount)
    expect(execCalls, '读到现值还去开 channel，等于把并发问题留在原处').toHaveLength(1)
  })

  it('没采过的会话按需采集，仍只一条 exec', async () => {
    execCalls.length = 0
    const monitor = SystemMonitor.getInstance(fakeSource)
    expect(monitor.latestSample('s-fresh')).toBeNull()
    const r = await runMonitorGet('s-fresh')
    expect(r.success).toBe(true)
    expect(r.data?.source).toBe('on-demand')
    expect(execCalls).toHaveLength(1)
    expect(r.data?.processCount).toBe(41)
  })

  it('会话没连着就明确失败，且一条 exec 都不发', async () => {
    execCalls.length = 0
    connectionState = 'disconnected'
    try {
      const r = await runMonitorGet('s-down')
      expect(r.success).toBe(false)
      expect(r.error).toContain('不可用')
      expect(execCalls).toHaveLength(0)
    } finally {
      connectionState = 'connected'
    }
  })
})
