/**
 * ConfidenceBreakdown - 可信度评估结果展示组件
 *
 * 职责：
 * - 一条 Bel→Pl 信任区间条（两个数各只出现一次）
 * - 参与融合的证据源清单（来源名 + 该源自己的置信度）
 * - 一行脚注说清用的融合规则与冲突情况
 * - CoT 熵轨迹折线图（采到熵点才画）
 *
 * 2026-10-27 整块重写：旧版是一张自带背景/描边/圆角的"卡里套卡"，
 * 标题重复一遍"可信度"和"D-S"，Bel/Pl 在同屏说两遍（30.8% 与 31%），
 * 规则徽标拿 --color-link（一个背景色令牌）当字色，实测对比 2.79:1 不过 AA。
 * 现在只留聊天流那条左竖线，读数一处一份，专家数字（k 值）挪进悬浮。
 *
 * 论文支撑：
 * - Shafer 1976（Bel/Pl 信任区间）
 * - Smarandache & Dezert 2004（PCR5 冲突处理）
 * - EU AI Act 2026（透明化设计原则）
 * - Zhao 2026, arXiv:2603.18940（CoT-shape 熵轨迹单调性预测推理可靠性）
 */
import type { ConfidenceAssessment } from '@shared/agent-types'
import type { CotTraceAnalysis } from '@shared/cot-trace-analyzer'
import './ConfidenceBreakdown.css'

/** ConfidenceBreakdown 组件 Props */
export interface ConfidenceBreakdownProps {
  /** 可信度评估结果 */
  assessment: ConfidenceAssessment
  /**
   * CoT 熵轨迹分析（可选）。不传或步数 < 2 时不渲染轨迹区。
   * 数据来源：ChatCredibility 读 assistant 消息的 cotEntropyTrajectory
   */
  cotTraceAnalysis?: CotTraceAnalysis
}

/** 格式化百分比 */
function fmtPct(n: number | undefined, digits = 0): string {
  if (n === undefined || Number.isNaN(n)) return '--'
  return `${(n * 100).toFixed(digits)}%`
}

/** 融合规则的展示名 */
function ruleLabel(rule: string | undefined): string {
  if (rule === 'dempster') return 'Dempster'
  if (rule === 'pcr5') return 'PCR5'
  if (rule === 'mixed') return '混合规则'
  return rule ?? '未知规则'
}

/** 冲突分档：0.3 是切换 PCR5 的阈值，0.15 以下视为无冲突 */
type ConflictTier = 'none' | 'mild' | 'high'
function conflictTier(k: number | undefined): ConflictTier {
  if (k === undefined) return 'none'
  if (k >= 0.3) return 'high'
  if (k >= 0.15) return 'mild'
  return 'none'
}

// ============================================================================
// CoT 熵轨迹折线图
// ============================================================================

const TRACE_W = 320
const TRACE_H = 40
const TRACE_PAD_X = 6
const TRACE_PAD_Y = 6
const TRACE_INNER_W = TRACE_W - TRACE_PAD_X * 2
const TRACE_INNER_H = TRACE_H - TRACE_PAD_Y * 2

function pointXY(idx: number, value: number, steps: number): { x: number; y: number } {
  const x =
    steps <= 1 ? TRACE_PAD_X + TRACE_INNER_W / 2 : TRACE_PAD_X + (idx / (steps - 1)) * TRACE_INNER_W
  const v = Math.max(0, Math.min(1, value))
  const y = TRACE_PAD_Y + (1 - v) * TRACE_INNER_H
  return { x, y }
}

