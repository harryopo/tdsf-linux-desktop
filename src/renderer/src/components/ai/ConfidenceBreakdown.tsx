/**
 * ConfidenceBreakdown - 可信度评估结果展示组件
 *
 * 职责：
 * - 展示 Bel/Pl 信任区间（区间条形图）
 * - 综合可信度（综合数值）
 * - 冲突等级警告（> 0.3 触发 PCR5）
 * - 使用规则标签（Dempster / PCR5）
 * - 不确定性（Pl - Bel）
 *
 * 论文支撑：
 * - Shafer 1976（Bel/Pl 信任区间）
 * - Smarandache & Dezert 2004（PCR5 冲突处理）
 * - EU AI Act 2026（透明化设计原则）
 *
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
 */
import type { ConfidenceAssessment } from '@shared/agent-types'
import './ConfidenceBreakdown.css'

/** ConfidenceBreakdown 组件 Props */
export interface ConfidenceBreakdownProps {
  /** 可信度评估结果 */
  assessment: ConfidenceAssessment
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

/**
 * ConfidenceBreakdown 组件
 */
const ConfidenceBreakdown: React.FC<ConfidenceBreakdownProps> = ({ assessment }) => {
  const { belief, plausibility, confidence, uncertainty, conflictLevel, ruleUsed } = assessment
  const bel = Math.max(0, Math.min(1, belief))
  const pl = Math.max(0, Math.min(1, plausibility))
  const unc = Math.max(0, Math.min(1, uncertainty))
  const conf = Math.max(0, Math.min(1, confidence))

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
    </div>
  )
}

export default ConfidenceBreakdown
