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
import { ConfigStore } from '../services/storage/config-store'
import { newExternalServerId, validateDraft } from '../services/mcp/external-server-store'

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
  // mcp:external-list / -add / -remove — 外部服务器的登记面（#173）
  // ------------------------------------------------------------------
  // 这条写入口以前不存在：mcpConfig 被 config:set 的白名单整键禁掉（那是对的，
  // 一条能被别处写入的 externalServers 等于"下次启动替你跑一个程序"），
  // 于是外部 MCP 停在"字段有、代码有、界面没有"。现在只有这个专用通道能写，
  // 入参在 external-server-store 里当场判形状，配置里也**不存**环境变量值。
  ipcMain.handle(MCP.EXTERNAL_LIST, () => ConfigStore.getMcpConfigOrDefault().externalServers ?? [])

  ipcMain.handle(MCP.EXTERNAL_ADD, (_event, draft) => {
    const cfg = ConfigStore.getMcpConfigOrDefault()
    const servers = cfg.externalServers ?? []
    const result = validateDraft(draft, servers, newExternalServerId(servers))
    if (!result.ok) throw new Error(result.error)
    const next = [...servers, result.server]
    if (!ConfigStore.saveMcpConfig({ ...cfg, externalServers: next })) {
      throw new Error('外部 MCP 配置没能写入本地存储')
    }
    // 立刻挂进连接池，不让用户以为"保存了要重启才生效"
    gateway.registerExternalServers(next)
    logger.info('IPC.MCP', `登记外部 MCP 服务器：${result.server.name}`, {
      serverId: result.server.id,
      transport: result.server.transport,
    })
    return result.server
  })

  ipcMain.handle(MCP.EXTERNAL_REMOVE, async (_event, serverId: string) => {
    const cfg = ConfigStore.getMcpConfigOrDefault()
    const servers = cfg.externalServers ?? []
    const next = servers.filter((s) => s.id !== serverId)
    if (next.length === servers.length) return false
    if (!ConfigStore.saveMcpConfig({ ...cfg, externalServers: next })) {
      throw new Error('外部 MCP 配置没能写入本地存储')
    }
    // registerServers 只增不减，删掉的那台要单独断开，否则配置没了、子进程还在跑
    await gateway.removeExternalServer(serverId)
    logger.info('IPC.MCP', `移除外部 MCP 服务器 ${serverId}`)
    return true
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
      // 审批卡上要写用户在设置页起的那个名字，不是 mcp-xxxx-yyyy 这种内部 id：
      // 让人对着一串乱码点头不叫把关。名字查不到（刚被别的窗口删掉）才退回 id。
      const serverName = ConfigStore.getMcpConfigOrDefault()
        .externalServers?.find((s) => s.id === serverId)?.name
      const approvalInput = buildExternalCallApproval(serverId, toolName, args ?? {}, serverName)
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
