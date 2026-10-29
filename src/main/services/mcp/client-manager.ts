/**
 * MCP Client Manager — 外部 MCP Server 连接管理器
 *
 * 职责：
 * - 管理 Agent 作为 MCP Client 到外部 MCP Server 的连接（如 Claude Code、Cursor 的工具）
 * - 使用 @modelcontextprotocol/sdk 的 Client + StdioClientTransport
 * - 配置驱动：启动时由 main/index.ts 把 ConfigStore.getMcpConfig().externalServers 注册进来
 *   （没有这一步时这张表永远是空的，mcp:external-* 只会回 []）
 * - 连接池管理：按需连接，超时控制
 *
 * 方案书依据：v0.9 §3.1（MCP 双向网关）— Agent 也可以调用外部 MCP Server
 *
 * 架构：
 * ```
 * 渲染层 mcpExternalCall() → IPC 'mcp:external-call'
 *       → McpGateway.callExternalTool()（这里上报生命周期状态）
 *       → McpClientManager.callTool(serverId, toolName, args)
 *       → Client.callTool() via StdioClientTransport
 *       → 外部 MCP Server（Claude Code / Cursor / 自定义）
 * ```
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { buildExternalChildEnv } from './child-env'
import { logger } from '../../services/log/logger'
/**
 * 一次工具调用的返回形状（MCP CallToolResult 里我们用到的那部分）。
 * 原先住在已撤掉的入站服务注册表里；客户端这条活路自己带着它需要的最小形状。
 */
export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

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
  /** 缓存的工具列表（连接成功后刷新；inputSchema 由对面那个程序自报） */
  cachedTools: Array<{ name: string; description: string; inputSchema?: unknown }>
  /**
   * 正在进行中的那一次连接。并发进来的调用者等同一个 promise，
   * 而不是各自起一次连接、或让后到的那个读到"还没连上"当场失败。
   */
  inflight: Promise<void> | null
}

/** 默认连接超时 30s */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 只看"会不会改变那条连接"的字段
 *
 * 登记面每次添加一台都会把整份列表重推一遍（启动时也推一次）。以前这一推会把
 * 已经连上的服务器连上下文一起换掉：状态踢回 disconnected、工具缓存清零，
 * 而旧的那个 stdio 子进程没人 close —— 界面上看着正常，后台多留一个孤儿进程。
 * 名字这类不参与建连的字段另算，见 registerServer。
 */
function connectionKey(s: ExternalMcpServer): string {
  return JSON.stringify([
    s.transport,
    s.command ?? null,
    s.args ?? [],
    s.cwd ?? null,
    s.url ?? null,
    s.envKeys ?? [],
    s.enabled,
    s.timeoutMs ?? null,
  ])
}

/**
 * 给一个 promise 加上限（到点拆掉定时器，绝不让它继续把事件循环占着）。
 * 超时抛错，由调用方按各自的失败路径处理。
 */
