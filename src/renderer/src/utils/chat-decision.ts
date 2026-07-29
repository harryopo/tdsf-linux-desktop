/**
 * chat-decision.ts — 主对话链路的决策/可信度数据构建工具（v2.5）
 *
 * 背景：DecisionCard / ConfidenceBreakdown / history:save 早已存在，
 * 但主对话（supervisor 流式）从未接线 —— 决策不落库、可信度不展示。
 * 本工具把聊天消息的【真实工具执行轨迹】转成算法层需要的 Evidence[]，
 * 并在用户批准执行命令时构建可落库的 DecisionCard 记录。
 *
 * 映射规则（全部来自真实 toolEvents，不造假数据）：
 * - ssh_readonly    → source='command'：真实命令输出，先验可信度高
 * - kb_search       → source='knowledge'：检索命中与否决定置信度
 * - tutorial_search → source='knowledge'
 * - skill_match     → source='knowledge'
 * - monitor_get     → source='metric'
 */
import type { AgentMessage, AgentToolCall } from '@/stores/agent-store'
import type { DecisionCard, Evidence, RiskAssessment } from '@shared/models'

/** 检索类输出是否为"无结果"（kb/tutorial 的 summary 以"未"开头） */
function isEmptySearchOutput(output: string | undefined): boolean {
  if (!output) return true
  return /^未/.test(output.trim())
}

/**
 * 把消息的真实工具执行轨迹转为 Evidence[]（供 6 源可信度评估 / 决策落库）
 *
 * 只转换已完成（done）的调用；未完成的调用没有产出，不能作为证据。
 */
export function toolEventsToEvidences(events: AgentToolCall[] | undefined): Evidence[] {
  if (!events || events.length === 0) return []
  const now = Date.now()
  return events
    .filter((e) => e.done)
    .map((e, i) => {
      const ok = e.ok === true
      if (e.toolName === 'ssh_readonly') {
        return {
          id: `ev_${e.toolCallId || i}`,
          source: 'command' as const,
          sourceDetail: e.input ?? 'ssh_readonly',
          content: (e.output ?? '').slice(0, 500),
          // 真实命令输出：模板匹配度不适用取中性；来源先验高（真机回显）
          drainMatch: 0.5,
          sourcePrior: 0.9,
          confidence: ok ? 0.9 : 0.3,
          timestamp: now,
          verified: ok,
        }
      }
      if (e.toolName === 'monitor_get') {
        return {
          id: `ev_${e.toolCallId || i}`,
          source: 'metric' as const,
          sourceDetail: 'monitor_get',
          content: (e.output ?? '').slice(0, 500),
          drainMatch: 0.5,
          sourcePrior: 0.85,
          confidence: ok ? 0.85 : 0.3,
          timestamp: now,
          verified: ok,
        }
      }
      // 检索类（kb_search / tutorial_search / skill_match / 其它）
      const hasHits = ok && !isEmptySearchOutput(e.output)
      return {
        id: `ev_${e.toolCallId || i}`,
        source: 'knowledge' as const,
        sourceDetail: `${e.toolName}: ${e.input ?? ''}`.slice(0, 120),
        content: (e.output ?? '').slice(0, 500),
        drainMatch: hasHits ? 0.8 : 0.2,
        sourcePrior: 0.75,
        confidence: hasHits ? 0.8 : 0.3,
        timestamp: now,
        verified: hasHits,
      }
    })
}

/** riskCheck IPC 的三级结果 → RiskAssessment（models.ts 五级模型） */
export function riskCheckToAssessment(
  risk: 'low' | 'medium' | 'high',
  reasons: string[],
): RiskAssessment {
  const map = {
    low: { level: 'LOW' as const, score: 20, requireConfirmation: false },
    medium: { level: 'MEDIUM' as const, score: 55, requireConfirmation: true },
    high: { level: 'HIGH' as const, score: 85, requireConfirmation: true },
  }
  const m = map[risk]
  return {
    level: m.level,
    score: m.score,
    matchedRules: reasons,
    description: reasons.length > 0 ? reasons.join('；') : '未命中风险规则',
    requireConfirmation: m.requireConfirmation,
    blocked: false,
  }
}

/** 构建聊天执行决策记录的入参 */
export interface ChatDecisionParams {
  /** 被执行的命令 */
  command: string
  /** 最近一条用户消息（问题描述） */
  userMessage: AgentMessage | null
  /** 命令所属的 assistant 消息（根因假设 + 证据来源） */
  assistantMessage: AgentMessage | null
  /** 风险评估（riskCheck 映射结果） */
  risk: RiskAssessment
  /** 可信度（有评估结果用评估值；否则用证据均值兜底） */
  confidence?: number
  /** SSH 会话 ID */
  sessionId?: string | null
}

/**
 * 用户在聊天里点击"在终端执行"= 一次真实决策（AI 建议 → 人工批准 → 执行）。
 * 构建可经 history:save 落库的 DecisionCard 记录。
 */
export function buildChatDecisionCard(params: ChatDecisionParams): DecisionCard {
  const { command, userMessage, assistantMessage, risk, confidence, sessionId } = params
  const evidences = toolEventsToEvidences(assistantMessage?.toolEvents)
  // 置信度：评估值 > 证据均值 > 中性 0.5
  const evidenceAvg =
    evidences.length > 0
      ? evidences.reduce((acc, e) => acc + e.confidence, 0) / evidences.length
      : 0.5
  return {
    id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    problem: (userMessage?.content ?? '（无用户问题上下文）').slice(0, 300),
    hypothesis: (assistantMessage?.content ?? '（无 AI 分析上下文）').slice(0, 300),
    evidences,
    confidence: confidence ?? evidenceAvg,
    risk,
    fixCommand: command,
    fixDescription: 'AI 对话中用户批准并发送到终端执行',
    status: 'executed',
    timestamp: Date.now(),
    sessionId: sessionId ?? undefined,
  }
}
