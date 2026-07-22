/**
 * MCP 工具注册表 - 日志域（v2.0 Phase F.2）
 *
 * 3 个日志域工具，通过 SSH 操作远程服务器日志：
 * 1. log_tail      - 读取日志文件尾部（tail -n N）
 * 2. log_search    - 在日志文件中搜索（grep -rn）
 * 3. log_analyze   - 日志异常分析（复用 LogAnalyzer 内置 16 条规则）
 *
 * 注意：
 * - log_tail 是同步读取（不是 tail -f 流式），适合一次性查看
 * - log_analyze 调用本地 LogAnalyzer 分析远程拉回的日志文本
 */
import { SshConnectionManager } from '../../ssh/connection-manager'
import { LogAnalyzer } from '../../diagnostics/log-analyzer'
import type { LogEvent, LogSource, LogLevel } from '../../diagnostics/types'
import type { McpToolRegistration, McpToolResult } from './registry'
import { toMcpErrorResult, toMcpTextResult } from './registry'

/** 安全执行 SSH 命令，失败抛 Error */
async function execOrThrow(
  sessionId: string,
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  try {
    const r = await SshConnectionManager.getInstance().exec(sessionId, command)
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode }
  } catch (err) {
    throw new Error(`SSH exec 失败: ${(err as Error).message}`)
  }
}

