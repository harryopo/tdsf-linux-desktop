/**
 * thinking-router.test.ts — 快慢思考自动路由单测（v2.10）
 */
import { describe, it, expect } from 'vitest'
import {
  scoreComplexity,
  resolveThinkingStrength,
} from '../../src/main/core/agent/thinking-router'

describe('scoreComplexity — 复杂度评分', () => {
  it('简单查询 → standard', () => {
    const r = scoreComplexity('查看磁盘使用率')
    expect(r.strength).toBe('standard')
  })

  it('寒暄 → standard（被简单信号抑制）', () => {
    expect(scoreComplexity('你好').strength).toBe('standard')
    expect(scoreComplexity('谢谢').strength).toBe('standard')
  })

  it('极短文本 → standard', () => {
    expect(scoreComplexity('a').strength).toBe('standard')
    expect(scoreComplexity('').strength).toBe('standard')
  })

  it('根因分析类 → deep', () => {
    const r = scoreComplexity('帮我排查为什么 nginx 间歇性 502，定位根因')
    expect(r.strength).toBe('deep')
    expect(r.signals).toContain('根因分析')
  })

  it('方案设计 + 性能优化 → deep（多信号累加）', () => {
    const r = scoreComplexity('对比几种缓存方案的利弊，设计一个高可用架构并做性能调优')
    expect(r.strength).toBe('deep')
    expect(r.score).toBeGreaterThanOrEqual(3)
  })

  it('多步任务 + 长文本 → deep', () => {
    const long = '我需要先备份数据库，然后升级内核，接着重启服务，之后再验证集群状态，' +
      '整个过程要分步骤执行，每步都要确认无误，这是一个端到端的复杂运维流程需要仔细规划'
    const r = scoreComplexity(long)
    expect(r.strength).toBe('deep')
  })

  it('单个强信号（诊断/方案/优化）→ deep（v2.11 阈值 2）', () => {
    expect(scoreComplexity('诊断一下当前系统健康状况').strength).toBe('deep')
    expect(scoreComplexity('设计一个日志归档方案').strength).toBe('deep')
    expect(scoreComplexity('优化一下这个服务的启动速度').strength).toBe('deep')
  })

  it('简单信号抑制复杂词：单个弱信号不足以升 deep', () => {
    // 仅"然后"一个弱信号(weight1) → 不到阈值2
    expect(scoreComplexity('先看下负载然后告诉我').strength).toBe('standard')
  })

  it('v2.11 会话连贯：recentDeep 下非明显简单的追问延续深度思考', () => {
    // 本句单独评分为 standard，但会话近期已深度 → 延续 deep
    const r = resolveThinkingStrength('auto', '那内存呢，再看看具体进程', { recentDeep: true })
    expect(r.resolved).toBe('deep')
    expect(r.score?.signals).toContain('延续深度思考')
  })

  it('v2.11 会话连贯：明显寒暄/简单查询即使 recentDeep 也回落 standard', () => {
    expect(resolveThinkingStrength('auto', '好的，谢谢', { recentDeep: true }).resolved).toBe('standard')
    expect(resolveThinkingStrength('auto', '查看磁盘', { recentDeep: true }).resolved).toBe('standard')
  })

  it('v2.11 会话连贯：显式 standard 档不受 recentDeep 影响', () => {
    expect(resolveThinkingStrength('standard', '随便问个复杂的问题', { recentDeep: true }).resolved).toBe('standard')
  })

  it('signals 记录命中的信号（可视化用）', () => {
    const r = scoreComplexity('分析这次故障的根因')
    expect(r.signals.length).toBeGreaterThan(0)
  })
})

describe('resolveThinkingStrength — 强度解析', () => {
  it('显式 deep/standard/fast 原样返回，不走自动评分', () => {
    expect(resolveThinkingStrength('deep', '你好').resolved).toBe('deep')
    expect(resolveThinkingStrength('deep', '你好').auto).toBe(false)
    expect(resolveThinkingStrength('standard', '排查根因方案设计').resolved).toBe('standard')
    expect(resolveThinkingStrength('fast', '任意').resolved).toBe('fast')
  })

  it('auto → 按复杂度评分（简单 standard / 复杂 deep）', () => {
    const simple = resolveThinkingStrength('auto', '查看内存')
    expect(simple.auto).toBe(true)
    expect(simple.resolved).toBe('standard')
    expect(simple.score).toBeDefined()

    const complex = resolveThinkingStrength('auto', '排查为什么服务偶发宕机，定位根因并给出方案')
    expect(complex.auto).toBe(true)
    expect(complex.resolved).toBe('deep')
  })

  it('undefined → 视为 auto 自动评分', () => {
    const r = resolveThinkingStrength(undefined, '查看磁盘')
    expect(r.auto).toBe(true)
    expect(r.resolved).toBe('standard')
  })

  it('解析结果永不为 auto（下游 DeepSeek thinking 判定需要明确三档）', () => {
    for (const q of ['你好', '排查根因', '', '设计方案对比利弊做性能优化']) {
      const r = resolveThinkingStrength('auto', q)
      expect(['fast', 'standard', 'deep']).toContain(r.resolved)
    }
  })
})
