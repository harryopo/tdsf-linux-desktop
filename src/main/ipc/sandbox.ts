/**
 * Sandbox IPC Handlers（v0.9 新增）
 *
 * 注册 OpenHands 沙箱集成相关的 IPC 通道，桥接渲染进程与沙箱服务层。
 *
 * 通道清单（与 preload/index.ts 中的 sandbox 命名空间对应）：
 * - sandbox:detect-docker — 检测 Docker Desktop 是否安装且运行
 * - sandbox:start         — 启动 OpenHands App Server 容器
 * - sandbox:stop          — 停止 OpenHands App Server 容器
 * - sandbox:status        — 获取当前沙箱集成状态（Docker + OpenHands 健康）
 * - sandbox:create        — 创建新沙箱（启动一个隔离 Docker 容器）
 * - sandbox:list          — 列出当前用户的所有沙箱
 * - sandbox:execute       — 在指定沙箱内执行 shell 命令（HC-6 始终审批）
 * - sandbox:delete        — 删除指定沙箱（不可逆）
 *
 * 配置来源：
 * - baseUrl / port 等从 ConfigStore 读取（key: 'sandboxConfig'），
 *   未配置时使用默认值（http://localhost:3000）。
 * - 不 hardcode API URL（HC：可配置化）。
 *
 * 设计风格与现有 agent-runtime.ts / deploy.ts 一致：
 * - 错误对象统一为 { success: false, error: string }
 * - 成功对象直接返回业务数据
 * - 所有调用通过 logger 记录（HC-1 网络日志可见）
 *
 * 方案书依据：v0.9 §8（沙箱集成）+ §11.2（IPC 命名规范）
 *
 * 拆分说明（保持主文件 ≤500 行）：
 * - 审批与危险度识别 → ./sandbox-approval.ts
 * - 配置与单例管理 → ./sandbox-config.ts
 */

import { ipcMain, BrowserWindow } from 'electron'
import { SANDBOX } from '@shared/ipc-channels'
import { detectDockerDesktop, type DockerInfo } from '../services/sandbox/docker-detector'
import { OpenHandsApiError } from '../services/sandbox/openhands-client'
import type {
  SandboxCommandResult,
  SandboxHealthStatus,
  SandboxInfo,
  SandboxPage,
} from '../services/sandbox/types'
import { logger } from '../services/log/logger'
// v0.9.4 新增：session-registry 集中维护 sessionId → AbortController Map，支持 abort signal + TTL 清理
import { getSessionRegistry } from '../core/agent/session-registry'
// 审批与危险度识别（从 sandbox-approval.ts 导入，保持主文件 ≤500 行）
import {
  waitForSandboxApproval,
  cacheAndRedactSessionKey,
  sessionKeyMap,
  pendingSandboxApprovals,
} from './sandbox-approval'
// 配置与单例管理（从 sandbox-config.ts 导入，保持主文件 ≤500 行）
import {
  getRunner,
  getClient,
  toErrorString,
  type ErrorResponse,
} from './sandbox-config'

// 重新导出外部依赖的接口（保持原 sandbox.ts 公开 API 兼容）
export { warmupSessionKeyCache, resetSandboxInstances } from './sandbox-config'
// 重新导出 SandboxApprovalRequest 类型（外部 preload/renderer 各自定义了同名接口，保留兼容）
export type { SandboxApprovalRequest } from './sandbox-approval'

/**
 * 注册沙箱集成 IPC handlers
 *
 * 由 registerAllIpcHandlers 调用，在 app.whenReady 后注册一次。
 *
 * @param mainWindow 主窗口实例，用于推送审批请求到渲染进程（P-2：HC-6 强制审批）
 */
