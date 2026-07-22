/**
 * MCP 工具注册表 - 监控域（v2.0 Phase F.1）
 *
 * 3 个监控域工具，通过 SSH 在远程服务器上执行只读监控命令：
 * 1. monitor_process_list   - 列出进程（按 CPU/内存排序，前 N 条）
 * 2. monitor_disk_usage     - 磁盘使用率（df -h 解析）
 * 3. monitor_network_stats  - 网络连接统计（ss/netstat 解析）
 *
 * 设计：所有命令都是只读，不修改系统状态。
 */
import { SshConnectionManager } from '../../ssh/connection-manager'
import type { McpToolRegistration, McpToolResult } from './registry'
import { toMcpErrorResult, toMcpTextResult } from './registry'

/** 安全执行 SSH 命令，失败返回空字符串 */
async function safeExec(
  sessionId: string,
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  try {
    const r = await SshConnectionManager.getInstance().exec(sessionId, command)
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode }
  } catch (err) {
    return {
      stdout: '',
      stderr: (err as Error).message,
      exitCode: null,
    }
  }
}

/** 校验 sessionId 非空字符串 */
function requireSessionId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

/**
 * 创建监控域 3 个 MCP 工具
 */
export function createMonitorMcpTools(): McpToolRegistration[] {
  return [
    // ── 1. monitor_process_list ──────────────────────────────────
    {
      meta: {
        name: 'monitor_process_list',
        description:
          '列出远程服务器上的活跃进程，按 CPU 或内存使用率排序，返回前 N 条。仅读，无副作用。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
            sortBy: {
              type: 'string',
              enum: ['cpu', 'mem'],
              description: '排序方式（默认 cpu）',
            },
            limit: {
              type: 'number',
              description: '返回进程数上限（默认 20，最大 100）',
            },
          },
          required: ['sessionId'],
        },
      },
      call: async (args) => {
        const sessionId = requireSessionId(args.sessionId)
        if (!sessionId) return toMcpErrorResult('参数 sessionId 必填且为非空字符串')
        const sortBy = args.sortBy === 'mem' ? 'mem' : 'cpu'
        const limitRaw = typeof args.limit === 'number' ? args.limit : 20
        const limit = Math.max(1, Math.min(100, Math.floor(limitRaw)))

        // ps aux 输出列：USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
        // -r 排序 CPU，-m 排序内存（GNU ps）
        const sortFlag = sortBy === 'cpu' ? '-r' : '-m'
        // 用 head -1 取表头 + head -N 取前 N 条
        const cmd = `ps aux --sort=${sortFlag} | head -n $((1 + ${limit}))`
        const { stdout, stderr, exitCode } = await safeExec(sessionId, cmd)
        const lines = stdout.split('\n').filter((l) => l.length > 0)
        const header = lines[0] ?? ''
        const rows = lines.slice(1, 1 + limit)
        const parsed = rows.map((line) => {
          // 按空白分列，COMMAND 可能含空格
          const parts = line.trim().split(/\s+/)
          if (parts.length < 11) return { raw: line }
          return {
            user: parts[0],
            pid: parts[1],
            cpu: parts[2],
            mem: parts[3],
            vsz: parts[4],
            rss: parts[5],
            tty: parts[6],
            stat: parts[7],
            start: parts[8],
            time: parts[9],
            command: parts.slice(10).join(' '),
          }
        })
        return toMcpTextResult({
          sessionId,
          sortBy,
          limit,
          exitCode,
          stderr: stderr || undefined,
          header,
          count: parsed.length,
          processes: parsed,
        })
      },
    },

    // ── 2. monitor_disk_usage ────────────────────────────────────
    {
      meta: {
        name: 'monitor_disk_usage',
        description:
          '获取远程服务器的磁盘使用率（df -h 解析），返回每个挂载点的容量/已用/可用/使用率。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
          },
          required: ['sessionId'],
        },
      },
      call: async (args) => {
        const sessionId = requireSessionId(args.sessionId)
        if (!sessionId) return toMcpErrorResult('参数 sessionId 必填且为非空字符串')

        const { stdout, stderr, exitCode } = await safeExec(sessionId, 'df -h')
        const lines = stdout.split('\n').filter((l) => l.length > 0)
        const header = lines[0] ?? ''
        const filesystems: Array<{
          filesystem: string
          size: string
          used: string
          avail: string
          usePercent: string
          mountedOn: string
        }> = []
        for (const line of lines.slice(1)) {
          const parts = line.trim().split(/\s+/)
          if (parts.length < 6) continue
          filesystems.push({
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            avail: parts[3],
            usePercent: parts[4],
            mountedOn: parts.slice(5).join(' '),
          })
        }
        return toMcpTextResult({
          sessionId,
          exitCode,
          stderr: stderr || undefined,
          header,
          count: filesystems.length,
          filesystems,
        })
      },
    },

    // ── 3. monitor_network_stats ─────────────────────────────────
    {
      meta: {
        name: 'monitor_network_stats',
        description:
          '获取远程服务器的网络连接统计（ss 命令解析，按状态分组）。包含 TCP/UDP 连接数和 LISTEN 端口列表。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
          },
          required: ['sessionId'],
        },
      },
      call: async (args) => {
        const sessionId = requireSessionId(args.sessionId)
        if (!sessionId) return toMcpErrorResult('参数 sessionId 必填且为非空字符串')

        // ss -tunap 一次性列出所有 TCP/UDP 连接（含进程信息）
        // 兼容性：如果 ss 不可用，回退到 netstat -tunap
        const cmd = `command -v ss >/dev/null 2>&1 && ss -tunap || netstat -tunap 2>/dev/null`
        const { stdout, stderr, exitCode } = await safeExec(sessionId, cmd)
        const lines = stdout.split('\n').filter((l) => l.length > 0)

        // 按状态分组计数
        const stateCount: Record<string, number> = {}
        const listenPorts: Array<{ proto: string; local: string; process: string }> = []

        // ss 输出（无表头）：
        //   udp UNCONN 0 0 0.0.0.0:68 0.0.0.0:* users:(("dhclient",pid=1234,fd=7))
        //   tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1083,fd=3))
        // netstat 输出（有表头）：
        //   Proto Recv-Q Send-Q Local Address Foreign Address State User Inode PID/Program name
        //   tcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN 0 12345 1083/sshd
        for (const line of lines) {
          // 跳过 netstat 表头
          if (/^Proto\s+Recv-Q/.test(line)) continue
          const lower = line.toLowerCase()

          // 状态提取
          let state = 'UNKNOWN'
          const stateMatch = line.match(/\b(LISTEN|ESTAB|TIME-WAIT|TIME_WAIT|CLOSE-WAIT|CLOSE_WAIT|FIN-WAIT|FIN_WAIT|SYN-SENT|SYN_SENT|SYN-RECV|SYN_RECV|UNCONN|CLOSED|CLOSING|LAST-ACK|LAST_ACK)\b/i)
          if (stateMatch) {
            state = stateMatch[1].toUpperCase().replace(/-/g, '_')
          }
          stateCount[state] = (stateCount[state] ?? 0) + 1

          // LISTEN 端口提取
          if (state === 'LISTEN' || /\bLISTEN\b/i.test(line)) {
            const parts = line.trim().split(/\s+/)
            const proto = parts[0]?.toLowerCase() ?? 'tcp'
            // 找到 *:Port 或 0.0.0.0:Port 或 [::]:Port 形式
            const localAddr = parts[4] ?? parts[3] ?? ''
            // 进程名（ss: users:(("name",pid=X,fd=Y))；netstat: pid/name）
            let process = ''
            const ssProcMatch = line.match(/users:\(\("([^"]+)"/)
            if (ssProcMatch) {
              process = ssProcMatch[1]
            } else {
              const parts2 = line.split(/\s+/)
              const lastPart = parts2[parts2.length - 1] ?? ''
              if (lastPart.includes('/')) {
                process = lastPart.split('/')[1] ?? ''
              }
            }
            listenPorts.push({ proto, local: localAddr, process })
          }
          void lower // 占位避免 TS unused
        }

        return toMcpTextResult({
          sessionId,
          exitCode,
          stderr: stderr || undefined,
          totalConnections: lines.filter((l) => !/^Proto\s+Recv-Q/.test(l)).length,
          stateCount,
          listenPorts,
        })
      },
    },
  ]
}

/** 监控域工具名清单 */
export const MONITOR_TOOL_NAMES = [
  'monitor_process_list',
  'monitor_disk_usage',
  'monitor_network_stats',
] as const

/** 监控域工具元数据（用于 listRegisteredTools 展示） */
export const MONITOR_TOOL_METAS: Array<{ name: string; description: string }> = [
  { name: 'monitor_process_list', description: '列出远程服务器的活跃进程（按 CPU/内存排序）' },
  { name: 'monitor_disk_usage', description: '获取远程服务器的磁盘使用率（df -h 解析）' },
  { name: 'monitor_network_stats', description: '获取远程服务器的网络连接统计（ss/netstat 解析）' },
]

/** 占位导出，避免 TS unused 警告 */
export type { McpToolResult }
