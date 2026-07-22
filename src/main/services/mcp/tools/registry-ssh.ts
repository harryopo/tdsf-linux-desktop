/**
 * MCP 工具注册表 - SSH 域（v2.0 Phase F.1）
 *
 * 5 个 SSH 域工具，复用现有 SshConnectionManager + SftpManager + ssh-exec LLM tool：
 * 1. ssh_execute      - 在远程 SSH session 上执行命令（复用 executeSshExec）
 * 2. ssh_file_read    - 读取远程文件内容（复用 SftpManager.readFile）
 * 3. ssh_file_write   - 写入远程文件内容（复用 SftpManager.writeFile）
 * 4. ssh_file_list    - 列出远程目录内容（复用 SftpManager.list）
 * 5. ssh_file_stat    - 获取远程文件元信息（复用 SftpManager.stat）
 *
 * 注意：与 LLM tool 中的 ssh_exec (TOOL_IDS.SSH_EXEC) 功能等价但工具名不同，
 * 这里使用 ssh_execute 命名以避免与 legacy 工具重名。
 */
import { SshConnectionManager } from '../../ssh/connection-manager'
import { SftpManager } from '../../ssh/sftp'
import { executeSshExec } from '../../llm/tools/ssh-exec'
import type { McpToolRegistration, McpToolResult } from './registry'
import { toMcpErrorResult, toMcpTextResult } from './registry'

/**
 * 创建 SSH 域 5 个 MCP 工具
 */
export function createSshMcpTools(): McpToolRegistration[] {
  const sftp = new SftpManager()

  return [
    // ── 1. ssh_execute ──────────────────────────────────────────────
    {
      meta: {
        name: 'ssh_execute',
        description:
          '在指定 SSH session 上执行一条 Linux 命令。high 风险命令（rm/shutdown/reboot 等）需用户审批。返回 stdout/stderr/exitCode/风险等级。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填，从已建立的连接获取）' },
            command: { type: 'string', description: '要执行的 Linux 命令（必填）' },
            timeoutMs: {
              type: 'number',
              description: '超时时间（毫秒），默认 10000，上限 60000',
            },
          },
          required: ['sessionId', 'command'],
        },
      },
      call: async (args) => {
        const sessionId = args.sessionId
        const command = args.command
        const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 10000
        if (typeof sessionId !== 'string' || !sessionId) {
          return toMcpErrorResult('参数 sessionId 必填且为非空字符串')
        }
        if (typeof command !== 'string' || !command) {
          return toMcpErrorResult('参数 command 必填且为非空字符串')
        }
        const result = await executeSshExec({ sessionId, command, timeoutMs })
        return toMcpTextResult(result)
      },
    },

    // ── 2. ssh_file_read ───────────────────────────────────────────
    {
      meta: {
        name: 'ssh_file_read',
        description:
          '读取远程 SSH 服务器上的文件内容（UTF-8 文本）。默认上限 10MB，超过将拒绝读取。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
            remotePath: { type: 'string', description: '远程文件绝对路径（必填）' },
            maxSize: {
              type: 'number',
              description: '最大字节数（可选，默认 10485760 = 10MB）',
            },
          },
          required: ['sessionId', 'remotePath'],
        },
      },
      call: async (args) => {
        const sessionId = args.sessionId
        const remotePath = args.remotePath
        if (typeof sessionId !== 'string' || !sessionId) {
          return toMcpErrorResult('参数 sessionId 必填且为非空字符串')
        }
        if (typeof remotePath !== 'string' || !remotePath) {
          return toMcpErrorResult('参数 remotePath 必填且为非空字符串')
        }
        const maxSize =
          typeof args.maxSize === 'number' && args.maxSize > 0 ? args.maxSize : 10 * 1024 * 1024
        try {
          const content = await sftp.readFile(sessionId, remotePath, maxSize)
          return toMcpTextResult(content)
        } catch (err) {
          return toMcpTextResult(err)
        }
      },
    },

    // ── 3. ssh_file_write ──────────────────────────────────────────
    {
      meta: {
        name: 'ssh_file_write',
        description:
          '写入字符串到远程 SSH 服务器上的文件（覆盖原内容）。建议在写入前备份原文件。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
            remotePath: { type: 'string', description: '远程文件绝对路径（必填）' },
            content: { type: 'string', description: '要写入的文件内容（必填）' },
          },
          required: ['sessionId', 'remotePath', 'content'],
        },
      },
      call: async (args) => {
        const sessionId = args.sessionId
        const remotePath = args.remotePath
        const content = args.content
        if (typeof sessionId !== 'string' || !sessionId) {
          return toMcpErrorResult('参数 sessionId 必填且为非空字符串')
        }
        if (typeof remotePath !== 'string' || !remotePath) {
          return toMcpErrorResult('参数 remotePath 必填且为非空字符串')
        }
        if (typeof content !== 'string') {
          return toMcpErrorResult('参数 content 必填且为字符串')
        }
        try {
          const ok = await sftp.writeFile(sessionId, remotePath, content)
          return toMcpTextResult({ success: ok, remotePath, bytes: content.length })
        } catch (err) {
          return toMcpTextResult(err)
        }
      },
    },

    // ── 4. ssh_file_list ───────────────────────────────────────────
    {
      meta: {
        name: 'ssh_file_list',
        description:
          '列出远程 SSH 服务器上指定目录的内容（目录排在前面，同类按名称排序）。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
            remotePath: { type: 'string', description: '远程目录绝对路径（必填）' },
          },
          required: ['sessionId', 'remotePath'],
        },
      },
      call: async (args) => {
        const sessionId = args.sessionId
        const remotePath = args.remotePath
        if (typeof sessionId !== 'string' || !sessionId) {
          return toMcpErrorResult('参数 sessionId 必填且为非空字符串')
        }
        if (typeof remotePath !== 'string' || !remotePath) {
          return toMcpErrorResult('参数 remotePath 必填且为非空字符串')
        }
        try {
          const entries = await sftp.list(sessionId, remotePath)
          return toMcpTextResult({
            path: remotePath,
            count: entries.length,
            entries: entries.map((e) => ({
              name: e.name,
              isDirectory: e.isDirectory,
              isFile: e.isFile,
              isSymlink: e.isSymlink,
              size: e.size,
              modifyTime: e.modifyTime,
              rights: e.rights,
              owner: e.owner,
              group: e.group,
            })),
          })
        } catch (err) {
          return toMcpTextResult(err)
        }
      },
    },

    // ── 5. ssh_file_stat ───────────────────────────────────────────
    {
      meta: {
        name: 'ssh_file_stat',
        description:
          '获取远程 SSH 服务器上文件/目录的元信息（大小、权限、修改时间、所有者等）。路径不存在时返回 null。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'SSH session ID（必填）' },
            remotePath: { type: 'string', description: '远程路径（必填）' },
          },
          required: ['sessionId', 'remotePath'],
        },
      },
      call: async (args) => {
        const sessionId = args.sessionId
        const remotePath = args.remotePath
        if (typeof sessionId !== 'string' || !sessionId) {
          return toMcpErrorResult('参数 sessionId 必填且为非空字符串')
        }
        if (typeof remotePath !== 'string' || !remotePath) {
          return toMcpErrorResult('参数 remotePath 必填且为非空字符串')
        }
        try {
          const stat = await sftp.stat(sessionId, remotePath)
          if (!stat) {
            return toMcpTextResult({ path: remotePath, exists: false })
          }
          return toMcpTextResult({
            path: remotePath,
            exists: true,
            name: stat.name,
            isDirectory: stat.isDirectory,
            isFile: stat.isFile,
            isSymlink: stat.isSymlink,
            size: stat.size,
            modifyTime: stat.modifyTime,
            accessTime: stat.accessTime,
            rights: stat.rights,
            owner: stat.owner,
            group: stat.group,
          })
        } catch (err) {
          return toMcpTextResult(err)
        }
      },
    },
  ]
}

