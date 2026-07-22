/**
 * Expectation IPC Handlers（v0.9.4 批次 4 - 任务 5 P2-E 新增）
 *
 * 注册预期回显监控相关 IPC 通道，将主进程 expectation-monitor.ts 的能力
 * 暴露给渲染层 UI（ExpectedOutput 组件）。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - expectation:check   — 对比预期与实际输出，返回 ExpectationCheckResult
 * - expectation:format  — 格式化违规列表为人类可读字符串
 *
 * 与现有 expectation-monitor.ts 的关系：
 * - expectation-monitor.ts 提供 checkExpectation / formatViolations 等纯函数
 * - 本文件仅做 IPC 包装：调用上述函数，返回 IPC 友好的响应
 * - 不修改 expectation-monitor.ts 的现有函数签名
 *
 * 设计要点：
 * - 无状态：每次 check 都是独立的纯函数调用
 * - 类型安全：入参/出参均使用 @shared/agent-types.ts 中的类型
 * - 错误隔离：单个 handler 异常不影响其他 handler
 *
 * 方案书依据：v0.9.4 §11 第 7 类（其他 3 项 - 任务 5）+ v0.9.5 §UI接入接线图
 */

import { ipcMain } from 'electron'
import {
  checkExpectation,
  formatViolations,
} from '../core/agent/expectation-monitor'
import type {
  CommandExpectation,
  ExpectationCheckResult,
  ExpectationViolation,
} from '@shared/agent-types'
import { logger } from '../services/log/logger'

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册 Expectation IPC handlers
 *
 * 注册以下通道（2 个）：
 * - expectation:check   — 对比预期与实际输出
 * - expectation:format  — 格式化违规列表
 *
 * IPC 4 步同步：
 * 1. main 层 handler：本文件
 * 2. ipc/index.ts：导入并调用 registerExpectationHandlers()
 * 3. preload/index.ts：暴露 2 个方法（expectationCheck / expectationFormat）
 * 4. electron.d.ts：声明 2 个类型
 */
export function registerExpectationHandlers(): void {
  // ------------------------------------------------------------------
  // expectation:check — 对比预期与实际输出
  // ------------------------------------------------------------------
  // 参数：(expectation: CommandExpectation, actualOutput: string, actualExitCode: number)
  // 返回：ExpectationCheckResult（含 met / violations / expectation / actualExitCode / timestamp）
  // 用途：UI 展示"预期 vs 实际"对比，发现异常时高亮告警
  //
  // 实现要点：
  // - 调用 checkExpectation 纯函数获取违规列表
  // - violations.length === 0 时 met=true
  // - 即使无违规也返回完整 result 对象（便于 UI 渲染"符合预期"提示）
  ipcMain.handle(
    'expectation:check',
    async (
      _event,
      expectation: CommandExpectation,
      actualOutput: string,
      actualExitCode: number
    ): Promise<ExpectationCheckResult> => {
      try {
        // 入参基础校验
        if (!expectation || typeof expectation !== 'object') {
          logger.warn('IPC.EXPECTATION', `expectation:check 入参非法`, { expectation })
          throw new Error('expectation 参数必须是对象')
        }
        if (typeof expectation.command !== 'string') {
          logger.warn('IPC.EXPECTATION', `expectation:check command 字段非法`, {
            command: expectation.command,
          })
          throw new Error('expectation.command 必须是字符串')
        }
        if (typeof actualOutput !== 'string') {
          logger.warn('IPC.EXPECTATION', `expectation:check actualOutput 字段非法`, {
            actualOutput,
          })
          throw new Error('actualOutput 必须是字符串')
        }
        if (typeof actualExitCode !== 'number' || !Number.isFinite(actualExitCode)) {
          logger.warn('IPC.EXPECTATION', `expectation:check actualExitCode 字段非法`, {
            actualExitCode,
          })
          throw new Error('actualExitCode 必须是有限数字')
        }

        const violations = checkExpectation(expectation, actualOutput, actualExitCode)
        const result: ExpectationCheckResult = {
          met: violations.length === 0,
          violations,
          expectation,
          actualExitCode,
          timestamp: Date.now(),
        }

        logger.debug('IPC.EXPECTATION', `expectation:check`, {
          command: expectation.command,
          met: result.met,
          violationsCount: violations.length,
          actualExitCode,
        })

        return result
      } catch (err) {
        const msg = (err as Error)?.message ?? '预期检查失败'
        logger.error('IPC.EXPECTATION', `expectation:check 失败: ${msg}`)
        throw new Error(`预期检查失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // expectation:format — 格式化违规列表为人类可读字符串
  // ------------------------------------------------------------------
  // 参数：(violations: ExpectationViolation[])
  // 返回：string（格式化后的字符串，空列表返回"符合预期（无违规）"）
  // 用途：UI 在 Tooltip / 详情面板中展示完整违规描述
  ipcMain.handle(
    'expectation:format',
    async (_event, violations: ExpectationViolation[]): Promise<string> => {
      try {
        if (!Array.isArray(violations)) {
          logger.warn('IPC.EXPECTATION', `expectation:format 入参非法`, { violations })
          throw new Error('violations 必须是数组')
        }
        const formatted = formatViolations(violations)
        logger.debug('IPC.EXPECTATION', `expectation:format`, {
          count: violations.length,
        })
        return formatted
      } catch (err) {
        const msg = (err as Error)?.message ?? '格式化违规列表失败'
        logger.error('IPC.EXPECTATION', `expectation:format 失败: ${msg}`)
        throw new Error(`格式化违规列表失败: ${msg}`)
      }
    }
  )

  logger.info('IPC.EXPECTATION', `Expectation IPC handlers 已注册`, {
    channels: ['expectation:check', 'expectation:format'],
  })
}
