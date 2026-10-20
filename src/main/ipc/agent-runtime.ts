/**
 * Agent Runtime IPC Handlers（v0.9 新增）
 *
 * 注册 v0.9 引入的 Supervisor Agent + Provider 抽象 + Token 统计相关的 IPC 通道。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - agent:chat          — 启动 supervisor 流式 chat（异步，通过事件推送 token/done/error）
 * - agent:chat:cancel   — 取消进行中的 chat 请求（注意：旧 agent:cancel 是 AgentWorkflow 通道，不冲突）
 * - provider:list       — 列出所有 Provider（仅 enabled 或全部）
 * - provider:get        — 获取单个 Provider 配置（不含 apiKey）
 * - provider:save       — 保存 Provider（apiKey 单独走 SecureStore）
 * - provider:set-default — 设置默认 Provider ID（P-6：统一为 kebab-case，与 sandbox:approval-request 等保持一致）
 * - token:stats         — 获取 token 统计聚合
 * - token:reset         — 重置 token 统计
 *
 * 推送通道（主 → 渲染，单向）：
 * - agent:chunk — 流式 token 块（含 correlationId 和 delta）
 * - agent:done  — 完成信号（含完整结果 ChatResult）
 * - agent:error — 错误信号（含 correlationId 和错误信息）
 *
 * 与现有 agent.ts（AgentWorkflow）的关系：
 * - agent:start / agent:confirm / agent:cancel 是旧 AgentWorkflow 的通道，保留不动
 * - 本文件新增的 agent:chat 是 Supervisor 的入口，是 v0.9 Week 1 新引入的统一入口
 * - 渲染进程 ChatPanel 在 v0.9 后优先使用 agent:chat（旧 AgentWorkflow 在 Week 2 后逐步迁移）
 *
 * 方案书依据：v0.9 §11.2（IPC 命名规范）+ §3（Provider 抽象）+ §5（Token 监控）
 */

import { randomUUID } from 'node:crypto'
import { ipcMain, BrowserWindow } from 'electron'
import { broadcastToWindows } from '../windows/main-window'
import type { ModelMessage } from 'ai'
import { AGENT, PAOR, TOKEN } from '@shared/ipc-channels'
import { getSupervisor } from '../core/agent/supervisor'
import {
  listProviders,
  getProvider,
  saveProvider,
  setDefaultProviderId,
  getDefaultProviderId,
  ensureProvidersInitialized,
  // v2.3.7 修复：PersistedProviderConfigWithKey 是 registry 内部类型，不再 re-export 自 types
  type PersistedProviderConfigWithKey,
} from '../core/agent/providers/provider-registry'
import { getTokenStats, resetTokenStats, getTokenRecords, getCostStats } from '../core/agent/providers/token-stats'
import { classifyLlmError } from '../core/agent/providers/llm-error'
import type {
  ProviderConfig,
  PersistedProviderConfig,
  ThinkingStrength,
  TokenStats,
  TokenUsageRecord,
} from '../core/agent/providers/types'
import type {
  ChatResult,
  AgentChunkPayload,
  AgentDonePayload,
  AgentErrorPayload,
  AgentToolEventPayload,
} from '@shared/agent-types'
import type { PaorApprovalRequest } from '@shared/approval-types'
import type { ChatMessage } from '@shared/models'
import { logger } from '../services/log/logger'
// v2.4 Phase B：预算告警检查（token 月成本超阈值时记录到 budget_alerts 表）
import { ConfigStore } from '../services/storage/config-store'
import { alertTokenBudgetExceeded } from '../services/llm/budget-alerter'
// v0.9.4 新增：session-registry 集中维护 sessionId → AbortController Map，支持 abort signal + TTL 清理
import { getSessionRegistry } from '../core/agent/session-registry'
// D2：审批判定唯一权威 —— 只有字面 true 算批准
import { readApproval } from '../core/security/approval'

/** 流式 token 推送通道名 */
const AGENT_CHUNK_CHANNEL = AGENT.CHUNK
/** 流式完成信号通道名 */
const AGENT_DONE_CHANNEL = AGENT.DONE
/** 流式错误信号通道名 */
const AGENT_ERROR_CHANNEL = AGENT.ERROR
/** 工具调用事件推送通道名（v2.4：真实工具执行可视化） */
const AGENT_TOOL_EVENT_CHANNEL = AGENT.TOOL_EVENT

