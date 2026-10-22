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
import { buildExternalCallApproval } from '../core/agent/mcp-approval'
import { requestApproval } from '../core/security/approval-request'
import { emitBlockTrace } from '../core/command-gate'
import { approvalTransport } from '../windows/main-window'
import { logger } from '../services/log/logger'

/** 状态变更通道 */
const MCP_STATE_CHANNEL = MCP.STATE_CHANGED

/**
 * 注册 MCP 状态机 IPC handlers
 *
 * 同时订阅 McpGateway 的状态变更，推送到渲染层。
 *
 * @param mainWindow 主窗口实例
 * @returns 卸载函数：摘掉 lifecycle 订阅（重复注册会让状态变更被推多次）
 */
export function registerMcpStateHandlers(mainWindow: BrowserWindow): () => void {
  const gateway = McpGateway.getInstance()

  // ------------------------------------------------------------------
  // mcp:get-state — 获取当前状态
  // ------------------------------------------------------------------
  ipcMain.handle(MCP.GET_STATE, () => {
    return gateway.getLifecycleState()
  })

  // ------------------------------------------------------------------
  // mcp:reset — 重置状态机
  // ------------------------------------------------------------------
  ipcMain.handle(MCP.RESET, () => {
    logger.info('IPC.MCP', '用户重置 MCP 状态机')
    gateway.resetLifecycle()
    return true
  })

  // ------------------------------------------------------------------
  // 订阅状态变更 → 推送到渲染层
  // ------------------------------------------------------------------
  const unsubscribeLifecycle = gateway.subscribeLifecycle((state, ctx) => {
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
  ipcMain.handle(MCP.EXTERNAL_STATUS, () => {
    return gateway.getExternalServerStatuses()
  })

  // ------------------------------------------------------------------
  // mcp:external-tools — 列出所有外部工具
  // ------------------------------------------------------------------
  ipcMain.handle(MCP.EXTERNAL_TOOLS, async () => {
    return gateway.listAllExternalTools()
  })

  // ------------------------------------------------------------------
  // mcp:external-call — 调用外部工具
  // ------------------------------------------------------------------
  // 每一次都要有人点头（#173 / 调研 P0-4）。
  // 为什么不套 assessToolCall：那道闸按工具名查形状表、查不到就整条拒，
  // 而第三方 MCP 的工具名不可枚举，接上去等于把所有外部工具拒死；
  // 参数是不是 shell 命令也只有对面那个服务器知道。判不了就先问人。
  ipcMain.handle(
    MCP.EXTERNAL_CALL,
    async (
      _event,
      serverId: string,
      toolName: string,
      args: Record<string, unknown>
    ) => {
      const approvalInput = buildExternalCallApproval(serverId, toolName, args ?? {})
      const approved = await requestApproval(approvalTransport(), approvalInput)
      if (!approved) {
        // 拒了要留在同一条拦截审计里：否则"拦下来了"这件事只有日志知道，
        // 设置页那张拦截记录永远是空的，用户不知道自己替 AI 挡过什么
        emitBlockTrace({
          source: '外部 MCP 工具',
          command: approvalInput.command,
          reason: `用户未批准外部 MCP 工具调用：${serverId} · ${toolName}（含超时未响应）`,
          riskLevel: 'block',
        })
        logger.warn('IPC.MCP', '外部工具调用未获批准', { serverId, toolName })
        return {
          success: false,
          content: [{ type: 'text' as const, text: '这次外部 MCP 调用没有被批准（拒绝或超时）。' }],
          error: 'not-approved',
        }
      }
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

  return unsubscribeLifecycle
}
