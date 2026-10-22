/**
 * Agent Store（v0.9 Supervisor Agent 状态管理）
 *
 * 职责：
 * - 管理与 Supervisor Agent 的对话消息（AgentMessage）
 * - 跟踪流式输出状态 + 当前 correlationId（用于取消请求）
 * - 持有当前思考强度（fast / standard / deep）
 * - 持有当前选择的 Provider ID
 * - 持有 Provider 列表（从 IPC provider:list 加载）
 * - 持有 Token 统计聚合（从 IPC token:stats 加载）
 *
 * 与 ai-store 的关系：
 * - ai-store 只剩终端→输入框的预填通道（prefillMessage / prefillAt / setPrefillMessage）
 * - 对话消息、流式标志、Provider、Token 统计都在这里，v0.8 那套旧 AgentWorkflow 状态已删
 * - 界面上的对话一律读这一份，别再找第二个 messages
 *
 * 流式输出流程：
 * 1. 用户发送消息 → 调用 agentChat IPC → 返回 correlationId
 * 2. 监听 onAgentChunk → appendToken 追加到当前 assistant 消息
 * 3. 监听 onAgentDone → finalizeMessage 标记完成 + 更新 tokenStats
 * 4. 监听 onAgentError → 标记错误 + 清理 streaming 状态
 *
 * 方案书依据：v0.9 §3（Provider 抽象）+ §5（Token 监控）+ §6（思考强度）
 */
import { create } from 'zustand'
import type {
  PersistedProviderConfig,
  ThinkingStrength,
  TokenStats,
  CostStats,
  AgentChunkPayload,
  AgentDonePayload,
  AgentErrorPayload,
  AgentToolEventPayload,
  LlmErrorCode,
} from '@shared/agent-types'
import { emptyTokenStats } from '@shared/agent-types'
import type { AgentWorkflowState } from '@shared/models'
import { estimateTokens, resolveCompactionThresholds } from '@shared/context-budget'
import { acceptsStream, lastIndexWhere, ownsStream, replaceAt } from '@/lib/messageSync'
import { buildCompactionNote, formatTokens } from '@/components/workbench/context-usage'

/**
 * Agent 对话消息（扩展 ChatMessage，含元信息）
 */
/**
 * 上下文压缩结果（v2.11 诚实化：让 UI 能准确反馈“压了多少 / 无需压缩”）
 */
export interface CompressResult {
  /** 是否发生了压缩（false = 对话较短或流式中，未变） */
  compressed: boolean
  /** 被合并丢弃的消息条数 */
  droppedMessages: number
  /** 被合并的估算 tokens（与主进程同一把尺算出来的，不是字符数） */
  droppedTokens: number
}

