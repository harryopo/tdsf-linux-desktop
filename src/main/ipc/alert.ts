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
 * - alertId 现在是渲染层生成的稳定键 `会话|种类`（见 renderer monitor-model 的 alertKey），
 *   同一种类在一场会话里始终是同一个键
 * - 空 alertId 返回 false（不抛错），其他错误向上抛
 *
 * 设计依据：M3 Task 2 · IPC 4 步同步铁律
 *
 * 这条通道是"记账"，不是"抑制"：抑制发生在渲染层。
 * AlertTable / MonitorPage 都读 useMonitorStore.ackedAlerts 来决定那一行显示未处理还是已处理，
 * 指标回落后那份确认会被 pruneSessionAcks 作废，下次再越线重新提醒。
 * 以前这个 Map 只写不读、且键里带着秒级时间戳（每条新数据一个新键），
 * 所以"标记已处理"的真实效果只有"关掉抽屉"。现在读的人在哪、键怎么来的，写在这里。
 */

import { ipcMain } from 'electron'
import { ALERT } from '@shared/ipc-channels'
import { logger } from '../services/log/logger'

/**
 * 内存中的告警确认状态
 *
 * key: alertId, value: true（已确认）
 * 主进程重启后重置（告警是瞬时状态，不持久化到磁盘）
 *
 * 上限：alertId 由渲染层按 `time|server|desc` 拼，每次触发都是新 key，
 * 不设上限就是一条一条只增不减地占内存。超出后按插入顺序淘汰最旧的
 * （Map 保持插入序），等价于"只记得最近这几百条确认过"。
 */
const ACK_CAP = 500
const acknowledgedAlerts = new Map<string, boolean>()

/** 记一条确认（超出上限时淘汰最旧的一条）；导出给判据直接驱动淘汰逻辑 */
export function acknowledgeAlert(alertId: string): number {
  acknowledgedAlerts.set(alertId, true)
  while (acknowledgedAlerts.size > ACK_CAP) {
    const oldest = acknowledgedAlerts.keys().next().value
    if (oldest === undefined) break
    acknowledgedAlerts.delete(oldest)
  }
  return acknowledgedAlerts.size
}

/** 当前登记的确认条数（只读，给判据用） */
export function acknowledgedCount(): number {
  return acknowledgedAlerts.size
}

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
    const total = acknowledgeAlert(alertId)
    logger.info('IPC.ALERT', '告警已确认', { alertId, totalAcked: total })
    return true
  })
}
