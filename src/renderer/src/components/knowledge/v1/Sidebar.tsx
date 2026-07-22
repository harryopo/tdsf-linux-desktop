/**
 * Sidebar — 知识库列表右栏（热门知识 + 最近浏览）
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge.html 右栏 aside
 *
 * 结构：
 * - 热门知识 Top5（带 rank 序号 + 标题 + 阅读量）
 * - 最近浏览 3 项（带 BookOpen 图标 + 标题 + 时间）
 *
 * 交互：
 * - Hot list 项 onClick → onNavigate(id) 跳转 `/knowledge/:id`
 * - Recent list 项 onClick → onNavigate(id) 跳转 `/knowledge/:id`
 */
import { BookOpen, Clock, Star } from 'lucide-react'
import { HOT_ITEMS, RECENT_ITEMS } from './types'

interface SidebarProps {
  /** 列表项点击回调（跳转知识详情） */
  onNavigate?: (id: string) => void
}

/** 热门知识卡片 */
export function HotList({ onNavigate }: SidebarProps = {}) {
  return (
    <section className="kb-side-card">
      <div className="kb-side-card__head">
        <Star
          className="h-4 w-4"
          style={{ color: 'var(--trae-icon-brand)' }}
        />
        <h2 className="kb-side-card__title">
          热门知识
        </h2>
      </div>
      <ol className="kb-hot-list">
        {HOT_ITEMS.map((item) => (
          <li
            key={item.rank}
            className="kb-hot-item"
            onClick={() => onNavigate?.(item.id)}
            title={`查看「${item.title}」详情`}
          >
            <span className="kb-hot-rank">
              {item.rank}
            </span>
            <span className="kb-hot-title">
              {item.title}
            </span>
            <span className="kb-hot-views">
              {item.views}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** 最近浏览卡片 */
export function RecentList({ onNavigate }: SidebarProps = {}) {
  return (
    <section className="kb-side-card">
      <div className="kb-side-card__head">
        <Clock
          className="h-4 w-4"
          style={{ color: 'var(--trae-icon-brand)' }}
        />
        <h2 className="kb-side-card__title">
          最近浏览
        </h2>
      </div>
      <ul className="kb-recent-list">
        {RECENT_ITEMS.map((item, idx) => (
          <li
            key={idx}
            className="kb-recent-item"
            onClick={() => onNavigate?.(item.id)}
            title={`查看「${item.title}」详情`}
          >
            <BookOpen
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: 'var(--trae-icon-secondary)' }}
            />
            <span className="kb-recent-title">
              {item.title}
            </span>
            <span className="kb-recent-time">
              {item.time}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 右栏整体（HotList + RecentList） */
export function Sidebar({ onNavigate }: SidebarProps = {}) {
  return (
    <aside className="kb-sidebar">
      <HotList onNavigate={onNavigate} />
      <RecentList onNavigate={onNavigate} />
    </aside>
  )
}
