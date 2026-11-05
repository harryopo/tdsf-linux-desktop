/**
 * Agent Runtime IPC Handlers（v0.9 新增）
 *
 * 注册 v0.9 引入的 Supervisor Agent + Provider 抽象 + Token 统计相关的 IPC 通道。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - agent:chat          — 启动 supervisor 流式 chat（异步，通过事件推送 token/done/error）
 * - agent:chat:cancel   — 取消进行中的 chat 请求（注意：旧 agent:cancel 是 AgentWorkflow 通道，不冲突）
 * - provider:list       — 列出所有 Provider（仅 enabled 或全部）
 * - provider:save       — 保存 Provider（apiKey 单独走 SecureStore）
 * - provider:set-default — 设置默认 Provider ID（P-6：统一为 kebab-case，与 sandbox:approval-request 等保持一致）
 * - token:stats         — 获取 token 统计聚合
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
import { approvalTransport, broadcastToWindows } from '../windows/main-window'
import type { ModelMessage } from 'ai'
import { AGENT } from '@shared/ipc-channels'
import { getSupervisor } from '../core/agent/supervisor'
import {
  listProviders,
  saveProvider,
  setDefaultProviderId,
  getDefaultProviderId,
  ensureProvidersInitialized,
  // v2.3.7 修复：PersistedProviderConfigWithKey 是 registry 内部类型，不再 re-export 自 types
  type PersistedProviderConfigWithKey,
} from '../core/agent/providers/provider-registry'
import { getTokenStats, getTokenRecords, getCostStats } from '../core/agent/providers/token-stats'
import { classifyLlmError } from '../core/agent/providers/llm-error'
import type {
  ProviderConfig,
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
import {
  APPROVAL_REQUEST_CHANNEL,
  requestApproval,
  settleApproval,
} from '../core/security/approval-request'
import type { ChatMessage } from '@shared/models'
import { logger } from '../services/log/logger'
// v2.4 Phase B：预算告警检查（token 月成本超阈值时记录到 budget_alerts 表）
import { ConfigStore } from '../services/storage/config-store'
import { alertTokenBudgetExceeded } from '../services/llm/budget-alerter'
// v0.9.4 新增：session-registry 集中维护 sessionId → AbortController Map，支持 abort signal + TTL 清理
import { getSessionRegistry } from '../core/agent/session-registry'
// D2：审批判定唯一权威 —— 只有字面 true 算批准
import { readApproval } from '../core/security/approval'
// #173：外部 MCP 工具并进主对话（取数、逐次审批、拒绝留痕都从这三个入口走）
import { McpGateway } from '../core/agent/mcp-gateway'
import { buildExternalChatTools } from '../core/agent/tools/external-mcp-tools'
import { emitBlockTrace } from '../core/command-gate'
import { RunRegistry, type RunFailureReason } from '../core/agent/run-registry'
import type { RunSnapshot } from '@shared/run-types'

/** 流式 token 推送通道名 */
const AGENT_CHUNK_CHANNEL = AGENT.CHUNK
/** 流式完成信号通道名 */
const AGENT_DONE_CHANNEL = AGENT.DONE
/** 流式错误信号通道名 */
const AGENT_ERROR_CHANNEL = AGENT.ERROR
/** 工具调用事件推送通道名（v2.4：真实工具执行可视化） */
const AGENT_TOOL_EVENT_CHANNEL = AGENT.TOOL_EVENT

/**
 * Agent 运行的唯一生命周期真相源（2026-11-03）
 *
 * 原来这里有一张 paorRuns，supervisor 有 activeRequests，session-registry 有 abortController，
 * 审批还有一张挂起表——四处各记各的账，终态只靠"往活着的窗口 send 一下"。
 * 现在：
 * - begin 以 sshSessionId 为粒度互锁：同会话的 chat 与 PAOR 不会同时向外发命令；
 * - finish 先落终态（persist → Run.state → 通知），订阅者晚到也能补发，终态恰好一次；
 * - 每轮 Run 的 controller 与 supervisor / session-registry 共用同一个对象；
 * - 审批请求登记在 Run 上，取消时随 Run 一起收尾。
 */