/** PAOR 审批请求推送通道名 */
const PAOR_APPROVAL_REQUEST_CHANNEL = PAOR.APPROVAL_REQUEST

/** PAOR 审批超时（毫秒）—— 60 秒内未响应自动拒绝 */
const PAOR_APPROVAL_TIMEOUT_MS = 60_000

/** PAOR 审批请求载荷：唯一声明在 @shared/approval-types，这里只引用 */

/** 待审批 PAOR 请求表：callId → { resolve, timeout } */
const pendingPaorApprovals = new Map<
  string,
  { resolve: (approved: boolean) => void; timeout: ReturnType<typeof setTimeout> }
>()

/**
 * 安全推送事件到渲染进程（窗口已销毁时跳过）
 */
function safeSend(mainWindow: BrowserWindow, channel: string, ...args: unknown[]): void {
  // 流式 token 与审批推送要让每个应用窗口都收到：只发主窗口的话，
  // 在副窗口（W4）里发的对话一个字都看不到，批准弹窗也不会出现。
  void mainWindow
  broadcastToWindows(channel, ...args)
}

/**
 * 错误分类：唯一一份规则表在 providers/llm-error.ts（#101）
 *
 * 这里原来手抄了一份 15 个分支的判定，与 ipc/llm.ts、ipc/llm-tools.ts 各一份共三份，
 * 三处都用 `message.includes('404')` 判 HTTP 状态——"requested 9404 tokens" 里的
 * 9404 会命中 '404'，把上下文超限报成"模型不存在或 endpoint 错误"。
 * 兜底前缀保留本调用点原有的"Agent 调用失败"说法。
 */
function toAgentError(err: unknown): { message: string; code: AgentErrorPayload['code'] } {
  const c = classifyLlmError(err, 'Agent 调用失败')
  return { message: c.message, code: c.code }
}

/**
 * 注册 Agent Runtime IPC handlers
 *
 * @param mainWindow 主窗口实例，用于推送流式事件到渲染进程
 */
