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
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { DatabaseManager } from '../db/database'
import { createMcpTools, type McpToolRegistration } from './tools/registry'
import { createSshMcpTools } from './tools/registry-ssh'
import { createMonitorMcpTools } from './tools/registry-monitor'
import { createLogMcpTools } from './tools/registry-log'
import { createKnowledgeMcpTools } from './tools/registry-knowledge'
import { createCredibilityMcpTools } from './tools/registry-credibility'
import { createSandboxMcpTools } from './tools/registry-sandbox'
import { handleLegacyToolCall } from './tools/legacy-handlers'
import { MCP_RESOURCES, readResource } from './resources'
import { MCP_PROMPTS, getPrompt } from './prompts'
import type { McpPromptMessage } from './prompts'
import { TOOL_IDS } from '@shared/llm-tool-types'

/** MCP Server 配置 */
export interface McpServerConfig {
  /** 是否启用 */
  enabled: boolean
  /** 端口（仅用于日志展示） */
  port: number
}

/**
 * 适配 Prompt 消息以符合 MCP 协议约束
 *
 * MCP GetPromptResultSchema.messages[].role 仅支持 'user' | 'assistant'，
 * 不支持 'system'。本函数将内部 McpPromptMessage（含 'system'）转换为
 * MCP 兼容格式：
 *
 * - 'system' 消息文本合并到第一条 'user' 消息前置（用分隔线隔开）
 * - 若没有 'user' 消息，则将 'system' 内容转为单条 'user' 消息
 * - 'user' / 'assistant' 消息原样保留
 *
 * @param messages 内部消息序列（可能含 'system' role）
 * @returns MCP 兼容的消息序列（仅含 'user' | 'assistant' role）
 */
