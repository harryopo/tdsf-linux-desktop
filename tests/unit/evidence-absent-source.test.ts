/**
 * 六源雷达里"没有这个来源"和"这个来源是 0"必须是两件事（#175-③）
 *
 * 真机截图上看到的：一条只有日志 + 命令输出的决策，雷达图例写着
 * 「指标 0.00 / 配置 0.00 / 知识库 0.00」——把"这条决策根本没碰过这些来源"
 * 演成"这些来源参与了、贡献是零"。同一页的成功率 0.0 已经按 F4 修过一轮，
 * 这是同一个病在另一处的残留。
 *
 * 判据：缺来源 → weight 为 null（不是 0）；有来源 → 照实给平均值。
 */
import { describe, it, expect } from 'vitest'
import { buildEvidenceSources } from '@renderer/utils/decision-mappers'
import type { Evidence } from '@shared/models'

const ev = (source: Evidence['source'], confidence: number): Evidence => ({
  id: `e-${source}`,
  source,
  sourceDetail: `${source} 采样`,
  content: 'x',
  drainMatch: null,
  sourcePrior: confidence,
  confidence,
  timestamp: 1,
  verified: true,
})

describe('buildEvidenceSources 的"未参与"', () => {
  it('只有日志与命令时，指标/配置/知识库是 null，不是 0.00', () => {
    const sources = buildEvidenceSources([ev('log', 0.85), ev('command', 0.9)])
    const by = Object.fromEntries(sources.map((s) => [s.label, s]))
    expect(by['日志'].weight).toBe(0.85)
    expect(by['命令'].weight).toBe(0.9)
    for (const label of ['指标', '配置', '知识库']) {
      expect(by[label].weight, `${label} 这一轴没有证据，不该给出 0 这个数`).toBeNull()
      expect(by[label].desc, `${label} 的说明要写清是"没参与"`).toContain('未参与')
    }
  })

  it('模型那一轴：没给 modelConfidence 也是 null', () => {
    const without = buildEvidenceSources([ev('log', 0.8)])
    expect(without.find((s) => s.label === '模型')?.weight).toBeNull()
    const withModel = buildEvidenceSources([ev('log', 0.8)], 0.66)
    expect(withModel.find((s) => s.label === '模型')?.weight).toBe(0.66)
  })

  it('真值为 0 的证据仍然算"参与了"（0 是读数，不是缺席）', () => {
    const sources = buildEvidenceSources([ev('metric', 0)])
    const metric = sources.find((s) => s.label === '指标')
    expect(metric?.weight, '这条决策确实采集了指标证据，只是置信度为 0').toBe(0)
    expect(metric?.weight).not.toBeNull()
  })
})
