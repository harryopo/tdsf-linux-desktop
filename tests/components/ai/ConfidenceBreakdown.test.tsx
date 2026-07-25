/**
 * tests/components/ai/ConfidenceBreakdown.test.tsx - ConfidenceBreakdown 组件级 RTL 测试（v0.9.6 P2 M7）
 *
 * 覆盖范围：
 * 1. 基础渲染：标题 + 规则 tag + Bel/Pl 区间条 + 4 数值卡片 + 冲突条
 * 2. CoT 轨迹区：单调链 / 非单调链 / 3 次反弹 / 1 步轨迹降级
 * 3. 关键指标：步数 / H₀ / Hₙ / ΔH / 形状置信度
 * 4. SVG 验证：aria-label、违规点 marker 数量
 * 5. 论文依据文本展示
 *
 * 关键决策：
 * - 用 jsdom 环境（文件头指令）
 * - 不用 mock css：jsdom 不解析 CSS 类名（不影响 RTL 的 getByText/getByRole）
 * - mock 数据用 analyzeCotEntropyTrajectory 构造，保证测试与算法同步
 *
 * 调研依据：v0.9.6 P2 M7（CoT 轨迹可视化单测）
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type {} from '@testing-library/jest-dom'
import ConfidenceBreakdown from '@renderer/components/ai/ConfidenceBreakdown'
import { analyzeCotEntropyTrajectory } from '@shared/cot-trace-analyzer'
import type { ConfidenceAssessment } from '@shared/agent-types'
import type { CotTraceAnalysis } from '@shared/cot-trace-analyzer'

// ============================================================================
// 测试夹具（fixtures）
// ============================================================================

/**
 * 构造基础 ConfidenceAssessment mock（覆盖最小必要字段）
 */
function makeAssessment(overrides: Partial<ConfidenceAssessment> = {}): ConfidenceAssessment {
  return {
    belief: 0.7,
    plausibility: 0.9,
    confidence: 0.8,
    uncertainty: 0.2,
    conflictLevel: 0.1,
    ruleUsed: 'dempster',
    sources: [],
    fusionSteps: [],
    fusedMassFunction: {
      sourceId: 'test',
      sourceName: 'test',
      confidence: 0.8,
      focalElements: [],
    },
    ...overrides,
  }
}

/**
 * 论文核心场景 1：完美单调链 [0.9, 0.7, 0.5, 0.3, 0.1]
 * → monotone=true, violations=0, confidence=0.85
 */
const PERFECT_MONOTONE_TRACE = [0.9, 0.7, 0.5, 0.3, 0.1]
const perfectMonotone = analyzeCotEntropyTrajectory(PERFECT_MONOTONE_TRACE)

/**
 * 论文核心场景 2：典型非单调链 [0.5, 0.7, 0.4, 0.6, 0.2]
 * → monotone=false, violations=2, confidence=0.30
 */
const TYPICAL_NON_MONOTONE_TRACE = [0.5, 0.7, 0.4, 0.6, 0.2]
const typicalNonMonotone = analyzeCotEntropyTrajectory(TYPICAL_NON_MONOTONE_TRACE)

/**
 * 3 次反弹链 [0.1, 0.9, 0.2, 0.8, 0.1, 0.7]
 * → monotone=false, violations=3, confidence=0.10
 */
const HEAVY_VIOLATIONS_TRACE = [0.1, 0.9, 0.2, 0.8, 0.1, 0.7]
const heavyViolations = analyzeCotEntropyTrajectory(HEAVY_VIOLATIONS_TRACE)

// ============================================================================
// 测试用例
// ============================================================================

describe('ConfidenceBreakdown — 基础渲染（D-S + PCR5）', () => {
  it('1. 渲染标题、规则 tag、4 数值卡片、冲突条', () => {
    const assessment = makeAssessment({ ruleUsed: 'dempster' })
    render(<ConfidenceBreakdown assessment={assessment} />)

    // region role
    expect(screen.getByRole('region', { name: '可信度评估明细' })).toBeInTheDocument()

    // 标题
    expect(screen.getByText('可信度评估（D-S + PCR5）')).toBeInTheDocument()

    // 规则 tag
    expect(screen.getByText('Dempster')).toBeInTheDocument()

    // 4 数值标签
    expect(screen.getByText('综合')).toBeInTheDocument()
    expect(screen.getByText('Bel')).toBeInTheDocument()
    expect(screen.getByText('Pl')).toBeInTheDocument()
    expect(screen.getByText('不确定')).toBeInTheDocument()

    // 冲突条
    expect(screen.getByText(/证据冲突 k =/)).toBeInTheDocument()
  })

  it('2. Bel 段宽度 = belief * 100%', () => {
    const assessment = makeAssessment({ belief: 0.65, plausibility: 0.85, uncertainty: 0.2 })
    const { container } = render(<ConfidenceBreakdown assessment={assessment} />)

    // Bel 段 div 携带 width: 65%
    const belEl = container.querySelector('.confidence-breakdown-interval-bel') as HTMLElement
    expect(belEl).toBeInTheDocument()
    expect(belEl.style.width).toBe('65%')

    // 不确定段 div 携带 left: 65% + width: 20%
    const uncEl = container.querySelector('.confidence-breakdown-interval-unc') as HTMLElement
    expect(uncEl).toBeInTheDocument()
    expect(uncEl.style.left).toBe('65%')
    expect(uncEl.style.width).toBe('20%')
  })

  it('3. 冲突 k=0.4 时显示 PCR5 切换提示', () => {
    const assessment = makeAssessment({ conflictLevel: 0.4, ruleUsed: 'pcr5' })
    render(<ConfidenceBreakdown assessment={assessment} />)

    // 规则 tag
    expect(screen.getByText('PCR5')).toBeInTheDocument()

    // 阈值提示
    expect(screen.getByText('超 0.3 阈值，已自动切换到 PCR5 规则')).toBeInTheDocument()
  })

  it('4. 综合置信度 0.8 → 绿色（var(--color-success)）', () => {
    const assessment = makeAssessment({ confidence: 0.8 })
    const { container } = render(<ConfidenceBreakdown assessment={assessment} />)

    // 找到综合数值的 cell-value
    const grid = container.querySelector('.confidence-breakdown-grid') as HTMLElement
    const cells = within(grid).getAllByText('80%')
    expect(cells.length).toBeGreaterThanOrEqual(1)
    // 综合 cell 的值是 80%（值 0.8 * 100 + 四舍五入 = 80%）
    const cellValue = cells[0]
    expect(cellValue).toHaveStyle({ color: 'var(--color-success)' })
  })

  it('5. 不传 cotTraceAnalysis 时不渲染 CoT 区域', () => {
    const assessment = makeAssessment()
    const { container } = render(<ConfidenceBreakdown assessment={assessment} />)

    // CoT 区域容器不应存在
    expect(container.querySelector('.confidence-breakdown-cot')).toBeNull()
  })
})

