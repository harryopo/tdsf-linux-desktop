/**
 * ConfidenceBreakdown - 可信度评估结果展示组件
 *
 * 职责：
 * - 展示 Bel/Pl 信任区间（区间条形图）
 * - 综合可信度（综合数值）
 * - 冲突等级警告（> 0.3 触发 PCR5）
 * - 使用规则标签（Dempster / PCR5）
 * - 不确定性（Pl - Bel）
 * - v0.9.6 P2 M6：CoT 熵轨迹可视化（SVG 折线图 + 单调性 tag + 关键指标）
 *
 * 论文支撑：
 * - Shafer 1976（Bel/Pl 信任区间）
 * - Smarandache & Dezert 2004（PCR5 冲突处理）
 * - EU AI Act 2026（透明化设计原则）
 * - Zhao 2026, arXiv:2603.18940（CoT-shape 熵轨迹单调性预测推理可靠性）
 *
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
 *           v0.9.6 P2 M6（Trace 可视化）
 */
import type { ConfidenceAssessment } from '@shared/agent-types'
import type { CotTraceAnalysis } from '@shared/cot-trace-analyzer'
import './ConfidenceBreakdown.css'

/** ConfidenceBreakdown 组件 Props */
export interface ConfidenceBreakdownProps {
  /** 可信度评估结果 */
  assessment: ConfidenceAssessment
  /**
   * CoT 熵轨迹分析（v0.9.6 P2 M6 新增，可选）
   *
   * 不传时不渲染轨迹区。
   * 传非空时渲染 SVG 折线图 + 单调性 tag + 关键指标。
   *
   * 数据来源：DecisionCard 从最后一条 assistant 消息的 cotEntropyTrajectory
   *          → analyzeCotEntropyTrajectory → 渲染
   */
  cotTraceAnalysis?: CotTraceAnalysis
}

/** 格式化百分比 */
function fmtPct(n: number | undefined, digits = 1): string {
  if (n === undefined || Number.isNaN(n)) return '--'
  return `${(n * 100).toFixed(digits)}%`
}

/** 规则标签显示 */
function ruleLabel(rule: string | undefined): string {
  if (rule === 'dempster') return 'Dempster'
  if (rule === 'pcr5') return 'PCR5'
  return rule ?? 'unknown'
}

/** 规则配色（暗系） */
function ruleColor(rule: string | undefined): string {
  if (rule === 'pcr5') return 'var(--color-warning)'
  return 'var(--color-link)'
}

/** 冲突等级颜色 */
function conflictColor(k: number | undefined): string {
  if (k === undefined) return 'var(--color-text-tertiary)'
  if (k >= 0.3) return 'var(--color-error)'
  if (k >= 0.15) return 'var(--color-warning)'
  return 'var(--color-success)'
}

/** 综合置信度颜色（参考 ISO 31000 风险三级） */
function confidenceColor(c: number | undefined): string {
  if (c === undefined) return 'var(--color-text-tertiary)'
  if (c >= 0.7) return 'var(--color-success)'
  if (c >= 0.5) return 'var(--color-warning)'
  return 'var(--color-error)'
}

// ============================================================================
// P2 M6: CoT 熵轨迹可视化（SVG 折线图 + 违规点 + 关键指标）
// ============================================================================

/** SVG 折线图尺寸（viewBox 用） */
const TRACE_W = 320
const TRACE_H = 80
const TRACE_PAD_X = 8
const TRACE_PAD_Y = 8
const TRACE_INNER_W = TRACE_W - TRACE_PAD_X * 2
const TRACE_INNER_H = TRACE_H - TRACE_PAD_Y * 2

/**
 * 计算轨迹点 (x, y) 坐标
 */
function pointXY(idx: number, value: number, steps: number): { x: number; y: number } {
  // x 均匀分布在 inner width
  const x =
    steps <= 1
      ? TRACE_PAD_X + TRACE_INNER_W / 2
      : TRACE_PAD_X + (idx / (steps - 1)) * TRACE_INNER_W
  // y 反转（SVG y 向下），clamp 到 [0, 1]
  const v = Math.max(0, Math.min(1, value))
  const y = TRACE_PAD_Y + (1 - v) * TRACE_INNER_H
  return { x, y }
}

/**
 * 构建折线路径（polyline 的 d 字符串）
 */
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
 * CoT 熵轨迹 SVG 折线图
 *
 * 设计原则（v0.9.6 P2 M6）：
 * - 不引入外部图表库（避免体积膨胀），用纯 SVG
 * - 暗系：网格 + 主折线（绿=单调 / 黄=非单调）+ 违规点（红圆）
 * - 紧凑：TRACE_W=320, TRACE_H=80（嵌入到 confidence-breakdown 内部）
 */
