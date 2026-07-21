/**
 * MCP Client Manager — 外部 MCP Server 连接管理器
 *
 * 职责：
 * - 管理 Agent 作为 MCP Client 到外部 MCP Server 的连接（如 Claude Code、Cursor 的工具）
 * - 使用 @modelcontextprotocol/sdk 的 Client + StdioClientTransport
 * - 配置驱动：从 ConfigStore 读取外部服务器列表
 * - 连接池管理：按需连接，自动重连，超时控制
 *
 * 方案书依据：v0.9 §3.1（MCP 双向网关）— Agent 也可以调用外部 MCP Server
 *
 * 架构：
 * ```
 * Agent → McpGateway.callExternalTool()
 *       → McpClientManager.callTool(serverId, toolName, args)
 *       → Client.callTool() via StdioClientTransport
 *       → 外部 MCP Server（Claude Code / Cursor / 自定义）
 * ```
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { logger } from '../../services/log/logger'
import type {
  ExternalMcpServer,
  ExternalMcpConnectionState,
  ExternalMcpServerStatus,
} from '@shared/models'

/** 单个外部服务器的运行时上下文 */
interface ServerContext {
  config: ExternalMcpServer
  client: Client | null
  transport: StdioClientTransport | null
  state: ExternalMcpConnectionState
  error?: string
  lastConnectedAt?: number
  /** 缓存的工具列表（连接成功后刷新） */
  cachedTools: Array<{ name: string; description: string }>
}

/** 默认连接超时 30s */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * MCP Client Manager（单例）
 *
 * 管理多个外部 MCP Server 的连接生命周期。
 */
export class McpClientManager {
  private static instance: McpClientManager | null = null
  private servers: Map<string, ServerContext> = new Map()

  private constructor() {}

  static getInstance(): McpClientManager {
    if (!this.instance) {
      this.instance = new McpClientManager()
    }
    return this.instance
  }

  /**
   * 注册外部 MCP Server 配置
   *
   * 不立即连接，仅注册配置。首次 callTool 时按需连接。
   */
  registerServer(config: ExternalMcpServer): void {
    if (this.servers.has(config.id)) {
      logger.warn('MCP.CLIENT', `服务器 ${config.id} 已注册，覆盖配置`, {
        name: config.name,
      })
    }
    this.servers.set(config.id, {
      config,
      client: null,
      transport: null,
      state: 'disconnected',
      cachedTools: [],
    })
    logger.info('MCP.CLIENT', `注册外部服务器`, {
      id: config.id,
      name: config.name,
      transport: config.transport,
    })
  }

  /**
   * 批量注册（从 ConfigStore 加载）
   */
  registerServers(configs: ExternalMcpServer[]): void {
    for (const cfg of configs) {
      if (cfg.enabled) {
        this.registerServer(cfg)
      }
    }
  }

  /**
   * 移除外部服务器（断开连接并删除配置）
   */
  async removeServer(serverId: string): Promise<void> {
    const ctx = this.servers.get(serverId)
    if (!ctx) return
    await this.disconnect(ctx)
    this.servers.delete(serverId)
    logger.info('MCP.CLIENT', `移除外部服务器 ${serverId}`)
  }

  /**
   * 调用外部 MCP Server 的工具
   *
   * 流程：
   * 1. 查找服务器上下文
   * 2. 若未连接，自动建立连接
   * 3. 调用 Client.callTool()
   * 4. 返回结果
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const ctx = this.servers.get(serverId)
    if (!ctx) {
      return {
        content: [
          { type: 'text', text: `外部 MCP Server "${serverId}" 未注册` },
        ],
      }
    }

    if (!ctx.config.enabled) {
      return {
        content: [
          { type: 'text', text: `外部 MCP Server "${ctx.config.name}" 已禁用` },
        ],
      }
    }

    // 确保连接
    if (ctx.state !== 'connected') {
      await this.connect(ctx)
    }

    if (!ctx.client || ctx.state !== 'connected') {
      return {
        content: [
          {
            type: 'text',
            text: `无法连接到外部 MCP Server "${ctx.config.name}": ${ctx.error || '未知错误'}`,
          },
        ],
      }
    }

    // 调用工具
    try {
      logger.info('MCP.CLIENT', `调用外部工具`, {
        serverId,
        toolName,
        server: ctx.config.name,
      })

      const result = await ctx.client.callTool({
        name: toolName,
        arguments: args,
      })

      // MCP SDK callTool 返回 CallToolResult（content 类型为 ContentBlock[]）
      const rawContent = (result as any).content as Array<Record<string, unknown>> | undefined
      const content =
        rawContent?.map((item) => {
          if (item.type === 'text') {
            return { type: 'text' as const, text: item.text as string }
          }
          // 非文本内容转为文本
          return { type: 'text' as const, text: JSON.stringify(item) }
        }) ?? [{ type: 'text' as const, text: JSON.stringify(result) }]

      return { content }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logger.error('MCP.CLIENT', `外部工具调用失败`, {
        serverId,
        toolName,
        reason,
      })
      return {
        content: [
          {
            type: 'text',
            text: `外部工具 "${toolName}" 调用失败: ${reason}`,
          },
        ],
      }
    }
  }

  /**
   * 列出指定外部服务器的可用工具
   *
   * 若未连接则先建立连接获取工具列表。
   */
  async listTools(
    serverId: string
  ): Promise<Array<{ name: string; description: string }>> {
    const ctx = this.servers.get(serverId)
    if (!ctx) return []
    if (!ctx.config.enabled) return []

    if (ctx.state !== 'connected') {
      await this.connect(ctx)
    }

    return ctx.cachedTools
  }

