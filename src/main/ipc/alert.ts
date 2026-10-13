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
 *
 * ⚠️ 覆盖面说明（别把这条通道当成"告警已被抑制"）：本 Map 目前**只写不读**——
 * 告警列表由渲染层从监控数据自己算出来（AlertRecord 在 renderer 侧生成），
 * 主进程的告警检测器用的是另一套 key（sessionId:dedupeKey）。
 * 所以"标记已处理"现在的真实效果只有"关掉抽屉 + 记一笔"，同一个指标继续超阈值
 * 仍会再次告警。要让它真的抑制，得先定"告警状态归谁管"（渲染层还是主进程），
 * 那是产品决定，不是这里能顺手补的。
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
