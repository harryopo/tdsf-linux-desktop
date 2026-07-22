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
      className="kb-card"
    >
      {/* 标题行 */}
      <div className="kb-card__head">
        <h3 className="kb-card__title">
          {item.title}
        </h3>
        <span className="kb-card__match">
          {item.matchScore}%匹配
        </span>
      </div>
      {/* 摘要 */}
      <p className="kb-card__summary">
        {item.summary}
      </p>
      {/* 元信息行 */}
      <div className="kb-card__meta">
        <span className="kb-cat-tag">
          {item.category}
        </span>
        <span className="kb-meta-time">
          <Clock className="h-3 w-3" style={{ color: 'var(--trae-icon-tertiary)' }} />
          {item.updatedAt}
        </span>
        <span className="kb-meta-views">
          <Eye className="h-3 w-3" style={{ color: 'var(--trae-icon-tertiary)' }} />
          <span className="kb-meta-views__num">
            {item.views >= 1000 ? `${(item.views / 1000).toFixed(1)}k` : item.views}
          </span>
        </span>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onNavigate(item.id)
          }}
          className="kb-view-link"
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
