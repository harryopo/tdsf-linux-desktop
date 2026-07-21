/**
 * Pagination — 底部分页栏
 *
 * 设计稿：history.html 第 5 段 底部分页栏
 *
 * 结构：
 * - 左侧：共 N 条记录
 * - 右侧：上一页 / 页码 / 下一页
 *
 * JS 交互：上一页/下一页按钮禁用判断 + 页码点击 mock
 */
import { ArrowLeft, ArrowRight } from 'lucide-react'

/** 分页数据结构（从 mock 数据推导） */
export type PaginationData = {
  total: number
  currentPage: number
  pages: number[]
  showEllipsis: boolean
}

/**
 * Pagination 主组件
 *
 * @param data - 分页数据
 * @param onPageChange - 页码切换回调（mock console.log）
 */
export function Pagination({
  data,
  onPageChange,
}: {
  data: PaginationData
  onPageChange: (page: number) => void
}) {
  const hasPrev = data.currentPage > 1
  const hasNext = data.currentPage < data.pages[data.pages.length - 1]

  return (
    <footer
      className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[var(--trae-bg-base-secondary)] border-t border-[var(--trae-border-neutral-l1)]"
    >
      <span className="text-[10px] text-[var(--trae-text-tertiary)]">
        共{' '}
        <span className="font-mono text-[var(--trae-text-secondary)]">
          {data.total}
        </span>{' '}
        条记录
      </span>
      <div className="flex items-center gap-1">
        {/* 上一页 */}
        <button
          type="button"
          aria-label="上一页"
          disabled={!hasPrev}
          onClick={() => hasPrev && onPageChange(data.currentPage - 1)}
          className="inline-flex items-center justify-center w-7 h-7 bg-transparent border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l2)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeft className="w-3 h-3 text-[var(--trae-text-tertiary)]" />
        </button>
        {/* 页码 */}
        {data.pages.map((page, idx) => (
          <span key={`${page}-${idx}`} className="flex items-center">
            {/* 省略号（仅在第二位和最后位之间显示） */}
            {idx === data.pages.length - 2 && data.showEllipsis && (
              <span className="inline-flex items-center justify-center w-7 h-7 text-[10px] text-[var(--trae-text-tertiary)]">
                …
              </span>
            )}
            <button
              type="button"
              onClick={() => onPageChange(page)}
              className="inline-flex items-center justify-center w-7 h-7 text-[10px] font-medium border rounded-[var(--trae-radius-4)] cursor-pointer transition-colors duration-150"
              style={{
                background:
                  page === data.currentPage
                    ? 'var(--trae-bg-brand)'
                    : 'transparent',
                color:
                  page === data.currentPage
                    ? 'var(--trae-text-onbrand)'
                    : 'var(--trae-text-secondary)',
                borderColor:
                  page === data.currentPage
                    ? 'var(--trae-bg-brand)'
                    : 'var(--trae-border-neutral-l1)',
              }}
            >
              {page}
            </button>
          </span>
        ))}
        {/* 下一页 */}
        <button
          type="button"
          aria-label="下一页"
          disabled={!hasNext}
          onClick={() => hasNext && onPageChange(data.currentPage + 1)}
          className="inline-flex items-center justify-center w-7 h-7 bg-transparent border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l2)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowRight className="w-3 h-3 text-[var(--trae-text-secondary)]" />
        </button>
      </div>
    </footer>
  )
}
