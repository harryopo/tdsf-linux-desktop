/**
 * tests/components/ai/ConfidenceBreakdown.test.tsx - ConfidenceBreakdown 组件级 RTL 测试
 *
 * 覆盖范围：
 * 1. 区间条：Bel/Pl 各只出现一次 + 两段几何宽度按 belief/uncertainty 算
 * 2. 证据源清单：来源名与各自置信度照 assessment.sources 渲染，空清单不硬凑
 * 3. 脚注三档：无冲突 / 轻微冲突 / ≥0.3 说人话（不再只报一个 k 数字）
 * 4. CoT 轨迹：单调与反弹标签、违规 marker、aria-label、单步不渲染
 * 5. 界面上不再出现内联上色（旧版 Dempster 徽标 2.79:1 就是这么来的）
 *
 * 关键决策：
 * - 用 jsdom 环境（文件头指令）
 * - 不用 mock css：jsdom 不解析 CSS 类名（不影响 RTL 的 getByText/getByRole）
 * - mock 数据用 analyzeCotEntropyTrajectory 构造，保证测试与算法同步
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ConfidenceBreakdown from '@renderer/components/ai/ConfidenceBreakdown'
import { analyzeCotEntropyTrajectory } from '@shared/cot-trace-analyzer'
import type { ConfidenceAssessment } from '@shared/agent-types'
import type { CotTraceAnalysis } from '@shared/cot-trace-analyzer'

// ============================================================================
// 测试夹具（fixtures）
// ============================================================================

/** 一条真实的融合来源（sourceName 取自主进程 FUSION_SOURCE_LABELS） */
const OBSERVATION_SOURCE = {
  sourceId: 'observation',
  sourceName: '直接观测证据',
  confidence: 0.75,
}
const KNOWLEDGE_SOURCE = {
  sourceId: 'knowledge',
  sourceName: '知识库匹配',
  confidence: 0.4,
}

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
    sources: [OBSERVATION_SOURCE, KNOWLEDGE_SOURCE],
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

