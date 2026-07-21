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
    <section
      className="border p-4"
      style={{
        background: 'var(--trae-bg-base-secondary)',
        borderColor: 'var(--trae-border-neutral-l1)',
        borderRadius: 'var(--trae-radius-8)',
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Star
          className="h-4 w-4"
          style={{ color: 'var(--trae-icon-brand)' }}
        />
        <h2
          className="font-semibold"
          style={{
            fontSize: 'var(--trae-heading-xs-font-size)',
            lineHeight: 'var(--trae-heading-xs-line-height)',
            color: 'var(--trae-text-default)',
          }}
        >
          热门知识
        </h2>
      </div>
      <ol className="flex flex-col gap-2.5">
        {HOT_ITEMS.map((item) => (
          <li
            key={item.rank}
            className="flex cursor-pointer items-center gap-2.5 transition-colors hover:text-[var(--trae-text-brand)]"
            onClick={() => onNavigate?.(item.id)}
            title={`查看「${item.title}」详情`}
          >
            <span
              className="w-4 shrink-0 text-center font-semibold"
              style={{
                fontSize: 'var(--trae-body-sm-font-size)',
                lineHeight: 'var(--trae-body-sm-line-height)',
                color: 'var(--trae-text-brand)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {item.rank}
            </span>
            <span
              className="min-w-0 flex-1 truncate"
              style={{
                fontSize: 'var(--trae-body-sm-font-size)',
                lineHeight: 'var(--trae-body-sm-line-height)',
                color: 'var(--trae-text-default)',
              }}
            >
              {item.title}
            </span>
            <span
              className="shrink-0"
              style={{
                fontSize: 'var(--trae-body-xs-font-size)',
                color: 'var(--trae-text-tertiary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
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
    <section
      className="border p-4"
      style={{
        background: 'var(--trae-bg-base-secondary)',
        borderColor: 'var(--trae-border-neutral-l1)',
        borderRadius: 'var(--trae-radius-8)',
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Clock
          className="h-4 w-4"
          style={{ color: 'var(--trae-icon-brand)' }}
        />
        <h2
          className="font-semibold"
          style={{
            fontSize: 'var(--trae-heading-xs-font-size)',
            lineHeight: 'var(--trae-heading-xs-line-height)',
            color: 'var(--trae-text-default)',
          }}
        >
          最近浏览
        </h2>
      </div>
      <ul className="flex flex-col gap-2.5">
        {RECENT_ITEMS.map((item, idx) => (
          <li
            key={idx}
            className="flex cursor-pointer items-center gap-2.5 transition-colors hover:text-[var(--trae-text-brand)]"
            onClick={() => onNavigate?.(item.id)}
            title={`查看「${item.title}」详情`}
          >
            <BookOpen
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: 'var(--trae-icon-secondary)' }}
            />
            <span
              className="min-w-0 flex-1 truncate"
              style={{
                fontSize: 'var(--trae-body-sm-font-size)',
                lineHeight: 'var(--trae-body-sm-line-height)',
                color: 'var(--trae-text-default)',
              }}
            >
              {item.title}
            </span>
            <span
              className="shrink-0"
              style={{
                fontSize: 'var(--trae-body-xs-font-size)',
                color: 'var(--trae-text-tertiary)',
              }}
            >
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
    <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[280px]">
      <HotList onNavigate={onNavigate} />
      <RecentList onNavigate={onNavigate} />
    </aside>
  )
}
