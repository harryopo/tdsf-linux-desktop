/**
 * Monitor Get Data 工具（v0.5.0 重构版）
 *
 * 拉取指定 SSH session 的最新一次监控数据（CPU/内存/磁盘/网络）。
 *
 * 设计说明：
 * SystemMonitor（services/ssh/monitor.ts）只有 startMonitoring/stopMonitoring，
 * 没有 getLatestData。所以这里采用两种模式：
 * 1. 若该 session 已在监控（startMonitoring 调用过），订阅 MONITOR_DATA_EVENT 缓存最新数据
 * 2. 若未启动监控，主动通过 sshManager.exec 采集一次（top/free/df 命令）
 *
 * 风险等级：low（只读）
 */
import { z } from 'zod'
import type { ToolDefinition, ToolCallResult, ToolRiskLevel } from '@shared/llm-tool-types'
import { TOOL_IDS } from '@shared/llm-tool-types'
import { SshConnectionManager } from '../../ssh/connection-manager'
import type { MonitorData } from '@shared/models'

/** monitor_get_data 参数 schema */
export const monitorGetArgsSchema = z.object({
  sessionId: z.string().min(1).describe('SSH session ID（必填）'),
})

export type MonitorGetArgs = z.infer<typeof monitorGetArgsSchema>

/** 工具返回的精简版 MonitorData（保持 @shared/models 字段名） */
export interface MonitorGetData {
  sessionId: string
  timestamp: number
  cpuUsage: number
  memoryUsage: number
  diskUsage: number
  networkIn: number
  networkOut: number
  loadAverage: number
  uptime: number
  processCount: number
  source: 'cached' | 'on-demand'
}

/**
 * 主动采集一次（用 SSH 拉取 top/free/df/loadavg 等命令）
 *
 * 解析逻辑参考 services/ssh/monitor.ts 的同名解析方法
 */
async function collectOnDemand(sessionId: string): Promise<Omit<MonitorGetData, 'sessionId' | 'source'>> {
  const ssh = SshConnectionManager.getInstance()
  const start = Date.now()

  // 并行执行 7 个采集命令（与 SystemMonitor.tick 一致）
  const [cpuOut, memOut, diskOut, netOut, loadOut, uptimeOut, procOut] = await Promise.all([
    safeExec(ssh, sessionId, 'top -bn1 | grep "Cpu(s)" | head -1'),
    safeExec(ssh, sessionId, "free -b | grep Mem | awk '{print $3/$2 * 100}'"),
    safeExec(ssh, sessionId, "df -h / | awk 'NR==2{print $5}'"),
    safeExec(ssh, sessionId, 'cat /proc/net/dev'),
    safeExec(ssh, sessionId, 'cat /proc/loadavg'),
    safeExec(ssh, sessionId, 'cat /proc/uptime'),
    safeExec(ssh, sessionId, 'ps aux | wc -l'),
  ])

  return {
    timestamp: start,
    cpuUsage: parseCpuUsage(cpuOut),
    memoryUsage: parseMemoryUsage(memOut),
    diskUsage: parseDiskUsage(diskOut),
    networkIn: 0, // 主动采集无法计算速率（需要前一次快照）
    networkOut: 0,
    loadAverage: parseLoadAverage(loadOut),
    uptime: parseUptime(uptimeOut),
    processCount: parseProcessCount(procOut),
  }
}

async function safeExec(ssh: SshConnectionManager, sessionId: string, cmd: string): Promise<string> {
  try {
    const r = await ssh.exec(sessionId, cmd)
    return r.stdout ?? ''
  } catch {
    return ''
  }
}

function parseCpuUsage(s: string): number {
  // top -bn1 | grep "Cpu(s)" → "Cpu(s):  3.2 us,  1.0 sy, ..."
  const m = s.match(/(\d+\.?\d*)\s*us/i)
  return m ? parseFloat(m[1]) : 0
}
function parseMemoryUsage(s: string): number {
  const m = s.trim()
  const n = parseFloat(m)
  return isNaN(n) ? 0 : n
}
function parseDiskUsage(s: string): number {
  // df -h / | awk NR==2 → "Use%" 或 "85%"
  const m = s.match(/(\d+)%/)
  return m ? parseInt(m[1], 10) : 0
}
function parseLoadAverage(s: string): number {
  // cat /proc/loadavg → "0.12 0.15 0.18 ..."
  return parseFloat(s.split(' ')[0] ?? '0') || 0
}
function parseUptime(s: string): number {
  return Math.floor(parseFloat(s.split(' ')[0] ?? '0')) || 0
}
function parseProcessCount(s: string): number {
  return parseInt(s.trim(), 10) || 0
}

/**
 * monitor_get 工具执行函数
 */
export async function executeMonitorGet(args: MonitorGetArgs): Promise<ToolCallResult<MonitorGetData>> {
  const start = Date.now()
  const { sessionId } = args

  try {
    const ssh = SshConnectionManager.getInstance()
    const state = ssh.getConnectionState(sessionId)
    if (state !== 'connected') {
      return {
        toolId: TOOL_IDS.MONITOR_GET,
        success: false,
        error: `SSH session 不可用（状态: ${state}）`,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      }
    }

    // 主动采集一次（简化实现：未订阅 on-demand 缓存）
    const collected = await collectOnDemand(sessionId)

    return {
      toolId: TOOL_IDS.MONITOR_GET,
      success: true,
      data: {
        sessionId,
        source: 'on-demand',
        ...collected,
      },
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  } catch (err) {
    return {
      toolId: TOOL_IDS.MONITOR_GET,
      success: false,
      error: `获取监控数据失败: ${(err as Error).message}`,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  }
}

/** monitor_get 工具定义 */
export const monitorGetTool: ToolDefinition = {
  name: TOOL_IDS.MONITOR_GET,
  description: '拉取远程 Linux 服务器的最新一次监控数据（CPU/内存/磁盘/负载）。',
  parameters: monitorGetArgsSchema,
  execute: async (args: unknown) => {
    const parsed = monitorGetArgsSchema.safeParse(args)
    if (!parsed.success) {
      return {
        toolId: TOOL_IDS.MONITOR_GET,
        success: false,
        error: `参数校验失败: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        durationMs: 0,
        timestamp: Date.now(),
      } satisfies ToolCallResult
    }
    return await executeMonitorGet(parsed.data)
  },
}

/** monitor_get 工具元数据 */
export const MONITOR_GET_META = {
  id: TOOL_IDS.MONITOR_GET,
  label: '监控数据获取',
  emoji: '📊',
  description: '拉取远程服务器的实时监控指标',
  risk: 'low' as ToolRiskLevel,
  requiresApproval: false,
} as const
