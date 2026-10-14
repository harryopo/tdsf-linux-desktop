/**
 * 置信度不许再拿编造的常数当"模板匹配度"（#103）
 *
 * 公式 `confidence = 0.7 × drainMatch + 0.3 × sourcePrior` 里，`drainMatch` 的原意是
 * "这条日志和 Drain3 模板有多像"——只有日志类证据有这个东西。命令输出、监控指标是结构化事实，
 * 没有"像不像模板"可言。此前采集器一律给它们填 0.8（渲染层聊天链路填 0.5，还自称"取中性"），
 * 于是界面上那条置信度七成来自一个没人测过的数。真机实测：8 条证据里 7 条 drainMatch 都是 0.8。
 *
 * 现在的口径（唯一权威在 src/main/core/confidence.ts）：
 *   - 有这一维 → 走公式；
 *   - 没有这一维 → drainMatch = null，置信度就等于来源先验。
 * 少一维就少一维，不补数。
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import {
  calculateEvidenceConfidence,
  getConfidenceBasis,
  getSourcePrior,
  CONFIDENCE_BASIS_TEXT,
} from '../../src/main/core/confidence'
import { buildAnalysisPrompt } from '../../src/main/services/llm/prompt-templates'
import { toolEventsToEvidences } from '../../src/renderer/src/utils/chat-decision'
import type { Evidence, EvidenceSource } from '@shared/models'

function evidenceOf(patch: Partial<Evidence>): Evidence {
  return {
    id: 'ev_x',
    source: 'command',
    sourceDetail: 'free -m',
    content: 'available 3%',
    drainMatch: null,
    sourcePrior: 0,
    confidence: 0,
    timestamp: 0,
    verified: true,
    ...patch,
  } as Evidence
}

describe('两条口径', () => {
  it('命令证据没有模板维度 ⇒ 置信度就是来源先验，不是"0.7×编造值 + 0.3×先验"', () => {
    const out = calculateEvidenceConfidence(evidenceOf({ source: 'command' }))
    expect(out.sourcePrior).toBe(getSourcePrior('command'))
    expect(out.confidence).toBeCloseTo(getSourcePrior('command'), 10)
    expect(getConfidenceBasis(out)).toBe('source-prior')
    expect(CONFIDENCE_BASIS_TEXT['source-prior']).toContain('没有模板维度')
  })

  it('反向对照：null 不是 0（当成 0 会被压到只剩先验的三成）', () => {
    const out = calculateEvidenceConfidence(evidenceOf({ source: 'command' }))
    const asIfZero = 0.7 * 0 + 0.3 * getSourcePrior('command')
    expect(out.confidence).not.toBeCloseTo(asIfZero, 10)
  })

  it('日志证据照旧走公式（这次改动没碰有测量值的那一路）', () => {
    const out = calculateEvidenceConfidence(
      evidenceOf({ source: 'log', sourceDetail: '/var/log/syslog', drainMatch: 0.7 })
    )
    expect(out.confidence).toBeCloseTo(0.7 * 0.7 + 0.3 * getSourcePrior('log'), 10)
    expect(getConfidenceBasis(out)).toBe('template-match')
  })

  it('喂给模型的提示词里，没有这一维就写"不适用"，不许印成 0% 或 NaN', () => {
    const prompt = buildAnalysisPrompt('磁盘满了', [
      evidenceOf({ source: 'command', sourceDetail: 'df -h', content: '/dev/sda1 100%' }),
      evidenceOf({ source: 'log', sourceDetail: '/var/log/syslog', drainMatch: 0.4 }),
    ])
    expect(prompt).toContain('不适用')
    expect(prompt).not.toMatch(/模板匹配度:\s*0%/)
    expect(prompt).not.toContain('NaN')
    // 有测量值的那条照常报数
    expect(prompt).toContain('模板匹配度: 40%')
  })
})

describe('渲染层聊天链路的先验必须与主进程那张表一致（跨进程手抄的分叉处）', () => {
  const evs = toolEventsToEvidences([
    {
      toolCallId: 'c1',
      toolName: 'ssh_readonly',
      input: 'free -m',
      output: 'available 3%',
      done: true,
      ok: true,
    },
    { toolCallId: 'c2', toolName: 'monitor_get', input: '', output: 'cpu 97', done: true, ok: true },
  ] as never)

  it('命令/指标类不再填"中性 0.5"，模板维度留 null', () => {
    const cmd = evs.find((e) => e.source === 'command')
    const metric = evs.find((e) => e.source === 'metric')
    expect(cmd?.drainMatch, '命令输出没有模板维度').toBeNull()
    expect(metric?.drainMatch, '指标读数没有模板维度').toBeNull()
  })

  it('先验取自主进程那张表（metric 以前抄成 0.85，表里是 0.8）', () => {
    const bySource = new Map<EvidenceSource, number>()
    for (const e of evs) bySource.set(e.source, e.sourcePrior)
    expect(bySource.get('command')).toBe(getSourcePrior('command'))
    expect(bySource.get('metric')).toBe(getSourcePrior('metric'))
  })
})

describe('结构闸：生产者面不许再写裸常数的 drainMatch', () => {
  /**
   * 扫描范围 = 会构造 Evidence 的生产者。设置页里那份演示样例
   * （DecisionSettings.tsx 的示例入参）不算生产者，它本来就是给人看的一段假输入。
   */
  const SCOPES = [
    resolve(__dirname, '../../src/main'),
    resolve(__dirname, '../../src/renderer/src/utils'),
  ]

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full)
    }
    return out
  }
  const files = SCOPES.flatMap((d) => walk(d))
  const BARE = /drainMatch:\s*-?\d/

  it('阳性对照：扫描真的读到了源码，且这条正则抓得住裸常数', () => {
    expect(files.length, `扫到 ${files.length} 个文件`).toBeGreaterThan(60)
    expect(BARE.test('drainMatch: 0.8')).toBe(true)
    // 三元（跟着真实观测变）与变量/ null 都不该被抓
    expect(BARE.test('drainMatch: hasHits ? 0.8 : 0.2')).toBe(false)
    expect(BARE.test('drainMatch: analysis.confidence')).toBe(false)
    expect(BARE.test('drainMatch: null,')).toBe(false)
  })

  it('生产者文件里不许出现 `drainMatch: <数字>` 这种编造的匹配度', () => {
    const offenders: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          const t = line.trim()
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
          if (BARE.test(line)) {
            offenders.push(`${relative(resolve(__dirname, '../..'), f)}:${i + 1} ${t}`)
          }
        })
    }
    expect(offenders, `又有人往模板匹配度里填常数：${offenders.join(' | ')}`).toEqual([])
  })
})