export interface AgentMessage {
  /** 消息唯一 ID */
  id: string
  /** 角色（user / assistant / system） */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容 */
  content: string
  /** 时间戳（ms） */
  timestamp: number
  /** 关联的 chat correlationId（assistant 消息用，便于追踪） */
  correlationId?: string
  /** 是否正在流式输出（assistant 消息用） */
  isStreaming?: boolean
  /**
   * 这条是被用户"停止"打断的半截回答（done 事件带 finishReason='cancelled' 时置真）
   *
   * 没有它，界面上"我点了停止"与"模型说完了"是同一个样子：内容停在中途、流动态关掉、
   * 其余什么都没有（2026-10-22 调研 P0-2）。用量那侧还有一句：取消时如果没拿到账，
   * finalizeMessage 会把主进程补发的 0 撤成"未知"，因为 0 是一个事实陈述而它并不是事实。
   */
  cancelled?: boolean
  /** 是否出错（assistant 消息用，error 内容来自 AgentErrorPayload） */
  isError?: boolean
  /**
   * 错误原文（assistant 消息用）
   *
   * 以前是把 `[错误] xxx` 拼进 content 尾部。那样有三个后果：
   * 1. 已经流出来的半截答案和错误混成一段，整块按错误样式渲染，答案跟着变红；
   * 2. 同一条错误又被 lastError 那条横幅再显示一遍（用户 2026-10-16："agent失败的UI太丑了"）；
   * 3. content 是发给模型的历史，掺进错误行等于每轮都把报错当上下文再喂一次。
   * 现在错误单独放这里，content 只装真说过的话。
   */
  errorMessage?: string
  /** 错误分类码（来自 AgentErrorPayload.code）：决定那条错误下面给哪个"下一步"按钮 */
  errorCode?: LlmErrorCode
  /**
   * 这条消息属于哪个 SSH 会话（undefined = 本机/未连接）
   *
   * 对话历史必须按会话隔离：A 机聊过的内容不能作为上下文发给 B 机，
   * 否则模型会拿着 A 的命令块去 B 上执行（2026-10-21 全维度审查 D2）。
   */
  sshSessionId?: string
  /** 触发的 Provider ID（assistant 消息用，用于展示） */
  providerId?: string
  /** 实际使用的模型名（assistant 消息用，done 事件回填） */
  model?: string
  /** 本次调用的 token 使用（done 事件回填） */
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  /**
   * 本轮结束时对话真实占用的 tokens（done 事件回填，徽章分子用这个）
   *
   * 与 usage.inputTokens 的区别：后者是各步之和（多步工具链把同一份上下文数了 N 遍），
   * 只能用来计费；拿它除以窗口得到的百分比是虚高的假读数。
   */
  contextTokens?: number
  /** 主进程本轮做了上下文压缩时的说明（不压缩则没有这一行） */
  contextNote?: string
  /**
   * CoT 熵轨迹（v0.9.6 P2 M5+ 新增，可选）
   *
   * 由主进程 CotTraceCollector 在流式过程中累积，每步一个 Shannon 熵 ∈ [0, 1]。
   * done 事件回填到对应 assistant 消息，供 DecisionCard 渲染时透传到可信度评估。
   *
   * 数据来源（详见 src/main/core/agent/credibility/mass-functions/cot-trace-collector.ts）：
   * 1. Anthropic Claude with thinking（最高优先级）
   * 2. Reasoning model 多 turn（次优先级）
   * 3. 文本启发式 fallback（按句子切分）
   *
   * 透传路径：ChatResult.cotEntropyTrajectory → agent-store → DecisionCard prop
   *   → buildCredibilityInputs → S3 ai-param.fields.cotEntropyTrajectory
   *   → IPC credibility:assess → createAiParamMassFunction → CoT-shape 融合
   *
   * 论文依据：Zhao 2026, arXiv:2603.18940
   */
  cotEntropyTrajectory?: number[]
  /** Agent 工作流状态（onAgentStep 推送，仅 assistant 消息） */
  stepState?: AgentWorkflowState | null
  /**
   * 深度思考链内容（v2.5，仅 assistant 消息）
   *
   * DeepSeek 思考模式（strength='deep'）下由 kind='reasoning' 的 agent:chunk 累积，
   * LiveMessageRow 渲染为可折叠的“深度思考”块（流式中默认展开，完成后收起）。
   */
  reasoning?: string
  /**
   * 工具调用轨迹（v2.4 新增，仅 assistant 消息）
   *
   * 记录本条回复过程中 Agent 【真实执行】的工具调用（如 ssh_readonly 诊断命令），
   * 由 agent:tool-event 事件驱动。每个元素是一次工具调用（call→result 合并）。
   */
  toolEvents?: AgentToolCall[]
}

/**
 * 单次工具调用记录（call 与 result 按 toolCallId 合并）
 */
export interface AgentToolCall {
  toolCallId: string
  toolName: string
  /** 调用入参（如命令文本） */
  input?: string
  /** 是否完成（收到 result） */
  done: boolean
  /** 是否成功 */
  ok?: boolean
  /** 输出摘要 */
  output?: string
  /**
   * 工具自己报的命中条数（result 阶段）。
   * 界面徽标只在这个数存在时才显示数字；没有就只说成/败，
   * 不再用正则去摘要文本里数编号行（那会把"输出不是编号列表"判成"无结果"）。
   */
  count?: number
  /**
   * 文本锚点（v2.8）：call 事件到达时正文已流出的字符数。
   * LiveMessageRow 据此把工具卡穿插到流式输出的真实发生位置，
   * 而不是全部堆在消息尾部。
   */
  anchorOffset?: number
}