export function registerAgentRuntimeHandlers(mainWindow: BrowserWindow): void {
  // 确保 Provider 列表已从持久化存储加载
  ensureProvidersInitialized()

  // ------------------------------------------------------------------
  // agent:chat — 启动 Supervisor 流式 chat
  // ------------------------------------------------------------------
  // 参数：(messages, providerId?, strength?, sshSessionId?, terminalContext?)
  //   —— 这五位与 src/shared/ipc-contract.ts 的 agentChat 逐位一致，主进程边界按它校验入参。
  //   - sshSessionId：SshConnectionManager 会话 id（可选，传入则启用只读 SSH 工具）
  //   - terminalContext：终端命令块摘要（可选，脱敏后注入 system prompt）
  // 会话注册表 id 一律由主进程生成（原来那个占位形参没有任何调用方传值，已删）。
  // 返回：correlationId
  ipcMain.handle(
    'agent:chat',
    async (
      _event,
      messages: ChatMessage[],
      providerId?: string,
      strength?: ThinkingStrength | 'auto',
      sshSessionId?: string,
      terminalContext?: string,
    ): Promise<string> => {
      const supervisor = getSupervisor()
      const correlationId = `chat_${Date.now()}_${randomUUID().slice(0, 8)}`

      // v0.9.4：注册到 session-registry（sessionId 由 registry 生成，取消时按它查）
      const registry = getSessionRegistry()
      const resolvedSessionId = registry.register({
        correlationId,
        kind: 'agent:chat',
        providerId,
      })

      logger.info('IPC.AGENT', `agent:chat 启动`, {
        correlationId,
        sessionId: resolvedSessionId,
        sshSessionId: sshSessionId ?? null,
        terminalBlockChars: terminalContext?.length ?? 0,
        providerId,
        strength,
        messageCount: messages?.length ?? 0,
      })

      const modelMessages = (messages ?? []) as unknown as ModelMessage[]

      void supervisor
        .chat({
          messages: modelMessages,
          providerId,
          strength,
          correlationId,
          sshSessionId,
          terminalContext,
          // v2.9 写命令 HITL 审批：复用 PAOR 审批通道（paor:approval-request 卡片），
          // ssh_write 工具 execute 内 await 此回调，用户批准才真执行；60 秒超时自动拒绝
          approveWriteCommand: async (command, level, description): Promise<boolean> => {
            const callId = `write_${Date.now()}_${randomUUID().slice(0, 8)}`
            const payload: PaorApprovalRequest = {
              callId,
              command,
              riskLevel: level,
              riskDescription: description,
              // 对话里 AI 调写工具没有"计划第几步"这回事；原来两处都写死 stepIndex: 0，
              // 于是审批卡把这条例外也说成"PAOR 请求批准 — 第 1 步"，两个字段都是假的
              origin: 'chat',
              timestamp: Date.now(),
            }
            logger.info('IPC.AGENT', 'ssh_write 推送审批请求', { callId, command, level })
            safeSend(mainWindow, PAOR_APPROVAL_REQUEST_CHANNEL, payload)
            return new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => {
                pendingPaorApprovals.delete(callId)
                logger.warn('IPC.AGENT', 'ssh_write 审批超时，自动拒绝', { callId })
                resolve(false)
              }, PAOR_APPROVAL_TIMEOUT_MS)
              pendingPaorApprovals.set(callId, { resolve, timeout })
            })
          },
          onToken: (delta) => {
            const payload: AgentChunkPayload = { correlationId, delta, sessionId: resolvedSessionId }
            safeSend(mainWindow, AGENT_CHUNK_CHANNEL, payload)
          },
          onReasoning: (delta) => {
            // v2.5：思考链增量复用 chunk 通道，kind='reasoning' 区分，前端折叠展示
            const payload: AgentChunkPayload = {
              correlationId,
              delta,
              kind: 'reasoning',
              sessionId: resolvedSessionId,
            }
            safeSend(mainWindow, AGENT_CHUNK_CHANNEL, payload)
          },
          onDone: (result: ChatResult) => {
            // 推送完成信号到渲染进程
            const payload: AgentDonePayload = { correlationId, result, sessionId: resolvedSessionId }
            safeSend(mainWindow, AGENT_DONE_CHANNEL, payload)
            // 请求结束，从 session-registry 移除（释放内存）
            registry.remove(resolvedSessionId)
          },
          onError: (error: Error) => {
            // 推送错误信号到渲染进程（错误信息已脱敏，不含 stack trace）
            const errInfo = toAgentError(error)
            const payload: AgentErrorPayload = {
              correlationId,
              message: errInfo.message,
              code: errInfo.code,
              sessionId: resolvedSessionId,
            }
            safeSend(mainWindow, AGENT_ERROR_CHANNEL, payload)
            // 请求结束，从 session-registry 移除（释放内存）
            registry.remove(resolvedSessionId)
          },
          onToolEvent: (evt) => {
            // v2.4：把【真实发生】的工具调用/结果推送到渲染进程，供可视化
            const payload: AgentToolEventPayload = {
              correlationId,
              toolCallId: evt.toolCallId,
              phase: evt.phase,
              toolName: evt.toolName,
              input: evt.input,
              ok: evt.ok,
              count: evt.count,
              output: evt.output,
              sessionId: resolvedSessionId,
            }
            safeSend(mainWindow, AGENT_TOOL_EVENT_CHANNEL, payload)
            
            // v2.11 去混乱：AI 自主执行的命令不再注入 xterm 终端。
            // 原先把 AI 的 ssh_readonly/ssh_write/ssh_journal_follow 命令行+真实输出+状态行
            // 都回显到终端，与右侧 AI 面板的“终端命令卡”重复，且把用户自己的交互 shell
            // 搅乱（真实回显与 AI 文字混在一起，丑且奇怪）。现 AI 命令执行仅在 AI 面板命令卡展示（agent:tool-event）；
            // 终端只展示用户自己的交互命令与“在终端执行”按钮（用户主动）发送的命令。
          },
        })
        .catch((err: unknown) => {
          // 兜底：supervisor.chat 内部异常（理论不应发生，因 onError 已处理）
          const errInfo = toAgentError(err)
          const payload: AgentErrorPayload = {
            correlationId,
            message: errInfo.message,
            code: errInfo.code,
            sessionId: resolvedSessionId,
          }
          safeSend(mainWindow, AGENT_ERROR_CHANNEL, payload)
          // 异常路径也需清理 session-registry
          registry.remove(resolvedSessionId)
          logger.error('IPC.AGENT', `agent:chat 异常`, { correlationId, sessionId: resolvedSessionId, error: errInfo.message })
        })

      // 立即返回 correlationId（渲染进程用它监听后续事件 + 取消请求）
      // 注意：sessionId 通过事件 payload 中的 sessionId 字段回传，不破坏返回类型
      return correlationId
    }
  )

  // ------------------------------------------------------------------
  // agent:chat:cancel — 取消进行中的 chat 请求
  // ------------------------------------------------------------------
  // 参数：(sessionIdOrCorrelationId: string)
  //   - v0.9.4 起兼容两种 ID：优先按 sessionId 查找，回退到 correlationId
  //   - 旧版调用方仍可传 correlationId（向后兼容）
  // 返回：boolean（是否成功取消）
  ipcMain.handle(
    'agent:chat:cancel',
    async (_event, sessionIdOrCorrelationId: string): Promise<boolean> => {
      const supervisor = getSupervisor()
      const registry = getSessionRegistry()

      // 1. 通过 session-registry 取消（按 sessionId 或 correlationId 查找）
      const registryOk = registry.abortById(sessionIdOrCorrelationId)

      // 2. 通过 supervisor 取消（按 correlationId 查找内部 AbortController）
      //    supervisor 内部维护 correlationId → AbortController Map（streamText 用）
      //    若 sessionIdOrCorrelationId 是 sessionId，需要先查 registry 反向索引找到 correlationId
      let correlationId = sessionIdOrCorrelationId
      const entry = registry.list().find((e) => e.sessionId === sessionIdOrCorrelationId || e.correlationId === sessionIdOrCorrelationId)
      if (entry) {
        correlationId = entry.correlationId
      }
      const supervisorOk = supervisor.cancelRequest(correlationId)

      const ok = registryOk || supervisorOk
      logger.info('IPC.AGENT', `agent:chat:cancel`, {
        inputId: sessionIdOrCorrelationId,
        correlationId,
        registryOk,
        supervisorOk,
        success: ok,
      })
      return ok
    }
  )

  // ------------------------------------------------------------------
  // provider:list — 列出所有 Provider
  // ------------------------------------------------------------------
  // v2.3.6 增强：返回 PersistedProviderConfigWithKey（含 hasApiKey 标识），
  // 前端 UI 用 hasApiKey 区分"已配置 Key"和"未配置 Key"。
  ipcMain.handle(
    'provider:list',
    async (_event, onlyEnabled?: boolean): Promise<PersistedProviderConfigWithKey[]> => {
      const providers = listProviders(onlyEnabled === true)
      logger.debug('IPC.PROVIDER', `provider:list`, { count: providers.length, onlyEnabled })
      return providers
    }
  )

  // ------------------------------------------------------------------
  // provider:get — 获取单个 Provider 配置（不含 apiKey）
  // ------------------------------------------------------------------
  ipcMain.handle(
    'provider:get',
    async (_event, id: string): Promise<PersistedProviderConfig | null> => {
      const provider = getProvider(id)
      logger.debug('IPC.PROVIDER', `provider:get`, { id, found: !!provider })
      return provider
    }
  )

  // ------------------------------------------------------------------
  // provider:save — 保存 Provider 配置
  // ------------------------------------------------------------------
  ipcMain.handle(
    'provider:save',
    async (_event, config: ProviderConfig): Promise<boolean> => {
      const ok = saveProvider(config)
      logger.info('IPC.PROVIDER', `provider:save`, {
        id: config.id,
        name: config.name,
        type: config.type,
        success: ok,
      })
      return ok
    }
  )

  // ------------------------------------------------------------------
  // provider:set-default — 设置默认 Provider ID（P-6：统一为 kebab-case）
  // ------------------------------------------------------------------
  ipcMain.handle(
    'provider:set-default',
    async (_event, id: string): Promise<boolean> => {
      const ok = setDefaultProviderId(id)
      logger.info('IPC.PROVIDER', `provider:set-default`, { id, success: ok })
      return ok
    }
  )

  // ------------------------------------------------------------------
  // provider:get-default — 获取默认 Provider ID（P0 修复：ModelSettings 盲写 providers[0]）
  // ------------------------------------------------------------------
  // 渲染层此前无法得知默认 Provider，只能盲写 providers[0] 并强制设默认，
  // 导致非首位 Provider 拿不到 Key、用户默认选择被覆盖。
  ipcMain.handle(
    'provider:get-default',
    async (): Promise<string> => {
      ensureProvidersInitialized()
      const id = getDefaultProviderId()
      logger.debug('IPC.PROVIDER', `provider:get-default`, { id })
      return id
    }
  )

  // ------------------------------------------------------------------
  // token:stats — 获取 token 统计
  // ------------------------------------------------------------------
  ipcMain.handle(
    'token:stats',
    async (): Promise<TokenStats> => {
      const stats = getTokenStats()
      logger.debug('IPC.TOKEN', `token:stats`, {
        today: stats.today,
        week: stats.week,
        month: stats.month,
        total: stats.total,
      })
      // v2.4 Phase B：检查月成本是否超阈值，超阈值时记录告警
      // 阈值 = monthlyBudget * alertThreshold / 100（默认 2.0 * 80 / 100 = 1.6 USD）
      // alertTokenBudgetExceeded 内部有当日去重，不会刷屏
      try {
        const costStats = getCostStats()
        const monthlyBudget = (ConfigStore.get('monthlyBudget') as number) ?? 2.0
        const alertThreshold = (ConfigStore.get('alertThreshold') as number) ?? 80
        const threshold = (monthlyBudget * alertThreshold) / 100
        if (threshold > 0 && costStats.monthCost >= threshold) {
          alertTokenBudgetExceeded(costStats.monthCost, threshold, '月')
        }
      } catch {
        // 静默失败：成本检查失败不影响 token:stats 正常返回
      }
      return stats
    }
  )

  // ------------------------------------------------------------------
  // token:reset — 重置 token 统计
  // ------------------------------------------------------------------
  ipcMain.handle(TOKEN.RESET, async (): Promise<boolean> => {
    resetTokenStats()
    logger.info('IPC.TOKEN', `token:reset`)
    return true
  })

  // ------------------------------------------------------------------
  // token:records — 获取 token 使用明细记录（P-5 新增）
  // ------------------------------------------------------------------
  // 参数：(limit?: number) — 返回最近 N 条记录，默认 100，上限 1000
  // 返回：TokenUsageRecord[]（按时间正序，最近一条在末尾）
  // 用途：Token 监控面板展示明细列表 + 按 Subagent/Provider 分布图表
  ipcMain.handle(
    'token:records',
    async (_event, limit?: number): Promise<TokenUsageRecord[]> => {
      const safeLimit = Math.max(1, Math.min(1000, limit ?? 100))
      const records = getTokenRecords(safeLimit)
      logger.debug('IPC.TOKEN', `token:records`, {
        limit: safeLimit,
        returned: records.length,
      })
      return records
    }
  )

  // ------------------------------------------------------------------
  // agent:paor — PAOR 自动循环（Plan→Act→Observe→Reflect 多步自主编排）
  // ------------------------------------------------------------------
  // 参数：(task: string, sshSessionId: string, maxIterations?: number)
  // 返回：PaorLoopResult（含完整迭代轨迹，可审计）
  // 推送：agent:paor:iteration — 每轮迭代实时进度（供 UI 展示）
  // 说明：方案书 v0.9 §3.2 PAOR 循环的生产入口。高危命令自动拦截（安全默认），
  //       如需人工审批交互，后续版本接入 sandbox:approval-request 通道。
  ipcMain.handle(
    'agent:paor',
    async (_event, task: string, sshSessionId: string, maxIterations?: number): Promise<unknown> => {
      const supervisor = getSupervisor()
      logger.info('IPC.AGENT', 'agent:paor 启动', {
        taskLength: task?.length ?? 0,
        sshSessionId,
        maxIterations,
      })
      try {
        const result = await supervisor.runPaorLoop(task, sshSessionId, {
          maxIterations: maxIterations ?? 5,
          onIteration: (iteration) => {
            safeSend(mainWindow, AGENT.PAOR_ITERATION, { sshSessionId, iteration })
          },
          // v2.11 任务拆解可视化：计划就绪/重规划后先行推送结构化 plan（复用同一通道）
          onPlan: (plan, planConfidence) => {
            safeSend(mainWindow, AGENT.PAOR_ITERATION, { sshSessionId, plan, planConfidence })
          },
          // v0.9.5 PAOR 人工审批：高危命令推送审批请求到渲染进程，等待用户响应
          approveRisk: async (command, level, description, stepIndex): Promise<boolean> => {
            const callId = `paor_${Date.now()}_${randomUUID().slice(0, 8)}`
            const payload: PaorApprovalRequest = {
              callId,
              command,
              riskLevel: level,
              riskDescription: description,
              origin: 'paor',
              stepIndex,
              timestamp: Date.now(),
            }
            logger.info('IPC.PAOR', '推送审批请求', { callId, command, level })
            safeSend(mainWindow, PAOR_APPROVAL_REQUEST_CHANNEL, payload)

            return new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => {
                pendingPaorApprovals.delete(callId)
                logger.warn('IPC.PAOR', '审批超时，自动拒绝', { callId })
                resolve(false)
              }, PAOR_APPROVAL_TIMEOUT_MS)
              pendingPaorApprovals.set(callId, { resolve, timeout })
            })
          },
        })
        logger.info('IPC.AGENT', 'agent:paor 完成', {
          status: result.status,
          iterations: result.iterations.length,
          durationMs: result.durationMs,
        })
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('IPC.AGENT', 'agent:paor 异常', { error: msg })
        return { status: 'abort', plan: { goal: task, steps: [], risks: [], verification: '' }, planConfidence: 0, iterations: [], summary: `PAOR 循环异常：${msg}`, durationMs: 0 }
      }
    }
  )

  // ------------------------------------------------------------------
  // paor:approve — PAOR 人工审批响应（v0.9.5 新增）
  // ------------------------------------------------------------------
  // 参数：(callId: string, approved: boolean)
  // 返回：boolean（是否成功处理审批响应）
  // 说明：渲染进程用户点击"批准/拒绝"后调用，resolve agent:paor 中挂起的 approveRisk Promise
  // 安全：approved 是跨进程外部输入，只有字面 true 算批准（见 core/security/approval.ts）
  ipcMain.handle(
    'paor:approve',
    async (_event, callId: string, approvedRaw: unknown): Promise<boolean> => {
      const approved = readApproval(approvedRaw)
      if (typeof approvedRaw !== 'boolean') {
        logger.warn('IPC.PAOR', 'paor:approve 批准位非布尔，按拒绝处理', {
          callId,
          type: typeof approvedRaw,
        })
      }
      const pending = pendingPaorApprovals.get(callId)
      if (!pending) {
        logger.warn('IPC.PAOR', 'paor:approve 收到未知 callId', { callId })
        return false
      }
      clearTimeout(pending.timeout)
      pendingPaorApprovals.delete(callId)
      pending.resolve(approved)
      logger.info('IPC.PAOR', `paor:approve 用户${approved ? '批准' : '拒绝'}`, { callId })
      return true
    }
  )

  logger.info('IPC.AGENT', `Agent Runtime IPC handlers 已注册`, {
    channels: [
      'agent:chat',
      'agent:chat:cancel',
      'agent:paor',
      'paor:approve',
      'provider:list',
      'provider:get',
      'provider:save',
      'provider:set-default',
      'provider:get-default',
      'token:stats',
      'token:reset',
      'token:records',
    ],
    pushChannels: [
      AGENT_CHUNK_CHANNEL,
      AGENT_DONE_CHANNEL,
      AGENT_ERROR_CHANNEL,
      AGENT.PAOR_ITERATION,
      PAOR_APPROVAL_REQUEST_CHANNEL,
    ],
    // v0.9.4 新增能力：sessionId + abort signal（向后兼容，旧调用方不受影响）
    v094Features: [
      'agent:chat 第 4 个参数 sessionId（可选，未提供时主进程自动生成并通过事件 payload 回传）',
      'agent:chat:cancel 兼容 sessionId 与 correlationId 两种 ID',
      'agent:chunk / agent:done / agent:error 事件 payload 新增可选 sessionId 字段',
      'session-registry 集中维护 sessionId → AbortController Map，TTL 30 分钟自动清理',
    ],
  })
}
