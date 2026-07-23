/**
 * Alert IPC Handlers（M3 新增）
 *
 * 注册告警确认 IPC 通道，供渲染层在 AlertDrawer "标记已处理" 时调用。
 *
 * 通道：
 * - alert:ack — 确认告警（标记已处理），主进程内存 Map 记录 ack 状态
 *
 * 设计说明：
 * - 告警是瞬时状态，不持久化到磁盘（主进程重启后重置）
 * - 渲染层通过 alertId（字符串）标识告警，主进程仅记录已确认状态
 * - 空 alertId 返回 false（不抛错），其他错误向上抛
 *
 * 设计依据：M3 Task 2 · IPC 4 步同步铁律
 */

import { ipcMain } from 'electron'
import { ALERT } from '@shared/ipc-channels'
import { logger } from '../services/log/logger'

/**
 * 内存中的告警确认状态
 *
 * key: alertId, value: true（已确认）
 * 主进程重启后重置（告警是瞬时状态，不持久化到磁盘）
 */
const acknowledgedAlerts = new Map<string, boolean>()

/**
 * 注册告警相关 IPC handlers
 *
 * 在 registerAllIpcHandlers 中调用，应用生命周期内只注册一次。
 * 当前仅支持 alert:ack（确认告警），后续可扩展 alert:list / alert:subscribe。
 */
export function registerAlertHandlers(): void {
  ipcMain.handle(ALERT.ACK, async (_event, alertId: string): Promise<boolean> => {
    if (typeof alertId !== 'string' || alertId.trim().length === 0) {
      logger.warn('IPC.ALERT', 'alert:ack 收到空 alertId')
      return false
    }
    acknowledgedAlerts.set(alertId, true)
    logger.info('IPC.ALERT', '告警已确认', {
      alertId,
      totalAcked: acknowledgedAlerts.size,
    })
    return true
  })
}
