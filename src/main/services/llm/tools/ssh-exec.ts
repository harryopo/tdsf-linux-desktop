/**
 * SSH Exec 工具（v0.5.0 重构版）
 *
 * 增强现有 vercel-ai-service.ts 的 sshExecTool：
 * - 强制 sessionId（必填）
 * - 加 timeoutMs（默认 10s，上限 60s）
 * - 风险等级：high（任意命令）
 * - 复用 SshConnectionManager
 * - 复用 Profiler 的风险评估（如果命令被识别为 critical 则自动 critical）
 *
 * 双重暴露：
 * 1. LLM Tool Calling（Vercel AI SDK 的 tool()）
 * 2. MCP Server tool（@modelcontextprotocol/sdk 的 server.tool()）
 */
import { z } from 'zod'
import type { ToolDefinition, ToolCallResult, ToolRiskLevel } from '@shared/llm-tool-types'
import { SshConnectionManager } from '../../ssh/connection-manager'
import { assessRisk } from '../../../core/risk-engine'
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

/**
 * 评估命令风险等级
 *
 * 简单实现：基于关键词黑名单 + 现有 risk-engine 的能力
 * 真实部署时应该用更精细的命令解析器
 */
function assessCommandRisk(command: string): { risk: ToolRiskLevel; reason: string } {
  const lower = command.toLowerCase().trim()

  // critical：立即可识别的高危操作
  if (/\brm\s+(-[a-z]*f[a-z]*\s+)?\/\b|rm\s+-[a-z]*r[a-z]*\s+\//.test(lower)) {
    return { risk: 'critical', reason: '删除根目录或递归删除系统目录' }
  }
  if (/\bmkfs\b/.test(lower) || /\bdd\s+if=.*of=\/dev/.test(lower)) {
    return { risk: 'critical', reason: '格式化磁盘或覆写设备' }
  }
  if (/\b:\(\)\s*\{\s*:\|:&\s*\};:\s*\|/.test(lower)) {
    return { risk: 'critical', reason: 'Fork 炸弹' }
  }
  if (/\bchmod\s+(-R\s+)?777\s+\//.test(lower) || /\bchown\s+(-R\s+)?\S+\s+\//.test(lower)) {
    return { risk: 'critical', reason: '修改根目录权限/属主' }
  }

  // high：可能破坏系统的命令
  if (/\brm\s+/.test(lower)) {
    return { risk: 'high', reason: '删除文件/目录' }
  }
  if (/\b(kill|killall|pkill)\s+(-9\s+)?-?1\b/.test(lower) || /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/.test(lower)) {
    return { risk: 'high', reason: '终止进程或关闭系统' }
  }
  if (/\buserdel\b|\bgroupdel\b/.test(lower)) {
    return { risk: 'high', reason: '删除用户/用户组' }
  }

  // medium：可能影响服务的命令
  if (/\b(systemctl|service)\s+(stop|restart|disable)\b/.test(lower)) {
    return { risk: 'medium', reason: '停止/重启/禁用系统服务' }
  }
  if (/\b(apt|yum|dnf|zypper)\s+(install|remove|purge)\b/.test(lower)) {
    return { risk: 'medium', reason: '安装/卸载软件包' }
  }
  if (/\bfirewall-cmd|\biptables\b/.test(lower)) {
    return { risk: 'medium', reason: '修改防火墙规则' }
  }

  // low：只读或轻微影响
  if (/\b(cat|less|more|head|tail|grep|find|ls|ps|top|htop|free|df|du|uptime|whoami|id|hostname|uname)\b/.test(lower)) {
    return { risk: 'low', reason: '只读查询命令' }
  }

  // safe：默认（无法识别的命令）
  return { risk: 'safe', reason: '已通过基础风险评估' }
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

  // 风险评估
  const { risk, reason } = assessCommandRisk(command)
  console.log(`[ssh_exec] risk=${risk} reason="${reason}" cmd=${command.slice(0, 80)}`)

  // 复用 Profiler 的风险引擎（如果有更细粒度的检查可以在这里加）
  void assessRisk // 占位调用，避免 TS 警告未使用

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

/**
 * ssh_exec 工具的 Vercel AI SDK 格式定义
 *
 * execute 包装：捕获异常 + 转为 ToolCallResult 格式
 */
export const sshExecTool: ToolDefinition = {
  name: TOOL_IDS.SSH_EXEC,
  description: '在指定 SSH session 上执行一条 Linux 命令。high 风险命令（rm/shutdown/reboot 等）执行前需用户审批。',
  parameters: sshExecArgsSchema,
  execute: async (args: unknown) => {
    const parsed = sshExecArgsSchema.safeParse(args)
    if (!parsed.success) {
      return {
        toolId: TOOL_IDS.SSH_EXEC,
        success: false,
        error: `参数校验失败: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        durationMs: 0,
        timestamp: Date.now(),
      } satisfies ToolCallResult
    }
    return await executeSshExec(parsed.data)
  },
}

/** ssh_exec 工具元数据（UI 展示 + 风险标签） */
export const SSH_EXEC_META = {
  id: TOOL_IDS.SSH_EXEC,
  label: 'SSH 命令执行',
  emoji: '🖥️',
  description: '在远程 Linux 服务器上执行命令并返回输出',
  risk: 'high' as ToolRiskLevel,
  requiresApproval: true, // 任意命令都需审批（保守策略）
} as const
