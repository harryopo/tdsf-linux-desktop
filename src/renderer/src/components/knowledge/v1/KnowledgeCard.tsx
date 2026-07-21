/**
 * KnowledgeCard — 单个知识卡片组件
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge.html 左栏单条知识卡
 *
 * 结构：
 * - 标题行：标题 + 匹配度标签（右上角）
 * - 摘要：2 行截断
 * - 元信息行：分类 chip + 更新时间 + 阅读量 + 查看详情链接
 *
 * 交互：
 * - 整卡 onClick 跳转 `/knowledge/:id`
 * - "查看详情" 链接同效（preventDefault + 调用 onNavigate）
 * - hover：背景变浅 + 边框变蓝
 */
import { ArrowUpRight, Clock, Eye } from 'lucide-react'
import type { KnowledgeItem } from './types'

interface KnowledgeCardProps {
  /** 知识条目数据 */
  item: KnowledgeItem
  /** 点击卡片跳转详情 */
  onNavigate: (id: string) => void
}

/** 知识卡片组件 */
export function KnowledgeCard({ item, onNavigate }: KnowledgeCardProps) {
  return (
    <article
      onClick={() => onNavigate(item.id)}
      className="flex cursor-pointer flex-col border p-4 transition-colors"
      style={{
        background: 'var(--trae-bg-base-secondary)',
        borderColor: 'var(--trae-border-neutral-l1)',
        borderRadius: 'var(--trae-radius-8)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--trae-bg-overlay-l1)'
        e.currentTarget.style.borderColor = 'var(--trae-border-brand)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--trae-bg-base-secondary)'
        e.currentTarget.style.borderColor = 'var(--trae-border-neutral-l1)'
      }}
    >
      {/* 标题行 */}
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3
          className="min-w-0 truncate font-semibold"
          style={{
            fontSize: 'var(--trae-body-base-strong-font-size)',
            lineHeight: 'var(--trae-body-base-strong-line-height)',
            color: 'var(--trae-text-default)',
          }}
        >
          {item.title}
        </h3>
        <span
          className="inline-flex h-5 shrink-0 items-center whitespace-nowrap px-2"
          style={{
            background: 'var(--trae-bg-brand-popup)',
            color: 'var(--trae-text-brand)',
            fontSize: 'var(--trae-body-xs-font-size)',
            fontWeight: 500,
            borderRadius: 'var(--trae-radius-2)',
            border: '1px solid var(--trae-border-brand)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {item.matchScore}%匹配
        </span>
      </div>
      {/* 摘要 */}
      <p
        className="mb-3 line-clamp-2"
        style={{
          fontSize: 'var(--trae-body-sm-font-size)',
          lineHeight: 'var(--trae-body-sm-line-height)',
          color: 'var(--trae-text-secondary)',
        }}
      >
        {item.summary}
      </p>
      {/* 元信息行 */}
      <div
        className="flex flex-wrap items-center gap-3"
        style={{
          fontSize: 'var(--trae-body-xs-font-size)',
          color: 'var(--trae-text-tertiary)',
        }}
      >
        <span
          className="inline-flex h-5 items-center px-2"
          style={{
            background: 'var(--trae-bg-overlay-l3)',
            color: 'var(--trae-text-secondary)',
            borderRadius: 'var(--trae-radius-2)',
          }}
        >
          {item.category}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" style={{ color: 'var(--trae-icon-tertiary)' }} />
          {item.updatedAt}
        </span>
        <span className="inline-flex items-center gap-1">
          <Eye className="h-3 w-3" style={{ color: 'var(--trae-icon-tertiary)' }} />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {item.views >= 1000 ? `${(item.views / 1000).toFixed(1)}k` : item.views}
          </span>
        </span>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onNavigate(item.id)
          }}
          className="ml-auto inline-flex items-center gap-1 transition-colors"
          style={{
            color: 'var(--trae-text-brand)',
            fontSize: 'var(--trae-body-xs-font-size)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--trae-text-brand-hover)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--trae-text-brand)'
          }}
        >
          查看详情
          <ArrowUpRight
            className="h-3 w-3"
            style={{ color: 'var(--trae-icon-brand)' }}
          />
        </a>
      </div>
    </article>
  )
}
