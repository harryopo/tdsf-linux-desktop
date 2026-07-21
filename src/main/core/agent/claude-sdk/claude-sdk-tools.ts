/**
 * Claude Agent SDK 工具适配层
 *
 * 职责：
 * 将项目现有的 SSH / SFTP 工具（src/main/services/ssh/）适配为 Claude Agent SDK
 * 的自定义工具格式，通过 createSdkMcpServer + mcpServers 注入到 query() 中。
 *
 * 关键事实（基于 @anthropic-ai/claude-agent-sdk@0.3.211 实际 API，而非调研文档模板）：
 * - SDK 不存在 `customTools` 选项；自定义工具通过 `createSdkMcpServer({ name, tools })`
 *   创建一个进程内 MCP server，再通过 `options.mcpServers` 注入。
 * - 单个工具用 `tool(name, description, inputSchema, handler)` 创建，
 *   `inputSchema` 是 Zod raw shape（{ key: z.ZodType }，非 z.object(...)）。
 *   SDK 的 AnyZodRawShape = ZodRawShape | ZodRawShape_2 同时兼容 Zod 3 与 Zod 4。
 * - handler 返回 CallToolResult：`{ content: [{ type: 'text', text }], isError?: boolean }`。
 *
 * Hard Constraints 对齐：
 * - HC-1 网络日志：每次工具调用 logger.info 记录（SSH exec 是远程网络操作）
 * - HC-2 敏感文件 redact：工具输出经过 redactSecrets 脱敏后再返回给模型
 * - HC-3 本地优先：工具复用项目已有 SSH/SFTP 服务，不引入额外网络依赖
 *
 * 方案书依据：v0.9 §3（Provider 抽象）+ 调研文档 §8.3（Linux 运维工具集注入）
 */
