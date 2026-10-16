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
 * - monitor_get     → source='metric'
 * - kb_search / tutorial_search / skill_match → source='knowledge'：检索命中与否决定置信度
 * 命令与指标这两类**没有"日志模板匹配度"这一维**，drainMatch 一律留 null（#103）：
 * 那一维不存在就别编一个数填进去，它占着公式里 0.7 的权重。
 */
import type { AgentMessage, AgentToolCall } from '@/stores/agent-store'
import type { HistorySaveIntent, Evidence, EvidenceSource } from '@shared/models'
import { evidencePriorOf } from '@shared/credibility'

/**
 * 证据先验一律从 @shared/credibility 那张唯一表取
 *
 * #106 的原始毛病就是这里手抄过一份：知识类写 0.75，而表里是 0.5，
 * 两份数各说各话，改一边没人知道。现在渲染层不持有先验数值，只查表。
 * 取的是**类别级**先验（单条证据值多少），不是融合级（这一类源在融合里值多少）。
 */
function priorOf(category: EvidenceSource): number {
  return evidencePriorOf(category)
}

/** 检索类输出是否为"无结果"（kb/tutorial 的 summary 以"未"开头） */
function isEmptySearchOutput(output: string | undefined): boolean {
  if (!output) return true
  return /^未/.test(output.trim())
}

/**
 * 工具调用没拿到结果时给的那一档置信度。
 * 这是**策略位**（"这次根本没读到东西"的固定折扣），不是测量值——
 * 和 #103 拆掉的那种"编一个模板匹配度填进公式"是两回事，别混用。
 */
const UNVERIFIED_FLOOR = 0.3

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
          // 命令输出没有"像不像日志模板"这一维 ⇒ drainMatch 取 null。
          // 原来这里写 0.5 当"中性"：那个数没人测过，却占掉公式里 0.7 那一维。
          drainMatch: null,
          sourcePrior: priorOf('command'),
          confidence: ok ? 0.9 : UNVERIFIED_FLOOR,
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
          // 指标读数同样没有模板维度。先验不再手抄（这里曾写死 0.85→0.8，
          // 而融合表里 metric 是另一个数）：metric 与 command 同属观测档，查同一张表。
          drainMatch: null,
          sourcePrior: priorOf('metric'),
          confidence: ok ? 0.8 : UNVERIFIED_FLOOR,
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
        // 这一档保留数值但说清它是什么：不是"日志模板匹配度"，而是"这次检索有没有回东西"
        // 的两个档位，跟着一条真实观测变（命中 / 空返回），不是没人测过的常数。
        drainMatch: hasHits ? 0.8 : 0.2,
        sourcePrior: priorOf('knowledge'),
        confidence: hasHits ? 0.8 : 0.3,
        timestamp: now,
        verified: hasHits,
      }
    })
}

/** 构建 history:save 落库意图的入参 */
export interface ChatDecisionParams {
  /** 被执行的命令 */
  command: string
  /** 最近一条用户消息（问题描述） */
  userMessage: AgentMessage | null
  /** 命令所属的 assistant 消息（根因假设 + 证据来源） */
  assistantMessage: AgentMessage | null
  /** SSH 会话 ID */
  sessionId?: string | null
}

/**
 * 用户在聊天里点击"在终端执行"= 一次真实决策（AI 建议 → 人工批准 → 执行）。
 * 构建交给 history:save 的**意图**。
 *
 * P0-5：这里刻意不再产出 risk / confidence / id / timestamp / status ——
 * 那些是"这条记录该怎么被判断"，必须由主进程基于自己的判据生成。
 * 渲染层只交代事实：命令是什么、上下文是什么、证据从哪来、用户确实批准执行了。
 */
export function buildHistorySaveIntent(params: ChatDecisionParams): HistorySaveIntent {
  const { command, userMessage, assistantMessage, sessionId } = params
  return {
    command,
    problem: (userMessage?.content ?? '（无用户问题上下文）').slice(0, 300),
    hypothesis: (assistantMessage?.content ?? '（无 AI 分析上下文）').slice(0, 300),
    evidences: toolEventsToEvidences(assistantMessage?.toolEvents),
    executed: true,
    fixDescription: 'AI 对话中用户批准并发送到终端执行',
    sessionId: sessionId ?? undefined,
  }
}
