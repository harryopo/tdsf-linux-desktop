/**
 * 对话记录的过滤与分页（#182）
 *
 * 之前这一块是摆设：搜索框没有 value/onChange，输入什么都不影响表格；
 * 分页页码写死 `[1,2,3] … 13`，`currentPage` 只用来高亮，列表从不按页切片——
 * 第 2 页和第 13 页看到的是同一整页。抽成纯函数是为了让这两件事能被判据钉住。
 */
import type { ConversationRow } from './constants'

/** 每页条数（与表格视觉密度一致：一屏 8 行） */
export const CONVERSATION_PAGE_SIZE = 8

/**
 * 按状态 + 搜索词过滤
 *
 * 搜索词对**用户输入 / 模型名 / 时间**做不区分大小写的子串匹配。
 * 空白搜索词视为不过滤（与空查询浏览全部一致）。
 */
export function filterConversations(
  rows: readonly ConversationRow[],
  status: '全部状态' | '成功' | '已拦截' | '失败',
  query: string
): ConversationRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (status !== '全部状态' && row.status !== status) return false
    if (!needle) return true
    return (
      row.input.toLowerCase().includes(needle) ||
      row.model.toLowerCase().includes(needle) ||
      row.time.toLowerCase().includes(needle)
    )
  })
}

export interface PagedResult<T> {
  /** 当前页的数据（已切片） */
  rows: T[]
  /** 收敛后的页码（越界会被拉回 1..totalPages） */
  page: number
  totalPages: number
  totalRows: number
}

/**
 * 按页切片
 *
 * 页码越界（筛选后总数变少、或手输页码）一律收敛到有效区间：
 * 否则会出现"当前第 13 页、表格却是空的"这种自相矛盾的界面。
 */
export function paginate<T>(
  rows: readonly T[],
  page: number,
  pageSize: number = CONVERSATION_PAGE_SIZE
): PagedResult<T> {
  const totalRows = rows.length
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const safePage = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages)
  const start = (safePage - 1) * pageSize
  return { rows: rows.slice(start, start + pageSize), page: safePage, totalPages, totalRows }
}

/**
 * 页码按钮的显示窗口
 *
 * 页数少时全列；页数多时首尾固定、中间用 null 表示省略号。
 * 例：page=5, total=13 → [1, null, 4, 5, 6, null, 13]
 */
export function pageWindow(page: number, totalPages: number): Array<number | null> {
  const total = Math.max(1, totalPages)
  const current = Math.min(Math.max(1, page), total)
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages = new Set<number>([1, total, current - 1, current, current + 1])
  // 只有两页之差时补上邻居，避免出现 `1 … 4 5` 这种看起来缺一块的窗口
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p))
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p))

  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: Array<number | null> = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(null)
    out.push(sorted[i])
  }
  return out
}