const CotTraceChart: React.FC<{ analysis: CotTraceAnalysis }> = ({ analysis }) => {
  const { trajectory = [], violationIndices = [], monotone } = analysis

  if (trajectory.length < 2) {
    return (
      <div className="confidence-breakdown-cot-empty">
        轨迹步数不足（{trajectory.length}），无法绘制形状
      </div>
    )
  }

  const path = buildTracePath(trajectory)
  const stroke = monotone ? 'var(--color-success)' : 'var(--color-warning)'

  // 网格线 y 坐标（0 / 0.5 / 1.0 三条）
  const gridYs = [0, 0.5, 1].map((v) => TRACE_PAD_Y + (1 - v) * TRACE_INNER_H)

  return (
    <svg
      className="confidence-breakdown-cot-svg"
      viewBox={`0 0 ${TRACE_W} ${TRACE_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`CoT 熵轨迹折线图，共 ${trajectory.length} 步`}
    >
      {/* 背景 */}
      <rect
        x={0}
        y={0}
        width={TRACE_W}
        height={TRACE_H}
        fill="var(--color-bg-card)"
        rx={4}
      />
      {/* 水平网格线 */}
      {gridYs.map((y) => (
        <line
          key={y}
          x1={TRACE_PAD_X}
          y1={y}
          x2={TRACE_W - TRACE_PAD_X}
          y2={y}
          stroke="var(--color-border)"
          strokeWidth={0.5}
          strokeDasharray="2 3"
        />
      ))}
      {/* y 轴标签（0 / 0.5 / 1） */}
      {[0, 0.5, 1].map((v) => {
        const y = TRACE_PAD_Y + (1 - v) * TRACE_INNER_H
        return (
          <text
            key={v}
            x={TRACE_W - TRACE_PAD_X + 2}
            y={y + 3}
            fontSize={8}
            fill="var(--color-text-tertiary)"
            textAnchor="start"
          >
            {v.toFixed(1)}
          </text>
        )
      })}
      {/* 主轨迹折线 */}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 轨迹点（细点） */}
      {trajectory.map((v: number, i: number) => {
        const { x, y } = pointXY(i, v, trajectory.length)
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={1.5}
            fill={stroke}
            opacity={0.7}
          />
        )
      })}
      {/* 违规点标记（红色圆 + 红色虚线连接到下一点） */}
      {violationIndices.map((idx) => {
        if (idx >= trajectory.length - 1) return null
        const v0 = trajectory[idx]
        const v1 = trajectory[idx + 1]
        const p0 = pointXY(idx, v0, trajectory.length)
        const p1 = pointXY(idx + 1, v1, trajectory.length)
        return (
          <g key={`v-${idx}`}>
            {/* 红色虚线连接（标识反弹） */}
            <line
              x1={p0.x}
              y1={p0.y}
              x2={p1.x}
              y2={p1.y}
              stroke="var(--color-error)"
              strokeWidth={1.2}
              strokeDasharray="2 2"
            />
            {/* 红色圆点（违规点） */}
            <circle
              cx={p0.x}
              cy={p0.y}
              r={3}
              fill="var(--color-error)"
              stroke="var(--color-bg-card)"
              strokeWidth={1}
            />
          </g>
        )
      })}
    </svg>
  )
}

/**
 * CoT 熵轨迹区（包含标题 + 单调性 tag + 折线图 + 关键指标 + 论文依据）
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
    summary,
  } = analysis

  /** 单调性 tag 颜色 */
  const tagColor = monotone ? 'var(--color-success)' : 'var(--color-warning)'

  return (
    <div className="confidence-breakdown-cot">
      <div className="confidence-breakdown-cot-header">
        <span className="confidence-breakdown-cot-title">CoT 熵轨迹分析</span>
        <span
          className="confidence-breakdown-cot-tag"
          style={{ color: tagColor }}
          title={summary}
        >
          {monotone ? '单调链' : `非单调链 · ${violations} 次违规`}
        </span>
      </div>
      <CotTraceChart analysis={analysis} />
      <div className="confidence-breakdown-cot-stats">
        <div className="confidence-breakdown-cot-stat">
          <span className="confidence-breakdown-cot-stat-label">步数</span>
          <span className="confidence-breakdown-cot-stat-value">{steps}</span>
        </div>
        <div className="confidence-breakdown-cot-stat">
          <span className="confidence-breakdown-cot-stat-label">H₀</span>
          <span className="confidence-breakdown-cot-stat-value">{startEntropy.toFixed(3)}</span>
        </div>
        <div className="confidence-breakdown-cot-stat">
          <span className="confidence-breakdown-cot-stat-label">Hₙ</span>
          <span className="confidence-breakdown-cot-stat-value">{endEntropy.toFixed(3)}</span>
        </div>
        <div className="confidence-breakdown-cot-stat">
          <span className="confidence-breakdown-cot-stat-label">ΔH</span>
          <span
            className="confidence-breakdown-cot-stat-value"
            style={{
              color: totalReduction >= 0 ? 'var(--color-success)' : 'var(--color-error)',
            }}
          >
            {totalReduction >= 0 ? '+' : ''}
            {totalReduction.toFixed(3)}
          </span>
        </div>
        <div className="confidence-breakdown-cot-stat">
          <span className="confidence-breakdown-cot-stat-label">形状置信度</span>
          <span
            className="confidence-breakdown-cot-stat-value"
            style={{ color: confidenceColor(confidence) }}
          >
            {fmtPct(confidence, 0)}
          </span>
        </div>
      </div>
      <div className="confidence-breakdown-cot-paper">
        论文依据：Zhao 2026, arXiv:2603.18940 — 熵轨迹形状单调性预测 LLM 推理可靠性
      </div>
    </div>
  )
}

/**
 * ConfidenceBreakdown 组件
 */
const ConfidenceBreakdown: React.FC<ConfidenceBreakdownProps> = ({
  assessment,
  cotTraceAnalysis,
}) => {
  const { belief, plausibility, confidence, uncertainty, conflictLevel, ruleUsed } = assessment
  const bel = Math.max(0, Math.min(1, belief))
  const pl = Math.max(0, Math.min(1, plausibility))
  const unc = Math.max(0, Math.min(1, uncertainty))
  const conf = Math.max(0, Math.min(1, confidence))

  /** 是否渲染 CoT 轨迹区（有 trajectory 且步数 >= 2） */
  const showCot = !!(
    cotTraceAnalysis &&
    cotTraceAnalysis.trajectory &&
    cotTraceAnalysis.trajectory.length >= 2
  )

  return (
    <div className="confidence-breakdown" role="region" aria-label="可信度评估明细">
      {/* ===== 标题行 ===== */}
      <div className="confidence-breakdown-header">
        <span className="confidence-breakdown-title">可信度评估（D-S + PCR5）</span>
        <span
          className="confidence-breakdown-rule"
          style={{ color: ruleColor(ruleUsed) }}
          title={ruleUsed === 'pcr5' ? '冲突 ≥ 0.3 切换到 PCR5 规则' : '低冲突使用 Dempster 规则'}
        >
          {ruleLabel(ruleUsed)}
        </span>
      </div>

      {/* ===== Bel/Pl 区间条 ===== */}
      <div className="confidence-breakdown-interval">
        <div className="confidence-breakdown-interval-bar">
          {/* 背景：完整 0-1 */}
          <div className="confidence-breakdown-interval-bg" />
          {/* Bel 段：0 → Bel */}
          <div
            className="confidence-breakdown-interval-bel"
            style={{ width: `${bel * 100}%` }}
            title={`Belief = ${fmtPct(bel)}`}
          />
          {/* 不确定段：Bel → Pl */}
          <div
            className="confidence-breakdown-interval-unc"
            style={{
              left: `${bel * 100}%`,
              width: `${unc * 100}%`,
            }}
            title={`Uncertainty = ${fmtPct(unc)}`}
          />
        </div>
        <div className="confidence-breakdown-interval-labels">
          <span style={{ color: 'var(--color-success)' }}>Bel {fmtPct(bel)}</span>
          <span style={{ color: 'var(--color-text-tertiary)' }}>Pl {fmtPct(pl)}</span>
        </div>
      </div>

      {/* ===== 4 个数值卡片 ===== */}
      <div className="confidence-breakdown-grid">
        <div className="confidence-breakdown-cell">
          <div className="confidence-breakdown-cell-label">综合</div>
          <div
            className="confidence-breakdown-cell-value"
            style={{ color: confidenceColor(conf) }}
          >
            {fmtPct(conf, 0)}
          </div>
        </div>
        <div className="confidence-breakdown-cell">
          <div className="confidence-breakdown-cell-label">Bel</div>
          <div
            className="confidence-breakdown-cell-value"
            style={{ color: 'var(--color-success)' }}
          >
            {fmtPct(bel, 0)}
          </div>
        </div>
        <div className="confidence-breakdown-cell">
          <div className="confidence-breakdown-cell-label">Pl</div>
          <div
            className="confidence-breakdown-cell-value"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {fmtPct(pl, 0)}
          </div>
        </div>
        <div className="confidence-breakdown-cell">
          <div className="confidence-breakdown-cell-label">不确定</div>
          <div
            className="confidence-breakdown-cell-value"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {fmtPct(unc, 0)}
          </div>
        </div>
      </div>

      {/* ===== 冲突警告条 ===== */}
      {conflictLevel !== undefined && (
        <div className="confidence-breakdown-conflict">
          <span
            className="confidence-breakdown-conflict-dot"
            style={{ background: conflictColor(conflictLevel) }}
          />
          <span className="confidence-breakdown-conflict-label">证据冲突 k =</span>
          <span
            className="confidence-breakdown-conflict-value"
            style={{ color: conflictColor(conflictLevel) }}
          >
            {conflictLevel.toFixed(3)}
          </span>
          {conflictLevel >= 0.3 && (
            <span className="confidence-breakdown-conflict-hint">
              超 0.3 阈值，已自动切换到 PCR5 规则
            </span>
          )}
        </div>
      )}

      {/* ===== v0.9.6 P2 M6: CoT 熵轨迹可视化 ===== */}
      {showCot && cotTraceAnalysis && <CotTraceSection analysis={cotTraceAnalysis} />}
    </div>
  )
}

export default ConfidenceBreakdown
