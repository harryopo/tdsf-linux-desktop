/**
 * LLM Tool Calling - 类型定义（主进程 + 渲染进程共享）
 *
 * 让 LLM 通过 Vercel AI SDK 的 tool() 函数调用本地能力（SSH/教程/部署/架构感知/监控）。
 * 5 个工具同时暴露给：
 * 1. 应用内 LLM 对话（Vercel AI SDK 的 generateText({ tools })）
 * 2. 外部 MCP Server（@modelcontextprotocol/sdk 的 server.tool()）
 *
 * 共享一个 tool-registry，单一来源保证两个入口能力一致。
 */

/** 工具风险等级（决定是否需要人工审批） */
export type ToolRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'

/** 中文风险标签 */
export const TOOL_RISK_LABELS: Record<ToolRiskLevel, string> = {
  safe: '安全',
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重'
}

/** 风险等级颜色（与 Profiler 保持视觉一致） */
export const TOOL_RISK_COLORS: Record<ToolRiskLevel, string> = {
  safe: '#52c41a',
  low: '#1890ff',
  medium: '#faad14',
  high: '#fa8c16',
  critical: '#f5222d'
}

/** 工具调用元数据（UI 展示用） */
export interface ToolCallMeta {
  /** 工具 ID（与 Vercel AI SDK tool name 一致） */
  id: string
  /** 中文显示名 */
  label: string
  /** Emoji 图标 */
  emoji: string
  /** 简短描述（用于 LLM 决策） */
  description: string
  /** 风险等级 */
  risk: ToolRiskLevel
  /** 是否需要人工审批（high/critical 自动为 true） */
  requiresApproval: boolean
}

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

/** 工具调用请求（renderer → main） */
export interface ToolCallRequest {
  /** 工具 ID */
  toolId: string
  /** 工具参数（已通过 zod 校验） */
  args: Record<string, unknown>
  /** 关联的 SSH session ID（部分工具需要） */
  sessionId?: string
  /** 是否已经用户审批（high 风险工具必须 true） */
  approved?: boolean
}

/** 工具调用进度事件（主 → 渲染） */
export interface ToolCallProgress {
  /** 调用 ID（单次会话唯一） */
  callId: string
  /** 工具 ID */
  toolId: string
  /** 阶段 */
  phase: 'start' | 'executing' | 'success' | 'failed' | 'awaiting-approval'
  /** 工具参数（start 阶段） */
  args?: Record<string, unknown>
  /** 部分结果（executing 阶段） */
  partial?: string
  /** 最终结果（success/failed 阶段） */
  result?: ToolCallResult
  /** 风险等级（awaiting-approval 阶段） */
  risk?: ToolRiskLevel
  /** 时间戳 */
  timestamp: number
}

/** 工具调用审批请求（主 → 渲染） */
export interface ToolApprovalRequest {
  /** 调用 ID */
  callId: string
  /** 工具 ID */
  toolId: string
  /** 工具参数 */
  args: Record<string, unknown>
  /** 风险等级 */
  risk: ToolRiskLevel
  /** 风险描述（中文） */
  riskReason: string
  /** 提示给用户的命令预览（仅 ssh_exec 用） */
  commandPreview?: string
}

/** 工具调用审批响应（渲染 → 主） */
export interface ToolApprovalResponse {
  /** 调用 ID */
  callId: string
  /** 是否批准 */
  approved: boolean
  /** 拒绝原因（可选） */
  reason?: string
}

/** 5 个工具的 ID 常量（避免拼写错误） */
export const TOOL_IDS = {
  SSH_EXEC: 'ssh_exec',
  TUTORIAL_SEARCH: 'tutorial_search',
  DEPLOY_LIST: 'deploy_list_templates',
  PROFILER_RUN: 'profiler_run',
  MONITOR_GET: 'monitor_get_data',
} as const

export type ToolId = (typeof TOOL_IDS)[keyof typeof TOOL_IDS]

/**
 * 工具定义（Vercel AI SDK 4 tool() 函数格式 + 我们的 execute 包装）
 *
 * 单一来源：被 services/llm/tools/registry.ts 和 services/mcp/tools/registry.ts 共同复用
 */
import type { z } from 'zod'

export interface ToolDefinition {
  /** 工具名（与 Vercel AI SDK tool name 一致，也是 LLM 调用的 key） */
  name: string
  /** 工具描述（LLM 决定何时调用） */
  description: string
  /** 参数 schema（Zod） */
  parameters: z.ZodTypeAny
  /**
   * 执行函数
   * 约定：返回 ToolCallResult（成功或失败均返回，不抛异常）
   * 异常应被工具内部 catch 后转为 success=false 的 ToolCallResult
   */
  execute: (args: unknown) => Promise<unknown>
}
