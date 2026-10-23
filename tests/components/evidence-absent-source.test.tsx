// @vitest-environment jsdom
/**
 * "未参与"这一档要画得出来（#175-③ 的显示侧）
 *
 * 上一份单测钉住的是数据形状（null 而不是 0）；这里钉的是界面：
 * 图例与融合面板对 null 那一轴必须写"未参与"，不许再打印 0.00——
 * 0.00 和"未参与"在图上是两个完全不同的结论，前者会让人以为该来源拉低了可信度。
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ConfidenceGauge } from '@renderer/components/decision/ConfidenceGauge'
import { EvidenceRadar } from '@renderer/components/decision/EvidenceRadar'
import { PCR5Result } from '@renderer/components/decision/PCR5Result'
import type { EvidenceSource } from '@renderer/components/decision/EvidenceRadar'

const SOURCES: EvidenceSource[] = [
  { label: '日志', weight: 0.85, desc: '/var/log/syslog' },
  { label: '指标', weight: null, desc: '未参与 · 这条决策没有该来源证据' },
  { label: '命令', weight: 0.9, desc: 'df -h' },
  { label: '配置', weight: null, desc: '未参与 · 这条决策没有该来源证据' },
  { label: '知识库', weight: null, desc: '未参与 · 这条决策没有该来源证据' },
  { label: '模型', weight: 0.66, desc: '模型综合置信度' },
]

describe('未参与那一轴的显示', () => {
  it('置信度仪表图例：null 轴写"未参与"，不出现 0.00', () => {
    render(<ConfidenceGauge value={0.87} sources={SOURCES} provenance="fused" />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('未参与')
    expect(text, '缺席的来源被印成 0.00＝看着像参与了').not.toContain('0.00')
    // 有值的那几轴照旧印数字
    expect(text).toContain('0.85')
    expect(text).toContain('0.9')
  })

  it('雷达图：null 轴画到圆心（几何上就是 0），但不报错', () => {
    render(<EvidenceRadar sources={SOURCES} />)
    expect(document.querySelectorAll('polygon').length).toBeGreaterThan(0)
  })

  it('融合面板：null 轴的条是空的、标签写"未参与"，有值的轴照旧给两位小数', () => {
    render(<PCR5Result sources={SOURCES} fusedValue={0.87} conflictK={0.02} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('未参与')
    expect(text).toContain('0.85')
    expect(text.match(/0\.00/g) ?? [], '融合面板也不许印 0.00').toHaveLength(0)
  })
})
