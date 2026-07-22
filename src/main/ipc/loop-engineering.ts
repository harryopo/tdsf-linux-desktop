/**
 * 循环工程 IPC Handlers（v1.5 新增）
 *
 * 用户原话：
 *   "我要从「假设计 → 可演示真 IDE」做完一整轮，你设计循环工程配置子agent达到这个目标"
 *
 * 注册循环工程配置子 Agent 的 IPC 通道，让 Workbench AIPanel 的"演示模式"
 * 能够调用真实的 LLM 推理 + 7 步 HITL 工作流 + 决策卡片 + SSH 执行 + 验证。
 *
 * 通道列表：
 * - loop:start   — 启动循环工程（problem, connId, providerId?, strength?）
 *                  返回 correlationId，后续通过事件推送进度
 * - loop:confirm — 人工确认（correlationId, approved）
 *                  在 'loop:decision' 事件后调用，恢复工作流
 * - loop:cancel  — 取消工作流（correlationId）
 *
 * 推送通道（主 → 渲染，单向）：
 * - loop:llm-start — LLM 推理开始
 * - loop:llm-done  — LLM 推理完成（含 hypothesis + fixCommand + confidence）
 * - loop:step      — 工作流步骤变化（含完整 AgentWorkflowState）
 * - loop:decision  — 决策卡片就绪（含 DecisionCard，等待用户确认）
 * - loop:done      — 工作流完成（含最终 DecisionCard）
 * - loop:error     — 工作流出错（含错误信息）
 *
 * 与现有 AgentWorkflow IPC（agent:start/confirm/cancel）的关系：
 * - agent:* 通道是旧 AgentWorkflow 的入口（v0.3 ChatPanel 在用）
 * - loop:* 通道是循环工程子 agent 的入口（v1.5 Workbench AIPanel 演示模式）
 * - 两条路径独立，互不干扰；loop:* 在 agent:* 基础上增加了 LLM 推理阶段
 *
 * 方案书依据：
 *   - v1.5 诊断服务（循环工程启动时利用后端的日志进行分析）
 *   - v0.9 §3.1（Subagent 架构）
 *   - AGENT_MAIN_PATH.md（Supervisor.chat 主路径冻结，本通道复用）
 */

import { ipcMain, BrowserWindow } from 'electron'
import { LOOP } from '@shared/ipc-channels'
import { logger } from '../services/log/logger'
import {
  getLoopEngineeringSubagent,
  type LoopEngineeringInput,
  type LoopEngineeringEvent,
} from '../core/agent/subagents/loop-engineering-subagent'
import { createSubagentTask } from '../core/agent/subagents/base'
import type { ThinkingStrength } from '../core/agent/providers/types'

// ============================================================================
// 推送通道名常量
// ============================================================================

const LOOP_LLM_START_CHANNEL = 'loop:llm-start'
const LOOP_LLM_DONE_CHANNEL = 'loop:llm-done'
const LOOP_STEP_CHANNEL = 'loop:step'
const LOOP_DECISION_CHANNEL = 'loop:decision'
const LOOP_DONE_CHANNEL = 'loop:done'
const LOOP_ERROR_CHANNEL = 'loop:error'
const LOOP_BLOCKED_CHANNEL = 'loop:blocked'

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 安全推送事件到渲染进程（窗口已销毁时跳过）
 */
