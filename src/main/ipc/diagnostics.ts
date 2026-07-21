/**
 * 诊断服务 IPC Handlers（v1.5 新增）
 *
 * 用户原话：
 *   "建立一个检测的后端，当循环工程启动时利用后端的日志进行分析"
 *
 * 暴露给渲染进程的 IPC 通道：
 *   - diagnostics:get-report    获取完整诊断报告
 *   - diagnostics:get-logs      获取缓冲区日志
 *   - diagnostics:get-findings  获取检测结果
 *   - diagnostics:get-stats     获取累计统计
 *   - diagnostics:clear         清空缓冲区
 *   - diagnostics:set-enabled   启用/禁用实时推送
 *
 * 主进程 → 渲染进程 推送通道：
 *   - diagnostics:log-batch     批量日志事件（含检测结果）
 *
 * 设计原则：
 *   - 渲染进程只读，不能直接写入日志（日志只能由 SidecarManager 注入）
 *   - clear 操作不影响累计统计（仅清空缓冲区）
 *   - 实时推送默认启用，渲染进程可通过 set-enabled 关闭
 */

import { ipcMain, BrowserWindow } from 'electron'
import { DIAGNOSTICS } from '@shared/ipc-channels'
import { getDiagnosticsService } from '../services/diagnostics/diagnostics-service'
import type { LogSource, LogLevel } from '../services/diagnostics/types'

/**
 * 注册诊断服务 IPC handlers
 *
 * @param mainWindow 主窗口实例，用于注入到 DiagnosticsService
 */
export function registerDiagnosticsHandlers(mainWindow: BrowserWindow): void {
  const svc = getDiagnosticsService()

  // 注入主窗口，启用实时推送
  svc.setMainWindow(mainWindow)

  // ------------------------------------------------------------------
  // diagnostics:get-report — 获取完整诊断报告
  // ------------------------------------------------------------------
  ipcMain.handle(DIAGNOSTICS.GET_REPORT, async () => {
    try {
      const report = svc.getReport()
      return { ok: true, data: report }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // ------------------------------------------------------------------
  // diagnostics:get-logs — 获取缓冲区日志
  // ------------------------------------------------------------------
  /**
   * 参数：
   *   - source?: LogSource  按来源过滤（可选）
   *   - level?: LogLevel    按级别过滤（可选）
   *   - limit?: number      限制返回数量（默认 500）
   */
  ipcMain.handle(
    'diagnostics:get-logs',
    async (_event, options?: { source?: LogSource; level?: LogLevel; limit?: number }) => {
      try {
        const limit = options?.limit ?? 500
        let logs = svc.getLogs()
        if (options?.source) {
          logs = logs.filter((l) => l.source === options.source)
        }
        if (options?.level) {
          logs = logs.filter((l) => l.level === options.level)
        }
        // 取最后 N 条
        const result = logs.slice(-limit)
        return { ok: true, data: result, total: logs.length }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: message }
      }
    },
  )

  // ------------------------------------------------------------------
  // diagnostics:get-findings — 获取检测结果
  // ------------------------------------------------------------------
  /**
   * 参数：
   *   - severity?: Severity  按严重性过滤（可选）
   *   - limit?: number       限制返回数量（默认 200）
   */
  ipcMain.handle(
    'diagnostics:get-findings',
    async (_event, options?: { severity?: 'info' | 'warning' | 'error' | 'critical'; limit?: number }) => {
      try {
        const limit = options?.limit ?? 200
        let findings = svc.getFindings()
        if (options?.severity) {
          findings = findings.filter((f) => f.severity === options.severity)
        }
        const result = findings.slice(-limit)
        return { ok: true, data: result, total: findings.length }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: message }
      }
    },
  )

  // ------------------------------------------------------------------
  // diagnostics:get-stats — 获取累计统计
  // ------------------------------------------------------------------
  ipcMain.handle(DIAGNOSTICS.GET_STATS, async () => {
    try {
      return { ok: true, data: svc.getStats() }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // ------------------------------------------------------------------
  // diagnostics:clear — 清空缓冲区
  // ------------------------------------------------------------------
  ipcMain.handle(DIAGNOSTICS.CLEAR, async () => {
    try {
      svc.clear()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // ------------------------------------------------------------------
  // diagnostics:set-enabled — 启用/禁用实时推送
  // ------------------------------------------------------------------
  ipcMain.handle(DIAGNOSTICS.SET_ENABLED, async (_event, enabled: boolean) => {
    try {
      svc.setEnabled(enabled)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // ------------------------------------------------------------------
  // diagnostics:ingest-test — 测试用：注入一条测试日志（仅 dev 模式）
  // ------------------------------------------------------------------
  /**
   * 该通道仅用于功能测试，让渲染进程可以模拟 Sidecar 日志，
   * 验证检测规则是否正确触发。
   *
   * 参数：
   *   - source: LogSource
   *   - level: LogLevel
   *   - raw: string
   */
  ipcMain.handle(
    'diagnostics:ingest-test',
    async (_event, event: { source: LogSource; level: LogLevel; raw: string }) => {
      try {
        svc.ingestLog({
          timestamp: new Date().toISOString(),
          source: event.source,
          level: event.level,
          raw: event.raw,
        })
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: message }
      }
    },
  )

  console.log('[IPC.Diagnostics] 诊断服务 IPC handlers 已注册')
}
