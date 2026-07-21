/**
 * MCP 生命周期状态机 IPC Handlers（v0.9.5 P0）
 *
 * 暴露 2 个 invoke + 1 个推送通道：
 * - 'mcp:get-state'   → 获取当前状态（invoke）
 * - 'mcp:reset'       → 重置状态机（invoke）
 * - 'mcp:state-changed' → 状态变更推送（mainWindow.webContents.send）
 *
 * v0.9.6 新增外部 MCP Server（Client 侧）IPC：
 * - 'mcp:external-status'     → 获取所有外部服务器状态
 * - 'mcp:external-tools'      → 列出所有外部工具
 * - 'mcp:external-call'       → 调用外部工具
 * - 'mcp:external-reconnect'  → 重连外部服务器
 *
 * 借鉴来源：instructkr/claw-code §3.3 McpLifecycleHardened
 */

import { ipcMain, BrowserWindow } from 'electron'
import { MCP } from '@shared/ipc-channels'
import { McpGateway } from '../core/agent/mcp-gateway'
import { logger } from '../services/log/logger'

/** 状态变更通道 */
const MCP_STATE_CHANNEL = 'mcp:state-changed'

/**
 * 注册 MCP 状态机 IPC handlers
 *
 * 同时订阅 McpGateway 的状态变更，推送到渲染层。
 *
 * @param mainWindow 主窗口实例
 */
export function registerMcpStateHandlers(mainWindow: BrowserWindow): void {
  const gateway = McpGateway.getInstance()

  // ------------------------------------------------------------------
  // mcp:get-state — 获取当前状态
  // ------------------------------------------------------------------
  ipcMain.handle('mcp:get-state', () => {
    return gateway.getLifecycleState()
  })

  // ------------------------------------------------------------------
  // mcp:reset — 重置状态机
  // ------------------------------------------------------------------
  ipcMain.handle('mcp:reset', () => {
    logger.info('IPC.MCP', '用户重置 MCP 状态机')
    gateway.resetLifecycle()
    return true
  })

  // ------------------------------------------------------------------
  // 订阅状态变更 → 推送到渲染层
  // ------------------------------------------------------------------
  gateway.subscribeLifecycle((state, ctx) => {
    if (!mainWindow.isDestroyed()) {
      // McpStateContext 序列化为普通对象（避免类型问题）
      mainWindow.webContents.send(MCP_STATE_CHANNEL, { ...ctx })
      logger.info('IPC.MCP', `状态变更推送：${state}`, { ...ctx })
    }
  })

  // ==================================================================
  // 外部 MCP Server（Client 侧）IPC handlers
  // ==================================================================

  // ------------------------------------------------------------------
  // mcp:external-status — 获取所有外部服务器状态
  // ------------------------------------------------------------------
  ipcMain.handle('mcp:external-status', () => {
    return gateway.getExternalServerStatuses()
  })

  // ------------------------------------------------------------------
  // mcp:external-tools — 列出所有外部工具
  // ------------------------------------------------------------------
  ipcMain.handle('mcp:external-tools', async () => {
    return gateway.listAllExternalTools()
  })

  // ------------------------------------------------------------------
  // mcp:external-call — 调用外部工具
  // ------------------------------------------------------------------
  ipcMain.handle(
    'mcp:external-call',
    async (
      _event,
      serverId: string,
      toolName: string,
      args: Record<string, unknown>
    ) => {
      logger.info('IPC.MCP', `调用外部工具`, { serverId, toolName })
      return gateway.callExternalTool(serverId, toolName, args)
    }
  )

  // ------------------------------------------------------------------
  // mcp:external-reconnect — 重连外部服务器
  // ------------------------------------------------------------------
  ipcMain.handle(MCP.EXTERNAL_RECONNECT, async (_event, serverId: string) => {
    logger.info('IPC.MCP', `重连外部服务器: ${serverId}`)
    await gateway.reconnectExternalServer(serverId)
    return true
  })
}
