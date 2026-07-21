/**
 * Profiler Run 工具（v0.5.0 重构版）
 *
 * 在指定 SSH session 上执行 27 项并发系统探查（架构感知）。
 * 复用 services/profiler/system-profiler.ts 的 runProfiler() 函数。
 *
 * 风险等级：medium（高并发 IO，但不修改系统）
 */
import { z } from 'zod'
import type { ToolDefinition, ToolCallResult, ToolRiskLevel } from '@shared/llm-tool-types'
import { TOOL_IDS } from '@shared/llm-tool-types'
import { runProfiler } from '../../profiler/system-profiler'
import { detectRisks, summarizeRisks } from '../../profiler/risk-detector'
import { renderProfilerMarkdown } from '../../profiler/markdown-renderer'
import type { ProfilerRiskLevel } from '@shared/models'
import type { RiskLevel } from '../../profiler/types'

/** profiler_run 参数 schema */
export const profilerRunArgsSchema = z.object({
  sessionId: z.string().min(1).describe('SSH session ID（必填）'),
  host: z.string().min(1).describe('目标主机名（用于报告展示）'),
})

export type ProfilerRunArgs = z.infer<typeof profilerRunArgsSchema>

/** 返回数据（精简版，token 友好） */
export interface ProfilerRunData {
  sessionId: string
  host: string
  totalChecks: number
  riskSummary: {
    critical: number
    high: number
    medium: number
    low: number
    info: number
  }
  topRisks: Array<{
    level: ProfilerRiskLevel
    category: string
    title: string
    description: string
  }>
  systemOverview: {
    os: string
    kernel: string
    arch: string
    cpuCores: number
    totalMemory: number
    totalDisk: number
  }
  durationMs: number
  /** Markdown 格式的完整报告（供 UI 展示） */
  md: string
}

/** profiler_run 工具执行函数 */
export async function executeProfilerRun(args: ProfilerRunArgs): Promise<ToolCallResult<ProfilerRunData>> {
  const start = Date.now()
  const { sessionId, host } = args

  try {
    // 1. 执行探查（返回 ProfilerResult）
    const result = await runProfiler(sessionId, host)

    // 2. 风险检测
    const risks = detectRisks(result)

    // 3. 风险摘要
    const summary = summarizeRisks(risks)

    // 4. 渲染 Markdown（summary 通过 risks 由内部计算）
    const md = renderProfilerMarkdown(result, risks)

    // 风险严重度排序（critical → info）
    const severityOrder: Record<string, number> = {
      critical: 0, high: 1, medium: 2, low: 3, info: 4
    }
    const topRisks = [...risks]
      .sort((a, b) => (severityOrder[a.level] ?? 9) - (severityOrder[b.level] ?? 9))
      .slice(0, 5)
      .map((r) => ({
        level: r.level as ProfilerRiskLevel,
        category: r.category,
        title: r.title,
        description: r.description,
      }))

    return {
      toolId: TOOL_IDS.PROFILER_RUN,
      success: true,
      data: {
        sessionId,
        host,
        totalChecks: summary.total,
        riskSummary: {
          critical: summary.critical,
          high: summary.high,
          medium: summary.medium,
          low: summary.low,
          info: summary.info,
        },
        topRisks,
        systemOverview: {
          os: extractOs(result),
          kernel: extractKernel(result),
          arch: extractArch(result),
          cpuCores: extractCpuCores(result),
          totalMemory: extractTotalMemory(result),
          totalDisk: extractTotalDisk(result),
        },
        durationMs: result.totalDurationMs ?? (Date.now() - start),
        md,
      },
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  } catch (err) {
    return {
      toolId: TOOL_IDS.PROFILER_RUN,
      success: false,
      error: `系统架构感知失败: ${(err as Error).message}`,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  }
}

/** 从 ProfilerItem.stdout 解析 OS（cat /etc/os-release 第一行 PRETTY_NAME=...） */
function extractOs(result: { items: ReadonlyArray<{ stdout: string; group: string }> }): string {
  const item = result.items.find((i) => i.stdout.includes('PRETTY_NAME') || i.stdout.includes('VERSION_ID'))
  if (!item) return 'unknown'
  const m = item.stdout.match(/PRETTY_NAME="?([^"\n]+)"?/)
  return m ? m[1] : 'unknown'
}
function extractKernel(result: { items: ReadonlyArray<{ stdout: string; group: string }> }): string {
  const item = result.items.find((i) => /^\d+\.\d+\.\d+/m.test(i.stdout))
  if (!item) return 'unknown'
  const m = item.stdout.match(/^(\d+\.\d+\.\d+[^\s]*)/m)
  return m ? m[1] : 'unknown'
}
function extractArch(result: { items: ReadonlyArray<{ stdout: string; group: string }> }): string {
  const item = result.items.find((i) => /x86_64|aarch64|armv7l/.test(i.stdout))
  if (!item) return 'unknown'
  const m = item.stdout.match(/(x86_64|aarch64|armv7l|i\d86)/)
  return m ? m[1] : 'unknown'
}
function extractCpuCores(result: { items: ReadonlyArray<{ stdout: string; group: string }> }): number {
  const item = result.items.find((i) => /processor\s*:\s*\d+/.test(i.stdout))
  if (!item) return 0
  const matches = item.stdout.match(/^processor\s*:\s*\d+$/gm)
  return matches?.length ?? 0
}
function extractTotalMemory(result: { items: ReadonlyArray<{ stdout: string; group: string }> }): number {
  const item = result.items.find((i) => /MemTotal:\s+\d+/.test(i.stdout))
  if (!item) return 0
  const m = item.stdout.match(/MemTotal:\s+(\d+)\s+kB/)
  return m ? parseInt(m[1], 10) * 1024 : 0
}
function extractTotalDisk(result: { items: ReadonlyArray<{ stdout: string; group: string }> }): number {
  const item = result.items.find((i) => /^\/dev\//m.test(i.stdout))
  if (!item) return 0
  // 简化：累计所有 /dev/* 行第一列（blocks）* 1024
  const lines = item.stdout.split('\n').filter((l) => l.startsWith('/dev/'))
  let total = 0
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2) {
      const blocks = parseInt(parts[1], 10)
      if (!isNaN(blocks)) total += blocks * 1024
    }
  }
  return total
}

/** profiler_run 工具定义 */
export const profilerRunTool: ToolDefinition = {
  name: TOOL_IDS.PROFILER_RUN,
  description: '对远程 Linux 服务器执行 27 项并发系统探查（CPU/内存/磁盘/网络/服务/日志等），返回风险报告。',
  parameters: profilerRunArgsSchema,
  execute: async (args: unknown) => {
    const parsed = profilerRunArgsSchema.safeParse(args)
    if (!parsed.success) {
      return {
        toolId: TOOL_IDS.PROFILER_RUN,
        success: false,
        error: `参数校验失败: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        durationMs: 0,
        timestamp: Date.now(),
      } satisfies ToolCallResult
    }
    return await executeProfilerRun(parsed.data)
  },
}

/** profiler_run 工具元数据 */
export const PROFILER_RUN_META = {
  id: TOOL_IDS.PROFILER_RUN,
  label: '系统架构感知',
  emoji: '🔬',
  description: '对远程服务器执行 27 项并发系统探查并生成风险报告',
  risk: 'medium' as ToolRiskLevel,
  requiresApproval: false,
} as const

/** 重导出，避免 unused 警告（RiskLevel 来自 profiler/types.ts） */
export type { RiskLevel }