describe('ConfidenceBreakdown — 区间条与证据清单', () => {
  it('1. Bel/Pl 各只出现一次（旧版同屏说两遍：30.8% 与 31%）', () => {
    const { container } = render(<ConfidenceBreakdown assessment={makeAssessment()} />)

    expect(screen.getByRole('region', { name: '可信度评估明细' })).toBeInTheDocument()
    expect(within(container).getAllByText('Bel 70%').length).toBe(1)
    expect(within(container).getAllByText('Pl 90%').length).toBe(1)
    // 旧版那四个数值格子（综合/Bel/Pl/不确定）不再存在
    expect(screen.queryByText('综合')).toBeNull()
    expect(screen.queryByText('不确定')).toBeNull()
  })

  it('2. Bel 实心段 = belief×100%，不确定段从 Bel 起点铺到 Pl', () => {
    const assessment = makeAssessment({
      belief: 0.65,
      plausibility: 0.85,
      uncertainty: 0.2,
    })
    const { container } = render(<ConfidenceBreakdown assessment={assessment} />)

    const belEl = container.querySelector('.confidence-breakdown-interval-bel-fill') as HTMLElement
    expect(belEl.style.width).toBe('65%')

    const uncEl = container.querySelector('.confidence-breakdown-interval-unc-fill') as HTMLElement
    expect(uncEl.style.left).toBe('65%')
    expect(uncEl.style.width).toBe('20%')
  })

  it('3. 证据源清单按 assessment.sources 渲染名字与各自置信度', () => {
    render(<ConfidenceBreakdown assessment={makeAssessment()} />)

    expect(screen.getByText('直接观测证据')).toBeInTheDocument()
    expect(screen.getByText('知识库匹配')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('4. 融合出口没给来源时不硬凑一份清单', () => {
    const { container } = render(
      <ConfidenceBreakdown assessment={makeAssessment({ sources: [] })} />,
    )
    expect(container.querySelector('.confidence-breakdown-sources')).toBeNull()
  })

  it('4b. 没提供信息的空源（confidence 恒 0）不列成"某证据说 0%"', () => {
    render(
      <ConfidenceBreakdown
        assessment={makeAssessment({
          sources: [
            OBSERVATION_SOURCE,
            { sourceId: 'human', sourceName: '人工证据', confidence: 0 },
          ],
        })}
      />,
    )
    expect(screen.getByText('直接观测证据')).toBeInTheDocument()
    // 空源在 Dempster 下是单位元，等于没参与；列出来会被读成"人工证据认为只有 0% 可信"
    expect(screen.queryByText('人工证据')).toBeNull()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('5. 规则名与 k 值在悬浮里，不占版面（旧版那块 2.79:1 的描边药丸已删）', () => {
    const { container } = render(
      <ConfidenceBreakdown assessment={makeAssessment({ conflictLevel: 0.041 })} />,
    )
    const bar = container.querySelector('.confidence-breakdown-interval') as HTMLElement
    expect(bar.getAttribute('title')).toBe('融合规则 Dempster · 最大成对冲突 k = 0.041')
  })
})

describe('ConfidenceBreakdown — 冲突脚注三档', () => {
  it('6. k < 0.15：报"没有冲突"', () => {
    render(<ConfidenceBreakdown assessment={makeAssessment({ conflictLevel: 0.1 })} />)
    expect(screen.getByText('Dempster 融合 · 各来源之间没有冲突')).toBeInTheDocument()
  })

  it('7. 0.15 ≤ k < 0.3：报"轻微冲突"，不吓人', () => {
    render(<ConfidenceBreakdown assessment={makeAssessment({ conflictLevel: 0.2 })} />)
    expect(screen.getByText('Dempster 融合 · 各来源之间有轻微冲突')).toBeInTheDocument()
  })

  it('8. k ≥ 0.3：说人话并劝住用户，而不是只甩一个数字', () => {
    render(
      <ConfidenceBreakdown assessment={makeAssessment({ conflictLevel: 0.4, ruleUsed: 'pcr5' })} />,
    )
    const foot = screen.getByText(/已改用 PCR5 重新分配/)
    expect(foot).toBeInTheDocument()
    expect(foot.className).toContain('is-high')
  })
})

describe('ConfidenceBreakdown — 不内联上色', () => {
  it('9. 全树没有任何 style 里的 color/background（颜色只走 CSS 类）', () => {
    const { container } = render(
      <ConfidenceBreakdown
        assessment={makeAssessment({ conflictLevel: 0.5, ruleUsed: 'pcr5' })}
        cotTraceAnalysis={typicalNonMonotone}
      />,
    )
    const offenders = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter(
      (el) => {
        const s = el.getAttribute('style') ?? ''
        return /\b(color|background)\s*:/.test(s)
      },
    )
    expect(offenders.map((el) => el.getAttribute('style'))).toEqual([])
  })
})

describe('ConfidenceBreakdown — CoT 熵轨迹可视化', () => {
  it('10. 完美单调链渲染"逐步收敛"，且不报违规', () => {
    render(<ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={perfectMonotone} />)

    const tag = screen.getByText('逐步收敛')
    expect(tag).toBeInTheDocument()
    expect(screen.queryByText(/中途反弹/)).toBeNull()
    // 中间量（步数 / H₀ / Hₙ / ΔH / 形状置信度）与论文出处收在悬浮里
    const hover = tag.getAttribute('title') ?? ''
    expect(hover).toContain('H₀ 0.900')
    expect(hover).toContain('Hₙ 0.100')
    expect(hover).toContain('ΔH +0.800')
    expect(hover).toContain('形状置信度 85%')
    expect(hover).toContain('Zhao 2026, arXiv:2603.18940')
  })

  it('11. 典型非单调链渲染"中途反弹 2 次" + 2 个违规 marker', () => {
    const { container } = render(
      <ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={typicalNonMonotone} />,
    )

    expect(screen.getByText(/中途反弹 2 次/)).toBeInTheDocument()
    expect(container.querySelector('svg.confidence-breakdown-cot-svg')).toBeInTheDocument()

    const violationCircles = Array.from(container.querySelectorAll('svg circle')).filter(
      (c) => c.getAttribute('r') === '2.5',
    )
    expect(violationCircles.length).toBe(2)
  })

  it('12. 3 次反弹链：标签计数对，且形状置信度 10% 在悬浮里', () => {
    render(<ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={heavyViolations} />)

    const tag = screen.getByText(/中途反弹 3 次/)
    expect(tag).toBeInTheDocument()
    expect(tag.getAttribute('title') ?? '').toContain('形状置信度 10%')
  })

  it('13. SVG 携带 aria-label 描述步数', () => {
    const { container } = render(
      <ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={perfectMonotone} />,
    )

    const svg = container.querySelector('svg.confidence-breakdown-cot-svg') as SVGElement
    expect(svg.getAttribute('aria-label')).toBe('思考链熵轨迹折线图，共 5 步')
  })

  it('14. 单步轨迹整段不渲染（采不到形状就不画）', () => {
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
      <ConfidenceBreakdown assessment={makeAssessment()} cotTraceAnalysis={singleStep} />,
    )

    expect(container.querySelector('.confidence-breakdown-cot')).toBeNull()
    expect(screen.queryByRole('img', { name: /思考链熵轨迹/ })).toBeNull()
  })
})
