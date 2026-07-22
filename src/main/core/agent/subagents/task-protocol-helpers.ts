/**
 * Subagent 调度 14 步协议 - 共享辅助函数
 *
 * 从 task-protocol-steps.ts 拆分而来（避免单文件超 500 行硬约束）。
 * 包含：日志器、input 字段读取、内置 Registry 创建。
 */
import type { Subagent, SubagentRegistry } from './base'
import { createAllSubagents } from './index'
import { logger } from '../../../services/log/logger'

/**
 * 子日志器（自动注入协议前缀）
 */
export const log = logger.child('AGENT.SUBAGENT.PROTOCOL')

/**
 * 从 unknown input 中安全读取字段值
 */
export function readInputField(input: unknown, field: string): unknown {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>
    return obj[field]
  }
  return undefined
}

/**
 * 从 unknown input 中提取字符串字段（必须为非空字符串）
 */
export function extractStringField(input: unknown, field: string): string | undefined {
  const v = readInputField(input, field)
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * 创建内置 Subagent 注册表（兜底，当 ctx.registry 未提供时使用）
 *
 * 兼容 explore 等不在 SubagentName 联合类型中的 subagent：
 * 通过 as Record<string, Subagent> 字符串键访问。
 */
export function createBuiltinRegistry(): SubagentRegistry {
  const subagents = createAllSubagents()
  return {
    get(name: Parameters<SubagentRegistry['get']>[0]): Subagent | null {
      // 兼容 explore 等不在 SubagentName 联合类型中的 subagent
      return (subagents as Record<string, Subagent>)[name as string] ?? null
    },
    list(): Subagent[] {
      return Object.values(subagents)
    },
  }
}
