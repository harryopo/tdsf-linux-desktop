/**
 * Token Cost Stats IPC Handlers（v0.9.5 P0 - 组 1 新增）
 *
 * 注册 v0.9.5 引入的 token 成本透明化相关 IPC 通道。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - token:cost-stats — 获取累计成本统计（当日/当周/当月/总 + 按 Subagent/Provider 分布）
 *
 * 与现有 agent-runtime.ts 中 token:stats / token:reset / token:records 的关系：
 * - token:stats / token:reset / token:records 是 v0.9 引入的 token 数量统计通道
 * - token:cost-stats 是 v0.9.5 新增的 token 成本（USD）统计通道
 * - 两者并存：token:stats 返回 TokenStats（token 数），
 *   token:cost-stats 返回 CostStats（USD 成本）
 *
 * 设计要点：
 * - 独立文件（避免 agent-runtime.ts 进一步膨胀，agent-runtime.ts 已 > 350 行）
 * - 复用 main/core/agent/providers/token-stats.ts 的 getCostStats() 函数
 * - CostStats 接口已迁移到 @shared/agent-types.ts（SSOT）
 *
 * 方案书依据：v0.9.5 §UI接入接线图（5 组 P0 级缺失 IPC - 组 1：成本透明）
 */

import { ipcMain } from 'electron'
import { getCostStats } from '../core/agent/providers/token-stats'
import type { CostStats } from '@shared/agent-types'
import { logger } from '../services/log/logger'

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册 Token Cost Stats IPC handlers
 *
 * 注册以下通道：
 * - token:cost-stats — 获取累计成本统计（USD）
 *
 * IPC 4 步同步：
 * 1. main 层 handler：本文件
 * 2. ipc/index.ts：导入并调用 registerTokenCostStatsHandlers()
 * 3. preload/index.ts：暴露 tokenCostStats() 方法
 * 4. electron.d.ts：声明 tokenCostStats 类型
 */
export function registerTokenCostStatsHandlers(): void {
  // ------------------------------------------------------------------
  // token:cost-stats — 获取累计成本统计
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：CostStats（含 todayCost/weekCost/monthCost/totalCost + bySubagent/byProvider）
  // 用途：Token 监控面板展示累计成本（USD），让用户对消费有直观感知
  //
  // 计算逻辑（由 main/core/agent/providers/token-stats.ts 的 getCostStats() 实现）：
  // 1. 遍历 usageRecords，对每条记录调用 computeRecordCost 计算 cost
  // 2. 按时间窗口（当日/当周/当月/总）累加 cost
  // 3. 按 Subagent 维度（record.subagent）累加 cost
  // 4. 按 Provider 维度（record.providerId）累加 cost
  // 5. 四舍五入到 6 位小数（避免浮点精度问题）
  ipcMain.handle(
    'token:cost-stats',
    async (): Promise<CostStats> => {
      try {
        const stats = getCostStats()
        logger.debug('IPC.TOKEN', `token:cost-stats`, {
          todayCost: stats.todayCost,
          weekCost: stats.weekCost,
          monthCost: stats.monthCost,
          totalCost: stats.totalCost,
          subagentCount: Object.keys(stats.bySubagent).length,
          providerCount: Object.keys(stats.byProvider).length,
        })
        return stats
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取成本统计失败'
        logger.error('IPC.TOKEN', `token:cost-stats 失败: ${msg}`)
        throw new Error(`获取成本统计失败: ${msg}`)
      }
    }
  )

  logger.info('IPC.TOKEN', `Token Cost Stats IPC handlers 已注册`, {
    channels: ['token:cost-stats'],
  })
}