async function raceTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rejectFn) => {
        timer = setTimeout(() => rejectFn(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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
    const existing = this.servers.get(config.id)
    if (existing) {
      if (connectionKey(existing.config) === connectionKey(config)) {
        // 同一份连接配置再推一遍（添加别的服务器、或重启时都会这样）：
        // 保住此刻的连接与工具缓存，只把显示字段换新的。整条换掉会踢掉活连接，
        // 并把旧那个 stdio 子进程留在后台没人收。
        existing.config = config
        return
      }
      logger.info('MCP.CLIENT', `服务器 ${config.id} 配置变了，先断开旧连接`, { name: config.name })
      void this.disconnect(existing)
    }
    this.servers.set(config.id, {
      config,
      client: null,
      transport: null,
      state: 'disconnected',
      cachedTools: [],
      inflight: null,
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
   *
   * 失败一律带 isError:true。以前这几条失败路只把错误写进 text、不带标记，
   * 于是 gateway 那句 success: true 会把"未注册/连不上"一路报成调用成功。
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolResult> {
    const ctx = this.servers.get(serverId)
    if (!ctx) {
      return {
        content: [
          { type: 'text', text: `外部 MCP Server "${serverId}" 未注册` },
        ],
        isError: true,
      }
    }

    if (!ctx.config.enabled) {
      return {
        content: [
          { type: 'text', text: `外部 MCP Server "${ctx.config.name}" 已禁用` },
        ],
        isError: true,
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
        isError: true,
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

      // MCP SDK callTool 返回联合类型（CallToolResult | CompatibilityCallToolResult）
      // CompatibilityCallToolResult 分支无显式 content 字段，用类型断言到具体形状避免 any
      const rawContent = (result as { content?: Array<Record<string, unknown>> }).content
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
        isError: true,
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
   * 此刻已连上的外部工具（同步读缓存，不触发连接）
   *
   * 给 AI 侧挂载用：每轮对话都去 listTools 一遍会替每台没连上的服务器起一个子进程，
   * "问一句天气"就把用户的机器点满第三方程序。连没连上是设置页那三张卡决定的状态，
   * 没连上的服务器在这里就是不存在——界面上状态列写的也是同一件事。
   */
  getConnectedTools(): Array<{
    serverId: string
    serverName: string
    name: string
    description: string
    inputSchema?: unknown
  }> {
    const out: Array<{
      serverId: string
      serverName: string
      name: string
      description: string
      inputSchema?: unknown
    }> = []
    for (const [serverId, ctx] of this.servers) {
      if (!ctx.config.enabled || ctx.state !== 'connected') continue
      for (const t of ctx.cachedTools) {
        out.push({
          serverId,
          serverName: ctx.config.name,
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })
      }
    }
    return out
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
   * 建立到外部 MCP Server 的连接（同一台同时只有一次真在跑）
   *
   * 旧写法在 state==='connecting' 时直接 return，调用方紧接着读状态读到的是
   * "还没连上"，于是报"无法连接：未知错误"——而 100 毫秒后那次连接其实成了。
   * 真机 e2e 就是这么红的：读工具列表与第一次调用几乎同时落到刚登记的那台。
   * 现在后来者等同一次连接的结果，不各起一次、也不假报失败。
   */
  private connect(ctx: ServerContext): Promise<void> {
    if (ctx.inflight) {
      logger.info('MCP.CLIENT', `服务器 ${ctx.config.id} 正在连接中，等那一次的结果`)
      return ctx.inflight
    }
    const run = this.doConnect(ctx).finally(() => {
      ctx.inflight = null
    })
    ctx.inflight = run
    return run
  }

  /** 真正执行一次连接（只由 connect() 调用，保证同一台串行） */
  private async doConnect(ctx: ServerContext): Promise<void> {
    ctx.state = 'connecting'
    ctx.error = undefined
    let timer: NodeJS.Timeout | undefined

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
        // 只给"SDK 认为可安全继承的那批 + 用户点名的键"。
        // 旧写法在这里摊开整个 process.env，等于把本机所有环境变量交给第三方程序。
        env: buildExternalChildEnv(ctx.config.envKeys),
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

      // 连接（带超时）。定时器必须在 race 结束后立刻拆掉：不拆的话这条 30s 的
      // 定时器会让事件循环一直有活干，而放弃连接的那条 Promise 之后仍可能成——
      // SDK 在 connect() 第一行就把 transport 挂上了，所以靠 client.close() 才能
      // 把已经拉起的 stdio 子进程带走（Protocol.close → transport.close → kill）。
      const timeout = new Promise<never>((_, rejectFn) => {
        timer = setTimeout(() => rejectFn(new Error(`连接超时 (${timeoutMs}ms)`)), timeoutMs)
      })
      try {
        await Promise.race([ctx.client.connect(ctx.transport), timeout])
      } finally {
        if (timer) clearTimeout(timer)
      }

      ctx.state = 'connected'
      ctx.lastConnectedAt = Date.now()

      // 获取工具列表并缓存。这一趟也要有上限：连接已经成了，listTools 却可能永远不返回，
      // 而它挂在 inflight 上——不设限就等于断开与退出都要一直等它（disconnect 会 await 它）。
      try {
        const toolsResult = await raceTimeout(
          ctx.client.listTools(),
          timeoutMs,
          `获取工具列表超时 (${timeoutMs}ms)`
        )
        ctx.cachedTools = (toolsResult.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description ?? '',
          // 参数表由对面那个程序自报；AI 侧挂载要按它给模型看，不能自己编一个
          inputSchema: t.inputSchema,
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

      // 超时放弃时 connect() 那条 Promise 还挂着，SDK 早把 transport 绑在 client 上，
      // 它后来真能连上并把 stdio 子进程留在后台。不等它：先尽力 close，
      // 让 Protocol.close → transport.close 把可能已经拉起的子进程带走。
      const abandoned = ctx.client
      ctx.client = null
      ctx.transport = null
      if (abandoned) {
        void Promise.resolve(abandoned.close()).catch(() => {
          /* 关不上就留给进程退出时收拾，这里已经没有更多信息可用 */
        })
      }

      logger.error('MCP.CLIENT', `连接外部服务器失败: ${ctx.config.name}`, {
        reason,
      })
    }
  }

  /**
   * 断开单个服务器连接
   */
  private async disconnect(ctx: ServerContext): Promise<void> {
    // 那次连接还在跑的时候先等它收个尾（connect 自己有 30s 上限，不会无限等）：
    // 不然这里把 client 清空、那边随后仍会把它写成 connected，而那个 stdio 子进程再没人 close。
    if (ctx.inflight) await ctx.inflight.catch(() => undefined)
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
