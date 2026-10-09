// @vitest-environment jsdom
/**
 * 可信度展示不许有来源不明的数（2026-10-09 安全审查 S5 / P1-6 判据）
 *
 * 缺陷长这样：评估失败 → credibility=null → 页面写 `fusedValue = credibility?.confidence ?? card.confidence`，
 * 于是模型自报的置信度被塞进 m(A)=Σ mi(A)±K 的公式排版里，页眉还挂着「D-S 证据理论」，
 * 用户以为那是融合结论并据此做决策。
 *
 * 两半都要有：缺值时那块区域不许出现公式文本；有值时公式照常出现（否则等于把展示也删了）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PCR5Result } from '@renderer/components/decision/PCR5Result'
import { ConfidenceGauge } from '@renderer/components/decision/ConfidenceGauge'
import type { EvidenceSource } from '@renderer/components/decision/EvidenceRadar'

const SOURCES: EvidenceSource[] = [
  { label: '日志', weight: 0.22, desc: '系统/应用日志证据' },
  { label: '指标', weight: 0.2, desc: '实时性能指标' },
  { label: '命令', weight: 0.18, desc: '命令执行输出' },
  { label: '配置', weight: 0.12, desc: '配置文件分析' },
  { label: '知识库', weight: 0.16, desc: '知识库匹配' },
  { label: '模型', weight: 0.72, desc: '模型综合置信度' },
]

afterEach(cleanup)

describe('PCR5Result 缺融合结论时整块降级', () => {
  it('fusedValue 为空时不出现 m(A) 与 K 的公式文本', () => {
    const { container } = render(<PCR5Result sources={SOURCES} fusedValue={null} conflictK={null} />)
    const text = container.textContent ?? ''
    expect(text, '没有融合结论却摆出 m(A) 就是编数字').not.toContain('m(A)')
    expect(text).not.toContain('K =')
    expect(text).toContain('未做融合评估')
    expect(container.querySelector('[data-pcr5="placeholder"]')).toBeTruthy()
  })

  it('阴性对照：真有融合结论时公式照常出现', () => {
    const { container } = render(<PCR5Result sources={SOURCES} fusedValue={0.83} conflictK={0.004} />)
    const text = container.textContent ?? ''
    expect(text).toContain('m(A)')
    expect(text).toContain('0.83')
    expect(text).toContain('K = 0.004')
    expect(container.querySelector('[data-pcr5="formula"]')).toBeTruthy()
  })

  it('降级只针对融合结论，六源自报权重仍然看得见', () => {
    const { container } = render(<PCR5Result sources={SOURCES} fusedValue={null} conflictK={null} />)
    const text = container.textContent ?? ''
    expect(text).toContain('日志')
    expect(text).toContain('0.22')
  })
})

describe('置信度仪表标明数字来路', () => {
  it('self-reported 与 fused 的文案不同（以前两者共用一个「置信度」标签）', () => {
    const a = render(<ConfidenceGauge value={0.72} provenance="self-reported" sources={SOURCES} />)
    expect(a.container.textContent).toContain('模型自报')
    expect(a.container.querySelector('[data-provenance="self-reported"]')).toBeTruthy()

    const b = render(<ConfidenceGauge value={0.72} provenance="fused" sources={SOURCES} />)
    expect(b.container.textContent).toContain('D-S 融合结果')
    expect(b.container.textContent).not.toContain('模型自报')
  })

  it('数值本身照常显示（标注来路不等于把数字藏起来）', () => {
    const { container } = render(<ConfidenceGauge value={0.72} provenance="fused" sources={SOURCES} />)
    expect(container.textContent).toContain('0.72')
  })
})

describe('DecisionDetailPage 不再拿自报数顶融合的坑', () => {
  const src = readFileSync(
    join(__dirname, '../../src/renderer/src/pages/DecisionDetailPage.tsx'),
    'utf8'
  )

  it('fusedValue 缺失时是 null，不是 card.confidence', () => {
    const line = src.split('\n').find((l) => l.trim().startsWith('const fusedValue'))
    expect(line, 'fusedValue 的定义行必须存在').toBeTruthy()
    expect(line).not.toContain('card.confidence')
    expect(line).toContain('null')
  })

  it('六源里的「模型」轴用的是模型自报的那个数', () => {
    const line = src.split('\n').find((l) => l.trim().startsWith('const evidenceSources'))
    expect(line).toContain('buildEvidenceSources(card.evidences, card.confidence)')
  })
})