describe('ConfidenceBreakdown — CoT 熵轨迹可视化（P2 M6）', () => {
  it('6. 完美单调链渲染"单调链" tag + 0 次违规', () => {
    render(<ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={perfectMonotone} />)

    // tag 文案
    expect(screen.getByText('单调链')).toBeInTheDocument()
    // 不应有"非单调链"
    expect(screen.queryByText(/非单调链/)).toBeNull()

    // 5 个统计指标
    expect(screen.getByText('步数')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument() // 步数 = 5
    expect(screen.getByText('H₀')).toBeInTheDocument()
    expect(screen.getByText('Hₙ')).toBeInTheDocument()
    expect(screen.getByText('ΔH')).toBeInTheDocument()
    expect(screen.getByText('形状置信度')).toBeInTheDocument()
  })

  it('7. 典型非单调链渲染"非单调链 · 2 次违规" tag + 2 个违规 marker', () => {
    const { container } = render(
      <ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={typicalNonMonotone} />
    )

    // tag 文案
    expect(screen.getByText(/非单调链 · 2 次违规/)).toBeInTheDocument()

    // SVG 存在
    const svg = container.querySelector('svg.confidence-breakdown-cot-svg')
    expect(svg).toBeInTheDocument()

    // 违规点 marker 计数：每个违规点渲染一个 r="3" 的红色圆
    // （jsdom 下 SVG 属性走 DOM API，getAttribute('r') 返回 "3"）
    const violationCircles = Array.from(
      container.querySelectorAll('svg circle')
    ).filter((c) => c.getAttribute('r') === '3')
    // violationIndices.length = 2 → 2 个违规圆
    expect(violationCircles.length).toBe(2)
  })

  it('8. 3 次反弹链：tag 包含"3 次违规" + 形状置信度 = 10%', () => {
    const { container } = render(
      <ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={heavyViolations} />
    )

    // tag
    expect(screen.getByText(/非单调链 · 3 次违规/)).toBeInTheDocument()

    // 形状置信度 = 0.10 = 10%
    // 找到 confidence-breakdown-cot-stats 内的"10%"
    const stats = container.querySelector('.confidence-breakdown-cot-stats') as HTMLElement
    expect(within(stats).getByText('10%')).toBeInTheDocument()
  })

  it('9. SVG 携带 aria-label 描述步数', () => {
    const { container } = render(
      <ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={perfectMonotone} />
    )

    const svg = container.querySelector('svg.confidence-breakdown-cot-svg') as SVGElement
    expect(svg).toBeInTheDocument()
    // aria-label: "CoT 熵轨迹折线图，共 N 步"
    expect(svg.getAttribute('aria-label')).toMatch(/^CoT 熵轨迹折线图，共 5 步$/)
  })

  it('10. 单步轨迹不渲染 CoT 区域（showCot=false 直接跳过整段）', () => {
    const singleStep: CotTraceAnalysis = {
      monotone: true,
      violations: 0,
      steps: 1,
      startEntropy: 0.5,
      endEntropy: 0.5,
      totalReduction: 0,
      confidence: 0.6,
      summary: '单步轨迹',
    }
    const { container } = render(
      <ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={singleStep} />
    )

    // 整段 CoT 区域不渲染（trajectory.length < 2 → showCot=false）
    expect(container.querySelector('.confidence-breakdown-cot')).toBeNull()
    expect(screen.queryByRole('img', { name: /CoT 熵轨迹/ })).toBeNull()
  })

  it('11. CoT 区显示论文依据（Zhao 2026）', () => {
    render(<ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={perfectMonotone} />)

    // 论文引用
    expect(
      screen.getByText(/论文依据：Zhao 2026, arXiv:2603\.18940/)
    ).toBeInTheDocument()
  })

  it('12. ΔH 正值时显示 + 号 + 绿色', () => {
    // 完美单调链：startEntropy=0.9, endEntropy=0.1, totalReduction=+0.8
    const { container } = render(
      <ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={perfectMonotone} />
    )

    const stats = container.querySelector('.confidence-breakdown-cot-stats') as HTMLElement
    // ΔH 标签
    expect(within(stats).getByText('ΔH')).toBeInTheDocument()
    // ΔH 数值 = +0.800
    const deltaValue = within(stats).getByText('+0.800')
    expect(deltaValue).toBeInTheDocument()
  })
})
