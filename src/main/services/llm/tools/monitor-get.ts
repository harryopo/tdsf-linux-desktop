/**
 * Monitor Get Data 工具
 *
 * 拉取指定 SSH session 的监控数据（CPU/内存/磁盘/网络/负载/运行时长/进程数）。
 *
 * 采集与解析全仓只有一份实现：SystemMonitor（services/ssh/monitor.ts）。
 * 这份工具以前自带 7 条并发 exec 加一份复制的解析函数，两个后果都真实发生过：
 *   1. 一次调用开 7 个 SSH channel，叠加界面轮询与交互 shell 就撞满 OpenSSH 默认
 *      MaxSessions=10 → "Channel open failure"，指标全 0（用户看到的"进程监控失败"）；
 *   2. 两份解析各自漂移：界面按 100 − idle 算 CPU、这份只取 us；进程数这份没减表头。
 *      于是 AI 报的数和用户在监控页看到的不是同一个数。
 *
 * 现在的取数顺序：会话若已被界面轮询，直接读最近一次样本（零 channel）；
 * 读不到或样本过期才按需采一次，且仍然只开一个 channel。
 *
 * 风险等级：low（只读）
 */
import { z } from 'zod'
import type { ToolDefinition, ToolCallResult, ToolRiskLevel } from '@shared/llm-tool-types'
import { TOOL_IDS } from '@shared/llm-tool-types'
import { SshConnectionManager } from '../../ssh/connection-manager'
import { SystemMonitor } from '../../ssh/monitor'

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
 * 样本算"现值"的窗口（毫秒）
 *
 * 界面默认 3 秒一采（server-store 的 MONITOR_INTERVAL_MS），这里给两倍周期：
 * 窗口内 AI 读到的是同一台机器刚采的那一份，比再开一条 channel 更便宜也更一致。
 */
const CACHE_FRESH_MS = 6000

/** 把采集结果摊平成工具输出形状 */
function toPayload(
  sessionId: string,
  data: { timestamp: number; cpuUsage: number; memoryUsage: number; diskUsage: number; networkIn: number; networkOut: number; loadAverage: number; uptime: number; processCount: number },
  source: 'cached' | 'on-demand',
): MonitorGetData {
  return {
    sessionId,
    timestamp: data.timestamp,
    cpuUsage: data.cpuUsage,
    memoryUsage: data.memoryUsage,
    diskUsage: data.diskUsage,
    networkIn: data.networkIn,
    networkOut: data.networkOut,
    loadAverage: data.loadAverage,
    uptime: data.uptime,
    processCount: data.processCount,
    source,
  }
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

    const monitor = SystemMonitor.getInstance()

    // 先读刚采过的那一份：界面在轮询时 AI 不必再开 channel
    const cached = monitor.latestSample(sessionId)
    if (cached && cached.ageMs <= CACHE_FRESH_MS) {
      return {
        toolId: TOOL_IDS.MONITOR_GET,
        success: true,
        data: toPayload(sessionId, cached.data, 'cached'),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      }
    }

    // 没有现值才主动采一轮（单条 exec = 单 channel）
    const fresh = await monitor.collectOnce(sessionId)
    return {
      toolId: TOOL_IDS.MONITOR_GET,
      success: true,
      data: toPayload(sessionId, fresh, 'on-demand'),
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
