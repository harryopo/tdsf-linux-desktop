/**
 * MCP 工具注册表 - 沙箱域（v2.0 Phase F.3）
 *
 * 3 个沙箱域工具，复用现有 OpenHandsClient（OpenHands App Server REST API）：
 * 1. sandbox_execute   - 在隔离的 Docker 沙箱中执行 shell 命令（自动脱敏）
 * 2. sandbox_create    - 创建新沙箱容器（返回 sandboxId + sessionApiKey）
 * 3. sandbox_destroy   - 销毁沙箱容器（不可逆，工作区数据丢失）
 *
 * 安全设计：
 * - sandbox_execute 需要 sandboxId + sessionApiKey（由 sandbox_create 返回）
 * - stdout/stderr 自动调用 redactSecrets 脱敏（HC-6）
 * - 所有命令默认 requireApproval=true（HC-6 沙箱隔离）
 *
 * 方案书依据：v0.9 §8（沙箱集成）+ §10（Hard Constraints）
 */
import { OpenHandsClient, OpenHandsApiError } from '../../sandbox/openhands-client'
import { defaultOpenHandsClient } from '../../sandbox/openhands-client'
import { redactSecrets } from '../../../core/agent/providers/redact'
import type { McpToolRegistration, McpToolResult } from './registry'
import { toMcpErrorResult, toMcpTextResult } from './registry'

/** 校验字符串非空 */
function requireNonString(value: unknown, _name: string): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 创建沙箱域 3 个 MCP 工具
 *
 * @param client OpenHandsClient 实例（默认使用 defaultOpenHandsClient 单例）
 */