/**
 * 工具事件该落在哪条 assistant 消息上（#86）
 *
 * 优先"正在流的那条"；对不上就按 correlationId 认领自己那条 ——
 * 工具结果常常晚于 agent:done 到达，那时消息已收尾，只认 isStreaming 会把终态丢掉，
 * 界面上那张命令卡就永远停在"运行中"。
 * 两边都对不上返回 -1（丢弃）：不凭空造消息，也不写进另一轮的回答。
 */
function findToolEventTarget(messages: readonly AgentMessage[], correlationId?: string): number {
  const streaming = lastIndexWhere(messages, (m) => m.role === 'assistant' && m.isStreaming === true)
  if (streaming >= 0 && ownsStream(messages[streaming].correlationId, correlationId)) return streaming
  if (correlationId) {
    return lastIndexWhere(messages, (m) => m.role === 'assistant' && m.correlationId === correlationId)
  }
  return streaming
}

/**
 * 默认 Token 统计（初始化时用；与 TokenUsageChart 的首屏空态同一份构造）
 */
const DEFAULT_TOKEN_STATS: TokenStats = emptyTokenStats()

/**
 * 默认成本统计（v0.9.3 §11 改进点 26 P2-F 新增）
 *
 * 与 DEFAULT_TOKEN_STATS 对应，用于 Token 监控面板展示 USD 成本。
 * 初始值全 0，由 useAgentChat 在挂载时通过 IPC token:cost-stats 加载。
 */
const DEFAULT_COST_STATS: CostStats = {
  todayCost: 0,
  weekCost: 0,
  monthCost: 0,
  totalCost: 0,
  bySubagent: {},
  byProvider: {},
}

/**
 * Agent Store 状态接口
 */
interface AgentState {
  // ===== 状态 =====
  /** 对话消息列表 */
  messages: AgentMessage[]
  /** 是否正在流式输出 */
  isStreaming: boolean
  /** 当前进行中的 chat correlationId（用于取消请求） */
  currentCorrelationId: string | null
  /** 当前思考强度（v2.10：'auto' = 按复杂度自动路由） */
  thinkingStrength: ThinkingStrength | 'auto'
  /** 当前选择的 Provider ID */
  selectedProviderId: string | null
  /** Provider 列表（从 IPC 加载，不含 apiKey） */
  providers: PersistedProviderConfig[]
  /** Token 统计聚合 */
  tokenStats: TokenStats
  /**
   * 成本统计聚合（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * 与 tokenStats 对应，展示 USD 成本（todayCost/weekCost/monthCost/totalCost + by 维度）。
   * 由 useAgentChat 通过 IPC token:cost-stats 加载，并在 agent:done 事件后刷新。
   */
  costStats: CostStats
  /**
   * 本次会话成本基线（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * 在 useAgentChat 首次加载 costStats 时记录 totalCost 作为基线。
   * sessionCost = currentTotalCost - sessionCostBaseline（≥0）。
   * 用于"本次会话累计成本：$X.XX"展示，让用户感知当前会话的真实开销。
   * 初始为 null（未加载过 costStats），加载后为非负数字。
   */
  sessionCostBaseline: number | null
  /** 最近一次错误（来自 AgentErrorPayload） */
  lastError: string | null

