/**
 * Mastra Tool Bridge — 将现有 ToolRegistry 工具适配为 Mastra createTool 格式
 *
 * 背景：项目有 5 个工具定义在 ToolRegistry（Vercel AI SDK ToolDefinition 格式），
 * Mastra Agent 需要 createTool 格式。本模块做无损转换，复用 execute 逻辑，零重复代码。
 *
 * 转换映射：
 *   ToolDefinition.name        → createTool.id
 *   ToolDefinition.description → createTool.description
 *   ToolDefinition.parameters  → createTool.inputSchema（同为 Zod schema）
 *   ToolDefinition.execute     → createTool.execute（包装错误处理）
 *
 * 设计要点：
 * - 不修改原始 ToolDefinition，纯函数式适配
 * - execute 包装：Mastra 的 execute 签名是 (input, context)，
 *   我们的 execute 签名是 (args) → ToolCallResult，需要桥接
 * - 保留 requireApproval 元数据（从 ToolCallMeta 读取）
 */
import { createTool } from '@mastra/core/tools'
import type { ToolDefinition } from '@shared/llm-tool-types'
import type { ToolCallMeta } from '@shared/llm-tool-types'
import { logger } from '../../../services/log/logger'

/**
 * Mastra Tool 类型（createTool 返回值）
 * 由于 @mastra/core 的类型导出较复杂，用 unknown 作为通用类型
 */
export type MastraTool = ReturnType<typeof createTool>

/**
 * 将单个 ToolRegistry 工具转换为 Mastra createTool 格式
 *
 * @param tool Vercel AI SDK 格式的工具定义
 * @param meta 工具元数据（风险等级/审批要求等）
 * @returns Mastra Tool 实例
 */
export function adaptToolToMastra(
  tool: ToolDefinition,
  meta?: ToolCallMeta
): MastraTool {
  return createTool({
    id: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
    // 高风险工具标记 requireApproval（Mastra HC 人机协同）
    ...(meta?.requiresApproval ? { requireApproval: true } : {}),
    execute: async (input: unknown, _context?: unknown) => {
      try {
        // 调用原始 execute（它内部已经 catch 异常，返回 ToolCallResult）
        const result = await tool.execute(input)
        return result
      } catch (err) {
        // 兜底：如果 execute 抛出异常（理论上不应该），转为错误结构
        logger.error('MASTRADAPTER', `Mastra tool "${tool.name}" execute 异常`, {
          error: (err as Error).message,
        })
        return {
          toolId: tool.name,
          success: false,
          error: `Mastra adapter: ${(err as Error).message}`,
          durationMs: 0,
          timestamp: Date.now(),
        }
      }
    },
  })
}

/**
 * 批量转换 ToolRegistry 工具为 Mastra tools Record
 *
 * @param tools ToolDefinition 数组
 * @param metas ToolCallMeta 数组（可选，与 tools 一一对应或按 id 匹配）
 * @returns Record<toolName, MastraTool>（可直接传给 Mastra Agent 的 tools 参数）
 */
export function adaptToolsToMastra(
  tools: ToolDefinition[],
  metas?: ToolCallMeta[]
): Record<string, MastraTool> {
  const metaMap = new Map<string, ToolCallMeta>()
  if (metas) {
    for (const m of metas) {
      metaMap.set(m.id, m)
    }
  }

  const result: Record<string, MastraTool> = {}
  for (const tool of tools) {
    const meta = metaMap.get(tool.name)
    result[tool.name] = adaptToolToMastra(tool, meta)
  }

  logger.info('MASTRADAPTER', `已适配 ${Object.keys(result).length} 个工具到 Mastra 格式`, {
    toolIds: Object.keys(result),
  })

  return result
}