function adaptPromptMessagesForMcp(
  messages: McpPromptMessage[]
): Array<{
  role: 'user' | 'assistant'
  content: { type: 'text'; text: string }
}> {
  const systemTexts: string[] = []
  const result: Array<{
    role: 'user' | 'assistant'
    content: { type: 'text'; text: string }
  }> = []
  let firstUserHandled = false

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemTexts.push(msg.content.text)
      continue
    }
    // 此处 msg.role 已被 TS 窄化为 'user' | 'assistant'
    if (msg.role === 'user' && !firstUserHandled && systemTexts.length > 0) {
      firstUserHandled = true
      result.push({
        role: 'user',
        content: {
          type: 'text',
          text: systemTexts.join('\n\n') + '\n\n---\n\n' + msg.content.text
        }
      })
    } else {
      result.push({ role: msg.role, content: msg.content })
    }
  }

  // 仅含 system 消息：转为单条 user 消息
  if (result.length === 0 && systemTexts.length > 0) {
    return [
      {
        role: 'user',
        content: { type: 'text', text: systemTexts.join('\n\n') }
      }
    ]
  }

  return result
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
            tools: {},
            resources: {},
            prompts: {}
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
          // v2.0 Phase F 新增 21 工具（分 6 域：SSH 5 + 监控 3 + 日志 3 + 知识 4 + 决策 3 + 沙箱 3）
          ...this.createV2Tools().map((t) => ({ name: t.meta.name, description: t.meta.description, inputSchema: t.meta.inputSchema })),
        ]
      }))

      // 注册工具调用
      this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        return await this.handleToolCall(request.params.name, request.params.arguments ?? {})
      })

      // ── Phase F.4: 注册 resources/prompts handler ────────────────────────
      // 注：resources/prompts 不修改 tools 相关逻辑，独立注册。
      this.registerResourcesHandlers()
      this.registerPromptsHandlers()

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
   * 注册 MCP Resources handler（list + read）
   *
   * - resources/list：返回 MCP_RESOURCES 清单（uri / name / description / mimeType）
   * - resources/read：根据 URI 调用 readResource() 返回文本内容
   *
   * 设计要点：
   * - readResource 失败时抛 Error，MCP SDK 会将其转为错误响应返回 Client
   * - 未知 URI 也由 readResource 抛 Error，无需在此处额外校验
   */
  private registerResourcesHandlers(): void {
    if (!this.server) {
      return
    }

    // resources/list
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: MCP_RESOURCES.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType
      }))
    }))

    // resources/read
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params
      const content = await readResource(uri)
      return {
        contents: [
          {
            uri: content.uri,
            mimeType: content.mimeType,
            text: content.text
          }
        ]
      }
    })
  }

  /**
   * 注册 MCP Prompts handler（list + get）
   *
   * - prompts/list：返回 MCP_PROMPTS 清单（name / description / arguments）
   * - prompts/get：根据 name（= prompt.id）调用 getPrompt() 返回消息序列
   *
   * ⚠️ MCP 协议约束：GetPromptResultSchema.messages[].role 仅支持 'user' | 'assistant'，
   *   不支持 'system'。因此调用 getPrompt() 后需要适配：
   *   - 将 'system' 消息文本合并到第一条 'user' 消息前置（用分隔线隔开）
   *   - 若没有 'user' 消息，则将 'system' 内容转为单条 'user' 消息
   *   - 'assistant' 消息原样保留
   */
  private registerPromptsHandlers(): void {
    if (!this.server) {
      return
    }

    // prompts/list
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: MCP_PROMPTS.map((p) => ({
        name: p.id, // MCP 协议用 name 字段作为唯一标识
        description: p.description,
        arguments: p.arguments
      }))
    }))

    // prompts/get
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      const promptArgs: Record<string, string> = args ?? {}
      const messages = await getPrompt(name, promptArgs)
      // v2.4 Phase D2：未知 prompt id 时 getPrompt 返回 null，返回空 messages 让 MCP 客户端自行处理
      if (messages === null) {
        return {
          description: undefined,
          messages: []
        }
      }
      const adapted = adaptPromptMessagesForMcp(messages)
      const promptMeta = MCP_PROMPTS.find((p) => p.id === name)
      return {
        description: promptMeta?.description,
        messages: adapted
      }
    })
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
   * 创建 v2.0 Phase F 新增的 21 个分域工具
   *
   * 分 6 域注册（按 Phase F.1-F.3 顺序）：
   * - SSH 域 5 工具：ssh_execute / ssh_file_read / ssh_file_write / ssh_file_list / ssh_file_stat
   * - 监控域 3 工具：monitor_process_list / monitor_disk_usage / monitor_network_stats
   * - 日志域 3 工具：log_tail / log_search / log_analyze
   * - 知识域 4 工具：kb_search / kb_add / kb_update / kb_list（db 不可用时跳过）
   * - 决策域 2 工具：credibility_assess / decision_history
   * - 沙箱域 3 工具：sandbox_execute / sandbox_create / sandbox_destroy
   *
   * @returns 21 个 McpToolRegistration（db 不可用时知识域会返回空，实际数量 17-21）
   */
  private createV2Tools(): McpToolRegistration[] {
    const db = DatabaseManager.getInstance() ?? null
    return [
      ...createSshMcpTools(),
      ...createMonitorMcpTools(),
      ...createLogMcpTools(),
      ...createKnowledgeMcpTools(db),
      ...createCredibilityMcpTools(db),
      ...createSandboxMcpTools(),
    ]
  }

  /**
   * 列出所有已注册工具（供 McpGateway 动态获取）
   *
   * 合并 legacy 独有 4 工具 + v0.5.0 注册表 5 工具 + v2.0 分域 21 工具，共 30 个（去重后）。
   * ssh_exec 仅由 v5 注册表提供；tutorial_search 需 db 可用时才注册；
   * v2.0 知识域 4 工具需 db 可用，沙箱域默认使用单例 client。
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
    // v2.0 Phase F 新增 21 工具（db 不可用时知识域 4 工具会缺失，其余 17 个始终可用）
    const v2Meta = this.createV2Tools().map((t) => ({
      name: t.meta.name,
      description: t.meta.description,
    }))
    return [...legacyTools, ...v5Meta, ...v2Meta]
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

      // ── v2.0 Phase F 新增分域工具分发（21 工具，按需创建）──
      // SSH/监控/日志/知识/决策/沙箱 6 域工具，与 LLM Tool Calling 解耦，
      // 直接调用各域 service（SshConnectionManager / SftpManager / LogAnalyzer /
      // KnowledgeRepository / FusionEngine / CalibrationTuner / OpenHandsClient）。
      const v2Tool = this.createV2Tools().find((t) => t.meta.name === name)
      if (v2Tool) {
        return await v2Tool.call(args)
      }

      // ── legacy 工具（v5/v2 未覆盖的独有工具，含 default 未知工具处理）──
      // 拆分到 ./tools/legacy-handlers.ts 以保证 server.ts ≤ 500 行（硬约束）
      return await handleLegacyToolCall(name, args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text', text: `工具调用失败: ${msg}` }]
      }
    }
  }
}