  // ===== Actions =====
  /** 添加消息 */
  addMessage: (message: AgentMessage) => void
  /** 追加流式 token 到最后一条 assistant 消息 */
  appendToken: (payload: AgentChunkPayload) => void
  /** 完成消息（done 事件回填 usage/model 等） */
  finalizeMessage: (payload: AgentDonePayload) => void
  /** 标记错误 */
  markError: (payload: AgentErrorPayload) => void
  /** 更新当前流式消息的 stepState */
  updateStepState: (stepState: AgentWorkflowState) => void
  /**
   * 追加/更新工具调用事件（v2.4）
   *
   * call 阶段：新增一条 AgentToolCall；output 阶段（v2.6）：按 toolCallId 累积流式输出；
   * result 阶段：按 toolCallId 找到并补全 done/ok/output。
   * correlationId（#86）：认领这是哪一轮回答的工具事件；没带则退回"正在流的那条"。
   *
   * 入参形状直接取 IPC 载荷类型（sessionId 这一路用不上），
   * 这里以前手抄过一份字段清单——契约加 count 那次就是靠这个才发现两处会漏。
   */
  appendToolEvent: (
    evt: Omit<AgentToolEventPayload, 'sessionId' | 'correlationId'> & { correlationId?: string },
  ) => void
  /** 清空所有消息 */
  clearMessages: () => void
  /**
   * 上下文压缩：保留 system 消息 + 最近一段（按主进程同一把尺的 tokens 预算），
   * 中间历史合并为一条本地提要。
   *
   * 保留量以前固定"最近 6 条"——对 8K 窗口的本地模型太多、对 200K 的长文本模型太少，
   * 而且与主进程的 L2/L3 阈值是两套互不相认的判据（同一件事的第四把尺）。
   * 现在预算取自 shared/context-budget，压缩按钮与真实发出去的请求按同一口径决定留多少。
   */
  compressMessages: (opts?: { windowTokens?: number }) => CompressResult
  /** 设置流式输出状态 */
  setStreaming: (streaming: boolean) => void
  /** 设置当前 correlationId */
  setCurrentCorrelationId: (id: string | null) => void
  /** 设置思考强度（v2.10：含 'auto'） */
  setThinkingStrength: (strength: ThinkingStrength | 'auto') => void
  /** 设置选中的 Provider ID */
  setSelectedProviderId: (id: string | null) => void
  /** 设置 Provider 列表（从 IPC 加载后调用） */
  setProviders: (providers: PersistedProviderConfig[]) => void
  /** 设置 Token 统计 */
  setTokenStats: (stats: TokenStats) => void
  /**
   * 设置成本统计（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * 同时处理 sessionCostBaseline：
   * - 如果当前 sessionCostBaseline 为 null（首次加载），则记录当前 totalCost 作为基线
   * - 否则保留现有基线，仅更新 costStats
   */
  setCostStats: (stats: CostStats) => void
  /**
   * 重置本次会话成本基线（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * 用户主动"重置会话成本"或清空对话时调用，将基线设为当前 totalCost，
   * 让"本次会话"从 0 重新累计。
   */
  resetSessionCostBaseline: () => void
}

/**
 * 徽章分子：最近一条 assistant 消息的真实占用（末步口径）。
 *
 * 单独成一个函数是因为这里有一个容易写错的取舍：`usage.inputTokens` 是各步之和，
 * 带工具的对话最多 12 步，同一份上下文被数了 12 遍——拿它当"窗口还剩多少"会虚高一个量级。
 * 老消息（回填前产生的）没有 contextTokens，才退回 inputTokens。
 */
/**
 * 只取发给模型的对话历史，且只取当前 SSH 会话那部分。
 *
 * 不按会话过滤时，切到 B 机后历史里还带着 A 机的命令块，模型会拿着 A 的上下文
 * 在 B 上执行（2026-10-21 全维度审查 D2）。旧消息没有 sshSessionId 字段，
 * 对远程会话一律不发送——安全侧多排除一点，代价只是升级后第一轮少一点旧上下文。
 */
export function historyForSession(
  messages: readonly AgentMessage[],
  sshSessionId: string | undefined
): AgentMessage[] {
  return messages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      m.sshSessionId === sshSessionId
  )
}

export function latestContextTokens(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && (m.contextTokens !== undefined || m.usage)) {
      return m.contextTokens ?? m.usage?.inputTokens ?? 0
    }
  }
  return 0
}

/**
 * 最近一条用户提问（错误行上的"重试"要重发的就是它）。
 * 找不到返回 null——空对话里"重试"没有对象，界面也就不该出现这个按钮。
 */
export function latestUserQuestion(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && m.content.trim()) return m.content
  }
  return null
}

/**
 * Agent Store（zustand）
 */