const runRegistry = new RunRegistry({
  // 任何终态（取消或完成/失败）都把挂着的审批立刻结算成拒绝：审批请求不吃 signal，
  // 不主动结算会让 Run 停在 cancelling 等 60 秒审批超时，期间这个会话一直被 busy 拒。
  onSettleApproval: (approvalId) => {
    if (settleApproval(approvalId, false)) {
      logger.info('IPC.AGENT', 'Run 收尾时已自动拒绝挂起的审批', { approvalId })
    }
  },
  persist: (run, outcome) => {
    // "先落盘再展示"的落点：终态先写进真相源与审计日志，之后才推送给界面。
    // 这里不记录 error 原文（红线：catch 脱敏），只记结构化字段。
    logger.info('IPC.AGENT', 'run 终态', {
      runId: run.id,
      kind: run.kind,
      sshSessionId: run.sshSessionId ?? null,
      state: outcome.state,
      failure: outcome.failure ?? null,
      durationMs: Date.now() - run.startedAt,
    })
  },
})

/** SSH 会话的 Run 键：一个会话同一时刻只允许一条 PAOR */
function paorRunId(sshSessionId: string): string {
  return `paor:${sshSessionId}`
}

/** 错误码 → Run 失败原因（只映射真实会走到的几档） */
function toRunFailure(errInfo: { code: AgentErrorPayload['code'] }): RunFailureReason {
  if (errInfo.code === 'CANCELLED') return 'aborted_by_user'
  if (errInfo.code === 'TIMEOUT') return 'budget_timeout'
  return 'provider_error'
}

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
 * 把这一轮 Run 的每次状态迁移推给渲染层（六态，含 `cancelling`）。
 *
 * 为什么必须紧贴 begin 调用：`subscribe` 只对"已终态"补发一次终态，
 * 订得晚了中间的 awaiting_approval / cancelling 就永远收不到。
 * 首次主动推一次 running，渲染层不必等第一次迁移才有基线。
 */
function watchRunState(mainWindow: BrowserWindow, runId: string): void {
  const push = (): void => {
    const snapshot = runRegistry.snapshot(runId)
    if (snapshot) safeSend(mainWindow, AGENT.RUN_STATE, snapshot)
  }
  runRegistry.subscribe(runId, push)
  push()
}