export function createSandboxMcpTools(
  client: OpenHandsClient = defaultOpenHandsClient
): McpToolRegistration[] {
  return [
    // ── 1. sandbox_execute ────────────────────────────────────────
    {
      meta: {
        name: 'sandbox_execute',
        description:
          '在隔离的 OpenHands Docker 沙箱中执行 shell 命令。stdout/stderr 自动脱敏。需先调用 sandbox_create 获取 sandboxId + sessionApiKey。',
        inputSchema: {
          type: 'object',
          properties: {
            sandboxId: { type: 'string', description: '沙箱 ID（由 sandbox_create 返回，必填）' },
            sessionApiKey: {
              type: 'string',
              description: '沙箱访问 Key（由 sandbox_create 返回，必填）',
            },
            command: { type: 'string', description: '要执行的 shell 命令（必填）' },
          },
          required: ['sandboxId', 'sessionApiKey', 'command'],
        },
      },
      call: async (args) => {
        const sandboxId = requireNonString(args.sandboxId, 'sandboxId')
        if (!sandboxId) return toMcpErrorResult('参数 sandboxId 必填且为非空字符串')
        const sessionApiKey = requireNonString(args.sessionApiKey, 'sessionApiKey')
        if (!sessionApiKey) return toMcpErrorResult('参数 sessionApiKey 必填且为非空字符串')
        const command = requireNonString(args.command, 'command')
        if (!command) return toMcpErrorResult('参数 command 必填且为非空字符串')

        try {
          const result = await client.executeCommand(sandboxId, command, sessionApiKey)
          // HC-6：redact secrets（默认重载返回纯 string）
          const safeStdout = redactSecrets(result.stdout, { returnStats: false }) as string
          const safeStderr = redactSecrets(result.stderr, { returnStats: false }) as string
          return toMcpTextResult({
            sandboxId,
            success: result.exitCode === 0,
            stdout: safeStdout,
            stderr: safeStderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs ?? 0,
          })
        } catch (err) {
          if (err instanceof OpenHandsApiError) {
            return toMcpTextResult({
              sandboxId,
              success: false,
              error: `[${err.code}/${err.statusCode}] ${err.message}`,
              statusCode: err.statusCode,
              errorCode: err.code,
            })
          }
          return toMcpTextResult(err)
        }
      },
    },

    // ── 2. sandbox_create ─────────────────────────────────────────
    {
      meta: {
        name: 'sandbox_create',
        description:
          '创建新的 OpenHands Docker 沙箱容器。返回 sandboxId、sessionApiKey、状态（STARTING/RUNNING）和暴露的 URL。',
        inputSchema: {
          type: 'object',
          properties: {
            sandboxSpecId: {
              type: 'string',
              description: '沙箱规格 ID（可选，默认 "default"：4 CPU / 4GB RAM / 10GB 磁盘）',
            },
          },
        },
      },
      call: async (args) => {
        const sandboxSpecId = requireNonString(args.sandboxSpecId, 'sandboxSpecId') ?? undefined
        try {
          const sandbox = await client.createSandbox(sandboxSpecId)
          return toMcpTextResult({
            success: true,
            sandboxId: sandbox.id,
            sessionApiKey: sandbox.session_api_key,
            status: sandbox.status,
            sandboxSpecId: sandbox.sandbox_spec_id,
            createdAt: sandbox.created_at,
            exposedUrls:
              sandbox.exposed_urls?.map((u) => ({
                name: u.name,
                url: u.url,
                port: u.port,
              })) ?? [],
            message: `沙箱已创建（状态: ${sandbox.status}）${
              sandbox.status === 'STARTING' ? '，请轮询等待 RUNNING 后再执行命令' : ''
            }`,
          })
        } catch (err) {
          if (err instanceof OpenHandsApiError) {
            return toMcpTextResult({
              success: false,
              error: `[${err.code}/${err.statusCode}] ${err.message}`,
              statusCode: err.statusCode,
              errorCode: err.code,
            })
          }
          return toMcpTextResult(err)
        }
      },
    },

    // ── 3. sandbox_destroy ────────────────────────────────────────
    {
      meta: {
        name: 'sandbox_destroy',
        description:
          '销毁指定的 OpenHands Docker 沙箱容器。不可逆操作，工作区数据将丢失（除非已归档）。',
        inputSchema: {
          type: 'object',
          properties: {
            sandboxId: { type: 'string', description: '要销毁的沙箱 ID（必填）' },
          },
          required: ['sandboxId'],
        },
      },
      call: async (args) => {
        const sandboxId = requireNonString(args.sandboxId, 'sandboxId')
        if (!sandboxId) return toMcpErrorResult('参数 sandboxId 必填且为非空字符串')

        try {
          await client.deleteSandbox(sandboxId)
          return toMcpTextResult({
            success: true,
            sandboxId,
            message: `沙箱 ${sandboxId} 已销毁`,
          })
        } catch (err) {
          if (err instanceof OpenHandsApiError) {
            // NOT_FOUND 视为已销毁（幂等）
            if (err.code === 'NOT_FOUND') {
              return toMcpTextResult({
                success: true,
                sandboxId,
                message: `沙箱 ${sandboxId} 不存在（可能已被销毁）`,
                alreadyGone: true,
              })
            }
            return toMcpTextResult({
              success: false,
              sandboxId,
              error: `[${err.code}/${err.statusCode}] ${err.message}`,
              statusCode: err.statusCode,
              errorCode: err.code,
            })
          }
          return toMcpTextResult(err)
        }
      },
    },
  ]
}

/** 沙箱域工具名清单 */
export const SANDBOX_TOOL_NAMES = [
  'sandbox_execute',
  'sandbox_create',
  'sandbox_destroy',
] as const

/** 沙箱域工具元数据（用于 listRegisteredTools 展示） */
export const SANDBOX_TOOL_METAS: Array<{ name: string; description: string }> = [
  { name: 'sandbox_execute', description: '在隔离的 Docker 沙箱中执行 shell 命令（自动脱敏）' },
  { name: 'sandbox_create', description: '创建新的 OpenHands Docker 沙箱容器' },
  { name: 'sandbox_destroy', description: '销毁指定的 Docker 沙箱容器（不可逆）' },
]

/** 占位导出，避免 TS unused 警告 */
export type { McpToolResult }