/**
 * 校验 SSH session 是否已连接（供其他域工具复用）
 *
 * @returns 已连接返回 null；未连接返回错误 MCP 结果
 */
export function requireSshConnected(
  sessionId: string
): { error: string } | null {
  const state = SshConnectionManager.getInstance().getConnectionState(sessionId)
  if (state !== 'connected') {
    return { error: `SSH session 不可用（状态: ${state}），请先建立连接` }
  }
  return null
}

/** SSH 域工具名清单（用于 server.ts 注册和校验） */
export const SSH_TOOL_NAMES = [
  'ssh_execute',
  'ssh_file_read',
  'ssh_file_write',
  'ssh_file_list',
  'ssh_file_stat',
] as const

/** SSH 域工具元数据（不含 call，仅供 listRegisteredTools 展示） */
export const SSH_TOOL_METAS: Array<{ name: string; description: string }> = [
  { name: 'ssh_execute', description: '在指定 SSH session 上执行一条 Linux 命令' },
  { name: 'ssh_file_read', description: '读取远程 SSH 服务器上的文件内容' },
  { name: 'ssh_file_write', description: '写入字符串到远程 SSH 服务器上的文件' },
  { name: 'ssh_file_list', description: '列出远程 SSH 服务器上指定目录的内容' },
  { name: 'ssh_file_stat', description: '获取远程文件/目录的元信息' },
]

/** 占位导出，避免 TS unused 警告（McpToolResult 类型在本文件内被使用） */
export type { McpToolResult }
