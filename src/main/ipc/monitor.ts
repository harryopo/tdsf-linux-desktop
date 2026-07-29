/**
 * 监控 IPC Handlers
 *
 * 注册 monitor:start / monitor:stop / monitor:getSystemInfo 三个 invoke 通道，
 * 桥接渲染进程与 SystemMonitor。
 *
 * 监控数据推送（主进程 → 渲染进程，单向）：
 * - registerMonitorIpcHandlers 时注册 onMonitorData / onSystemInfo 回调
 * - monitor:data 通道：每次采集到实时指标时推送（每 interval 秒一次）
 * - monitor:systemInfo 通道：首次采集到系统静态信息时推送一次
 *
 * 注意：监控数据是持续推送的，所以回调注册在 handler 注册时
 * 一次性完成，而不是每次 monitor:start 时注册。
 */

import { ipcMain, BrowserWindow, Notification } from 'electron'
import { MONITOR } from '@shared/ipc-channels'
import { SystemMonitor } from '../services/ssh/monitor'
import type { MonitorData, SystemInfo } from '@shared/models'
// v2.9 告警自动检测：阀值评估纯函数 + 去抖
import {
  evaluateAlerts,
  shouldNotify,
  DEFAULT_ALERT_THRESHOLDS,
  type AlertThresholds,
} from '../services/ssh/alert-detector'
import { ConfigStore } from '../services/storage/config-store'

/** 监控数据推送通道名 */
const MONITOR_DATA_CHANNEL = 'monitor:data'

/** 系统信息推送通道名（首次采集时推送） */
const MONITOR_SYSTEM_INFO_CHANNEL = 'monitor:systemInfo'

/** v2.9 告警事件推送通道名（后台检测到超阀时推送） */
const MONITOR_ALERT_CHANNEL = 'monitor:alert'

/** SystemMonitor 单例（整个应用共享一个实例） */
let monitorInstance: SystemMonitor | null = null

/** 告警去抖状态（dedupeKey → 上次通知时间）；主机名缓存供通知标题用 */
const alertLastFired = new Map<string, number>()
const sessionHostnames = new Map<string, string>()

/** 读取告警阀值配置（设置页 monitor.threshold.*，缺省回退默认值） */
function readThresholds(): AlertThresholds {
  const num = (key: string, def: number): number => {
    const v = ConfigStore.get(key)
    return typeof v === 'number' && v > 0 ? v : def
  }
  return {
    cpu: num('monitor.threshold.cpu', DEFAULT_ALERT_THRESHOLDS.cpu),
    memory: num('monitor.threshold.memory', DEFAULT_ALERT_THRESHOLDS.memory),
    disk: num('monitor.threshold.disk', DEFAULT_ALERT_THRESHOLDS.disk),
  }
}

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

  // 注册监控数据回调：每次采集到新数据时推送到渲染进程 + v2.9 后台告警检测
  monitor.onMonitorData((sessionId: string, data: MonitorData) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(MONITOR_DATA_CHANNEL, sessionId, data)
    }
    // v2.9 后台告警：不依赖监控页是否打开，每次采集都判定阀值，
    // 超阀且过了去抖冷却期 → 弹系统通知 + 推送 monitor:alert 事件供渲染层展示
    try {
      const thresholds = readThresholds()
      const hostname = sessionHostnames.get(sessionId) ?? '服务器'
      const alerts = evaluateAlerts(data, thresholds, hostname)
      const now = Date.now()
      for (const alert of alerts) {
        if (!shouldNotify(alert.dedupeKey, now, alertLastFired)) continue
        // 系统通知（支持时才弹）
        if (Notification.isSupported()) {
          new Notification({ title: alert.title, body: alert.body }).show()
        }
        // 推送给渲染层（日志页/监控页可展示）
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(MONITOR_ALERT_CHANNEL, sessionId, alert)
        }
      }
    } catch {
      // 告警检测失败绝不影响正常监控数据推送
    }
  })

  // 注册系统信息回调：首次采集到系统静态信息时推送到渲染进程
  // 这样渲染进程无需额外 invoke 请求，被动接收即可
  monitor.onSystemInfo((sessionId: string, info: SystemInfo) => {
    sessionHostnames.set(sessionId, info.hostname || '服务器')
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(MONITOR_SYSTEM_INFO_CHANNEL, sessionId, info)
    }
  })

  // ------------------------------------------------------------------
  // IPC handlers
  // ------------------------------------------------------------------

  /** monitor:start — 启动监控，interval 单位为毫秒（v2.4 修复：统一为毫秒，与前端调用方对齐） */
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
  ipcMain.handle(MONITOR.STOP, async (_event, sessionId: string) => {
    try {
      return await monitor.stopMonitoring(sessionId)
    } catch (err) {
      throw new Error(`停止监控失败: ${(err as Error).message}`)
    }
  })

  /** monitor:getSystemInfo — 获取系统静态信息（保留 invoke 接口用于主动查询） */
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
