/**
 * 证据形状与先验单源对账（#106 · B 方案判据）
 *
 * 这里管的是三件以前没有任何执行体在管的事：
 *
 * 1. **先验不再有第二份拷贝**。聊天链路（chat-decision.ts）以前手抄过一份：知识类写 0.75，
 *    而主进程那张表写 0.5，两份数各说各话，谁也发现不了谁改了。现在类别级先验（单条证据值多少）
 *    与融合级先验（这一类源在融合里值多少）都在 @shared/credibility，两边各自 import 同一份。
 *    这条判据钉的是"跑真函数拿到的数确实等于表里的数"（不是 grep 源码）。
 *
 * 2. **业务证据类别 → 融合源是全映射**，且没有兜底。以前 metric→ai-param、
 *    command→human、config→best-practice 三处是假映射，映射不到还按 `idx % 6` 随机归类。
 *
 * 3. **先验必须真的改变数字**。五个 `*_SOURCE_PRIOR` 常量写了却没人读，
 *    等于"文档承诺有折扣、代码里没有"。这里的成对断言（sourcePrior=1 vs 默认）
 *    一旦有人把 applySourcePrior 摘掉就红。
 */
import { describe, it, expect } from 'vitest'
import { buildHistorySaveIntent, toolEventsToEvidences } from '@renderer/utils/chat-decision'
import { buildCredibilityInputs } from '@renderer/utils/evidence-to-input'
import { createMassFunctionFromInput } from '../../src/main/ipc/credibility-helpers'
import { createKnowledgeMassFunction } from '../../src/main/core/agent/credibility/mass-functions/knowledge-source'
import {
  EVIDENCE_CATEGORY_PRIORS,
  EVIDENCE_CATEGORY_TO_SOURCE,
  FUSION_SOURCE_IDS,
  SOURCE_PRIORS,
  applySourcePrior,
  normalizeFusionSourceId,
} from '@shared/credibility'
import { getSourcePrior } from '../../src/main/core/confidence'
import type { AgentToolCall } from '@renderer/stores/agent-store'
import type { CredibilityEvidenceInput } from '@shared/agent-types'
import type { EvidenceSource } from '@shared/models'

/** @shared/models 里业务证据类别的完整清单——新增一类而这里没补，本文件应红 */
const ALL_EVIDENCE_CATEGORIES: EvidenceSource[] = ['log', 'metric', 'command', 'config', 'knowledge']

function toolEvent(partial: Partial<AgentToolCall>): AgentToolCall {
  return {
    toolCallId: 't-' + (partial.toolName ?? 'x'),
    toolName: 'ssh_readonly',
    input: 'df -h',
    done: true,
    ok: true,
    output: '/dev/sda1 40G 12G 26G 32%',
    ...partial,
  } as AgentToolCall
}

describe('先验单源：渲染层不再手抄先验', () => {
  it('命令证据的 sourcePrior 等于类别先验表（0.9）', () => {
    const [ev] = toolEventsToEvidences([toolEvent({ toolName: 'ssh_readonly' })])
    expect(EVIDENCE_CATEGORY_TO_SOURCE[ev.source]).toBe('observation')
    expect(ev.sourcePrior).toBe(EVIDENCE_CATEGORY_PRIORS.command)
  })

  it('指标证据的 sourcePrior 等于类别先验表（0.8，主进程与渲染层同一份数）', () => {
    const [ev] = toolEventsToEvidences([toolEvent({ toolName: 'monitor_get', input: 'cpu' })])
    expect(EVIDENCE_CATEGORY_TO_SOURCE[ev.source]).toBe('observation')
    expect(ev.sourcePrior).toBe(EVIDENCE_CATEGORY_PRIORS.metric)
    // 主进程那条口径（src/main/core/confidence.ts）读到的必须是同一个数
    expect(getSourcePrior('metric')).toBe(ev.sourcePrior)
  })

  it('知识证据的 sourcePrior 等于表里的 0.5（聊天链路手抄的那份 0.75 已作废）', () => {
    const [ev] = toolEventsToEvidences([
      toolEvent({ toolName: 'kb_search', output: '命中 3 条：清理日志' }),
    ])
    expect(EVIDENCE_CATEGORY_TO_SOURCE[ev.source]).toBe('knowledge')
    expect(ev.sourcePrior).toBe(0.5)
    expect(EVIDENCE_CATEGORY_PRIORS.knowledge).toBe(0.5)
    expect(getSourcePrior('knowledge')).toBe(ev.sourcePrior)
  })

  it('两张先验表都补齐：每个证据类别、每个融合源都有数且在 0-1 内', () => {
    for (const category of ALL_EVIDENCE_CATEGORIES) {
      const prior = EVIDENCE_CATEGORY_PRIORS[category]
      expect(prior, `${category} 缺类别先验`).toBeGreaterThan(0)
      expect(prior, `${category} 类别先验越界`).toBeLessThanOrEqual(1)
    }
    for (const id of FUSION_SOURCE_IDS) {
      const prior = SOURCE_PRIORS[id]
      expect(prior, `${id} 缺源先验`).toBeGreaterThan(0)
      expect(prior, `${id} 源先验越界`).toBeLessThanOrEqual(1)
    }
  })
})