function safeSend(mainWindow: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (!mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send(channel, ...args)
    } catch (err) {
      logger.warn('IPC.LOOP', `推送事件失败: channel=${channel}`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册循环工程 IPC handlers
 *
 * @param mainWindow 主窗口实例，用于推送事件到渲染进程
 */
export function registerLoopEngineeringHandlers(mainWindow: BrowserWindow): void {
  const subagent = getLoopEngineeringSubagent()

  // ─── 订阅子 agent 事件 → 推送到渲染进程 ─────────────────────────

  subagent.events.on('loop:llm-start', (evt: LoopEngineeringEvent) => {
    if (evt.type === 'loop:llm-start') {
      safeSend(mainWindow, LOOP_LLM_START_CHANNEL, evt)
    }
  })

  subagent.events.on('loop:llm-done', (evt: LoopEngineeringEvent) => {
    if (evt.type === 'loop:llm-done') {
      safeSend(mainWindow, LOOP_LLM_DONE_CHANNEL, evt)
    }
  })

  subagent.events.on('loop:step', (evt: LoopEngineeringEvent) => {
    if (evt.type === 'loop:step') {
      safeSend(mainWindow, LOOP_STEP_CHANNEL, evt)
    }
  })

  subagent.events.on('loop:decision', (evt: LoopEngineeringEvent) => {
    if (evt.type === 'loop:decision') {
      safeSend(mainWindow, LOOP_DECISION_CHANNEL, evt)
    }
  })

  subagent.events.on('loop:done', (evt: LoopEngineeringEvent) => {
    if (evt.type === 'loop:done') {
      safeSend(mainWindow, LOOP_DONE_CHANNEL, evt)
    }
  })

  subagent.events.on('loop:error', (evt: LoopEngineeringEvent) => {
    if (evt.type === 'loop:error') {
      safeSend(mainWindow, LOOP_ERROR_CHANNEL, evt)
    }
  })

  subagent.events.on('loop:blocked', (evt: LoopEngineeringEvent) => {
    if (evt.type === 'loop:blocked') {
      safeSend(mainWindow, LOOP_BLOCKED_CHANNEL, evt)
    }
  })

  // ─── loop:start — 启动循环工程 ───────────────────────────────────

  /**
   * 参数：(input: { problem, connId, providerId?, strength? })
   * 返回：{ correlationId, status } — 工作流异步执行，进度通过事件推送
   */
  ipcMain.handle(
    LOOP.START,
    async (
      _event,
      input: {
        problem: string
        connId: string
        providerId?: string
        strength?: ThinkingStrength
      }
    ): Promise<{ correlationId: string; status: string; error?: string }> => {
      // 参数校验
      if (!input?.problem || typeof input.problem !== 'string' || input.problem.trim().length === 0) {
        return {
          correlationId: '',
          status: 'error',
          error: '参数 problem 不能为空',
        }
      }
      if (!input?.connId || typeof input.connId !== 'string') {
        return {
          correlationId: '',
          status: 'error',
          error: '参数 connId 不能为空（需要已连接的 SSH 服务器）',
        }
      }

      // 生成 correlationId（用于追踪本次循环工程）
      const correlationId = `loop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      logger.info('IPC.LOOP', `loop:start 启动循环工程`, {
        correlationId,
        problem: input.problem,
        connId: input.connId,
        providerId: input.providerId,
        strength: input.strength,
      })

      // 构造 SubagentTask
      const task = createSubagentTask(
        'loop-engineering',
        `循环工程：${input.problem}`,
        {
          problem: input.problem,
          connId: input.connId,
          providerId: input.providerId,
          strength: input.strength,
          correlationId,
        } satisfies LoopEngineeringInput,
        {
          sessionId: input.connId,
          providerId: input.providerId,
          strength: input.strength,
          correlationId,
        }
      )

      // 异步执行（不等待完成，立即返回 correlationId）
      void subagent
        .execute(task)
        .then((result) => {
          logger.info('IPC.LOOP', `循环工程子 agent 执行完成`, {
            correlationId,
            success: result.success,
            confidence: result.confidence,
            durationMs: result.durationMs,
          })
        })
        .catch((err: unknown) => {
          // 兜底：subagent.execute 内部已包装异常，理论不应到这里
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error('IPC.LOOP', `循环工程子 agent 异常`, { correlationId, error: errorMsg })
          safeSend(mainWindow, LOOP_ERROR_CHANNEL, {
            type: 'loop:error',
            correlationId,
            error: errorMsg,
          })
        })

      return {
        correlationId,
        status: 'started',
      }
    }
  )

  // ─── loop:confirm — 人工确认 ─────────────────────────────────────

  /**
   * 参数：(correlationId: string, approved: boolean)
   * 返回：boolean（确认是否成功传递）
   *
   * 在 'loop:decision' 事件后调用此方法恢复工作流。
   */
  ipcMain.handle(
    'loop:confirm',
    async (_event, correlationId: string, approved: boolean): Promise<boolean> => {
      if (!correlationId) {
        logger.warn('IPC.LOOP', `loop:confirm 缺少 correlationId`)
        return false
      }
      logger.info('IPC.LOOP', `loop:confirm`, { correlationId, approved })
      return subagent.confirm(correlationId, approved)
    }
  )

  // ─── loop:cancel — 取消工作流 ────────────────────────────────────

  /**
   * 参数：(correlationId: string)
   * 返回：boolean
   */
  ipcMain.handle(LOOP.CANCEL, async (_event, correlationId: string): Promise<boolean> => {
    if (!correlationId) return false
    logger.info('IPC.LOOP', `loop:cancel`, { correlationId })
    return subagent.cancel(correlationId)
  })

  logger.info('IPC.LOOP', `循环工程 IPC handlers 已注册`, {
    invokeChannels: ['loop:start', 'loop:confirm', 'loop:cancel'],
    pushChannels: [
      LOOP_LLM_START_CHANNEL,
      LOOP_LLM_DONE_CHANNEL,
      LOOP_STEP_CHANNEL,
      LOOP_DECISION_CHANNEL,
      LOOP_DONE_CHANNEL,
      LOOP_ERROR_CHANNEL,
      LOOP_BLOCKED_CHANNEL,
    ],
  })
}

/**
 * 清理循环工程 IPC handlers（应用退出时调用）
 *
 * 移除子 agent 的所有事件监听器，避免内存泄漏。
 */
export function cleanupLoopEngineering(): void {
  const subagent = getLoopEngineeringSubagent()
  subagent.events.removeAllListeners()
  logger.info('IPC.LOOP', `循环工程 IPC handlers 已清理`)
}
