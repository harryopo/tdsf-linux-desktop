/**
 * Risk IPC Handlers（M2 新增）
 *
 * 注册命令风险评估 IPC 通道，桥接 assessCommandRisk（AST + 正则降级）。
 * 供渲染层在执行命令前主动查询风险等级（如 DecisionPage 高危拦截清单）。
 *
 * 通道：
 * - risk:rules — 读取真正生效的拦截规则表（设置页「命令风险评级规则」在读）
 *
 * 曾有第二条 risk:check（桥接 assessCommandRisk 返回 { risk, reasons }），2026-10-25 整删（#216）：
 * `assessCommandRisk` 本来就被沙箱审批自己调用（sandbox-approval.ts 内），界面读规则走 risk:rules，
 * AI 侧走 MCP 的 risk_check——这条通道只是同一件事的第二个出口，渲染层一次都没调过。
 *
 * 设计说明：
 * - 不调用 assessWithAst（其失败时返回 null，需调用方处理降级）
 * - 改调 assessCommandRisk（已封装 AST 优先 + 正则降级，始终返回 { risk, reasons }）
 * - 空命令返回 low（不抛错），其他错误向上抛
 *
 * 设计依据：M2 Task 2 · IPC 4 步同步铁律
 */

import { ipcMain } from 'electron'
import { RISK, type RiskRulesSnapshot } from '@shared/ipc-channels'
import { COMMAND_RULES_SNAPSHOT } from '../core/command-gate'
import { logger } from '../services/log/logger'

/**
 * 注册风险评估 IPC handlers
 *
 * 在 registerAllIpcHandlers 中调用，应用生命周期内只注册一次。
 */
export function registerRiskHandlers(): void {

  /**
   * risk:rules — 把真正生效的拦截规则表给设置页展示
   *
   * 为什么要有这条：风险控制页原来自己维护一张可增删的"规则表"（risk.rules），
   * 但判定走的是主进程 command-rules.json，用户改的那张表谁也不读。
   * 现在页面显示的就是引擎实际用的那份，规则本身仍是随包分发的数据文件，
   * 不在界面上开放编辑——能随手删掉 rm -rf / 拦截项的"设置"不是安全特性。
   */
  ipcMain.handle(RISK.RULES, async (): Promise<RiskRulesSnapshot> => {
    const snapshot = COMMAND_RULES_SNAPSHOT
    logger.debug('IPC.RISK', 'risk:rules 读取完成', {
      version: snapshot.version,
      ruleCount: snapshot.rules.length,
    })
    return {
      version: snapshot.version,
      blockDetectors: snapshot.blockDetectors,
      rules: snapshot.rules,
    }
  })
}