describe('业务证据类别 → 融合源：全覆盖、无兜底', () => {
  it('五类业务证据全部映射得到融合源（新增类别时这条会红）', () => {
    for (const category of ALL_EVIDENCE_CATEGORIES) {
      const mapped = EVIDENCE_CATEGORY_TO_SOURCE[category]
      expect(mapped, `${category} 没有映射，会被塞进某个源或丢掉`).toBeTruthy()
      expect(FUSION_SOURCE_IDS as readonly string[], `${category} 映射到了不存在的源`).toContain(
        mapped
      )
    }
  })

  it('映射后的源都能被主进程建成 mass 函数（词表确实合并成一套）', () => {
    for (const category of ALL_EVIDENCE_CATEGORIES) {
      const sourceId = EVIDENCE_CATEGORY_TO_SOURCE[category]
      // 只验 id 这一层能被分发认出来；字段用该源的最小合法输入
      const minimalFields: Record<string, Record<string, number | boolean | number[]>> = {
        log: { drainMatch: 0.5 },
        observation: { hasObservations: true, successRate: 0.5 },
        knowledge: { hasResults: true, topScore: 0.5 },
        'ai-param': { verbalizedConfidence: 0.5 },
        human: { hasAnnotations: true },
        history: { hasCases: true },
        'best-practice': { hasMatches: true },
      }
      const fields = minimalFields[sourceId]
      expect(fields, `${sourceId} 没有质量算法`).toBeTruthy()
      expect(() => createMassFunctionFromInput({ sourceId, fields })).not.toThrow()
    }
  })

  it('旧写法 kb / S 前缀都能归一到唯一 id', () => {
    expect(normalizeFusionSourceId('kb')).toBe('knowledge')
    expect(normalizeFusionSourceId('S2-knowledge')).toBe('knowledge')
    expect(normalizeFusionSourceId('S1-log')).toBe('log')
    expect(normalizeFusionSourceId('observation')).toBe('observation')
  })

  it('认不出来的源 id 抛错，不再按序号随机归类', () => {
    expect(() => normalizeFusionSourceId('S7-magic')).toThrow(/未知证据源/)
    // 真实通道里这种值是会进来的：credibility:assess 的入参是渲染层传来的 JSON，
    // 类型只存在于编译期。这里按 IPC 的实际形状构造（不走 as never 计数位）。
    const fromIpc = JSON.parse('[{"sourceId":"S7-magic","fields":{}}]') as Array<{
      sourceId: CredibilityEvidenceInput['sourceId']
      fields: CredibilityEvidenceInput['fields']
    }>
    expect(() => createMassFunctionFromInput(fromIpc[0])).toThrow(/未知证据源/)
  })
})

describe('先验真的进计算（不是写在注释里的装饰）', () => {
  it('applySourcePrior 是乘法且两端都 clamp，NaN 记 0', () => {
    expect(applySourcePrior(1, 1)).toBe(1)
    expect(applySourcePrior(1, 0.5)).toBe(0.5)
    expect(applySourcePrior(2, 1)).toBe(1)
    expect(applySourcePrior(1, NaN)).toBe(0)
  })

  it('knowledge 档：满分相似度经先验折到 0.5，传 sourcePrior=1 才拿满', () => {
    const discounted = createKnowledgeMassFunction({ hasResults: true, topScore: 1, avgScore: 1 })
    const undiscounted = createKnowledgeMassFunction({
      hasResults: true,
      topScore: 1,
      avgScore: 1,
      sourcePrior: 1,
    })
    expect(undiscounted.confidence).toBeCloseTo(1, 9)
    expect(discounted.confidence).toBeCloseTo(SOURCE_PRIORS.knowledge, 9)
  })

  it('IPC 通道能把 sourcePrior 传到质量算法（跨进程这一环没断）', () => {
    const withLowPrior = createMassFunctionFromInput({
      sourceId: 'knowledge',
      fields: { hasResults: true, topScore: 1, avgScore: 1, sourcePrior: 0.2 },
    })
    const withHighPrior = createMassFunctionFromInput({
      sourceId: 'knowledge',
      fields: { hasResults: true, topScore: 1, avgScore: 1, sourcePrior: 0.9 },
    })
    expect(withLowPrior.confidence).toBeCloseTo(0.2, 9)
    expect(withHighPrior.confidence).toBeCloseTo(0.9, 9)
  })
})

