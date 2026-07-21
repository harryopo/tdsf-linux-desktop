/**
 * MCP Server 服务
 *
 * 职责：
 * - 启动 MCP Server（端口 3107）
 * - 暴露 TDSF 能力（SSH 执行、AI 诊断、知识库查询、风险评估、历史决策）给 Claude Code/Cursor 等 MCP Client
 * - 通过 stdio JSON-RPC 与 Client 通信
 *
 * 调研依据：07-开源项目调研-AIAgent生态.md Top5（8.6分）
 * 价值：让 Claude Code/Cursor 调用 TDSF（评委爽点 5）
 *
 * ⚠️ 注意：本服务是可选的，仅在 MCP_SERVER_ENABLED=true 时启动
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { assessRisk } from '../../core/risk-engine'
import { AgentWorkflow } from '../../core/agent-workflow'
import { DatabaseManager } from '../db/database'
import { KnowledgeRepository } from '../db/knowledge-repo'
import { DecisionRepository } from '../db/decision-repo'
import { createMcpTools } from './tools/registry'
import type { Evidence, KnowledgeType } from '@shared/models'
import { TOOL_IDS } from '@shared/llm-tool-types'
import { z } from 'zod'

/** MCP Server 配置 */
export interface McpServerConfig {
  /** 是否启用 */
  enabled: boolean
  /** 端口（仅用于日志展示） */
  port: number
}

/** MCP 服务（单例） */
export class McpServerService {
  private static instance: McpServerService | null = null
  private server: Server | null = null
  private running = false
  private config: McpServerConfig

  private constructor(config: McpServerConfig) {
    this.config = config
  }

  /** 获取单例 */
  static getInstance(config?: McpServerConfig): McpServerService {
    if (!this.instance) {
      this.instance = new McpServerService(config ?? { enabled: false, port: 3107 })
    }
    return this.instance
  }

  /**
   * 启动 MCP Server
   *
   * 启动后通过 stdio 监听 MCP Client（Claude Code/Cursor）的请求
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[MCP] 未启用（设置 MCP_SERVER_ENABLED=true 启用）')
      return
    }

    if (this.running) {
      console.log('[MCP] 已在运行中')
      return
    }

    try {
      this.server = new Server(
        {
          name: 'tdsf-mcp-server',
          version: '0.4.0'
        },
        {
          capabilities: {
            tools: {}
          }
        }
      )

      // v0.5.0 注册新 5 工具（推荐用法，与 LLM Tool Calling 共用业务逻辑）
      const v5Tools = createMcpTools(DatabaseManager.getInstance() ?? null)

      // 注册工具列表
      this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          // 注：ssh_exec 由 v0.5.0 注册表统一提供（schema 含 sessionId/timeout/risk），
          // legacy 版本已移除避免重名重复注册。
          {
            name: 'ssh_diagnose',
            description: '使用 TDSF Agent 诊断服务器故障（7 步 HITL 工作流）',
            inputSchema: {
              type: 'object',
              properties: {
                connId: { type: 'string', description: 'SSH 会话 ID' },
                problem: { type: 'string', description: '故障描述' }
              },
              required: ['connId', 'problem']
            }
          },
          {
            name: 'knowledge_query',
            description: '查询历史故障案例知识库',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '查询关键词（必填）' },
                type: {
                  type: 'string',
                  enum: ['command_skill', 'incident_case'],
                  description: '知识类型过滤（可选）'
                },
                limit: { type: 'number', description: '返回数量上限（默认5，最大50）' }
              },
              required: ['query']
            }
          },
          {
            name: 'risk_check',
            description: '评估 Linux 命令的风险等级',
            inputSchema: {
              type: 'object',
              properties: {
                command: { type: 'string', description: '要评估的 Linux 命令' }
              },
              required: ['command']
            }
          },
          {
            name: 'history_search',
            description: '搜索历史决策卡片（按问题/假设/修复命令）',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '搜索关键词（必填）' },
                limit: { type: 'number', description: '返回数量上限（默认10，最大50）' }
              },
              required: ['query']
            }
          },
          // v0.5.0 新增 5 工具（与 LLM Tool Calling 复用）
          ...v5Tools.map((t) => ({ name: t.meta.name, description: t.meta.description, inputSchema: t.meta.inputSchema })),
        ]
      }))

      // 注册工具调用
      this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        return await this.handleToolCall(request.params.name, request.params.arguments ?? {})
      })

      // 启动 stdio 传输
      const transport = new StdioServerTransport()
      await this.server.connect(transport)
      this.running = true
      console.log(`[MCP] Server 已启动（端口 ${this.config.port} 仅显示，stdio 通信）`)
    } catch (err) {
      console.error('[MCP] 启动失败:', err)
      this.server = null
      this.running = false
    }
  }

  /**
   * 停止 MCP Server
   */
  async stop(): Promise<void> {
    if (this.server) {
      try {
        await this.server.close()
      } catch {
        // 忽略关闭错误
      }
    }
    this.server = null
    this.running = false
    console.log('[MCP] Server 已停止')
  }

