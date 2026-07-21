/**
 * MCP 网关（MCP Gateway）
 *
 * 职责：
 * - 双向桥接 Agent 与 MCP（Model Context Protocol）
 * - 复用 v0.7 已有的 src/main/services/mcp/server.ts（暴露 TDSF 能力给外部 MCP Client）
 * - 新增：Agent 也可以作为 MCP Client 调用外部 MCP Server（如 Claude Code、Cursor 的工具）
 *
 * 当前版本（v0.9.5）：
 * - 集成 McpLifecycleManager 5 阶段状态机（借鉴 claw-code §3.3）
 * - 状态变更通过 IPC 'mcp:state' 推送给渲染层
 * - 在 backoff/failed 状态下直接拒绝调用，避免雪崩
 *
 * 方案书依据：v0.9 §3.1（MCP 双向网关）+ §11.1（mcp-gateway.ts）+ v0.9.5 §13 状态机
 */
import { logger } from '../../services/log/logger'
import { McpServerService } from '../../services/mcp/server'
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
 * MCP 工具调用请求（与 Agent Subagent 集成用）
 */
export interface McpToolCallRequest {
  /** 工具名（如 'ssh_exec' / 'knowledge_query'） */
  toolName: string
  /** 工具参数 */
  args: Record<string, unknown>
  /** 关联的会话 ID */
  sessionId?: string
}

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
   * 检查 MCP Server 是否在运行
   */
  isServerRunning(): boolean {
    return McpServerService.getInstance().isRunning()
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

  /**
   * 调用本地 MCP 工具
   *
   * v0.9.5 集成状态机：
   * - backoff/failed 状态下直接返回 blocked=true
   * - 调用结束后报告成功/失败
   */
  async callLocalTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
    const lifecycle = McpLifecycleManager.getInstance().getState()

    // 状态机闸门：backoff/failed 状态直接拒绝
    if (lifecycle.state === 'backoff') {
      logger.warn('AGENT.MCP', `MCP 在 backoff 冷却中，拒绝调用`, {
        toolName: request.toolName,
        remainingSec: lifecycle.backoffRemainingSec,
      })
      return {
        success: false,
        content: [
          {
            type: 'text',
            text: `MCP 正在冷却中（剩余 ${lifecycle.backoffRemainingSec}s），请稍候重试`,
          },
        ],
        error: 'MCP_BACKOFF',
        blocked: true,
      }
    }

    if (lifecycle.state === 'failed') {
      logger.error('AGENT.MCP', `MCP 已 failed 状态，调用被拒`, {
        toolName: request.toolName,
      })
      return {
        success: false,
        content: [
          {
            type: 'text',
            text: 'MCP 连接失败，请在 UI 中点击"重置"恢复',
          },
        ],
        error: 'MCP_FAILED',
        blocked: true,
      }
    }

    logger.info('AGENT.MCP', `MCP 工具调用`, {
      toolName: request.toolName,
      sessionId: request.sessionId,
      state: lifecycle.state,
    })

    // 实际调用逻辑：通过 McpServerService.invokeTool() 委托
    try {
      const result = await McpServerService.getInstance().invokeTool(
        request.toolName,
        request.args
      )

      // 上报成功
      McpLifecycleManager.getInstance().reportSuccess()

      return {
        success: true,
        content: result.content,
      }
    } catch (err) {
      // 上报失败
      const reason = err instanceof Error ? err.message : String(err)
      McpLifecycleManager.getInstance().reportFailure(reason)

      return {
        success: false,
        content: [
          {
            type: 'text',
            text: `MCP 工具 "${request.toolName}" 调用失败：${reason}`,
          },
        ],
        error: reason,
      }
    }
  }

  /**
   * 列出本地可用 MCP 工具（动态获取）
   *
   * 从 McpServerService 获取所有已注册工具（旧版 + v0.5.0），
   * 不再硬编码工具列表。
   */
  async listLocalTools(): Promise<Array<{ name: string; description: string }>> {
    logger.info('AGENT.MCP', `列出本地 MCP 工具`)
    return McpServerService.getInstance().listRegisteredTools()
  }

  // ==================================================================
  // 外部 MCP Server（Client 侧）— 双向网关的另一半
  // ==================================================================

  /**
   * 调用外部 MCP Server 的工具
   *
   * Agent 作为 MCP Client，调用外部 MCP Server（如 Claude Code、Cursor）的工具。
   * 委托给 McpClientManager 处理连接管理和实际调用。
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
      return {
        success: true,
        content: result.content,
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
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
