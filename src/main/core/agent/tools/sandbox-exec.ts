/**
 * 沙箱执行 Mastra Tool（v0.9 新增）
 *
 * 在隔离的 OpenHands Docker 沙箱中执行 shell 命令，对应方案书 v0.9 §8 沙箱集成。
 *
 * 设计要点：
 * 1. **requireApproval: true**：所有沙箱命令都需用户审批（HC-6 沙箱隔离 + 命令可见）
 * 2. **HC-1 网络日志可见**：所有命令执行通过 logger 记录（command / exitCode / durationMs）
 * 3. **HC-6 敏感 redact**：stdout / stderr 在返回给 LLM 前自动调用 redactSecrets
 * 4. **sessionApiKey 显式传参**：不依赖 context 隐式状态，便于审计
 *
 * 使用方式：
 * ```ts
 * import { createSandboxExecTool } from './tools/sandbox-exec'
 * import { defaultOpenHandsClient } from '../../../services/sandbox/openhands-client'
 *
 * const sandboxExec = createSandboxExecTool(defaultOpenHandsClient)
 * ```
 *
 * 方案书依据：v0.9 §8（沙箱集成）+ §10（Hard Constraints）
 *            + 源码分析报告 §八（与 Mastra 集成）
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { OpenHandsClient, OpenHandsApiError } from '../../../services/sandbox/openhands-client'
import { redactSecrets } from '../providers/redact'
import { logger } from '../../../services/log/logger'

/**
 * 沙箱执行工具的输入 Schema
 *
 - command：要执行的 shell 命令（必填）
 - sandboxId：目标沙箱 ID（必填）
 - sessionApiKey：沙箱访问 Key（必填，由 createSandbox 返回的 session_api_key）
 */
const sandboxExecInputSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe('要在沙箱内执行的 shell 命令（如 ls -la / cat /etc/os-release）'),
  sandboxId: z
    .string()
    .min(1)
    .describe('目标沙箱 ID（由 sandbox:create IPC 通道返回）'),
  sessionApiKey: z
    .string()
    .min(1)
    .describe('沙箱访问 Key（X-Session-API-Key Header，由 sandbox:create 返回）'),
})

/**
 * 沙箱执行工具的输出 Schema
 */
const sandboxExecOutputSchema = z.object({
  success: z.boolean().describe('命令是否执行成功（exitCode === 0）'),
  stdout: z.string().describe('标准输出（已脱敏）'),
  stderr: z.string().describe('标准错误（已脱敏）'),
  exitCode: z.number().describe('退出码（0 = 成功）'),
  durationMs: z.number().describe('执行耗时（毫秒）'),
  error: z.string().optional().describe('错误信息（执行失败时填充）'),
})

/**
 * 创建沙箱执行 Mastra Tool
 *
 * @param client OpenHandsClient 实例（由调用方注入，便于配置化）
 * @returns Mastra Tool 实例
 */
export function createSandboxExecTool(client: OpenHandsClient) {
  return createTool({
    id: 'sandbox-exec',
    description:
      '在隔离的 Docker 沙箱中执行 shell 命令。' +
      '适用于实验性 / 危险 / 不确定影响的操作（如测试新命令、运行脚本、调试问题）。' +
      '所有命令都需要用户显式审批，stdout/stderr 会自动脱敏敏感信息后返回。',
    inputSchema: sandboxExecInputSchema,
    outputSchema: sandboxExecOutputSchema,
    // HC-6：沙箱命令始终需要用户审批（即使 command 看起来无害）
    requireApproval: true,
    execute: async (input, context) => {
      const { command, sandboxId, sessionApiKey } = input

      // HC-1：网络请求 UI 可见（通过 logger 暴露给主进程日志系统）
      logger.info('AGENT.TOOL.SANDBOX', '执行沙箱命令（审批已通过）', {
        sandboxId,
        commandPreview: command.slice(0, 200),
        correlationId: context?.requestContext
          ? (context.requestContext as unknown as Record<string, unknown>).correlationId
          : undefined,
      })

      try {
        const result = await client.executeCommand(sandboxId, command, sessionApiKey)

        // HC-6：redact secrets —— stdout / stderr 在返回给 LLM 前自动脱敏
        // 注意：redactSecrets 默认重载返回 { text, stats } 对象，
        // 传 { returnStats: false } 才返回纯 string，匹配 outputSchema
        const safeStdout = redactSecrets(result.stdout, { returnStats: false })
        const safeStderr = redactSecrets(result.stderr, { returnStats: false })
        const success = result.exitCode === 0

        logger.info('AGENT.TOOL.SANDBOX', '沙箱命令执行完成', {
          sandboxId,
          exitCode: result.exitCode,
          success,
          durationMs: result.durationMs,
        })

        return {
          success,
          stdout: safeStdout,
          stderr: safeStderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs ?? 0,
        }
      } catch (err) {
        // 区分错误类型，便于 LLM 决策下一步
        const isApiError = err instanceof OpenHandsApiError
        const errorMsg = isApiError
          ? `[${err.code}/${err.statusCode}] ${err.message}`
          : (err as Error).message

        logger.error('AGENT.TOOL.SANDBOX', '沙箱命令执行失败', {
          sandboxId,
          error: errorMsg,
          code: isApiError ? err.code : 'UNKNOWN',
        })

        // 返回错误结构（而不是抛出），让 LLM 能看到错误信息并决定重试 / 放弃
        return {
          success: false,
          stdout: '',
          stderr: errorMsg,
          exitCode: -1,
          durationMs: 0,
          error: errorMsg,
        }
      }
    },
  })
}

/**
 * 沙箱执行工具的输入类型（便于上层类型推导）
 */
export type SandboxExecInput = z.infer<typeof sandboxExecInputSchema>

/**
 * 沙箱执行工具的输出类型
 */
export type SandboxExecOutput = z.infer<typeof sandboxExecOutputSchema>