/**
 * 推送一次高危审批：等待器住在 `core/security/approval-request.ts`（单源）。
 * 这里只负责"要不要问"，超时、死线、挂起表都在那一份里——
 * 外部 MCP 工具调用（`ipc/mcp.ts`）问的是同一把表，两处不许各写一把 60 秒。
 */

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

      // 同会话互锁：这条 chat 要先拿到这个 SSH 会话的 Run 锁才允许启动。
      // 已经有 PAOR（或另一条对话）在跑时直接拒绝——两条同时下发命令的窗口在入口关掉。
      const begun = runRegistry.begin({ id: correlationId, kind: 'chat', sshSessionId })
      if (!begun.ok) {
        logger.warn('IPC.AGENT', 'agent:chat 被拒绝：同会话已有任务在跑', {
          correlationId,
          sshSessionId: sshSessionId ?? null,
          holderId: begun.existing.id,
          holderKind: begun.existing.kind,
        })
        throw new Error(
          '这个会话已有任务正在执行（对话或 PAOR），请等它结束或先点“停止”，再发送新的消息。'
        )
      }
      const chatRun = begun.run
      // 六态推给渲染层：begin 之后立刻订阅，中间态（awaiting_approval / cancelling）才收得到
      watchRunState(mainWindow, correlationId)

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
          // 取消入口与 Run 共用同一把 controller（RunRegistry 持有）
          abortController: chatRun.controller,
          // v2.9 写命令 HITL 审批：复用 PAOR 审批通道（paor:approval-request 卡片），
          // ssh_write 工具 execute 内 await 此回调，用户批准才真执行；60 秒超时自动拒绝
          approveWriteCommand: async (command, level, description): Promise<boolean> => {
            const callId = `write_${Date.now()}_${randomUUID().slice(0, 8)}`
            // 审批挂起登记到这一轮 Run 上：取消时随 Run 一起收尾，不再只存在于审批表里
            runRegistry.awaitApproval(correlationId, callId)
            try {
              return await requestApproval(approvalTransport(), {
                callId,
                command,
                riskLevel: level,
                riskDescription: description,
                // 对话里 AI 调写工具没有"计划第几步"这回事；原来两处都写死 stepIndex: 0，
                // 于是审批卡把这条例外也说成"PAOR 请求批准 — 第 1 步"，两个字段都是假的
                origin: 'chat',
                // 让界面知道这张卡属于哪一轮：用户点停止时，主进程会把挂着的审批
                // 结算成未批准，界面要能说出"是这一轮被停了"，而不是说"超时"
                runId: correlationId,
                timestamp: Date.now(),
              })
            } finally {
              runRegistry.settleApproval(correlationId, callId)
            }
          },
          /**
           * #173：外部 MCP 工具进主对话。
           * 取数只认"此刻真连上的"那几台（不为了挂工具去起子进程），
           * 每一次调用都先推同一张审批卡；没批准就落进拦截记录——
           * 与设置页那条走的是同一个出口，用户在「拦截记录」里能看到这一轮挡下了什么。
           */
          mountExternalTools: () =>
            buildExternalChatTools({
              tools: () => McpGateway.getInstance().getConnectedExternalTools(),
              approve: (input) => requestApproval(approvalTransport(), input),
              call: (serverId, toolName, args) =>
                McpGateway.getInstance().callExternalTool(serverId, toolName, args),
              onDenied: ({ serverId, serverName, toolName }) =>
                emitBlockTrace({
                  source: '外部 MCP 工具',
                  command: `外部 MCP「${serverName}」 · 工具 ${toolName}`,
                  reason: `AI 在对话里调用外部 MCP 工具未获批准：${serverId} · ${toolName}（含超时未响应）`,
                  riskLevel: 'block',
                }),
            }),
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
            // 终态先落（persist → Run.state），再推 UI：推送失败不会把"这一轮结束了"丢掉。
            // 取消中的 Run 必须由被中断方（这里）确认后才算 cancelled。
            if (chatRun.state === 'cancelling') runRegistry.confirmCancel(correlationId)
            else runRegistry.finish(correlationId, { ok: true, result })
            // 推送完成信号到渲染进程
            const payload: AgentDonePayload = { correlationId, result, sessionId: resolvedSessionId }
            safeSend(mainWindow, AGENT_DONE_CHANNEL, payload)
            // 请求结束，从 session-registry 移除（释放内存）
            registry.remove(resolvedSessionId)
          },
          onError: (error: Error) => {
            // 推送错误信号到渲染进程（错误信息已脱敏，不含 stack trace）
            const errInfo = toAgentError(error)
            // 先落终态再推 UI；取消中的 Run 由这里确认 cancelled
            if (chatRun.state === 'cancelling') runRegistry.confirmCancel(correlationId)
            else
              runRegistry.finish(correlationId, {
                ok: false,
                failure: toRunFailure(errInfo),
                error: errInfo.message,
              })
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
              // 决策事件的结构化字段（工具装配三组）原样透传；
              // 这里若漏掉，渲染层只能回退解析人类可读文本。
              meta: evt.meta,
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
          if (chatRun.state === 'cancelling') runRegistry.confirmCancel(correlationId)
          else
            runRegistry.finish(correlationId, {
              ok: false,
              failure: toRunFailure(errInfo),
              error: errInfo.message,
            })
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
      // Run 状态机只迁到 cancelling，**不落终态**：等被中断方（onDone / onError）确认停了，
      // 才由它调 confirmCancel 落到 cancelled。否则会出现"界面说已取消、后台还在发命令"。
      const runCancelOk = runRegistry.requestCancel(correlationId)

      const ok = registryOk || supervisorOk || runCancelOk
      logger.info('IPC.AGENT', `agent:chat:cancel`, {
        inputId: sessionIdOrCorrelationId,
        correlationId,
        registryOk,
        supervisorOk,
        runCancelOk,
        success: ok,
      })
      return ok
    }
  )

  // ------------------------------------------------------------------
  // agent:run:snapshot — 订阅方晚到补发当前 Run 的已知终态
  // ------------------------------------------------------------------
  // 参数：(runId, consumerId)
  // 返回：RunSnapshot | null —— 同一 consumerId 对同一条终态只领一次；
  //       非终态返回当前快照（它还会变，不能按终态消费）；未知 runId 返回 null。
  // 用途：窗口重建 / safeSend 失败 / 订阅者晚到时，渲染层重新挂载后不再永远等不到终态。
  ipcMain.handle(
    AGENT.RUN_SNAPSHOT,
    async (_event, runId: unknown, consumerId: unknown): Promise<RunSnapshot | null> => {
      if (typeof runId !== 'string' || !runId.trim()) return null
      if (typeof consumerId !== 'string' || !consumerId.trim()) return null
      return runRegistry.replayTerminal(runId, consumerId)
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
      // 一个会话同时只允许一条 PAOR（RunRegistry 连 chat 一起互锁）：
      // 两条同时跑会让"停止"和审批卡都指向不确定的那一条。
      const runId = paorRunId(sshSessionId)
      const begun = runRegistry.begin({ id: runId, kind: 'paor', sshSessionId })
      if (begun.ok) watchRunState(mainWindow, runId)
      if (!begun.ok) {
        logger.warn('IPC.AGENT', 'agent:paor 该会话已有任务在跑，拒绝重复启动', {
          sshSessionId,
          holderId: begun.existing.id,
          holderKind: begun.existing.kind,
        })
        return {
          status: 'abort',
          plan: { goal: task, steps: [], risks: [], verification: '' },
          planConfidence: 0,
          iterations: [],
          summary: '该会话已有任务在跑（对话或 PAOR），本次启动被拒绝',
          durationMs: 0,
        }
      }
      // 取消入口与 Run 共用同一把 controller
      const controller = begun.run.controller
      try {
        const result = await supervisor.runPaorLoop(task, sshSessionId, {
          signal: controller.signal,
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
            // 审批挂起登记到这一轮 Run 上：取消时随 Run 一起收尾
            runRegistry.awaitApproval(runId, callId)
            try {
              return await requestApproval(approvalTransport(), {
                callId,
                command,
                riskLevel: level,
                riskDescription: description,
                origin: 'paor',
                stepIndex,
                runId,
                timestamp: Date.now(),
              })
            } finally {
              runRegistry.settleApproval(runId, callId)
            }
          },
        })
        // 终态先落：取消中的 Run 由被中断方（这里）确认后才算 cancelled
        if (begun.run.state === 'cancelling') runRegistry.confirmCancel(runId)
        else runRegistry.finish(runId, { ok: true, result })
        logger.info('IPC.AGENT', 'agent:paor 完成', {
          status: result.status,
          iterations: result.iterations.length,
          durationMs: result.durationMs,
        })
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // 异常路径也要落终态，否则 Run 会一直挂在 running 上
        if (begun.run.state === 'cancelling') runRegistry.confirmCancel(runId)
        else runRegistry.finish(runId, { ok: false, failure: 'tool_error', error: msg })
        logger.error('IPC.AGENT', 'agent:paor 异常', { error: msg })
        return { status: 'abort', plan: { goal: task, steps: [], risks: [], verification: '' }, planConfidence: 0, iterations: [], summary: `PAOR 循环异常：${msg}`, durationMs: 0 }
      }
    }
  )

  // ------------------------------------------------------------------
  // agent:paor:cancel — 请求停止进行中的 PAOR 循环（2026-11-01）
  // ------------------------------------------------------------------
  // 参数：(sshSessionId: string)
  // 返回：boolean（false = 当前没有这个会话的循环在跑）
  // 说明：协作式停止——主进程在"下一轮开始前 / 下一次发命令前"退出，
  //       正在飞的那条远端命令会执行完。返回 true 只代表"停止请求已送达"，不代表已经停住。
  ipcMain.handle(
    AGENT.PAOR_CANCEL,
    async (_event, sshSessionId: unknown): Promise<boolean> => {
      if (typeof sshSessionId !== 'string' || !sshSessionId.trim()) {
        logger.warn('IPC.PAOR', 'agent:paor:cancel 入参非法，按未处理返回', {
          type: typeof sshSessionId,
        })
        return false
      }
      // requestCancel 只迁到 cancelling 并 abort controller；终态由 PAOR handler 确认。
      const requested = runRegistry.requestCancel(paorRunId(sshSessionId))
      if (!requested) {
        logger.info('IPC.PAOR', 'agent:paor:cancel 没有正在跑的循环', { sshSessionId })
        return false
      }
      logger.info('IPC.PAOR', 'agent:paor:cancel 已请求停止（当前步结束后生效）', { sshSessionId })
      return true
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
      const handled = settleApproval(callId, approved)
      if (!handled) {
        // 表里没有 = 已超时或从来没见过这张卡。返回 false，让界面知道"这次点击没落到任何等待者上"
        logger.warn('IPC.PAOR', 'paor:approve 收到未知 callId（多半已超时自动拒绝）', { callId })
        return false
      }
      return true
    }
  )

  logger.info('IPC.AGENT', `Agent Runtime IPC handlers 已注册`, {
    channels: [
      'agent:chat',
      'agent:chat:cancel',
      'agent:run:snapshot',
      'agent:paor',
      'agent:paor:cancel',
      'paor:approve',
      'provider:list',
      'provider:save',
      'provider:set-default',
      'provider:get-default',
      'token:stats',
      'token:records',
    ],
    pushChannels: [
      AGENT_CHUNK_CHANNEL,
      AGENT_DONE_CHANNEL,
      AGENT_ERROR_CHANNEL,
      AGENT.PAOR_ITERATION,
      APPROVAL_REQUEST_CHANNEL,
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
