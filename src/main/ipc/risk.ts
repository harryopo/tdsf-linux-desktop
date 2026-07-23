/**
 * Risk IPC Handlers（M2 新增）
 *
 * 注册命令风险评估 IPC 通道，桥接 assessCommandRisk（AST + 正则降级）。
 * 供渲染层在执行命令前主动查询风险等级（如 DecisionPage 高危拦截清单）。
 *
 * 通道：
 * - risk:check — 检查命令风险等级，返回 { risk, reasons }
 *
 * 设计说明：
 * - 不调用 assessWithAst（其失败时返回 null，需调用方处理降级）
 * - 改调 assessCommandRisk（已封装 AST 优先 + 正则降级，始终返回 { risk, reasons }）
 * - 空命令返回 low（不抛错），其他错误向上抛
 *
 * 设计依据：M2 Task 2 · IPC 4 步同步铁律
 */

import { ipcMain } from 'electron'
import { RISK } from '@shared/ipc-channels'
import { assessCommandRisk } from './sandbox-approval'
import type { CommandRiskLevel } from './sandbox-approval'
import { logger } from '../services/log/logger'

/**
 * 注册风险评估 IPC handlers
 *
 * 在 registerAllIpcHandlers 中调用，应用生命周期内只注册一次。
 */
export function registerRiskHandlers(): void {
  ipcMain.handle(
    RISK.CHECK,
    async (_event, command: string): Promise<{ risk: CommandRiskLevel; reasons: string[] }> => {
      if (typeof command !== 'string' || command.trim().length === 0) {
        logger.warn('IPC.RISK', 'risk:check 收到空命令，返回 low')
        return { risk: 'low', reasons: [] }
      }
      const result = await assessCommandRisk(command)
      logger.debug('IPC.RISK', 'risk:check 评估完成', {
        command: command.slice(0, 80),
        risk: result.risk,
        reasonCount: result.reasons.length,
      })
      return result
    },
  )
}
