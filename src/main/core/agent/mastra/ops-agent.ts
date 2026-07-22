/**
 * TDSF Ops Agent — 基于 Mastra Agent 的 Linux 运维智能体
 *
 * 这是 Mastra 框架在项目中的核心集成点。
 * 将现有的 5 个工具（ssh_exec / tutorial_search / deploy_list / profiler_run / monitor_get_data）
 * 通过 Mastra Agent 编排，提供统一的"对话式运维"入口。
 *
 * ============================================================================
 * v2.0 Phase E.3 边界声明（Mastra vs Supervisor，详见 docs/AGENT-BOUNDARY.md）
 * ============================================================================
 *
 * 【本文件：Mastra OpsAgent】— **单轮场景专用**
 *
 * 适用条件（满足全部 3 项才走 Mastra）：
 *   1. 单轮可完成：用户一次提问 + 一次工具调用 + 一次回答即可解决
 *   2. 无需多步推理：不需要 PAOR 4 阶段循环（plan/act/observe/reflect）
 *   3. 无需 HITL 审批：低风险操作（如只读查询、教程搜索）
 *
 * 典型场景：
 *   - "查看 CPU 使用率" → monitor_get_data 一次调用
 *   - "搜索 nginx 教程" → tutorial_search 一次调用
 *   - "列出部署模板" → deploy_list_templates 一次调用
 *   - MCP Server 外部调用（无状态单次请求）
 *
 * 不适用场景（应走 Supervisor）：
 *   - 复杂故障诊断（如"服务为什么变慢了"）→ 需要 PAOR 多轮迭代
 *   - 高危命令执行（如 rm -rf / shutdown）→ 需要 7 步 HITL 审批
 *   - 跨多 Subagent 协作（如 explore + coding + verify）→ 需要 Subagent 调度
 *   - 需要可信度评估 + 决策卡 + 审计报告 → 走 credibility 子系统
 *
 * 与 Supervisor 的关系：
 *   - **不互相调用**：ops-agent 不调用 supervisor，supervisor 也不调用 ops-agent
 *   - **共享工具**：两者都通过 ToolRegistry 复用 5 个核心工具
 *   - **路由由 IPC 层决定**：上层 IPC handler 根据请求复杂度选择路径
 *
 * 方案书依据：v0.9 §3（Mastra + AI SDK 7 组合）+ v2.0 Phase E.3 TD-3 边界澄清
 *
 * 详见决策树：docs/AGENT-BOUNDARY.md §决策树
 */
import { Agent } from '@mastra/core/agent'
import { createOpenAI } from '@ai-sdk/openai'
import type { LlmConfig } from '@shared/models'
import type { DatabaseManager } from '../../../services/db/database'
import { ToolRegistry } from '../../../services/llm/tools/registry'
import { TOOL_META_LIST } from '../../../services/llm/tools/registry'
import { adaptToolsToMastra } from './tool-bridge'
import { logger } from '../../../services/log/logger'

/** TDSF Ops Agent 系统提示词 */
const TDSF_OPS_INSTRUCTIONS = `你是 TDSF-Linux Desktop 的 AI 运维助手，面向 Linux 运维人员和学生学习者。

核心能力：
- ssh_exec：在远程 Linux 服务器上执行命令（需审批高危操作）
- tutorial_search：搜索 Linux 教学知识库（适合学习场景）
- monitor_get_data：获取服务器 CPU/内存/磁盘/网络监控数据
- profiler_run：运行 27 项系统性能分析
- deploy_list_templates：列出部署模板

工作原则：
1. 安全第一：高危命令（rm -rf、shutdown 等）执行前必须确认
2. 证据驱动：每条建议必须基于真实命令输出，不编造数据
3. 教学导向：解释命令含义和输出含义，帮助学生理解
4. 最小权限：只执行完成任务所需的最小命令集

回答风格：
- 简洁专业，使用中文
- 命令用代码块展示
- 关键数据加粗标注
- 异常指标给出排查建议`

/**
 * Mastra Ops Agent 配置
 */
export interface OpsAgentConfig {
  /** LLM 配置（API Key / Base URL / Model） */
  llmConfig: LlmConfig
  /** 数据库管理器（用于 tutorial_search 工具） */
  db?: DatabaseManager
}

/**
 * 创建 TDSF Ops Agent（Mastra Agent 实例）
 *
 * @param config LLM 配置 + 数据库
 * @returns Mastra Agent 实例，可直接调用 generate() / stream()
 */
export function createOpsAgent(config: OpsAgentConfig) {
  const { llmConfig, db } = config

  // 1. 构建 ToolRegistry（复用现有 5 工具）
  const registry = new ToolRegistry(db)
  const tools = registry.list()
  const metas = TOOL_META_LIST

  // 2. 适配为 Mastra 工具格式
  const mastraTools = adaptToolsToMastra(tools, metas)

  // 3. 构建 LLM model（Vercel AI SDK LanguageModel）
  const openai = createOpenAI({
    baseURL: llmConfig.baseUrl || 'https://api.openai.com/v1',
    apiKey: llmConfig.apiKey || 'placeholder',
  })
  const model = openai(llmConfig.model || 'gpt-4o')

  // 4. 创建 Mastra Agent
  const agent = new Agent({
    id: 'tdsf-ops-agent',
    name: 'TDSF 运维助手',
    instructions: TDSF_OPS_INSTRUCTIONS,
    model,
    tools: mastraTools,
  })

  logger.info('MASTRA', 'Ops Agent 创建完成', {
    toolCount: Object.keys(mastraTools).length,
    model: llmConfig.model,
  })

  return agent
}

/**
 * 使用 Mastra Ops Agent 执行单次对话
 *
 * 这是对外暴露的主要 API。supervisor 或 IPC handler 可以调用此函数
 * 来走 Mastra 路径（区别于 supervisor 的 PAOR 循环路径）。
 *
 * @param config LLM 配置
 * @param db 数据库管理器
 * @param userMessage 用户消息
 * @param history 历史消息（可选）
 * @returns Agent 响应文本
 */
export async function runOpsAgent(
  config: OpsAgentConfig,
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<{
  text: string
  toolCalls: Array<{ toolName: string; args: unknown; result: unknown }>
}> {
  const agent = createOpsAgent(config)

  // 构建消息列表（Mastra Agent 要求 id + createdAt）
  const allMessages = [
    ...history.map((m, i) => ({
      id: `hist-${i}-${Date.now()}`,
      role: m.role,
      content: m.content,
      createdAt: new Date(Date.now() - (history.length - i) * 1000),
    })),
    {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: userMessage,
      createdAt: new Date(),
    },
  ]

  // 调用 Mastra Agent 的 generate 方法
  // Mastra Agent.generate() 自动处理工具调用循环
  const response = await agent.generate(allMessages)

  // 提取文本和工具调用
  const text = response?.text ?? ''
  const toolCalls: Array<{ toolName: string; args: unknown; result: unknown }> = []

  // Mastra Agent generate 返回的 response 包含 toolCalls 信息
  if (response?.toolCalls && Array.isArray(response.toolCalls)) {
    for (const tc of response.toolCalls) {
      const record = tc as { toolName?: string; args?: unknown; result?: unknown }
      toolCalls.push({
        toolName: record.toolName ?? 'unknown',
        args: record.args,
        result: record.result,
      })
    }
  }

  logger.info('MASTRA', 'Ops Agent 调用完成', {
    textLength: text.length,
    toolCallCount: toolCalls.length,
  })

  return { text, toolCalls }
}
