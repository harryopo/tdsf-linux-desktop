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
import { evidenceWeightPercent } from '@shared/credibility'

interface PCR5ResultProps {
  /** 6 源证据数据 */
  sources: EvidenceSource[]
  /**
   * D-S 融合结果值
   *
   * null = 没有做过融合评估。这个位置以前会拿模型自报的置信度顶上来，
   * 外面还套着 m(A)=Σ… 的公式排版，看起来就像真算过融合。
   */
  fusedValue: number | null
  /** 冲突系数 K（null = 没有融合结论，不显示 K） */
  conflictK: number | null
}

/** 源图标映射 */
const SOURCE_ICONS = [
  Activity, TrendingUp, Database, FileText, Fingerprint, Cpu,
]

/**
 * 进度条相对宽度：满刻度从 shared/credibility 取
 *
 * 原来这里除以写死的 0.3，而画同一份权重的雷达图早已改成 1.0——
 * 同一个 0.6 在两张图上一个显示 60%、一个显示满格，两张图并排放着读数不可比。
 */
function getBarWidth(weight: number): string {
  return `${evidenceWeightPercent(weight)}%`
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
            <Icon className="h-4 w-4 shrink-0 text-ink-dim" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">{src.label}</span>
                <span className="text-micro text-ink-mute">{src.desc}</span>
              </div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--trae-bg-overlay-l2)]">
                <div
                  className="h-full rounded-full bg-accent-solid transition-all duration-700"
                  style={{ width: getBarWidth(src.weight) }}
                />
              </div>
            </div>
            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-(--accent-text)">
              {src.weight.toFixed(2)}
            </span>
          </div>
        )
      })}

      {/* D-S 融合公式 + PCR5 冲突再分配（没有融合结论时整块降级成占位，不摆公式） */}
      {fusedValue === null || conflictK === null ? (
        <div
          data-pcr5="placeholder"
          className="mt-1 rounded-[var(--trae-radius-6)] border border-dashed border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] px-4 py-3"
        >
          <div className="mb-1.5 flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-ink-dim" />
            <span className="text-micro font-medium uppercase tracking-[0.06em] text-ink-dim">
              未做融合评估
            </span>
          </div>
          <p className="text-caption leading-relaxed text-ink-mute">
            这条决策没有可信度融合结论（评估未执行，或执行失败）。上面六源是各来源的自报权重，
            没有经过 D-S 合成，所以这里不给出融合值与冲突系数的数字。
          </p>
        </div>
      ) : (
        <div className="mt-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-4 py-3" data-pcr5="formula">
          <div className="mb-1.5 flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-(--accent-text)" />
            <span className="text-micro font-medium uppercase tracking-[0.06em] text-ink-dim">
              D-S 融合公式 · PCR5 冲突再分配
            </span>
          </div>
          <code className="font-mono text-sm tabular-nums text-(--accent-text)">
            m(A) = Σ m<sub>i</sub>(A) ± K(冲突项) ={' '}
            <strong className="font-semibold">{fusedValue.toFixed(2)}</strong>
          </code>
          <div className="mt-1.5 flex items-center gap-2 text-micro text-ink-mute">
            <span className="font-mono">K = {conflictK.toFixed(3)}</span>
            <span className="text-ink-mute">·</span>
            <span>PCR5 按比例分配冲突质量</span>
          </div>
        </div>
      )}
    </div>
  )
}
