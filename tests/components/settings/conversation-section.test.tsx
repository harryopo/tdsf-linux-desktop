// @vitest-environment jsdom
/**
 * 对话记录：输入框与页码必须是真的（#182）
 *
 * 现场：搜索框没有 value/onChange（打字对表格零影响），页码写死 `[1,2,3] … 13`，
 * 而列表从不按页切片——用户翻到第 13 页看到的还是同一整页。
 * 纯函数已由 conversation-paging.test.ts 覆盖，这里只钉两件"控件接没接上"的事：
 *   1. 打字会回调 onQueryChange（受控），不是自娱自乐的空输入框；
 *   2. 页码按钮来自 totalPages，不再出现凭空写死的第 13 页。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConversationSection } from '../../../src/renderer/src/components/settings/model/ConversationSection'
import type { ConversationRow } from '../../../src/renderer/src/components/settings/model/constants'

vi.mock('../../../src/renderer/src/components/settings/SettingsCard', () => ({
  SettingsCard: ({ children }: { children?: ReactNode }) => createElement('section', null, children),
}))

function row(over: Partial<ConversationRow> = {}): ConversationRow {
  return {
    time: '10-24 10:00',
    input: '磁盘满了怎么办',
    model: 'deepseek-chat',
    modelTagType: 'brand',
    inputTokens: '1',
    outputTokens: '2',
    status: '成功',
    statusType: 'success',
    ...over,
  }
}

function mount(props: Partial<Parameters<typeof ConversationSection>[0]> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onQueryChange = vi.fn()
  act(() => {
    root.render(
      createElement(ConversationSection, {
        statusFilter: '全部状态',
        onCycleStatusFilter: () => undefined,
        query: '',
        onQueryChange,
        rows: [row()],
        totalRows: 1,
        currentPage: 1,
        totalPages: 1,
        onCurrentPageChange: () => undefined,
        isLoading: false,
        ...props,
      })
    )
  })
  return { container, root, onQueryChange }
}

let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ''
})

beforeEach(() => {
  root = null
})

describe('对话记录工具栏', () => {
  it('搜索框是受控的：打字会回调 onQueryChange', () => {
    const { container, onQueryChange } = mount()
    const input = container.querySelector('input[aria-label="搜索对话"]') as HTMLInputElement
    expect(input).not.toBeNull()
    // React 接管了 input.value 的 setter，直接赋值不会触发 onChange；
    // 用原型上的原生 setter 写入，再冒泡一次 input 事件，才是真的"用户打字"
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set
    act(() => {
      nativeSetter?.call(input, 'nginx')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onQueryChange).toHaveBeenCalledWith('nginx')
  })

  it('页码按钮跟着总页数走，不出现写死的第 13 页', () => {
    const { container } = mount({ totalPages: 3, currentPage: 1, totalRows: 20 })
    const labels = Array.from(container.querySelectorAll('.set-conv-page-btn')).map(
      (el) => el.getAttribute('aria-label') ?? el.textContent
    )
    expect(labels).toContain('第 1 页')
    expect(labels).toContain('第 3 页')
    expect(labels).not.toContain('第 13 页')
  })

  it('最后一页时"下一页"是禁用的', () => {
    const { container } = mount({ totalPages: 2, currentPage: 2 })
    const next = container.querySelector('button[aria-label="下一页"]') as HTMLButtonElement
    expect(next.disabled).toBe(true)
  })

  it('过滤后为空时，空态说清是被什么条件过滤掉的', () => {
    const { container } = mount({ rows: [], totalRows: 0, query: '  nginx  ' })
    expect(container.querySelector('.set-conv-empty')?.textContent).toContain('搜索词「nginx」')
  })
})
