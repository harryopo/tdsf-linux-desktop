/**
 * SearchResultCard — 混合检索结果项（Sprint 7 任务 F）
 *
 * 设计要点：
 * - 标题（title）+ 分类标签（category）
 * - 相似度分数（scorePercent，以百分比展示）
 * - 命中来源（source: fts/vec/both，用小图标 + 文字标签）
 * - 摘要（problem 前 100 字，由 toSearchResultItem 截断）
 * - 点击跳转 TutorialDetailPage（通过 onOpen 回调）
 *
 * 视觉规范：
 * - 卡片 hover 仅阴影变化（禁止同时变 border + 位移 + scale）
 * - rrfScore 高亮：用 scorePercent 配色（>80 绿 / 50-80 蓝 / <50 灰）
 * - source 标签：fts 灰 / vec 蓝 / both 绿（双路命中强调）
 * - 字体：标题 Inter / 摘要 Inter / 分数 JetBrains Mono（等宽数字）
 *
 * 交互：
 * - 整卡 onClick 跳转 onOpen(id)
 * - 键盘 Enter/Space 触发跳转（无障碍）
 */
import { FileText, ArrowUpRight } from 'lucide-react'
import type { SearchResultItem } from './hybrid-search-types'
import { SOURCE_LABELS, SOURCE_COLORS } from './hybrid-search-types'

export interface SearchResultCardProps {
  /** 搜索结果项 */
  result: SearchResultItem
  /** 点击卡片跳转 */
  onOpen: (id: string) => void
}

/**
 * 根据相似度百分比返回颜色配置
 *
 * - >= 80：成功绿（高匹配度，强调）
 * - 50-79：品牌蓝（中等匹配度）
 * - < 50：中性灰（低匹配度，弱化）
 */
function getScoreColor(score: number): {
  color: string
  background: string
  border: string
} {
  if (score >= 80) {
    return {
      color: 'var(--trae-status-success-default)',
      background: 'var(--trae-status-success-surface-l1)',
      border: 'var(--trae-status-success-default)',
    }
  }
  if (score >= 50) {
    return {
      color: 'var(--trae-text-brand)',
      background: 'var(--trae-bg-brand-popup)',
      border: 'var(--trae-border-brand)',
    }
  }
  return {
    color: 'var(--trae-text-secondary)',
    background: 'var(--trae-bg-overlay-l2)',
    border: 'var(--trae-border-neutral-l1)',
  }
}

/** 搜索结果卡片组件 */
export function SearchResultCard({ result, onOpen }: SearchResultCardProps) {
  const sourceColor = SOURCE_COLORS[result.source]
  const scoreColor = getScoreColor(result.scorePercent)

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(result.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(result.id)
        }
      }}
      className="flex cursor-pointer flex-col gap-2 border transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
      style={{
        background: 'var(--trae-bg-base-secondary)',
        borderColor: 'var(--trae-border-neutral-l1)',
        borderRadius: 'var(--trae-radius-8)',
        padding: '14px 16px',
      }}
    >
      {/* ===== 标题行：图标 + 标题 + 分数 + 跳转箭头 ===== */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <FileText
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: 'var(--trae-icon-secondary)' }}
          />
          <h4
            className="m-0 min-w-0 truncate font-semibold"
            style={{
              fontSize: 'var(--trae-body-base-strong-font-size)',
              lineHeight: 'var(--trae-body-base-strong-line-height)',
              color: 'var(--trae-text-default)',
            }}
            title={result.title}
          >
            {result.title}
          </h4>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 相似度分数（百分比） */}
          <span
            className="inline-flex h-5 items-center whitespace-nowrap px-1.5"
            style={{
              color: scoreColor.color,
              background: scoreColor.background,
              border: `1px solid ${scoreColor.border}`,
              borderRadius: 'var(--trae-radius-2)',
              fontSize: 'var(--trae-body-xs-font-size)',
              fontWeight: 'var(--trae-font-weight-medium)',
              fontVariantNumeric: 'tabular-nums',
            }}
            title={`RRF 融合分：${result.rrfScore.toFixed(4)}`}
          >
            {result.scorePercent}%
          </span>
          <ArrowUpRight
            className="h-3.5 w-3.5"
            style={{ color: 'var(--trae-icon-tertiary)' }}
          />
        </div>
      </div>

      {/* ===== 摘要（前 100 字） ===== */}
      <p
        className="m-0"
        style={{
          fontSize: 'var(--trae-body-sm-font-size)',
          lineHeight: 'var(--trae-body-sm-line-height)',
          color: 'var(--trae-text-secondary)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {result.summaryTruncated}
      </p>

      {/* ===== 元信息行：分类 + 召回来源 + 原始分数 ===== */}
      <div
        className="flex flex-wrap items-center gap-2"
        style={{
          fontSize: 'var(--trae-body-xs-font-size)',
          color: 'var(--trae-text-tertiary)',
        }}
      >
        {/* 分类标签 */}
        {result.category && (
          <span
            className="inline-flex h-5 items-center px-1.5"
            style={{
              background: 'var(--trae-bg-overlay-l2)',
              color: 'var(--trae-text-secondary)',
              borderRadius: 'var(--trae-radius-2)',
            }}
          >
            {result.category}
          </span>
        )}

        {/* 召回来源标签（fts / vec / both） */}
        <span
          className="inline-flex h-5 items-center gap-1 px-1.5"
          style={{
            color: sourceColor.color,
            background: sourceColor.background,
            border: `1px solid ${sourceColor.border}`,
            borderRadius: 'var(--trae-radius-2)',
            fontWeight: 'var(--trae-font-weight-medium)',
          }}
          title={`召回来源：${
            result.source === 'fts'
              ? '仅关键词命中'
              : result.source === 'vec'
                ? '仅语义命中'
                : '关键词 + 语义双路命中'
          }`}
        >
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'currentColor',
            }}
          />
          {SOURCE_LABELS[result.source]}
        </span>

        {/* 原始分数（调试用，等宽数字） */}
        <span
          className="inline-flex items-center gap-1"
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontFamily: 'var(--trae-font-family-mono)',
          }}
          title="BM25 原始分 / 余弦距离"
        >
          fts:{result.ftsScore.toFixed(2)} · vec:{result.vecDistance.toFixed(3)}
        </span>
      </div>
    </article>
  )
}