describe('聊天链路按融合源分组，不再把证据改名成历史案例', () => {
  const ctx = (events: AgentToolCall[]) => ({
    cardId: 'msg-1',
    evidences: toolEventsToEvidences(events),
  })

  it('命令 + 指标合成一条 observation 源，successRate 是真实的成功占比', () => {
    const inputs = buildCredibilityInputs(
      ctx([
        toolEvent({ toolCallId: 'a', toolName: 'ssh_readonly', ok: true }),
        toolEvent({ toolCallId: 'b', toolName: 'monitor_get', input: 'cpu', ok: false }),
      ])
    )
    const obs = inputs.find((i) => i.sourceId === 'observation')
    expect(obs).toBeDefined()
    expect(obs!.fields.hasObservations).toBe(true)
    expect(obs!.fields.successRate).toBeCloseTo(0.5, 9)
    // 旧口径：这一整包被改名成 history 的 weightedSuccessRate 送出
    expect(inputs.find((i) => i.sourceId === 'history'), '聊天链路没有案例库数据').toBeUndefined()
  })

  it('检索命中走 knowledge，空返回不占源位', () => {
    const hit = buildCredibilityInputs(
      ctx([toolEvent({ toolCallId: 'c', toolName: 'kb_search', output: '命中 3 条' })])
    )
    const kb = hit.find((i) => i.sourceId === 'knowledge')
    expect(kb, '有检索命中就该送 knowledge 源').toBeDefined()
    expect(kb!.fields.hasResults).toBe(true)
    // 聊天链路能送的真实分数只有证据自带的 confidence（命中档 0.8）
    expect(kb!.fields.topScore).toBeCloseTo(0.8, 9)

    const miss = buildCredibilityInputs(
      ctx([toolEvent({ toolCallId: 'd', toolName: 'kb_search', output: '未找到相关条目' })])
    )
    expect(miss.find((i) => i.sourceId === 'knowledge'), '空返回不该当一个有命中的源送').toBeUndefined()
  })

  it('融合出口读得到聊天链路送的每一条形参（真消费者当裁判）', () => {
    const inputs = buildCredibilityInputs(
      ctx([
        toolEvent({ toolCallId: 'e', toolName: 'ssh_readonly' }),
        toolEvent({ toolCallId: 'f', toolName: 'kb_search', output: '命中 1 条' }),
      ])
    )
    for (const input of inputs) {
      expect(() => createMassFunctionFromInput(input), `${input.sourceId} 被主进程拒绝`).not.toThrow()
    }
  })
})

/**
 * 落库意图里的"事实字段"（#175-① 的另一半）
 *
 * serverId 是聊天链路知道、但以前没往下传的事实：会话→服务器的映射就在 server-store 里，
 * 不传的后果是决策记录永远不知道自己在哪台机器上做的，历史页的"服务器"筛选永远是空的。
 * 耗时不在这张清单里：那条命令是发到终端的，主进程没有等到它的返回，
 * 没有实测值就留 null（界面显示 —），拿 timestamp 取模编一个数是这个项目明确不许的。
 */
describe('buildHistorySaveIntent 带得上真实事实', () => {
  it('给了 serverId 就照实带上；没给就是没有，不编一个占位值', () => {
    const withServer = buildHistorySaveIntent({
      command: 'df -h',
      userMessage: null,
      assistantMessage: null,
      sessionId: 'sess-7',
      serverId: 'srv-prod-web-01',
    })
    expect(withServer.serverId).toBe('srv-prod-web-01')
    expect(withServer.sessionId).toBe('sess-7')

    const without = buildHistorySaveIntent({
      command: 'df -h',
      userMessage: null,
      assistantMessage: null,
    })
    expect(without.serverId ?? null, '缺席要留 null/undefined，不能塞假服务器名').toBeNull()
    expect(without.durationMs ?? null, '没有实测耗时就不许给数').toBeNull()
  })
})
