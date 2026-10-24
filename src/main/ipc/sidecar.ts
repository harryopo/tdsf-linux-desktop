/**
 * Sidecar IPC Handlers
 *
 * 界面真在用的只有两条：
 * - 'sidecar:status'   → getStatus（日志面板开机取一次当前状态）
 * - 'sidecar:pipeline' → runPipeline（端到端：日志 → Drain3 解析 → 根因诊断）
 *
 * 其余九条通道（start / stop / health / list-status / start-one / stop-one /
 * health-one / tool-call / parse-logs）已于 2026-10-24 整删（#207）。判据是"谁按、谁读"：
 * - 启动不需要按钮：pipeline 自己就是懒启动（见下），引擎没就绪时第一次分析就把它拉起来；
 *   退出收尾走 `cleanupSidecar()`，由 `core/quit-cleanup.ts` 在主进程里直接调，不绕界面；
 * - 健康读数界面看的是"本机分析引擎（实测）"那张表，数据由 app:get-info 现场量
 *   （`sidecarEngineHealth()`），不是这条 health 通道；
 * - -one 那一族与 list-status 是"多 Sidecar 管理面"的遗留：本应用只跑一个分析引擎，
 *   界面上从来没有 Sidecar 列表；parse-logs 是 pipeline 的中段子步，单独开一条口只多一个出口；
 * - tool-call 最要收：它让渲染层往本地端口 POST 任意 endpoint，而渲染层零调用——
 *   一道没人在用的通用写入口，等于白给的攻击面。
 *
 * 顺带清掉一段假话：这份文件的旧注释写着"ChatPanel 顶部按钮调 sidecar:start"
 * "SidecarStatusPanel 启动时调 list-status"，那两个组件早就不在界面上了。
 *
 * 设计原则（没变）：
 * - 单一职责：本文件只做 IPC 通道注册，业务逻辑在 SidecarManager
 * - 启动幂等：start 调用多次只启动一次（SidecarManager 内部已保证）
 */

import { ipcMain } from 'electron'
import { SIDECAR } from '@shared/ipc-channels'
import { getSidecarManager, shutdownSidecarManager } from '../core/sidecar/sidecar-manager'
import { logger } from '../services/log/logger'

/**
 * 注册 Sidecar IPC handlers
 *
 * 在 app.whenReady() 后、registerAllIpcHandlers 内调用。
 */
export function registerSidecarIpcHandlers(): void {
  const manager = getSidecarManager()

  // ------------------------------------------------------------------
  // sidecar:status — 获取 Sidecar-A 当前状态
  // ------------------------------------------------------------------
  ipcMain.handle(SIDECAR.STATUS, () => {
    return manager.getStatus()
  })

  // ------------------------------------------------------------------
  // sidecar:pipeline — 端到端 Pipeline
  // 日志输入 → Drain3 解析 → 根因诊断 → JSON 回传
  // llmConfig 可选，传了就启用 LLM 增强诊断
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
        // v2.6 修复：懒启动 —— sidecar 不随应用自启，本通道是引擎的唯一启动点，
        // 非 ready 就先拉起，否则日志页「AI 日志分析」永远报「Sidecar 未就绪（status=stopped）」。
        // 也是因此，界面上不需要另配一个"启动引擎"的按钮。
        if (manager.getStatus().status !== 'ready') {
          logger.info('IPC.Sidecar', 'Pipeline 懒启动：Sidecar 非 ready，先拉起进程')
          await manager.start()
        }
        const data = await manager.runPipeline(logLines, serviceName, llmConfig)
        return { ok: true, data }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        logger.error('IPC.Sidecar', `Pipeline 失败：${error}`)
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
