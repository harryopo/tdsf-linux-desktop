/**
 * 可信度输入契约测试（#82）
 *
 * 判据不手写期望字段，直接用真实消费者：主进程 src/main/ipc/credibility-helpers
 * 的 createMassFunctionFromInput —— 它按 sourceId 校验必填字段，缺字段/类型不对就 throw，
 * 而 credibility:assess 的 handler 就是把每条输入交给它。渲染层两个 builder 造出来的
 * 每一条输入都必须能过这道关，此前没人对过账，于是：
 *   - decision-mappers 给 ai-param 塞 confidence、给 human 塞 approved(number)，
 *     主进程要的是 verbalizedConfidence(number) / hasAnnotations(boolean)
 *     → credibility:assess 每次必抛 → DecisionDetailPage 的 catch 把它吞成
 *       "这张卡没有可信度分析"，用户永远看不到 D-S/PCR5 结果。
 *   - evidence-to-input 在没有日志证据时补 drainMatch/sourcePrior = 0.5，
 *     AI 源恒为 verbalized/logprob/consistency = 0.7 —— 聊天证据的来源是
 *     command/metric/knowledge（永远没有 log），所以那两份"证据"是编的，
 *     还会在 mass 函数里变成 committed belief，界面上的百分比一半来自常数。
 */
import { describe, it, expect } from 'vitest'
import { createMassFunctionFromInput } from '../../src/main/ipc/credibility-helpers'
import { buildCredibilityInputs as buildChatInputs, fingerprint } from '@renderer/utils/evidence-to-input'
import { buildCredibilityInputs as buildCardInputs } from '@renderer/utils/decision-mappers'
import { toolEventsToEvidences } from '@renderer/utils/chat-decision'
import type { AgentToolCall } from '@renderer/stores/agent-store'
import type { Evidence } from '@shared/models'
import type { DecisionContext } from '@renderer/utils/evidence-to-input'

/** 聊天里真实会发生的工具轨迹 */
function chatEvents(): AgentToolCall[] {
  return [
    {
      toolCallId: 't1',
      toolName: 'ssh_readonly',
      input: 'df -h',
      done: true,
      ok: true,
      output: '/dev/sda1 40G 12G 26G 32%',
    },
    {
      toolCallId: 't2',
      toolName: 'kb_search',
      input: '磁盘满',
      done: true,
      ok: true,
      output: '命中 3 条：清理日志…',
    },
  ]
}

function chatCtx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    cardId: 'msg-1',
    evidences: toolEventsToEvidences(chatEvents()),
    ...overrides,
  } as DecisionContext
}

function evidence(partial: Partial<Evidence>): Evidence {
  return {
    id: 'ev-1',
    source: 'command',
    sourceDetail: 'df -h',
    content: '/dev/sda1 40G',
    drainMatch: 0.5,
    sourcePrior: 0.9,
    confidence: 0.9,
    timestamp: 1,
    verified: true,
    ...partial,
  } as Evidence
}

function card(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'd-1',
    problem: '磁盘满',
    hypothesis: '日志占满',
    confidence: 0.72,
    status: 'executed',
    risk: { level: 'medium', requireConfirmation: false },
    evidences: [evidence({})],
    ...partial,
  }
}

/** 每一条输入都要能过主进程真校验；抛了就红 */
function assertAllAccepted(inputs: ReturnType<typeof buildChatInputs>, label: string): void {
  expect(inputs.length, `${label}：至少要有一条输入（handler 对空列表直接抛）`).toBeGreaterThan(0)
  for (const input of inputs) {
    expect(() => createMassFunctionFromInput(input), `${label} → ${input.sourceId} 被主进程拒绝`).not.toThrow()
  }
}

describe('可信度输入必须过主进程字段校验（真消费者当裁判）', () => {
  it('聊天路径（command+knowledge 证据）', () => {
    assertAllAccepted(buildChatInputs(chatCtx()), 'chat')
  })

  it('决策详情页路径：command/metric 证据 + ai-param 兜底', () => {
    assertAllAccepted(
      buildCardInputs(card({ evidences: [evidence({}), evidence({ id: 'ev-2', source: 'metric' })] }) as never),
      'card:command/metric'
    )
  })

  it('决策详情页路径：log+knowledge 证据且要求人工确认（含 human 源）', () => {
    assertAllAccepted(
      buildCardInputs(
        card({
          risk: { level: 'high', requireConfirmation: true },
          evidences: [
            evidence({ id: 'ev-l', source: 'log', drainMatch: 0.8, sourcePrior: 0.6, confidence: 0.74 }),
            evidence({ id: 'ev-k', source: 'knowledge', confidence: 0.6 }),
          ],
        }) as never
      ),
      'card:log/kb/human'
    )
  })

  it('决策详情页路径：零证据（走兜底输入，仍不许抛）', () => {
    assertAllAccepted(buildCardInputs(card({ evidences: [], confidence: 0 }) as never), 'card:empty')
  })
})

describe('不许把常数当证据喂给融合', () => {
  const sourceIds = (inputs: ReturnType<typeof buildChatInputs>): string[] =>
    inputs.map((i) => i.sourceId)

  it('没有日志证据时不得出现 log 源（聊天证据源是 command/metric/knowledge）', () => {
    const ids = sourceIds(buildChatInputs(chatCtx()))
    expect(ids, '无日志证据却送出一个 log 源，那是 0.5/0.5 的占位假证据').not.toContain('log')
  })

  it('调用方没给 AI 自评分时不得出现 ai-param 源', () => {
    const ids = sourceIds(buildChatInputs(chatCtx()))
    expect(ids, '模型从没被要求自评，0.7 是代码写的').not.toContain('ai-param')
  })

  it('有日志证据时 log 源用真实均值，不是 0.5', () => {
    const inputs = buildChatInputs(
      chatCtx({ evidences: [evidence({ source: 'log', drainMatch: 0.8, sourcePrior: 0.6 })] })
    )
    const log = inputs.find((i) => i.sourceId === 'log')
    expect(log, '有日志证据就该送出 log 源').toBeDefined()
    expect(log!.fields.drainMatch).toBeCloseTo(0.8, 5)
    expect(log!.fields.sourcePrior).toBeCloseTo(0.6, 5)
  })

  it('调用方给了真实自评分才送 ai-param，且不补没测到的 logprob/consistency', () => {
    const inputs = buildChatInputs(chatCtx({ llmVerbalized: 0.42 }))
    const ai = inputs.find((i) => i.sourceId === 'ai-param')
    expect(ai, '调用方传了真实 verbalized 就应送出').toBeDefined()
    expect(ai!.fields.verbalizedConfidence).toBe(0.42)
    expect(ai!.fields.logprobConfidence, 'logprob 没采到就不该填 0.7').toBeUndefined()
    expect(ai!.fields.consistency, 'consistency 没采样就不该填 0.7').toBeUndefined()
  })

  it('CoT 熵轨迹仍随真实 AI 源透传（有自评分时）', () => {
    const inputs = buildChatInputs(chatCtx({ llmVerbalized: 0.5, cotEntropyTrajectory: [0.4, 0.3, 0.2] }))
    const ai = inputs.find((i) => i.sourceId === 'ai-param')
    expect(ai!.fields.cotEntropyTrajectory).toEqual([0.4, 0.3, 0.2])
  })

  it('指纹去重对没来自评分的情形不炸', () => {
    expect(() => fingerprint(chatCtx())).not.toThrow()
    expect(fingerprint(chatCtx())).toBe(fingerprint(chatCtx()))
  })
})
