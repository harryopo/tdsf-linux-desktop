/**
 * Sidecar IPC Handlers（v1.0 + v1.5 多 Sidecar 升级）
 *
 * v1.0 通道：
 * - 'sidecar:start'     → start（启动 Sidecar-A 进程）
 * - 'sidecar:stop'      → stop（停止 Sidecar-A 进程）
 * - 'sidecar:status'    → getStatus（获取当前状态）
 * - 'sidecar:health'    → health（健康检查）
 * - 'sidecar:pipeline'  → runPipeline（端到端 pipeline：日志 → Drain3 → OpenDerisk）
 *
 * v1.5 新增通道：
 * - 'sidecar:list-status'  → 列出 sidecar 状态
 * - 'sidecar:start-one'    → 启动 sidecar
 * - 'sidecar:stop-one'     → 停止 sidecar
 * - 'sidecar:health-one'   → sidecar 的健康检查
 * - 'sidecar:tool-call'    → 通用工具调用
 * - 'sidecar:parse-logs'   → 单独调 Drain3 解析（不调 OpenDerisk）
 *
 * 设计原则：
 * - 单一职责：本文件只做 IPC 通道注册，业务逻辑在 SidecarManager
 * - 错误向上抛：主进程捕获后返回 500 状态 + 错误消息给渲染进程
 * - 启动幂等：start 调用多次只启动一次（SidecarManager 内部已保证）
 * - v1.5：start/stop/health 兼容 Single/Multi 通道
 *
 * 使用场景：
 * - ChatPanel 顶部按钮"🔍 SRE 诊断" → 调用 sidecar:start → 提示用户输入日志 → 调用 sidecar:pipeline → 展示诊断结果
 * - SidecarStatusPanel 启动时 → 调用 sidecar:list-status → 展示 Sidecar 状态
 * - 用户点击 Sidecar-A 启动 → 调用 sidecar:start-one('sre')
 */

import { ipcMain } from 'electron'
import { SIDECAR } from '@shared/ipc-channels'
import {
  getSidecarManager,
  getAllSidecarStatuses,
  shutdownSidecarManager,
  SIDECAR_CONFIGS,
  type SidecarStatus,
} from '../core/sidecar/sidecar-manager'
import { logger } from '../services/log/logger'

/**
 * 注册 Sidecar IPC handlers
 *
 * 在 app.whenReady() 后、registerAllIpcHandlers 内调用。
 */