// P-1 修复（运行时补充）：@anthropic-ai/claude-agent-sdk 是 ESM-only，
// 静态 import 会触发 ERR_REQUIRE_ESM。改为 type-only import + 动态 import()。
import type { SdkMcpToolDefinition, McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { SshConnectionManager } from '../../../services/ssh/connection-manager'
import { SftpManager } from '../../../services/ssh/sftp'
import { redactSecrets } from '../providers/redact'
import { logger } from '../../../services/log/logger'

/** MCP server 名称（注入到 query options.mcpServers 的 key） */
export const TDSF_LINUX_OPS_SERVER_NAME = 'tdsf-linux-ops'

/**
 * 构造 SSH/SFTP 自定义工具集（SDK 格式）
 *
 * 每个工具：
 * 1. 用 redactSecrets 对输出脱敏（HC-2）
 * 2. 用 logger.info 记录调用审计（HC-1）
 * 3. 异常时返回 isError=true 的 CallToolResult（不抛出，让 Agent Loop 继续）
 *
 * @returns SdkMcpToolDefinition 数组，供 createSdkMcpServer 使用
 */
export async function createClaudeSdkTools(): Promise<SdkMcpToolDefinition[]> {
  // 动态 import ESM 模块（@anthropic-ai/claude-agent-sdk 是 ESM-only）
  const { tool } = await import('@anthropic-ai/claude-agent-sdk')
  const sshManager = SshConnectionManager.getInstance()
  const sftpManager = new SftpManager(sshManager)

  // ------------------------------------------------------------------
  // ssh_exec — 在远程 Linux 主机执行命令
  // ------------------------------------------------------------------
  const sshExecTool = tool(
    'ssh_exec',
    '在已连接的远程 Linux 主机上执行 shell 命令（SSH exec）。'
      + '入参：sessionId（SSH 连接 ID，由前端 ssh:connect 返回）、command（要执行的命令）。'
      + '返回 stdout / stderr / exitCode。输出已脱敏。',
    {
      sessionId: z.string().describe('SSH 会话 ID（前端 ssh:connect 返回的 sessionId）'),
      command: z.string().describe('要执行的 shell 命令'),
    },
    async (args) => {
      const { sessionId, command } = args
      logger.info('AGENT.CLAUDE_SDK.TOOL', `ssh_exec 调用`, {
        sessionId,
        command: redactSecrets(command),
      })
      try {
        const result = await sshManager.exec(sessionId, command)
        // HC-2：输出脱敏（命令输出可能包含 .env 路径、密钥等）
        const safeStdout = redactSecrets(result.stdout)
        const safeStderr = redactSecrets(result.stderr)
        const text =
          `exitCode: ${result.exitCode}\n`
          + `duration: ${result.duration}ms\n`
          + `--- stdout ---\n${safeStdout}\n`
          + `--- stderr ---\n${safeStderr}\n`
        return {
          content: [{ type: 'text' as const, text }],
          isError: result.exitCode !== 0,
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? 'ssh_exec 失败'
        logger.error('AGENT.CLAUDE_SDK.TOOL', `ssh_exec 异常`, {
          sessionId,
          error: redactSecrets(msg),
        })
        return {
          content: [{ type: 'text' as const, text: `ssh_exec 失败: ${redactSecrets(msg)}` }],
          isError: true,
        }
      }
    }
  )

  // ------------------------------------------------------------------
  // sftp_read_file — 读取远程文件内容
  // ------------------------------------------------------------------
  const sftpReadTool = tool(
    'sftp_read_file',
    '通过 SFTP 读取远程主机上的文件内容（utf-8 字符串）。'
      + '入参：sessionId、path（远程文件绝对路径）。'
      + '单文件最大 10MB；内容已脱敏。',
    {
      sessionId: z.string().describe('SSH 会话 ID'),
      path: z.string().describe('远程文件绝对路径'),
    },
    async (args) => {
      const { sessionId, path: remotePath } = args
      logger.info('AGENT.CLAUDE_SDK.TOOL', `sftp_read_file 调用`, {
        sessionId,
        path: redactSecrets(remotePath),
      })
      try {
        const content = await sftpManager.readFile(sessionId, remotePath)
        // HC-2：文件内容可能含密钥/凭证，强制脱敏
        const safe = redactSecrets(content)
        return {
          content: [{ type: 'text' as const, text: safe }],
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? 'sftp_read_file 失败'
        logger.error('AGENT.CLAUDE_SDK.TOOL', `sftp_read_file 异常`, {
          sessionId,
          error: redactSecrets(msg),
        })
        return {
          content: [
            { type: 'text' as const, text: `sftp_read_file 失败: ${redactSecrets(msg)}` },
          ],
          isError: true,
        }
      }
    }
  )

  // ------------------------------------------------------------------
  // sftp_write_file — 写入远程文件内容
  // ------------------------------------------------------------------
  const sftpWriteTool = tool(
    'sftp_write_file',
    '通过 SFTP 写入远程主机文件（覆盖原内容，utf-8）。'
      + '入参：sessionId、path（远程文件绝对路径）、content（文件内容）。',
    {
      sessionId: z.string().describe('SSH 会话 ID'),
      path: z.string().describe('远程文件绝对路径'),
      content: z.string().describe('要写入的文件内容'),
    },
    async (args) => {
      const { sessionId, path: remotePath, content } = args
      logger.info('AGENT.CLAUDE_SDK.TOOL', `sftp_write_file 调用`, {
        sessionId,
        path: redactSecrets(remotePath),
        contentLength: content.length,
      })
      try {
        const ok = await sftpManager.writeFile(sessionId, remotePath, content)
        return {
          content: [
            {
              type: 'text' as const,
              text: `sftp_write_file ${ok ? '成功' : '失败'}: ${redactSecrets(remotePath)}`,
            },
          ],
          isError: !ok,
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? 'sftp_write_file 失败'
        logger.error('AGENT.CLAUDE_SDK.TOOL', `sftp_write_file 异常`, {
          sessionId,
          error: redactSecrets(msg),
        })
        return {
          content: [
            { type: 'text' as const, text: `sftp_write_file 失败: ${redactSecrets(msg)}` },
          ],
          isError: true,
        }
      }
    }
  )

  // ------------------------------------------------------------------
  // sftp_list — 列出远程目录内容
  // ------------------------------------------------------------------
  const sftpListTool = tool(
    'sftp_list',
    '通过 SFTP 列出远程主机目录内容。入参：sessionId、path（远程目录绝对路径）。'
      + '返回目录条目列表（名称 / 类型 / 大小 / 权限 / 属主）。',
    {
      sessionId: z.string().describe('SSH 会话 ID'),
      path: z.string().describe('远程目录绝对路径'),
    },
    async (args) => {
      const { sessionId, path: remotePath } = args
      logger.info('AGENT.CLAUDE_SDK.TOOL', `sftp_list 调用`, {
        sessionId,
        path: redactSecrets(remotePath),
      })
      try {
        const entries = await sftpManager.list(sessionId, remotePath)
        const lines = entries.map(
          (e) =>
            `${e.isDirectory ? 'd' : e.isFile ? '-' : 'l'} ${e.rights.user}${e.rights.group}${e.rights.other} ${e.owner}:${e.group} ${e.size} ${e.name}`
        )
        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? 'sftp_list 失败'
        logger.error('AGENT.CLAUDE_SDK.TOOL', `sftp_list 异常`, {
          sessionId,
          error: redactSecrets(msg),
        })
        return {
          content: [
            { type: 'text' as const, text: `sftp_list 失败: ${redactSecrets(msg)}` },
          ],
          isError: true,
        }
      }
    }
  )

  // 注意：每个 tool 的 SdkMcpToolDefinition<具体 Schema> 与函数返回类型
  // SdkMcpToolDefinition[]（默认 AnyZodRawShape）存在泛型逆变（inputSchema 协变，
  // handler.args 逆变），TypeScript 严格模式下无法直接赋值。
  // 这里用 unknown 双重断言绕过泛型检查，运行时安全性由 createSdkMcpServer 内部校验保证。
  return [sshExecTool, sftpReadTool, sftpWriteTool, sftpListTool] as unknown as SdkMcpToolDefinition[]
}

/**
 * 构造一个注入了 SSH/SFTP 工具的 SDK MCP server 配置
 *
 * 用于传给 `query({ options: { mcpServers: { [name]: config } } })`。
 * 工具在主进程内执行（in-process MCP transport），无额外子进程开销。
 *
 * @param tools 自定义工具数组（默认调用 createClaudeSdkTools()）
 * @returns McpSdkServerConfigWithInstance 实例
 */
export async function createLinuxOpsMcpServer(
  tools?: SdkMcpToolDefinition[]
): Promise<McpSdkServerConfigWithInstance> {
  // 动态 import ESM 模块（@anthropic-ai/claude-agent-sdk 是 ESM-only）
  const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk')
  const finalTools = tools ?? (await createClaudeSdkTools())
  return createSdkMcpServer({
    name: TDSF_LINUX_OPS_SERVER_NAME,
    version: '0.9.0',
    instructions:
      'tdsf-linux-desktop Linux 运维工具集：ssh_exec / sftp_read_file / sftp_write_file / sftp_list。',
    tools,
    alwaysLoad: true,
  })
}
