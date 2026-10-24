/**
 * SSH Exec 工具（v0.5.0 重构版）
 *
 * 本文件是 ssh_exec 这一个能力的执行体：由外部 MCP 出口（services/mcp/tools/registry.ts）
 * 直接 import 调用。曾经还有第二条路——应用内的 llm:chat-with-tools 通道与它的注册表包装，
 * 渲染层零调用，2026-10-24 随 #195 整删。能力本身没缩水：
 * - 强制 sessionId（必填）
 * - 加 timeoutMs（默认 10s，上限 60s）
 * - 风险等级与拦截：统一由 core/command-gate 判定，block 级直接拒绝
 * - 复用 SshConnectionManager
 *
 * 双重暴露：
 * 1. LLM Tool Calling（Vercel AI SDK 的 tool()）
 * 2. MCP Server tool（@modelcontextprotocol/sdk 的 server.tool()）
 */
import { z } from 'zod'
import type { ToolCallResult, ToolRiskLevel } from '@shared/llm-tool-types'
import { SshConnectionManager } from '../../ssh/connection-manager'
import { evaluateCommand, type CommandRiskLevel } from '../../../core/command-gate'
import { TOOL_IDS } from '@shared/llm-tool-types'

/** ssh_exec 参数 schema */
export const sshExecArgsSchema = z.object({
  sessionId: z.string().min(1).describe('SSH session ID（必填，从 ServerList 获取）'),
  command: z.string().min(1).describe('要执行的 Linux 命令（必填）'),
  timeoutMs: z.number().int().min(1000).max(60000).default(10000)
    .describe('超时时间（毫秒），默认 10s，上限 60s'),
})

export type SshExecArgs = z.infer<typeof sshExecArgsSchema>

/** ssh_exec 执行结果（不含 metadata） */
export interface SshExecData {
  sessionId: string
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  risk: ToolRiskLevel
}

/** 闸的等级 → 工具展示用风险标签（block 归为 critical：会被直接拒绝） */
function toToolRisk(level: CommandRiskLevel): ToolRiskLevel {
  switch (level) {
    case 'block': return 'critical'
    case 'high': return 'high'
    case 'medium': return 'medium'
    case 'low': return 'low'
    default: return 'safe'
  }
}

/**
 * ssh_exec 工具的执行函数
 *
 * 错误处理：返回 ToolCallResult（success=false + error），不抛异常
 * 这样 LLM 能基于错误自纠（如果用 generateText({ tools }) 自动多轮）
 */
export async function executeSshExec(args: SshExecArgs): Promise<ToolCallResult<SshExecData>> {
  const start = Date.now()
  const { sessionId, command, timeoutMs } = args
  const sshManager = SshConnectionManager.getInstance()

  // 校验：session 必须已连接
  const state = sshManager.getConnectionState(sessionId)
  if (state !== 'connected') {
    return {
      toolId: TOOL_IDS.SSH_EXEC,
      success: false,
      error: `SSH session 不可用（状态: ${state}），请先建立连接`,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  }

  // 风险闸：block 级直接拒绝（此前这里是 `void assessRisk` 占位，只记日志不拦）
  const verdict = evaluateCommand(command)
  if (verdict.level === 'block') {
    return {
      toolId: TOOL_IDS.SSH_EXEC,
      success: false,
      error: `高危命令被安全闸拒绝：${verdict.reason}（命中段：${verdict.matched}）`,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  }
  const risk = toToolRisk(verdict.level)

  try {
    // 设置 timeout（用 Promise.race 实现）
    const execPromise = sshManager.exec(sessionId, command)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`命令执行超时（${timeoutMs}ms）`)), timeoutMs)
    })

    const result = await Promise.race([execPromise, timeoutPromise])

    return {
      toolId: TOOL_IDS.SSH_EXEC,
      success: result.exitCode === 0,
      data: {
        sessionId,
        command,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode,
        durationMs: result.duration ?? (Date.now() - start),
        risk,
      },
      error: result.exitCode !== 0 ? `命令退出码 ${result.exitCode}` : undefined,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  } catch (err) {
    return {
      toolId: TOOL_IDS.SSH_EXEC,
      success: false,
      error: `SSH exec 失败: ${(err as Error).message}`,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  }
}