  /**
   * 列出所有外部服务器的工具（带 serverId 前缀）
   *
   * 用于 Agent 工具选择时展示所有可用的外部工具。
   */
  async listAllExternalTools(): Promise<
    Array<{ name: string; description: string; serverId: string; serverName: string }>
  > {
    const tools: Array<{
      name: string
      description: string
      serverId: string
      serverName: string
    }> = []

    for (const [serverId, ctx] of this.servers) {
      if (!ctx.config.enabled) continue
      const serverTools = await this.listTools(serverId)
      for (const t of serverTools) {
        tools.push({
          name: t.name,
          description: t.description,
          serverId,
          serverName: ctx.config.name,
        })
      }
    }

    return tools
  }

  /**
   * 获取所有外部服务器的状态快照
   */
  getStatuses(): ExternalMcpServerStatus[] {
    const statuses: ExternalMcpServerStatus[] = []
    for (const [id, ctx] of this.servers) {
      statuses.push({
        id,
        name: ctx.config.name,
        connectionState: ctx.state,
        toolCount: ctx.cachedTools.length,
        error: ctx.error,
        lastConnectedAt: ctx.lastConnectedAt,
      })
    }
    return statuses
  }

  /**
   * 获取指定服务器状态
   */
  getServerStatus(serverId: string): ExternalMcpServerStatus | null {
    const ctx = this.servers.get(serverId)
    if (!ctx) return null
    return {
      id: ctx.config.id,
      name: ctx.config.name,
      connectionState: ctx.state,
      toolCount: ctx.cachedTools.length,
      error: ctx.error,
      lastConnectedAt: ctx.lastConnectedAt,
    }
  }

  /**
   * 断开所有外部服务器连接
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [, ctx] of this.servers) {
      promises.push(this.disconnect(ctx))
    }
    await Promise.allSettled(promises)
    logger.info('MCP.CLIENT', '所有外部服务器已断开')
  }

  /**
   * 手动重连指定服务器
   */
  async reconnect(serverId: string): Promise<void> {
    const ctx = this.servers.get(serverId)
    if (!ctx) return
    await this.disconnect(ctx)
    await this.connect(ctx)
  }

  // ========== 私有方法 ==========

  /**
   * 建立到外部 MCP Server 的连接
   */
  private async connect(ctx: ServerContext): Promise<void> {
    if (ctx.state === 'connecting') {
      logger.warn('MCP.CLIENT', `服务器 ${ctx.config.id} 正在连接中，跳过`)
      return
    }

    ctx.state = 'connecting'
    ctx.error = undefined

    try {
      if (ctx.config.transport !== 'stdio') {
        // 目前只支持 stdio 传输
        ctx.state = 'error'
        ctx.error = `不支持的传输协议: ${ctx.config.transport}（当前仅支持 stdio）`
        logger.error('MCP.CLIENT', ctx.error)
        return
      }

      if (!ctx.config.command) {
        ctx.state = 'error'
        ctx.error = 'stdio 模式需要指定 command'
        logger.error('MCP.CLIENT', ctx.error)
        return
      }

      const timeoutMs = ctx.config.timeoutMs ?? DEFAULT_TIMEOUT_MS

      logger.info('MCP.CLIENT', `连接外部服务器: ${ctx.config.name}`, {
        command: ctx.config.command,
        args: ctx.config.args,
        timeoutMs,
      })

      // 创建 StdioClientTransport
      ctx.transport = new StdioClientTransport({
        command: ctx.config.command,
        args: ctx.config.args ?? [],
        env: ctx.config.env
          ? { ...process.env, ...ctx.config.env } as Record<string, string>
          : undefined,
        cwd: ctx.config.cwd,
      })

      // 创建 Client
      ctx.client = new Client(
        {
          name: 'tdsf-agent',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      )

      // 连接（带超时）
      await Promise.race([
        ctx.client.connect(ctx.transport),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`连接超时 (${timeoutMs}ms)`)),
            timeoutMs
          )
        ),
      ])

      ctx.state = 'connected'
      ctx.lastConnectedAt = Date.now()

      // 获取工具列表并缓存
      try {
        const toolsResult = await ctx.client.listTools()
        ctx.cachedTools = (toolsResult.tools ?? []).map((t: any) => ({
          name: t.name,
          description: t.description ?? '',
        }))
        logger.info('MCP.CLIENT', `连接成功: ${ctx.config.name}`, {
          toolCount: ctx.cachedTools.length,
        })
      } catch (toolErr) {
        // 连接成功但获取工具失败，仍标记为 connected
        logger.warn('MCP.CLIENT', `获取工具列表失败`, {
          server: ctx.config.name,
          error: toolErr instanceof Error ? toolErr.message : String(toolErr),
        })
        ctx.cachedTools = []
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      ctx.state = 'error'
      ctx.error = reason
      ctx.client = null
      ctx.transport = null

      logger.error('MCP.CLIENT', `连接外部服务器失败: ${ctx.config.name}`, {
        reason,
      })
    }
  }

  /**
   * 断开单个服务器连接
   */
  private async disconnect(ctx: ServerContext): Promise<void> {
    if (ctx.client) {
      try {
        await ctx.client.close()
      } catch {
        // 忽略关闭错误
      }
      ctx.client = null
    }
    ctx.transport = null
    ctx.state = 'disconnected'
    ctx.cachedTools = []
  }
}
