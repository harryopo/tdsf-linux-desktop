/**
 * LLM Tool Calling - 共享类型定义
 *
 * 这 5 个本地能力（SSH 执行 / 教程搜索 / 部署模板 / 架构感知 / 监控采样）现在只有一个出口：
 * 外部 MCP Server（`services/mcp/tools/registry.ts` 直接 import 各 `executeXxx`）。
 * 曾经并存的第二个出口是应用内那条 `llm:chat-with-tools` IPC 通道与它的
 * `services/llm/tools/registry.ts` 注册表，渲染层零调用，2026-10-24 随 #195 整删；
 * 应用内 AI 对话用的是另一套目录（`core/agent/tools/chat-tool-router.ts`），不走这里。
 */

/** 工具风险等级（决定是否需要人工审批） */
export type ToolRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'

/** 工具调用结果（统一格式） */
export interface ToolCallResult<T = unknown> {
  /** 工具 ID */
  toolId: string
  /** 是否成功 */
  success: boolean
  /** 结果数据 */
  data?: T
  /** 错误信息 */
  error?: string
  /** 执行耗时（毫秒） */
  durationMs: number
  /** 时间戳 */
  timestamp: number
}

/** 5 个工具的 ID 常量（避免拼写错误） */
export const TOOL_IDS = {
  SSH_EXEC: 'ssh_exec',
  TUTORIAL_SEARCH: 'tutorial_search',
  DEPLOY_LIST: 'deploy_list_templates',
  PROFILER_RUN: 'profiler_run',
  MONITOR_GET: 'monitor_get_data',
} as const