function buildTracePath(trajectory: number[]): string {
  if (trajectory.length === 0) return ''
  return trajectory
    .map((v, i) => {
      const { x, y } = pointXY(i, v, trajectory.length)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

/**
 * CoT 熵轨迹区
 *
 * 折线图 + 一个单调性标签；H₀/Hₙ/ΔH/形状置信度这些中间量收进标签的悬浮里，
 * 不再占五行格子（旧版 5 个小格 + 一行斜体引文，和正文里被骂的是同一个毛病）。
 */
const CotTraceSection: React.FC<{ analysis: CotTraceAnalysis }> = ({ analysis }) => {
  const {
    monotone,
    violations,
    steps,
    startEntropy,
    endEntropy,
    totalReduction,
    confidence,
    trajectory = [],
    violationIndices = [],
  } = analysis

  if (trajectory.length < 2) return null

  const path = buildTracePath(trajectory)
  const hover =
    `熵轨迹 ${steps} 步：H₀ ${startEntropy.toFixed(3)} → Hₙ ${endEntropy.toFixed(3)}，` +
    `ΔH ${totalReduction >= 0 ? '+' : ''}${totalReduction.toFixed(3)}；` +
    `形状置信度 ${fmtPct(confidence)}。依据 Zhao 2026, arXiv:2603.18940`

  return (
    <div className="confidence-breakdown-cot">
      <div className="confidence-breakdown-cot-head">
        <span className="confidence-breakdown-cot-title">思考链熵轨迹</span>
        <span
          className={`confidence-breakdown-cot-tag ${monotone ? 'is-ok' : 'is-warn'}`}
          title={hover}
        >
          {monotone ? '逐步收敛' : `中途反弹 ${violations} 次`}
        </span>
      </div>
      <svg
        className="confidence-breakdown-cot-svg"
        viewBox={`0 0 ${TRACE_W} ${TRACE_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`思考链熵轨迹折线图，共 ${trajectory.length} 步`}
      >
        {[0, 0.5, 1].map((v) => {
          const y = TRACE_PAD_Y + (1 - v) * TRACE_INNER_H
          return (
            <line
              key={v}
              x1={TRACE_PAD_X}
              y1={y}
              x2={TRACE_W - TRACE_PAD_X}
              y2={y}
              className="confidence-breakdown-cot-grid"
              strokeDasharray="2 3"
            />
          )
        })}
        <path
          d={path}
          className={`confidence-breakdown-cot-line ${monotone ? 'is-ok' : 'is-warn'}`}
          fill="none"
        />
        {violationIndices.map((idx) => {
          if (idx >= trajectory.length - 1) return null
          const p0 = pointXY(idx, trajectory[idx], trajectory.length)
          const p1 = pointXY(idx + 1, trajectory[idx + 1], trajectory.length)
          return (
            <g key={`v-${idx}`}>
              <line
                x1={p0.x}
                y1={p0.y}
                x2={p1.x}
                y2={p1.y}
                className="confidence-breakdown-cot-violation-seg"
                strokeDasharray="2 2"
              />
              <circle cx={p0.x} cy={p0.y} r={2.5} className="confidence-breakdown-cot-violation" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * 真提供了信息的来源。
 *
 * 导出是给收起行用的：那一格"几个来源"必须和展开那份清单同一条规则算出来，
 * 否则两处各算各的，又变成"同一个名字两个数"（#175 那一族）。
 *
 * 融合出口里那些"没有数据"的源会拿到一个 vacuous mass function（confidence 恒 0），
 * 它在 Dempster 下是单位元——等于什么都没参与。把它们列成"人工证据 0%"，
 * 用户读到的却是"人工证据说只有 0% 可信"，那是替系统编一个没发生过的判断。
 */
export function informativeSources(
  sources: ConfidenceAssessment['sources'],
): ConfidenceAssessment['sources'] {
  return sources.filter((s) => s.confidence > 0)
}

/**
 * ConfidenceBreakdown 组件
 */
const ConfidenceBreakdown: React.FC<ConfidenceBreakdownProps> = ({
  assessment,
  cotTraceAnalysis,
}) => {
  const { belief, plausibility, uncertainty, conflictLevel, ruleUsed, sources } = assessment
  const bel = Math.max(0, Math.min(1, belief))
  const pl = Math.max(0, Math.min(1, plausibility))
  const unc = Math.max(0, Math.min(1, uncertainty))
  const tier = conflictTier(conflictLevel)
  const informative = informativeSources(sources)

  const hover =
    `融合规则 ${ruleLabel(ruleUsed)} · 最大成对冲突 k = ` +
    (conflictLevel === undefined ? '未知' : conflictLevel.toFixed(3))

  return (
    <div className="confidence-breakdown" role="region" aria-label="可信度评估明细">
      <div className="confidence-breakdown-interval" title={hover}>
        <span className="confidence-breakdown-interval-bel">Bel {fmtPct(bel)}</span>
        <span className="confidence-breakdown-interval-track" aria-hidden="true">
          <i
            className="confidence-breakdown-interval-bel-fill"
            style={{ width: `${bel * 100}%` }}
          />
          <i
            className="confidence-breakdown-interval-unc-fill"
            style={{ left: `${bel * 100}%`, width: `${unc * 100}%` }}
          />
        </span>
        <span className="confidence-breakdown-interval-pl">Pl {fmtPct(pl)}</span>
      </div>

      {informative.length > 0 && (
        <ul className="confidence-breakdown-sources">
          {informative.map((s) => (
            <li className="confidence-breakdown-source" key={s.sourceId}>
              <span className="confidence-breakdown-source-name">{s.sourceName}</span>
              <span className="confidence-breakdown-source-meter" aria-hidden="true">
                <i
                  style={{
                    width: `${Math.max(0, Math.min(1, s.confidence)) * 100}%`,
                  }}
                />
              </span>
              <span className="confidence-breakdown-source-value">{fmtPct(s.confidence)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={`confidence-breakdown-foot is-${tier}`}>
        {tier === 'high'
          ? `各来源证据有冲突，已改用 ${ruleLabel(ruleUsed)} 重新分配 —— 这一轮的结论别直接照做`
          : tier === 'mild'
            ? `${ruleLabel(ruleUsed)} 融合 · 各来源之间有轻微冲突`
            : `${ruleLabel(ruleUsed)} 融合 · 各来源之间没有冲突`}
      </div>

      {cotTraceAnalysis && <CotTraceSection analysis={cotTraceAnalysis} />}
    </div>
  )
}

export default ConfidenceBreakdown
