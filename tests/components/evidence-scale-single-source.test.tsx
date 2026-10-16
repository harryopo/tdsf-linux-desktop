// @vitest-environment jsdom
/**
 * 证据权重的刻度只有一个来源（#135）
 *
 * 缺陷长这样：雷达图与 PCR5 权重条画的是**同一份** weight，却各自写死刻度——
 * 雷达图 2026-10 改成 1.0，PCR5 那六条横条还除以 0.3。同一个 0.6 一边显示 60%、
 * 一边顶格显示满格，两张图并排放着读数不可比，而各自单看都"像是对的"。
 *
 * 三层判据各管一类漂移，缺一类就留盲区：
 * 1. 逐条相等：两边分叉（只改一边）→ 红。
 * 2. 0.6 就是 60%：两边**一起**改成别的刻度也 → 红（第 1 条抓不到同步漂移）。
 * 3. 组件必须引用 shared 那张表：抓"把本地字面量重新写回组件"这个动作本身。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PCR5Result } from '@renderer/components/decision/PCR5Result'
import { EvidenceRadar, type EvidenceSource } from '@renderer/components/decision/EvidenceRadar'
import { EVIDENCE_WEIGHT_FULL_SCALE, evidenceWeightPercent } from '@shared/credibility'

const REPO = join(__dirname, '..', '..')

/** 覆盖半格 / 满格 / 超刻度 / 零 / 低权重，其中 0.6 正是旧刻度会顶格的那一档 */
const WEIGHTS = [0.6, 1, 1.2, 0, 0.3, 0.05]

const SOURCES: EvidenceSource[] = WEIGHTS.map((w, i) => ({
  label: `S${i}`,
  weight: w,
  desc: '测试权重',
}))

afterEach(cleanup)

/** 从渲染出的 SVG 反推每条轴画出的比例，不复制组件里的几何常量 */
function radarRatios(container: HTMLElement): number[] {
  const grid = container.querySelector('polygon')
  if (!grid) throw new Error('雷达图没画出网格六边形')
  const vertices = (grid.getAttribute('points') ?? '')
    .trim()
    .split(/\s+/)
    .map((p) => p.split(',').map(Number))
  const center = vertices.reduce(
    (acc, v) => ({ x: acc.x + v[0] / vertices.length, y: acc.y + v[1] / vertices.length }),
    { x: 0, y: 0 },
  )
  const points = [...container.querySelectorAll('circle')].map((c) => ({
    x: Number(c.getAttribute('cx')),
    y: Number(c.getAttribute('cy')),
  }))
  expect(points.length, '雷达点数应与源数一致').toBe(vertices.length)

  return vertices.map((v, i) => {
    const dx = v[0] - center.x
    const dy = v[1] - center.y
    const radiusSq = dx * dx + dy * dy
    // 数据点沿该轴的投影长度 / 轴长
    return ((points[i].x - center.x) * dx + (points[i].y - center.y) * dy) / radiusSq
  })
}

/** PCR5 横条画出的宽度比例（按源顺序） */
function barRatios(container: HTMLElement): number[] {
  const bars = [...container.querySelectorAll('div[style*="width"]')]
  expect(bars.length, '横条没渲染').toBeGreaterThan(0)
  return bars.map((b) => Number.parseFloat((b as HTMLElement).style.width) / 100)
}

describe('两张图画同一个刻度', () => {
  it('每个 weight 在横条与雷达上的比例逐条相等', () => {
    const bars = barRatios(
      render(<PCR5Result sources={SOURCES} fusedValue={null} conflictK={null} />).container,
    )
    const radar = radarRatios(render(<EvidenceRadar sources={SOURCES} />).container)

    expect(bars.length, '横条数应与源数一致').toBe(WEIGHTS.length)
    bars.forEach((b, i) => {
      const expected = Math.min(WEIGHTS[i] / EVIDENCE_WEIGHT_FULL_SCALE, 1)
      expect(radar[i], `第 ${i} 轴雷达比例`).toBeCloseTo(expected, 6)
      expect(b, `第 ${i} 条横条比例`).toBeCloseTo(expected, 6)
    })
  })

  it('0.6 画成 60%（除以 0.3 的旧刻度会把它顶成满格）', () => {
    const { container } = render(
      <PCR5Result sources={[{ label: 'A', weight: 0.6, desc: '' }]} fusedValue={null} conflictK={null} />,
    )
    const bar = container.querySelector('div[style*="width"]')
    expect(bar, '横条没渲染').toBeTruthy()
    expect(bar!.getAttribute('style')).toContain('width: 60%')
  })

  it('超刻度不溢出、零权重塌到圆心', () => {
    const bars = barRatios(
      render(<PCR5Result sources={SOURCES.slice(2, 4)} fusedValue={null} conflictK={null} />).container,
    )
    expect(bars[0]).toBeCloseTo(1, 6)
    expect(bars[1]).toBeCloseTo(0, 6)
  })

  it('阴性对照：换算式跟着刻度变，不是钉死一个百分比', () => {
    expect(evidenceWeightPercent(0.6)).toBeCloseTo((0.6 / EVIDENCE_WEIGHT_FULL_SCALE) * 100, 10)
    expect(evidenceWeightPercent(1.2)).toBe(100)
    expect(evidenceWeightPercent(-0.4)).toBe(0)
    expect(evidenceWeightPercent(Number.NaN)).toBe(0)
  })
})

describe('刻度不许再被写回组件本地', () => {
  const files = [
    'src/renderer/src/components/decision/PCR5Result.tsx',
    'src/renderer/src/components/decision/EvidenceRadar.tsx',
  ].map((p) => ({ p, text: readFileSync(join(REPO, p), 'utf8') }))

  it.each(files)('$p 引用 shared 那张表', ({ p, text }) => {
    expect(text, '必须从 @shared/credibility 取刻度').toContain('@shared/credibility')
    expect(text).toMatch(/EVIDENCE_WEIGHT_FULL_SCALE|evidenceWeightPercent/)
  })

  it('组件内不留本地满刻度赋值（= 一个数字）', () => {
    const offenders = files
      .filter(({ text }) => /FULL_SCALE\s*=\s*[\d.]+\s*$/m.test(text))
      .map(({ p }) => p)
    expect(offenders, '本地数字满刻度 = 又开始分叉').toEqual([])
  })
})
