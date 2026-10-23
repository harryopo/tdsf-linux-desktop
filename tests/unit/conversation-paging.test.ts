/**
 * 对话记录过滤与分页（#182）
 *
 * 判据针对的是两个曾经真实存在的假象：
 *   1. 搜索框输入不生效（控件没接 state）；
 *   2. 页码写死 13 页、列表不按页切片（翻到第 13 页还是同一页）。
 */
import { describe, it, expect } from 'vitest'
import {
  CONVERSATION_PAGE_SIZE,
  filterConversations,
  paginate,
  pageWindow,
} from '../../src/renderer/src/components/settings/model/conversation-paging'
import type { ConversationRow } from '../../src/renderer/src/components/settings/model/constants'

function row(over: Partial<ConversationRow>): ConversationRow {
  return {
    time: '10-24 10:00',
    input: '磁盘满了怎么办',
    model: 'deepseek-chat',
    modelTagType: 'brand',
    inputTokens: '100',
    outputTokens: '200',
    status: '成功',
    statusType: 'success',
    ...over,
  }
}

const ROWS: ConversationRow[] = [
  row({ time: '10-24 10:00', input: '磁盘满了怎么办' }),
  row({ time: '10-24 10:05', input: 'nginx 502 排查', model: 'gpt-4o-mini', modelTagType: 'neutral' }),
  row({ time: '10-23 22:10', input: 'ssh 连不上', status: '失败', statusType: 'danger' }),
  row({ time: '10-23 21:00', input: '误删文件恢复', status: '已拦截', statusType: 'warning' }),
]

describe('过滤', () => {
  it('搜索词命中用户输入（不区分大小写）', () => {
    expect(filterConversations(ROWS, '全部状态', 'NGINX').map((r) => r.input)).toEqual([
      'nginx 502 排查',
    ])
  })

  it('搜索词也能命中模型名与时间', () => {
    expect(filterConversations(ROWS, '全部状态', 'gpt-4o').map((r) => r.input)).toEqual([
      'nginx 502 排查',
    ])
    expect(filterConversations(ROWS, '全部状态', '10-23').length).toBe(2)
  })

  it('空白搜索词等于不过滤（首尾空格也一样）', () => {
    expect(filterConversations(ROWS, '全部状态', '   ').length).toBe(ROWS.length)
  })

  it('状态筛选与搜索词同时生效', () => {
    expect(filterConversations(ROWS, '失败', 'ssh').map((r) => r.input)).toEqual(['ssh 连不上'])
    expect(filterConversations(ROWS, '失败', '磁盘')).toEqual([])
  })
})

describe('分页', () => {
  const many = Array.from({ length: 20 }, (_, i) => row({ input: `第 ${i + 1} 条` }))

  it('按页切片，不是每次都回整页数据', () => {
    const page2 = paginate(many, 2)
    expect(page2.rows).toHaveLength(CONVERSATION_PAGE_SIZE)
    expect(page2.rows[0].input).toBe(`第 ${CONVERSATION_PAGE_SIZE + 1} 条`)
    expect(page2.totalPages).toBe(Math.ceil(20 / CONVERSATION_PAGE_SIZE))
  })

  it('最后一页只给剩下的几条', () => {
    const last = paginate(many, 3)
    expect(last.rows.length).toBe(20 - CONVERSATION_PAGE_SIZE * 2)
  })

  it('页码越界被拉回有效区间（不会出现"第 13 页却是空表"）', () => {
    expect(paginate(many, 99).page).toBe(3)
    expect(paginate(many, 0).page).toBe(1)
    expect(paginate(many, -5).page).toBe(1)
    expect(paginate(many, Number.NaN).page).toBe(1)
  })

  it('空列表也有一页，避免除零/空白页', () => {
    expect(paginate([], 1)).toMatchObject({ rows: [], page: 1, totalPages: 1, totalRows: 0 })
  })
})

describe('页码窗口', () => {
  it('页数少时全列', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
    expect(pageWindow(2, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('页数多时首尾固定、中间省略，且包含当前页', () => {
    expect(pageWindow(5, 13)).toEqual([1, null, 4, 5, 6, null, 13])
    expect(pageWindow(1, 13)).toEqual([1, 2, 3, 4, null, 13])
    // 末页附近多带几个邻居，方便往回翻，而不是只剩 1 … 12 13
    expect(pageWindow(13, 13)).toEqual([1, null, 10, 11, 12, 13])
  })

  it('越界页码按收敛后的位置算窗口', () => {
    expect(pageWindow(99, 13)).toEqual(pageWindow(13, 13))
  })
})