export function registerSandboxIpcHandlers(mainWindow: BrowserWindow): void {
  // ------------------------------------------------------------------
  // sandbox:approve — 用户审批响应（P-2：HC-6 强制审批）
  // ------------------------------------------------------------------
  // 参数：(callId: string, approved: boolean)
  // 返回：boolean（是否成功处理审批响应）
  ipcMain.handle(
    'sandbox:approve',
    async (_event, callId: string, approved: boolean): Promise<boolean> => {
      const pending = pendingSandboxApprovals.get(callId)
      if (!pending) {
        logger.warn('IPC.SANDBOX', 'sandbox:approve 收到未知 callId', { callId })
        return false
      }
      clearTimeout(pending.timeout)
      pendingSandboxApprovals.delete(callId)
      pending.resolve(approved)
      logger.info('IPC.SANDBOX', `sandbox:approve 用户${approved ? '批准' : '拒绝'}`, { callId })
      return true
    }
  )

  // ------------------------------------------------------------------
  // sandbox:detect-docker — 检测 Docker Desktop
  // ------------------------------------------------------------------
  ipcMain.handle(SANDBOX.DETECT_DOCKER, async (): Promise<DockerInfo> => {
    logger.info('IPC.SANDBOX', 'sandbox:detect-docker 调用')
    try {
      const info = await detectDockerDesktop()
      return info
    } catch (err) {
      logger.error('IPC.SANDBOX', 'sandbox:detect-docker 异常', {
        error: toErrorString(err),
      })
      return {
        installed: false,
        version: null,
        running: false,
        error: `检测异常：${toErrorString(err)}`,
      }
    }
  })

  // ------------------------------------------------------------------
  // sandbox:start — 启动 OpenHands App Server 容器
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sandbox:start',
    async (): Promise<{ success: true } | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:start 调用')
      try {
        const runner = getRunner()
        await runner.start()
        return { success: true }
      } catch (err) {
        logger.error('IPC.SANDBOX', 'sandbox:start 失败', {
          error: toErrorString(err),
        })
        return { success: false, error: toErrorString(err) }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:stop — 停止 OpenHands App Server 容器
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sandbox:stop',
    async (): Promise<{ success: true } | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:stop 调用')
      try {
        const runner = getRunner()
        await runner.stop()
        return { success: true }
      } catch (err) {
        logger.error('IPC.SANDBOX', 'sandbox:stop 失败', {
          error: toErrorString(err),
        })
        return { success: false, error: toErrorString(err) }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:status — 获取沙箱集成状态
  // ------------------------------------------------------------------
  // 返回：{ dockerReady, dockerVersion, openhandsRunning, error? }
  ipcMain.handle(
    'sandbox:status',
    async (): Promise<SandboxHealthStatus> => {
      logger.debug('IPC.SANDBOX', 'sandbox:status 调用')

      // 1. 检测 Docker
      const docker = await detectDockerDesktop()
      if (!docker.running) {
        return {
          dockerReady: false,
          dockerVersion: docker.version,
          openhandsRunning: false,
          error: docker.error ?? 'Docker 未运行',
        }
      }

      // 2. 检测 OpenHands App Server
      try {
        const client = getClient()
        const openhandsRunning = await client.healthCheck()
        return {
          dockerReady: true,
          dockerVersion: docker.version,
          openhandsRunning,
          error: openhandsRunning ? undefined : 'OpenHands App Server 未运行',
        }
      } catch (err) {
        return {
          dockerReady: true,
          dockerVersion: docker.version,
          openhandsRunning: false,
          error: `OpenHands 健康检查异常：${toErrorString(err)}`,
        }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:create — 创建新沙箱
  // ------------------------------------------------------------------
  // 参数：(sandboxSpecId?: string)
  // 返回：SandboxInfo | ErrorResponse
  // 注意（P-4）：返回前抹除 session_api_key（设为 null），key 缓存在主进程 Map 中
  ipcMain.handle(
    'sandbox:create',
    async (_event, sandboxSpecId?: string): Promise<SandboxInfo | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:create 调用', { sandboxSpecId })
      try {
        const client = getClient()
        const info = await client.createSandbox(sandboxSpecId)
        // P-4 句柄模式：缓存 session_api_key 到主进程，抹除返回值中的 key
        return cacheAndRedactSessionKey(info)
      } catch (err) {
        const code = err instanceof OpenHandsApiError ? err.code : undefined
        logger.error('IPC.SANDBOX', 'sandbox:create 失败', {
          error: toErrorString(err),
          code,
        })
        return { success: false, error: toErrorString(err), code }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:list — 列出当前用户的所有沙箱
  // ------------------------------------------------------------------
  // 参数：(limit?: number)
  // 返回：SandboxPage | ErrorResponse
  // 注意（P-4）：返回前抹除所有 SandboxInfo 的 session_api_key
  ipcMain.handle(
    'sandbox:list',
    async (_event, limit?: number): Promise<SandboxPage | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:list 调用', { limit })
      try {
        const client = getClient()
        const page = await client.searchSandboxes(limit ?? 100)
        // P-4 句柄模式：缓存所有 session_api_key，抹除返回值
        const redactedItems = page.items.map(cacheAndRedactSessionKey)
        return { ...page, items: redactedItems }
      } catch (err) {
        const code = err instanceof OpenHandsApiError ? err.code : undefined
        logger.error('IPC.SANDBOX', 'sandbox:list 失败', {
          error: toErrorString(err),
          code,
        })
        return { success: false, error: toErrorString(err), code }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:execute — 在沙箱内执行命令（P-2：HC-6 IPC 层强制审批）
  // ------------------------------------------------------------------
  // 参数：(sandboxId: string, command: string, sessionId?: string)
  //      - v0.9.4 新增第 3 个参数 sessionId（可选，未提供时主进程自动生成）
  //      - sessionApiKey 从主进程 sessionKeyMap 查找（P-4 句柄模式，不出主进程）
  // 返回：SandboxCommandResult | ErrorResponse
  //      - v0.9.4：ErrorResponse 携带 sessionId 字段（用于关联失败响应）
  //      - SandboxApprovalRequest 推送时携带 sessionId（UI 可显示并支持取消）
  //
  // 安全说明（P-2 修复）：
  // - HC-6 沙箱命令始终审批：本通道在 IPC 层强制 waitForSandboxApproval()
  // - 不依赖 UI 层"自觉"实现审批弹窗（避免 XSS 绕过）
  // - 命令危险度识别（low/medium/high）随审批请求推送，辅助 UI 展示
  // - 30 秒超时自动拒绝
  ipcMain.handle(
    'sandbox:execute',
    async (
      _event,
      sandboxId: string,
      command: string,
      sessionId?: string
    ): Promise<SandboxCommandResult | ErrorResponse> => {
      // v0.9.4：注册到 session-registry（如未提供 sessionId，registry 自动生成）
      // 用于追踪 sandbox:execute 会话状态，支持后续通过 sessionId 取消（如审批 pending 时主动取消）
      const registry = getSessionRegistry()
      const callId = `sbx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const resolvedSessionId = registry.register({
        sessionId,
        correlationId: callId,
        kind: 'sandbox:execute',
      })

      logger.info('IPC.SANDBOX', 'sandbox:execute 调用', {
        sandboxId,
        sessionId: resolvedSessionId,
        commandPreview: command.slice(0, 100),
      })
      try {
        if (!sandboxId || !command) {
          return {
            success: false,
            error: '参数缺失：sandboxId / command 均为必填',
            sessionId: resolvedSessionId,
          }
        }

        // P-4 句柄模式：从主进程 Map 查找 sessionApiKey
        const sessionApiKey = sessionKeyMap.get(sandboxId)
        if (!sessionApiKey) {
          logger.warn('IPC.SANDBOX', 'session_api_key 未在主进程缓存中找到', { sandboxId })
          return {
            success: false,
            error: 'session_api_key 未找到：沙箱可能已过期或主进程已重启，请重新调用 sandbox:create 或 sandbox:list 刷新缓存',
            code: 'SESSION_KEY_MISSING',
            sessionId: resolvedSessionId,
          }
        }

        // P-2 HC-6 强制审批：IPC 层推送审批请求，等待用户响应
        // v0.9.4：把 sessionId 附带在审批请求上，UI 可关联请求与响应、支持主动取消
        let approved: boolean
        try {
          approved = await waitForSandboxApproval(
            mainWindow,
            callId,
            sandboxId,
            command,
            resolvedSessionId
          )
        } catch (approvalErr) {
          // 审批超时或异常 → 拒绝执行
          logger.warn('IPC.SANDBOX', 'sandbox:execute 审批被拒绝/超时', {
            sandboxId,
            callId,
            sessionId: resolvedSessionId,
            error: (approvalErr as Error).message,
          })
          return {
            success: false,
            error: `命令执行被拒绝：${(approvalErr as Error).message}`,
            code: 'APPROVAL_DENIED',
            sessionId: resolvedSessionId,
          }
        }

        if (!approved) {
          logger.info('IPC.SANDBOX', '用户拒绝执行命令', { sandboxId, callId, sessionId: resolvedSessionId })
          return {
            success: false,
            error: '用户拒绝执行该命令',
            code: 'APPROVAL_DENIED',
            sessionId: resolvedSessionId,
          }
        }

        // 审批通过 → 执行命令
        const client = getClient()
        const result = await client.executeCommand(sandboxId, command, sessionApiKey)
        return result
      } catch (err) {
        const code = err instanceof OpenHandsApiError ? err.code : undefined
        logger.error('IPC.SANDBOX', 'sandbox:execute 失败', {
          sandboxId,
          sessionId: resolvedSessionId,
          error: toErrorString(err),
          code,
        })
        return { success: false, error: toErrorString(err), code, sessionId: resolvedSessionId }
      } finally {
        // sandbox:execute 是同步阻塞调用，结束时清理 session-registry
        registry.remove(resolvedSessionId)
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:delete — 删除沙箱（P-4：清理 session_api_key 缓存）
  // ------------------------------------------------------------------
  // 参数：(sandboxId: string)
  // 返回：{ success: true } | ErrorResponse
  ipcMain.handle(
    'sandbox:delete',
    async (_event, sandboxId: string): Promise<{ success: true } | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:delete 调用', { sandboxId })
      try {
        if (!sandboxId) {
          return { success: false, error: '参数缺失：sandboxId 为必填' }
        }
        const client = getClient()
        await client.deleteSandbox(sandboxId)
        // P-4 句柄模式：清理主进程 session_api_key 缓存
        sessionKeyMap.delete(sandboxId)
        logger.debug('IPC.SANDBOX', 'session_api_key 缓存已清理', { sandboxId })
        return { success: true }
      } catch (err) {
        const code = err instanceof OpenHandsApiError ? err.code : undefined
        logger.error('IPC.SANDBOX', 'sandbox:delete 失败', {
          sandboxId,
          error: toErrorString(err),
          code,
        })
        return { success: false, error: toErrorString(err), code }
      }
    }
  )

  logger.info('IPC.SANDBOX', 'Sandbox IPC handlers 已注册', {
    channels: [
      'sandbox:approve',
      'sandbox:approval-request',
      'sandbox:detect-docker',
      'sandbox:start',
      'sandbox:stop',
      'sandbox:status',
      'sandbox:create',
      'sandbox:list',
      'sandbox:execute',
      'sandbox:delete',
    ],
  })
}
