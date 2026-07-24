/**
 * Tool Registry - 5 工具统一注册表
 *
 * 单一来源：所有 LLM Tool Calling 和 MCP Server 工具都从这里取。
 * 加新工具只需：
 * 1. 在 tools/ 目录新建 xxx.ts
 * 2. 在本文件注册（allTools + META）
 * 3. 同步在 shared/llm-tool-types.ts 加 TOOL_IDS 常量
 */
import type { ToolDefinition } from '@shared/llm-tool-types'
import type { ToolCallMeta, ToolId } from '@shared/llm-tool-types'
import { TOOL_IDS } from '@shared/llm-tool-types'
import type { DatabaseManager } from '../../db/database'
import { recordToolCall } from '../../../ipc/model-stats'

import { sshExecTool, SSH_EXEC_META } from './ssh-exec'
import { createTutorialSearchTool, TUTORIAL_SEARCH_META } from './tutorial-search'
import { deployListTool, DEPLOY_LIST_META } from './deploy-list'
import { profilerRunTool, PROFILER_RUN_META } from './profiler-run'
import { monitorGetTool, MONITOR_GET_META } from './monitor-get'

/** 5 工具元数据（顺序与 LLM 决策优先级无关，仅用于 UI 展示） */
export const TOOL_METAS: Record<ToolId, ToolCallMeta> = {
  [TOOL_IDS.SSH_EXEC]: SSH_EXEC_META,
  [TOOL_IDS.TUTORIAL_SEARCH]: TUTORIAL_SEARCH_META,
  [TOOL_IDS.DEPLOY_LIST]: DEPLOY_LIST_META,
  [TOOL_IDS.PROFILER_RUN]: PROFILER_RUN_META,
  [TOOL_IDS.MONITOR_GET]: MONITOR_GET_META,
}

/** 元数据列表（按风险等级降序：critical → safe，方便 UI 分组展示） */
export const TOOL_META_LIST: ToolCallMeta[] = [
  PROFILER_RUN_META,
  MONITOR_GET_META,
  TUTORIAL_SEARCH_META,
  DEPLOY_LIST_META,
  SSH_EXEC_META,
].sort((a, b) => {
  const order = { critical: 0, high: 1, medium: 2, low: 3, safe: 4 }
  return (order[a.risk] ?? 9) - (order[b.risk] ?? 9)
})

/**
 * 根据 ID 查元数据
 */
export function getToolMeta(id: ToolId): ToolCallMeta | undefined {
  return TOOL_METAS[id]
}

/**
 * 工具注册器（依赖注入）
 *
 * 教程工具需要 db 参数，所以用工厂模式而非直接 import
 *
 * 同时维护两份映射：
 * - tools: ToolId → ToolDefinition（Vercel AI SDK 格式）
 * - metas: ToolId → ToolCallMeta（UI/审批/风险展示用）
 */
export class ToolRegistry {
  private tools: Map<ToolId, ToolDefinition> = new Map()
  private metas: Map<ToolId, ToolCallMeta> = new Map()
  private db?: DatabaseManager

  constructor(db?: DatabaseManager) {
    this.db = db
    this.register(sshExecTool, SSH_EXEC_META)
    this.register(monitorGetTool, MONITOR_GET_META)
    this.register(deployListTool, DEPLOY_LIST_META)
    this.register(profilerRunTool, PROFILER_RUN_META)
    if (db) {
      this.register(createTutorialSearchTool(db), TUTORIAL_SEARCH_META)
    } else {
      console.warn('[ToolRegistry] 未传 db，跳过 tutorial_search 工具注册')
    }
  }

  /**
   * 注册一个工具（同时存 tool + meta）
   *
   * v2.4 新增：自动包装 execute，在工具调用完成后记录到 tool_call_log 表
   * 这样 ModelSettings 的"功能调用统计"能显示真实数据
   */
  private register(tool: ToolDefinition, meta: ToolCallMeta): void {
    const db = this.db
    if (db && tool.execute) {
      const originalExecute = tool.execute
      const toolLabel = meta.label
      const wrappedTool: ToolDefinition = {
        ...tool,
        execute: async (args: unknown) => {
          const result = await originalExecute(args)
          // 记录工具调用（无论成功/失败都记录，让统计真实反映使用频率）
          recordToolCall(db, toolLabel)
          return result
        },
      }
      this.tools.set(tool.name as ToolId, wrappedTool)
    } else {
      this.tools.set(tool.name as ToolId, tool)
    }
    this.metas.set(tool.name as ToolId, meta)
  }

  /** 列出所有工具（Vercel AI SDK 格式） */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /** 列出所有工具（Vercel AI SDK 格式的 Record，方便传入 generateText） */
  asMap(): Record<string, ToolDefinition> {
    const map: Record<string, ToolDefinition> = {}
    for (const [id, tool] of this.tools) {
      map[id] = tool
    }
    return map
  }

  /** 按 ID 获取工具 */
  get(id: ToolId): ToolDefinition | undefined {
    return this.tools.get(id)
  }

  /** 按 ID 获取工具元数据（风险/标签/审批） */
  getMeta(id: ToolId): ToolCallMeta | undefined {
    return this.metas.get(id)
  }

  /** 已注册工具数量 */
  size(): number {
    return this.tools.size
  }
}