  /**
   * 是否在运行
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * 公开工具调用入口（供 McpGateway 内部调用）
   *
   * 委托给 handleToolCall()，无需 MCP Client 连接即可调用。
   */
  async invokeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    return this.handleToolCall(name, args)
  }

  /**
   * 列出所有已注册工具（供 McpGateway 动态获取）
   *
   * 合并 legacy 独有 4 工具 + v0.5.0 注册表 5 工具，共 9 个（去重后）。
   * ssh_exec 仅由 v5 注册表提供；tutorial_search 需 db 可用时才注册。
   */
  listRegisteredTools(): Array<{ name: string; description: string }> {
    // ssh_exec 由 v5 注册表统一提供，legacy 列表不再重复列举
    const legacyTools = [
      { name: 'ssh_diagnose', description: '使用 TDSF Agent 诊断服务器故障（7 步 HITL 工作流）' },
      { name: 'knowledge_query', description: '查询历史故障案例知识库' },
      { name: 'risk_check', description: '评估 Linux 命令的风险等级' },
      { name: 'history_search', description: '搜索历史决策卡片（按问题/假设/修复命令）' },
    ]
    const v5Tools = createMcpTools(DatabaseManager.getInstance() ?? null)
    const v5Meta = v5Tools.map((t) => ({
      name: t.meta.name,
      description: t.meta.description,
    }))
    return [...legacyTools, ...v5Meta]
  }

  /**
   * 工具调用分发
   */
  private async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      // ── v0.5.0 注册表工具优先分发（单一来源，与 LLM Tool Calling 共用业务逻辑）──
      // 修复：此前 handleToolCall 只分发 5 个 legacy 工具，导致注册表中的
      // tutorial_search / deploy_list_templates / profiler_run / monitor_get_data
      // 以及新版 ssh_exec 全部落到"未知工具"。
      const v5Tools = createMcpTools(DatabaseManager.getInstance() ?? null)
      const v5Tool = v5Tools.find((t) => t.meta.name === name)
      if (v5Tool) {
        // ssh_exec legacy 兼容：旧外部客户端可能传 connId，自动映射为 sessionId
        let callArgs = args
        if (name === TOOL_IDS.SSH_EXEC) {
          const { connId, sessionId } = args
          if (typeof connId === 'string' && typeof sessionId !== 'string') {
            callArgs = { ...args, sessionId: connId }
          }
        }
        return await v5Tool.call(callArgs)
      }

      // ── legacy 工具（v5 注册表未覆盖的独有工具）──
      switch (name) {
        case 'ssh_diagnose': {
          const { connId, problem } = z
            .object({ connId: z.string(), problem: z.string() })
            .parse(args)
          // 调用 Agent 工作流（简化版，不等待 confirm 步骤）
          const workflow = new AgentWorkflow()
          const card = await workflow.start({
            problem,
            logs: '',
            connId
          })
          return {
            content: [
              {
                type: 'text',
                text: card ? JSON.stringify(card, null, 2) : '诊断失败'
              }
            ]
          }
        }

        case 'knowledge_query': {
          const { query, type, limit } = z
            .object({
              query: z.string(),
              type: z.enum(['command_skill', 'incident_case']).optional(),
              limit: z.number().int().min(1).max(50).optional()
            })
            .parse(args)
          const db = DatabaseManager.getInstance()
          const repo = new KnowledgeRepository(db)
          const results = repo.search(query, type as KnowledgeType | undefined, limit ?? 5)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    query,
                    count: results.length,
                    entries: results.map((e) => ({
                      id: e.id,
                      type: e.type,
                      title: e.title,
                      problem: e.problem,
                      rootCause: e.rootCause,
                      commands: e.commands,
                      rollbackCommands: e.rollbackCommands,
                      verification: e.verification,
                      keywords: e.keywords,
                      tags: e.tags,
                      successRate: e.successRate,
                      useCount: e.useCount
                    }))
                  },
                  null,
                  2
                )
              }
            ]
          }
        }

        case 'risk_check': {
          const { command } = z.object({ command: z.string() }).parse(args)
          const risk = assessRisk(command)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(risk, null, 2)
              }
            ]
          }
        }

        case 'history_search': {
          const { query, limit } = z
            .object({
              query: z.string(),
              limit: z.number().int().min(1).max(50).optional()
            })
            .parse(args)
          const db = DatabaseManager.getInstance()
          const repo = new DecisionRepository(db)
          const results = repo.search(query).slice(0, limit ?? 10)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    query,
                    count: results.length,
                    cards: results.map((c) => ({
                      id: c.id,
                      problem: c.problem,
                      hypothesis: c.hypothesis,
                      confidence: c.confidence,
                      riskLevel: c.risk.level,
                      fixCommand: c.fixCommand,
                      status: c.status,
                      timestamp: c.timestamp
                    }))
                  },
                  null,
                  2
                )
              }
            ]
          }
        }

        default:
          return {
            content: [{ type: 'text', text: `未知工具: ${name}` }]
          }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text', text: `工具调用失败: ${msg}` }]
      }
    }
  }
}