export const useAgentStore = create<AgentState>()((set) => ({
  // ===== 初始状态 =====
  messages: [],
  isStreaming: false,
  currentCorrelationId: null,
  thinkingStrength: 'auto',
  selectedProviderId: null,
  providers: [],
  tokenStats: DEFAULT_TOKEN_STATS,
  costStats: DEFAULT_COST_STATS,
  sessionCostBaseline: null,
  lastError: null,

  // ===== Actions =====

  // 添加消息
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  /**
   * 追加流式 token 到最后一条 assistant 消息
   *
   * 会话归属：payload 必须对上 currentCorrelationId，否则整条丢弃。
   * 挡的是"切走又切回"期间旧流在途的 chunk 落进新回答；以前靠反向扫描
   * 找匹配，找不到就悄悄写到更早一条已完成的 assistant 消息上。
   */
  appendToken: (payload) =>
    set((state) => {
      if (!acceptsStream(state.currentCorrelationId, payload.correlationId)) return state
      const idx = lastIndexWhere(state.messages, (m) => m.role === 'assistant')
      if (idx < 0) return state
      const msg = state.messages[idx]
      if (payload.correlationId && msg.correlationId && msg.correlationId !== payload.correlationId) {
        return state
      }
      const next =
        payload.kind === 'reasoning'
          ? { ...msg, reasoning: (msg.reasoning ?? '') + payload.delta, isStreaming: true }
          : { ...msg, content: msg.content + payload.delta, isStreaming: true }
      const messages = replaceAt(state.messages, idx, next)
      return messages ? { messages } : state
    }),

  /**
   * 完成消息（done 事件回填 usage/model/providerId/cotEntropyTrajectory 等）
   *
   * done 是 CRITICAL 类：不认会话闸门，而是按 correlationId 认领自己那条，
   * 迟到的 done 仍要把自己那条消息关掉，不能因为切了会话就让它永远卡在 streaming。
   * 但绝不代关别人的消息 —— currentCorrelationId 只在相等时才清。
   */
  finalizeMessage: (payload) =>
    set((state) => {
      const idx = lastIndexWhere(
        state.messages,
        (m) => m.role === 'assistant' && ownsStream(m.correlationId, payload.correlationId)
      )
      if (idx < 0) {
        return state.currentCorrelationId === payload.correlationId
          ? { isStreaming: false, currentCorrelationId: null }
          : state
      }
      const msg = state.messages[idx]
      // v0.9.6 P2 M5+：回填 CoT 熵轨迹（可选，undefined / 空数组不写）
      const cotTrajectory =
        payload.result.cotEntropyTrajectory && payload.result.cotEntropyTrajectory.length > 0
          ? payload.result.cotEntropyTrajectory
          : msg.cotEntropyTrajectory
      const cancelled = payload.result.finishReason === 'cancelled'
      /*
       * 取消那一轮：主进程的用量拿不到时会补一串 0（它的类型不允许 undefined）。
       * 一串 0 到这里已经分不出"真的一个 token 都没烧"与"没拿到账"，
       * 而徽章要说的恰恰是后者——所以 cancelled 且全 0 时按"未知"处理，
       * 真拿到部分用量（cancel 前流里已经回报过）则原样保留。
       */
      const rawUsage = payload.result.usage
      const usageUnknownAfterCancel =
        cancelled &&
        !!rawUsage &&
        rawUsage.inputTokens === 0 &&
        rawUsage.outputTokens === 0 &&
        rawUsage.totalTokens === 0
      const messages = replaceAt(state.messages, idx, {
        ...msg,
        isStreaming: false,
        ...(cancelled ? { cancelled: true } : {}),
        providerId: payload.result.providerId,
        model: payload.result.model,
        usage: usageUnknownAfterCancel ? undefined : payload.result.usage,
        contextTokens: payload.result.contextTokens,
        contextNote: buildCompactionNote(payload.result) ?? undefined,
        cotEntropyTrajectory: cotTrajectory,
      })
      const closesCurrent = state.currentCorrelationId === payload.correlationId
      return {
        ...(messages ? { messages } : {}),
        ...(closesCurrent ? { isStreaming: false, currentCorrelationId: null } : {}),
      }
    }),

  /**
   * 标记错误
   *
   * 与 finalizeMessage 同一条认领规则：按 correlationId 找自己那条，
   * lastError 始终记录（它是全局提示，不属于任何一条消息）。
   */
  markError: (payload) =>
    set((state) => {
      const idx = lastIndexWhere(
        state.messages,
        (m) => m.role === 'assistant' && ownsStream(m.correlationId, payload.correlationId)
      )
      const closesCurrent = state.currentCorrelationId === payload.correlationId
      const base = closesCurrent
        ? { isStreaming: false, currentCorrelationId: null }
        : {}
      if (idx < 0) return { ...base, lastError: payload.message }
      const msg = state.messages[idx]
      const messages = replaceAt(state.messages, idx, {
        ...msg,
        isStreaming: false,
        isError: true,
        // 分类码一起留下：界面按它给"下一步"按钮，光有一段中文错误用户只能重发试试
        errorCode: payload.code,
        // 错误原文单独放，不再拼进 content（见 AgentMessage.errorMessage 的三条后果）
        errorMessage: payload.message,
      })
      return { ...(messages ? { messages } : {}), ...base, lastError: payload.message }
    }),

  // 更新当前流式消息的 stepState（onAgentStep 推送）
  updateStepState: (stepState) =>
    set((state) => {
      const next = [...state.messages]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant' && next[i].isStreaming) {
          next[i] = { ...next[i], stepState }
          break
        }
      }
      return { messages: next }
    }),

  // 追加/更新工具调用事件（v2.4；#86：按 correlationId 认领消息，迟到的终态不再丢）
  appendToolEvent: (evt) =>
    set((state) => {
      const idx = findToolEventTarget(state.messages, evt.correlationId)
      if (idx < 0) return state
      const msg = state.messages[idx]
      const events = [...(msg.toolEvents ?? [])]
      if (evt.phase === 'call') {
        const existIdx = events.findIndex((e) => e.toolCallId === evt.toolCallId)
        if (existIdx < 0) {
          events.push({
            toolCallId: evt.toolCallId,
            toolName: evt.toolName,
            input: evt.input,
            done: false,
            // v2.8：记录此刻正文长度作为穿插锚点（工具卡渲染在流式文本的真实发生位置）
            anchorOffset: msg.content.length,
          })
        } else {
          // output 早于 call 到达时记录已建好：call 仍要把入参补上（查询/命令文本），锚点缺才补
          events[existIdx] = {
            ...events[existIdx],
            input: evt.input ?? events[existIdx].input,
            anchorOffset: events[existIdx].anchorOffset ?? msg.content.length,
          }
        }
      } else if (evt.phase === 'output') {
        // v2.6 流式中间输出：按 toolCallId 累积到 output（上限 12000 字符，与主进程推送上限一致）；
        // 找不到时新增一条未完成记录（output 事件可能早于 fullStream 的 call 分片到达）
        const idx2 = events.findIndex((e) => e.toolCallId === evt.toolCallId)
        const chunk = evt.output ?? ''
        if (idx2 >= 0) {
          const prev = events[idx2].output ?? ''
          if (prev.length < 12000) {
            events[idx2] = { ...events[idx2], output: (prev + chunk).slice(0, 12000) }
          }
        } else {
          events.push({
            toolCallId: evt.toolCallId,
            toolName: evt.toolName,
            done: false,
            output: chunk.slice(0, 12000),
            anchorOffset: msg.content.length,
          })
        }
      } else {
        // result：按 toolCallId 回填；找不到则新增一条已完成记录。
        // v2.6：若已有流式累积输出且执行成功，保留累积内容（比 result 摘要更完整）；
        // 失败时用 result 的错误信息覆盖。
        const idx2 = events.findIndex((e) => e.toolCallId === evt.toolCallId)
        if (idx2 >= 0) {
          const streamed = events[idx2].output
          const finalOutput =
            evt.ok !== false && streamed ? streamed : (evt.output ?? streamed)
          events[idx2] = {
            ...events[idx2],
            done: true,
            ok: evt.ok,
            count: evt.count ?? events[idx2].count,
            output: finalOutput,
          }
        } else {
          events.push({
            toolCallId: evt.toolCallId,
            toolName: evt.toolName,
            done: true,
            ok: evt.ok,
            count: evt.count,
            output: evt.output,
            anchorOffset: msg.content.length,
          })
        }
      }
      const next = replaceAt(state.messages, idx, { ...msg, toolEvents: events })
      return next ? { messages: next } : state
    }),

  // 清空所有消息
  clearMessages: () =>
    set({
      messages: [],
      isStreaming: false,
      currentCorrelationId: null,
      lastError: null,
    }),

  // 上下文压缩：保留 system 消息 + 最近一段（预算按 shared 那把尺 + 这台模型的窗口算），
  // 中间历史合并为一条本地提要。返回真实压缩结果供 UI 准确反馈。
  // 注意这是本地截断（非 AI 语义摘要），快是设计使然；但留多少不再拍一个固定条数。
  compressMessages: (opts) => {
    let result: CompressResult = { compressed: false, droppedMessages: 0, droppedTokens: 0 }
    set((state) => {
      if (state.isStreaming || state.messages.length === 0) return state

      // 与主进程 compactIfNeeded 用的是同一个函数、同一组比例
      const budget = resolveCompactionThresholds(opts?.windowTokens ?? 0).keepRecentTokens
      const systemMessages = state.messages.filter((m) => m.role === 'system')
      const chatMessages = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant')

      // 从尾部往前累加，装进预算的那一段才保留；至少留 2 条，避免整段对话被自己压没
      let used = 0
      let splitIdx = chatMessages.length
      for (let i = chatMessages.length - 1; i >= 0; i--) {
        const t = estimateTokens(chatMessages[i].content ?? '')
        if (used + t > budget && chatMessages.length - i > 2) break
        used += t
        splitIdx = i
      }

      const kept = chatMessages.slice(splitIdx)
      const dropped = chatMessages.slice(0, splitIdx)

      // 一条都没剪就没什么可报告的，列表原样返回
      if (dropped.length === 0) return state

      const userCount = dropped.filter((m) => m.role === 'user').length
      const assistantCount = dropped.filter((m) => m.role === 'assistant').length
      const droppedTokens = dropped.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0)

      // 本地提要：提取被压缩段落的主题片段（启发式，非 AI 摘要）
      const snippets = dropped
        .filter((m) => m.role === 'user')
        .map((m) => m.content.slice(0, 40))
        .filter(Boolean)
        .slice(0, 3)
      const topicNote = snippets.length > 0 ? `涉及主题：${snippets.join('；')}。` : ''
      const summaryText =
        `[上下文已压缩（本地）] 已将较早的 ${userCount} 轮提问 / ${assistantCount} 条回复` +
        `（约 ${formatTokens(droppedTokens)} tokens）合并为提要，保留最近 ${kept.length} 条。${topicNote}`

      const summaryMessage: AgentMessage = {
        id: `compress_${Date.now()}`,
        role: 'assistant',
        content: summaryText,
        timestamp: Date.now(),
      }

      result = { compressed: true, droppedMessages: dropped.length, droppedTokens }
      return { messages: [...systemMessages, summaryMessage, ...kept] }
    })
    return result
  },

  // 设置流式输出状态
  setStreaming: (streaming) => set({ isStreaming: streaming }),

  // 设置当前 correlationId
  setCurrentCorrelationId: (id) => set({ currentCorrelationId: id }),

  // 设置思考强度
  setThinkingStrength: (strength) => set({ thinkingStrength: strength }),

  // 设置选中的 Provider ID
  setSelectedProviderId: (id) => set({ selectedProviderId: id }),

  // 设置 Provider 列表
  setProviders: (providers) => set({ providers }),

  // 设置 Token 统计
  setTokenStats: (stats) => set({ tokenStats: stats }),

  // 设置成本统计（v0.9.3 §11 改进点 26 P2-F）
  // 首次加载时记录 sessionCostBaseline，后续保留基线只更新 costStats
  setCostStats: (stats) =>
    set((state) => ({
      costStats: stats,
      sessionCostBaseline:
        state.sessionCostBaseline === null ? stats.totalCost : state.sessionCostBaseline,
    })),

  // 重置本次会话成本基线（用户主动重置时调用）
  resetSessionCostBaseline: () =>
    set((state) => ({
      sessionCostBaseline: state.costStats.totalCost,
    })),
}))
