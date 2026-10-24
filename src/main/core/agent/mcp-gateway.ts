/**
 * MCP 网关（MCP Gateway）
 *
 * 职责：
 * - Agent 作为 MCP Client 调用外部 MCP Server（如 Claude Code、Cursor 的工具）
 * - 复用 v0.7 已有的 src/main/services/mcp/server.ts（把 TDSF 能力暴露给外部 MCP Client）
 * - 把外部调用的成败上报给 McpLifecycleManager，'mcp:get-state' 才有真值可读
 *
 * 当前版本（v0.9.5）：
 * - 集成 McpLifecycleManager 5 阶段状态机（借鉴 claw-code §3.3）
 * - 状态变更通过 IPC 'mcp:state-changed' 推送给渲染层
 *
 * 方案书依据：v0.9 §3.1（MCP 双向网关）+ §11.1（mcp-gateway.ts）+ v0.9.5 §13 状态机
 */
import { logger } from '../../services/log/logger'
import { McpClientManager } from '../../services/mcp/client-manager'
import {
  McpLifecycleManager,
  type McpStateContext,
  type McpLifecycleState,
} from './mcp-lifecycle'
import type {
  ExternalMcpServer,
  ExternalMcpServerStatus,
} from '@shared/models'

/**
 * MCP 工具调用结果
 */
export interface McpToolCallResult {
  /** 是否成功 */
  success: boolean
  /** 返回数据（文本内容数组，符合 MCP 协议） */
  content: Array<{ type: 'text'; text: string }>
  /** 错误信息 */
  error?: string
  /** 触发状态机失败（如 backoff 中） */
  blocked?: boolean
}

/**
 * MCP 网关
 *
 * v0.9.5 集成 5 阶段状态机：
 * - 调用前检查状态（backoff/failed 直接拒绝）
 * - 调用成功 reportSuccess
 * - 调用失败 reportFailure（自动触发状态转换）
 */
export class McpGateway {
  private static instance: McpGateway | null = null

  private constructor() {}

  static getInstance(): McpGateway {
    if (!this.instance) {
      this.instance = new McpGateway()
    }
    return this.instance
  }

  /**
   * 获取当前 MCP 生命周期状态（渲染层展示用）
   */
  getLifecycleState(): McpStateContext {
    return McpLifecycleManager.getInstance().getState()
  }

  /**
   * 重置 MCP 生命周期状态（用户手动恢复）
   */
  resetLifecycle(): void {
    McpLifecycleManager.getInstance().reset()
  }

  /**
   * 订阅 MCP 状态变更
   *
   * 用于 IPC 推送给渲染层
   */
  subscribeLifecycle(listener: (state: McpLifecycleState, ctx: McpStateContext) => void): () => void {
    return McpLifecycleManager.getInstance().subscribe(listener)
  }

  // ==================================================================
  // 外部 MCP Server（Client 侧）
  //
  // 本地那半边（Agent 直接调 TDSF 自己的 MCP 工具）不在这里：那条路是
  // McpServerService.invokeTool() / handleToolCall()，命令闸就装在派发口上（#88），
  // 网关曾经包了一层 callLocalTool() 但全仓零调用方，已删。
  // ==================================================================

  /**
   * 调用外部 MCP Server 的工具
   *
   * Agent 作为 MCP Client，调用外部 MCP Server（如 Claude Code、Cursor）的工具。
   * 委托给 McpClientManager 处理连接管理和实际调用。
   *
   * 成败都会上报给 McpLifecycleManager —— 这是这张状态机唯一的真生产者，
   * 没有它 'mcp:get-state' 只会一直回报初始的 connected（等于没测）。
   *
   * 这里刻意**不**按 backoff/failed 拦截调用：一台外部服务器抽风会把冷却期
   * 套到所有 MCP 调用上，而"重置失败计数"只能清零读数，不能证明那台机器已经修好。
   * 所以这台状态机只用于观测（设置 → 外部 MCP 那一格读的就是它），
   * 每一次外部调用真正把关的是审批卡。
   */
  async callExternalTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    const clientManager = McpClientManager.getInstance()

    logger.info('AGENT.MCP', `调用外部 MCP 工具`, {
      serverId,
      toolName,
    })

    try {
      const result = await clientManager.callTool(serverId, toolName, args)
      // clientManager 把"未注册/已禁用/连不上/调用抛错"都做成带 isError 的正常返回，
      // 不看这个标记就会一路把它们报成 success:true。
      if (result.isError) {
        const reason = result.content[0]?.text ?? '外部工具调用失败'
        McpLifecycleManager.getInstance().reportFailure(reason)
        return {
          success: false,
          content: result.content,
          error: reason,
        }
      }
      McpLifecycleManager.getInstance().reportSuccess()
      return {
        success: true,
        content: result.content,
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      McpLifecycleManager.getInstance().reportFailure(reason)
      logger.error('AGENT.MCP', `外部工具调用异常`, {
        serverId,
        toolName,
        reason,
      })
      return {
        success: false,
        content: [
          {
            type: 'text',
            text: `外部工具 "${toolName}" 调用异常：${reason}`,
          },
        ],
        error: reason,
      }
    }
  }

  /**
   * 列出指定外部服务器的可用工具
   */
  async listExternalTools(
    serverId: string
  ): Promise<Array<{ name: string; description: string }>> {
    return McpClientManager.getInstance().listTools(serverId)
  }

  /**
   * 列出所有外部服务器的所有工具（带来源标注）
   */
  async listAllExternalTools(): Promise<
    Array<{ name: string; description: string; serverId: string; serverName: string }>
  > {
    return McpClientManager.getInstance().listAllExternalTools()
  }

  /**
   * 此刻已连上的外部工具（同步，不触发连接）—— 主对话挂载外部工具的唯一取数口
   */
  getConnectedExternalTools(): Array<{
    serverId: string
    serverName: string
    name: string
    description: string
    inputSchema?: unknown
  }> {
    return McpClientManager.getInstance().getConnectedTools()
  }

  /**
   * 注册外部 MCP Server
   */
  registerExternalServer(config: ExternalMcpServer): void {
    McpClientManager.getInstance().registerServer(config)
  }

  /**
   * 批量注册外部服务器（从配置加载）
   */
  registerExternalServers(configs: ExternalMcpServer[]): void {
    McpClientManager.getInstance().registerServers(configs)
  }

  /**
   * 移除外部服务器
   */
  async removeExternalServer(serverId: string): Promise<void> {
    await McpClientManager.getInstance().removeServer(serverId)
  }

  /**
   * 获取所有外部服务器的状态
   */
  getExternalServerStatuses(): ExternalMcpServerStatus[] {
    return McpClientManager.getInstance().getStatuses()
  }

  /**
   * 手动重连外部服务器
   */
  async reconnectExternalServer(serverId: string): Promise<void> {
    await McpClientManager.getInstance().reconnect(serverId)
  }

  /**
   * 断开所有外部服务器
   */
  async disconnectAllExternalServers(): Promise<void> {
    await McpClientManager.getInstance().disconnectAll()
  }
}