export function registerSidecarIpcHandlers(): void {
  const manager = getSidecarManager()

  // ------------------------------------------------------------------
  // sidecar:start — 启动 Sidecar-A 进程（向后兼容 v1.0）
  // ------------------------------------------------------------------
  ipcMain.handle(SIDECAR.START, async (): Promise<{ ok: boolean; status: string; error?: string }> => {
    logger.info('IPC.Sidecar', '用户请求启动 Sidecar-A')
    try {
      await manager.start()
      const status = manager.getStatus()
      return { ok: true, status: status.status }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.error('IPC.Sidecar', `Sidecar 启动失败：${error}`)
      return { ok: false, status: 'crashed', error }
    }
  })

  // ------------------------------------------------------------------
  // sidecar:stop — 停止 Sidecar 进程（向后兼容 v1.0，停止全部）
  // ------------------------------------------------------------------
  ipcMain.handle(SIDECAR.STOP, async (): Promise<{ ok: boolean }> => {
    logger.info('IPC.Sidecar', '用户请求停止所有 Sidecar')
    try {
      await shutdownSidecarManager()
      return { ok: true }
    } catch (err) {
      logger.error('IPC.Sidecar', `Sidecar 停止失败：${err}`)
      return { ok: false }
    }
  })

  // ------------------------------------------------------------------
  // sidecar:status — 获取 Sidecar-A 当前状态（向后兼容 v1.0）
  // ------------------------------------------------------------------
  ipcMain.handle(SIDECAR.STATUS, () => {
    return manager.getStatus()
  })

  // ------------------------------------------------------------------
  // sidecar:health — 主动健康检查（调用 Sidecar-A /health 端点）
  // ------------------------------------------------------------------
  ipcMain.handle(SIDECAR.HEALTH, async () => {
    try {
      return { ok: true, ...(await manager.health()) }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { ok: false, error }
    }
  })

  // ------------------------------------------------------------------
  // sidecar:pipeline — 端到端 Pipeline（v1.0 核心，v1.5 增强）
  // 日志输入 → Drain3 解析 → OpenDerisk 诊断 → JSON 回传
  // v1.5 新增：第 3 参数 llmConfig 可选，启用 LLM 增强诊断
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sidecar:pipeline',
    async (
      _event,
      logLines: string[],
      serviceName?: string,
      llmConfig?: { apiKey: string; baseUrl: string; model: string },
    ): Promise<
      | { ok: true; data: Awaited<ReturnType<typeof manager.runPipeline>> }
      | { ok: false; error: string }
    > => {
      logger.info(
        'IPC.Sidecar',
        `Pipeline 调用：${logLines.length} 行日志，服务=${serviceName ?? 'unknown'}, LLM=${llmConfig ? 'enabled' : 'disabled'}`,
      )
      try {
        const data = await manager.runPipeline(logLines, serviceName, llmConfig)
        return { ok: true, data }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        logger.error('IPC.Sidecar', `Pipeline 失败：${error}`)
        return { ok: false, error }
      }
    },
  )

  // ════════════════════════════════════════════════════════════════
  // v1.5 新增：多 Sidecar 通用 IPC 通道
  // ════════════════════════════════════════════════════════════════

  // ------------------------------------------------------------------
  // sidecar:list-status — 列出所有 sidecar 状态（A/B/C）
  // ------------------------------------------------------------------
  ipcMain.handle(SIDECAR.LIST_STATUS, async () => {
    try {
      const statuses = getAllSidecarStatuses()
      // 合并 SIDECAR_CONFIGS 中的元数据（name/port）
      const data: Record<string, { id: string; name: string; port: number; status: SidecarStatus; lastError: string | null }> = {}
      for (const [id, config] of Object.entries(SIDECAR_CONFIGS).filter(([k]) => k === 'sre')) {
        const s = statuses[id] ?? { status: 'stopped' as SidecarStatus, lastError: null }
        data[id] = {
          id,
          name: config.name,
          port: config.port,
          status: s.status,
          lastError: s.lastError,
        }
      }
      return { ok: true, data }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.error('IPC.Sidecar', `list-status 失败：${error}`)
      return { ok: false, error }
    }
  })

  // ------------------------------------------------------------------
  // sidecar:start-one — 启动指定 sidecar
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sidecar:start-one',
    async (_event, sidecarId: string) => {
      logger.info('IPC.Sidecar', `用户请求启动 ${sidecarId}`)
      try {
        const m = getSidecarManager(sidecarId)
        await m.start()
        const status = m.getStatus()
        return { ok: true, status: status.status }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        logger.error('IPC.Sidecar', `${sidecarId} 启动失败：${error}`)
        return { ok: false, status: 'crashed', error }
      }
    },
  )

  // ------------------------------------------------------------------
  // sidecar:stop-one — 停止指定 sidecar
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sidecar:stop-one',
    async (_event, sidecarId: 'sre' | 'analytics' | 'agent') => {
      logger.info('IPC.Sidecar', `用户请求停止 ${sidecarId}`)
      try {
        const m = getSidecarManager(sidecarId)
        await m.stop()
        return { ok: true }
      } catch (err) {
        logger.error('IPC.Sidecar', `${sidecarId} 停止失败：${err}`)
        return { ok: false }
      }
    },
  )

  // ------------------------------------------------------------------
  // sidecar:health-one — 单个 sidecar 的健康检查
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sidecar:health-one',
    async (_event, sidecarId: string) => {
      try {
        const m = getSidecarManager(sidecarId)
        const health = await m.health()
        return { ok: true, ...health }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        return { ok: false, error }
      }
    },
  )

  // ------------------------------------------------------------------
  // sidecar:tool-call — 通用 Sidecar 工具调用
  // 通用 Sidecar 工具调用
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sidecar:tool-call',
    async (
      _event,
      sidecarId: string,
      endpoint: string,
      payload: unknown,
    ) => {
      logger.info('IPC.Sidecar', `tool-call: ${sidecarId} ${endpoint}`)
      try {
        const config = SIDECAR_CONFIGS[sidecarId]
        if (!config) {
          return { ok: false, error: `Unknown sidecar: ${sidecarId}` }
        }
        // 确保 sidecar 已就绪（懒启动）
        const m = getSidecarManager(sidecarId)
        if (m.getStatus().status !== 'ready') {
          await m.start()
        }
        // 调用 sidecar HTTP 端点
        const resp = await fetch(
          `http://${config.host}:${config.port}${endpoint}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload ?? {}),
          },
        )
        if (!resp.ok) {
          const errText = await resp.text()
          return { ok: false, error: `HTTP ${resp.status} - ${errText}` }
        }
        const data = await resp.json()
        return { ok: true, data }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        logger.error('IPC.Sidecar', `tool-call 失败：${error}`)
        return { ok: false, error }
      }
    },
  )

  // ------------------------------------------------------------------
  // sidecar:parse-logs — 单独调用 Drain3 解析
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sidecar:parse-logs',
    async (_event, logLines: string[], maxClusters: number = 50) => {
      try {
        const m = getSidecarManager('sre')
        if (m.getStatus().status !== 'ready') {
          await m.start()
        }
        const data = await m.parseLogs(logLines, maxClusters)
        return { ok: true, data }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        return { ok: false, error }
      }
    },
  )

  logger.info('IPC.Sidecar', 'Sidecar IPC handlers 注册完成')
}

/**
 * 应用退出时清理 Sidecar 进程
 *
 * 应在 app.on('before-quit') 钩子中调用，避免僵尸进程。
 */
export async function cleanupSidecar(): Promise<void> {
  await shutdownSidecarManager()
}
