/**
 * PCR5Result — D-S 证据融合 + PCR5 冲突再分配结果
 *
 * 设计稿：decision-detail.html 区域3 右侧
 * - 6 证据源明细卡片（每个含进度条 + 权重值）
 * - D-S 融合公式 m(A) = Σ mi(A) ± K(冲突项) = 0.87
 * - PCR5 冲突再分配提示（项目自定义增强）
 *
 * PCR5（Proportional Conflict Redistribution 5）是 D-S 证据理论的扩展规则，
 * 用于处理高冲突证据场景，将冲突质量按比例分配给非空假设。
 */
import {
  Activity, TrendingUp, Database, FileText, Fingerprint, Cpu, Zap,
} from 'lucide-react'
import type { EvidenceSource } from './EvidenceRadar'

interface PCR5ResultProps {
  /** 6 源证据数据 */
  sources: EvidenceSource[]
  /** D-S 融合结果值 */
  fusedValue: number
  /** 冲突系数 K */
  conflictK: number
}

/** 源图标映射 */
const SOURCE_ICONS = [
  Activity, TrendingUp, Database, FileText, Fingerprint, Cpu,
]

/**
 * 进度条相对宽度（基于满刻度 0.30）。
 */
function getBarWidth(weight: number): string {
  return `${Math.min((weight / 0.3) * 100, 100)}%`
}

/**
 * PCR5Result 组件
 */
export function PCR5Result({ sources, fusedValue, conflictK }: PCR5ResultProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {/* 6 证据源明细卡片 */}
      {sources.map((src, idx) => {
        const Icon = SOURCE_ICONS[idx] ?? Activity
        return (
          <div
            key={src.label}
            className="evidence-card flex items-center gap-3 rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-base-tertiary)] px-3 py-2 transition-colors hover:bg-[var(--trae-bg-overlay-l1)]"
          >
            <Icon className="h-4 w-4 shrink-0 text-[var(--trae-text-secondary)]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-[var(--trae-text-default)]">{src.label}</span>
                <span className="text-[10px] text-[var(--trae-text-tertiary)]">{src.desc}</span>
              </div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--trae-bg-overlay-l2)]">
                <div
                  className="h-full rounded-full bg-[var(--trae-bg-brand)] transition-all duration-700"
                  style={{ width: getBarWidth(src.weight) }}
                />
              </div>
            </div>
            <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-[var(--trae-text-brand)]">
              {src.weight.toFixed(2)}
            </span>
          </div>
        )
      })}

      {/* D-S 融合公式 + PCR5 冲突再分配 */}
      <div className="mt-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-4 py-3">
        <div className="mb-1.5 flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-[var(--trae-text-brand)]" />
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--trae-text-secondary)]">
            D-S 融合公式 · PCR5 冲突再分配
          </span>
        </div>
        <code className="font-mono text-[12px] tabular-nums text-[var(--trae-text-brand)]">
          m(A) = Σ m<sub>i</sub>(A) ± K(冲突项) ={' '}
          <strong className="font-semibold">{fusedValue.toFixed(2)}</strong>
        </code>
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--trae-text-tertiary)]">
          <span className="font-mono">K = {conflictK.toFixed(3)}</span>
          <span className="text-[var(--trae-text-tertiary)]">·</span>
          <span>PCR5 按比例分配冲突质量</span>
        </div>
      </div>
    </div>
  )
}
