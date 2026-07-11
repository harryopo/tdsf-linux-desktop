/**
 * 监控 IPC Handlers
 *
 * 注册 monitor:start / monitor:stop / monitor:getSystemInfo 三个 invoke 通道，
 * 桥接渲染进程与 SystemMonitor。
 *
 * 监控数据推送：
 * - registerMonitorIpcHandlers 时注册 onMonitorData 回调
 * - 回调通过 mainWindow.webContents.send('monitor:data', sessionId, data) 推送
 *
 * 注意：监控数据是持续推送的（每 3 秒一次），所以回调注册在 handler 注册时
 * 一次性完成，而不是每次 monitor:start 时注册。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { SystemMonitor } from '../services/ssh/monitor'
import type { MonitorData, SystemInfo } from '@shared/models'

/** 监控数据推送通道名 */
const MONITOR_DATA_CHANNEL = 'monitor:data'

/** SystemMonitor 单例（整个应用共享一个实例） */
let monitorInstance: SystemMonitor | null = null

/**
 * 注册监控相关 IPC handlers
 *
 * @param mainWindow 主窗口实例，用于推送监控数据到渲染进程
 */
export function registerMonitorIpcHandlers(mainWindow: BrowserWindow): void {
  // 全局单例：所有监控会话共享一个 SystemMonitor
  if (!monitorInstance) {
    monitorInstance = new SystemMonitor()
  }
  const monitor = monitorInstance

  // 注册监控数据回调：每次采集到新数据时推送到渲染进程
  monitor.onMonitorData((sessionId: string, data: MonitorData) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(MONITOR_DATA_CHANNEL, sessionId, data)
    }
  })

  // ------------------------------------------------------------------
  // IPC handlers
  // ------------------------------------------------------------------

  /** monitor:start — 启动监控，interval 单位为秒 */
  ipcMain.handle(
    'monitor:start',
    async (_event, sessionId: string, interval: number) => {
      try {
        return await monitor.startMonitoring(sessionId, interval)
      } catch (err) {
        throw new Error(`启动监控失败: ${(err as Error).message}`)
      }
    }
  )

  /** monitor:stop — 停止监控 */
  ipcMain.handle('monitor:stop', async (_event, sessionId: string) => {
    try {
      return await monitor.stopMonitoring(sessionId)
    } catch (err) {
      throw new Error(`停止监控失败: ${(err as Error).message}`)
    }
  })

  /** monitor:getSystemInfo — 获取系统静态信息 */
  ipcMain.handle(
    'monitor:getSystemInfo',
    async (_event, sessionId: string): Promise<SystemInfo> => {
      try {
        return await monitor.getSystemInfo(sessionId)
      } catch (err) {
        throw new Error(`获取系统信息失败: ${(err as Error).message}`)
      }
    }
  )
}

/**
 * 停止所有监控（应用退出时调用）
 */
export async function stopAllMonitoring(): Promise<void> {
  if (monitorInstance) {
    await monitorInstance.stopAll()
  }
}