/** 安全转义 shell 单引号参数（防止命令注入） */
function shellEscape(s: string): string {
  // 用单引号包裹，内部单引号用 '\'' 转义
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** 校验 sessionId */
function requireSessionId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 把日志文本解析为 LogEvent 数组
 *
 * 每行一个事件，timestamp 用当前时间（无法精确解析每行时间戳），
 * source 默认 'agent'，level 自动从文本推断。
 */
function parseLogEvents(text: string, source: LogSource = 'agent'): LogEvent[] {
  const events: LogEvent[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    let level: LogLevel = 'INFO'
    if (/\bFATAL\b|\bCRITICAL\b/i.test(line)) level = 'FATAL'
    else if (/\bERROR\b|\bException\b|\bTraceback\b/i.test(line)) level = 'ERROR'
    else if (/\bWARN(ING)?\b/i.test(line)) level = 'WARN'
    else if (/\bDEBUG\b/i.test(line)) level = 'DEBUG'
    events.push({
      timestamp: new Date().toISOString(),
      source,
      level,
      raw: line,
    })
  }
  return events
}

/**
 * 创建日志域 3 个 MCP 工具
 */
export function createLogMcpTools(): McpToolRegistration[] {
  return [
    // ── 1. log_tail ───────────────────────────────────────────────
    {
      meta: {
        name: 'log_tail',
        description:
          '读取远程服务器日志文件的尾部 N 行（tail -n N）。适合快速查看最近日志。同步返回，非流式。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
            filePath: { type: 'string', description: '日志文件绝对路径（必填）' },
            lines: { type: 'number', description: '读取行数（默认 100，最大 5000）' },
          },
          required: ['sessionId', 'filePath'],
        },
      },
      call: async (args) => {
        const sessionId = requireSessionId(args.sessionId)
        if (!sessionId) return toMcpErrorResult('参数 sessionId 必填且为非空字符串')
        const filePath = args.filePath
        if (typeof filePath !== 'string' || !filePath) {
          return toMcpErrorResult('参数 filePath 必填且为非空字符串')
        }
        const linesRaw = typeof args.lines === 'number' ? args.lines : 100
        const lines = Math.max(1, Math.min(5000, Math.floor(linesRaw)))

        // 用 tail -n N 读取，避免大文件全量加载
        const cmd = `tail -n ${lines} ${shellEscape(filePath)}`
        try {
          const { stdout, stderr, exitCode } = await execOrThrow(sessionId, cmd)
          return toMcpTextResult({
            sessionId,
            filePath,
            linesRequested: lines,
            linesReturned: stdout.split('\n').filter((l) => l).length,
            exitCode,
            stderr: stderr || undefined,
            content: stdout,
          })
        } catch (err) {
          return toMcpTextResult(err)
        }
      },
    },

    // ── 2. log_search ─────────────────────────────────────────────
    {
      meta: {
        name: 'log_search',
        description:
          '在远程服务器日志文件中搜索关键词（grep -rn）。返回匹配行及行号，支持正则表达式。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
            pattern: { type: 'string', description: '搜索模式（支持 grep -E 正则，必填）' },
            path: {
              type: 'string',
              description: '搜索路径（文件或目录，默认 /var/log）',
            },
            ignoreCase: { type: 'boolean', description: '是否忽略大小写（默认 false）' },
            maxMatches: {
              type: 'number',
              description: '最大返回匹配数（默认 50，上限 500）',
            },
          },
          required: ['sessionId', 'pattern'],
        },
      },
      call: async (args) => {
        const sessionId = requireSessionId(args.sessionId)
        if (!sessionId) return toMcpErrorResult('参数 sessionId 必填且为非空字符串')
        const pattern = args.pattern
        if (typeof pattern !== 'string' || !pattern) {
          return toMcpErrorResult('参数 pattern 必填且为非空字符串')
        }
        const path = typeof args.path === 'string' && args.path ? args.path : '/var/log'
        const ignoreCase = args.ignoreCase === true
        const maxMatchesRaw =
          typeof args.maxMatches === 'number' ? args.maxMatches : 50
        const maxMatches = Math.max(1, Math.min(500, Math.floor(maxMatchesRaw)))

        // grep -rn -E <pattern> <path>
        // -r 递归，-n 显示行号，-E 扩展正则，-i 忽略大小写
        // 用 head 限制输出
        const flags = ['-r', '-n', '-E']
        if (ignoreCase) flags.push('-i')
        const cmd = `grep ${flags.join(' ')} ${shellEscape(pattern)} ${shellEscape(path)} 2>/dev/null | head -n ${maxMatches}`
        try {
          const { stdout, exitCode } = await execOrThrow(sessionId, cmd)
          const matches = stdout
            .split('\n')
            .filter((l) => l)
            .map((line) => {
              // 解析 grep -n 输出格式：file:line:content
              const match = line.match(/^(.+?):(\d+):(.*)$/)
              if (match) {
                return {
                  file: match[1],
                  line: parseInt(match[2], 10),
                  content: match[3],
                }
              }
              return { raw: line }
            })
          return toMcpTextResult({
            sessionId,
            pattern,
            path,
            ignoreCase,
            exitCode,
            // grep exitCode: 0 = 有匹配，1 = 无匹配，2 = 错误
            found: exitCode === 0,
            count: matches.length,
            truncated: matches.length >= maxMatches,
            matches,
          })
        } catch (err) {
          return toMcpTextResult(err)
        }
      },
    },

    // ── 3. log_analyze ────────────────────────────────────────────
    {
      meta: {
        name: 'log_analyze',
        description:
          '分析远程日志文件的异常（端口冲突/依赖缺失/Python 异常/超时等 16 类内置规则）。返回每个命中的规则及修复建议。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
            filePath: { type: 'string', description: '日志文件绝对路径（必填）' },
            lines: {
              type: 'number',
              description: '分析尾部 N 行（默认 500，最大 5000）',
            },
          },
          required: ['sessionId', 'filePath'],
        },
      },
      call: async (args) => {
        const sessionId = requireSessionId(args.sessionId)
        if (!sessionId) return toMcpErrorResult('参数 sessionId 必填且为非空字符串')
        const filePath = args.filePath
        if (typeof filePath !== 'string' || !filePath) {
          return toMcpErrorResult('参数 filePath 必填且为非空字符串')
        }
        const linesRaw = typeof args.lines === 'number' ? args.lines : 500
        const lines = Math.max(1, Math.min(5000, Math.floor(linesRaw)))

        // 1. 先拉取日志内容
        const cmd = `tail -n ${lines} ${shellEscape(filePath)}`
        let stdout: string
        try {
          const r = await execOrThrow(sessionId, cmd)
          stdout = r.stdout
        } catch (err) {
          return toMcpTextResult(err)
        }

        // 2. 解析为 LogEvent
        const events = parseLogEvents(stdout, 'agent')
        if (events.length === 0) {
          return toMcpTextResult({
            sessionId,
            filePath,
            message: '日志为空，无内容可分析',
            healthy: true,
            totalFindings: 0,
          })
        }

        // 3. 调用 LogAnalyzer 分析
        const analyzer = new LogAnalyzer()
        const { findings } = analyzer.analyzeBatch(events)
        const report = analyzer.generateReport(events, findings)

        return toMcpTextResult({
          sessionId,
          filePath,
          linesAnalyzed: events.length,
          healthy: report.healthy,
          summary: report.summary,
          totalFindings: report.totalFindings,
          bySeverity: report.bySeverity,
          byCategory: report.byCategory,
          findings: findings.map((f) => ({
            ruleId: f.ruleId,
            category: f.category,
            severity: f.severity,
            description: f.description,
            matchedLine: f.matchedLine.slice(0, 500),
            remediation: f.remediation,
            timestamp: f.timestamp,
          })),
        })
      },
    },
  ]
}

/** 日志域工具名清单 */
export const LOG_TOOL_NAMES = ['log_tail', 'log_search', 'log_analyze'] as const

/** 日志域工具元数据（用于 listRegisteredTools 展示） */
export const LOG_TOOL_METAS: Array<{ name: string; description: string }> = [
  { name: 'log_tail', description: '读取远程日志文件尾部 N 行（tail -n）' },
  { name: 'log_search', description: '在远程日志中搜索关键词（grep -rn -E）' },
  { name: 'log_analyze', description: '分析远程日志异常（16 类内置规则）' },
]

/** 占位导出，避免 TS unused 警告 */
export type { McpToolResult }
