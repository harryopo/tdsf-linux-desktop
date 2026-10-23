// @vitest-environment jsdom
/**
 * 知识库页的搜索必须走真检索（#184）
 *
 * 现场：搜索框只过滤「已加载的前 100 条」，库里更多条目永远搜不到；
 * `kb:search` 通道一直在做真实检索（关键词 + 相似度）却没人调。
 *
 * 判据钉三件：
 *   1. 有查询词时调用 `kbSearch`（而不是本地过滤）；
 *   2. 连打几个字只发一次请求（防抖）；
 *   3. 慢请求晚回来不覆盖新查询（按请求序号作废）；
 *   4. 空查询不检索。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useKnowledgeSearch } from '../../../src/renderer/src/hooks/useKnowledgeSearch'
import type { KnowledgeEntry } from '../../../src/shared/models'

function entry(id: string): KnowledgeEntry {
  return {
    id,
    type: 'incident_case',
    title: `标题 ${id}`,
    problem: '问题',
    commands: [],
    keywords: [],
    tags: [],
    successRate: 0,
    useCount: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

let root: Root | null = null
let container: HTMLDivElement

function Harness({ query, limit }: { query: string; limit?: number }) {
  const state = useKnowledgeSearch(query, { debounceMs: 10, limit })
  return createElement('div', {
    'data-testid': 'state',
    'data-ids': state.results?.map((r) => r.id).join(',') ?? 'null',
    'data-searching': String(state.searching),
    'data-error': state.error ?? '',
  })
}

function mount(query: string, limit?: number) {
  act(() => {
    root!.render(createElement(Harness, { query, limit }))
  })
  return container.querySelector('[data-testid="state"]') as HTMLElement
}

async function flush(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('useKnowledgeSearch', () => {
  it('有查询词时走 kbSearch，并把结果交回界面', async () => {
    const kbSearch = vi.fn<(q: string, t?: undefined, l?: number) => Promise<KnowledgeEntry[]>>(async () => [entry('a'), entry('b')])
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { kbSearch }

    const el = mount('磁盘')
    await flush()

    expect(kbSearch).toHaveBeenCalledTimes(1)
    expect(kbSearch.mock.calls[0][0]).toBe('磁盘')
    expect(kbSearch.mock.calls[0][2]).toBe(50)
    expect(el.getAttribute('data-ids')).toBe('a,b')
  })

  it('连打几个字只发一次（防抖）', async () => {
    const kbSearch = vi.fn<(q: string, t?: undefined, l?: number) => Promise<KnowledgeEntry[]>>(async () => [entry('a')])
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { kbSearch }

    act(() => root!.render(createElement(Harness, { query: '磁' })))
    act(() => root!.render(createElement(Harness, { query: '磁盘' })))
    act(() => root!.render(createElement(Harness, { query: '磁盘满' })))
    await flush()

    expect(kbSearch).toHaveBeenCalledTimes(1)
    expect(kbSearch.mock.calls[0][0]).toBe('磁盘满')
  })

  it('慢请求晚回来不覆盖新查询', async () => {
    let resolveFirst: ((v: KnowledgeEntry[]) => void) | null = null
    const kbSearch = vi
      .fn<(q: string, t?: undefined, l?: number) => Promise<KnowledgeEntry[]>>()
      .mockImplementationOnce(
        () => new Promise<KnowledgeEntry[]>((resolve) => { resolveFirst = resolve })
      )
      .mockImplementationOnce(async () => [entry('new')])
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { kbSearch }

    act(() => root!.render(createElement(Harness, { query: '旧查询' })))
    await flush()
    act(() => root!.render(createElement(Harness, { query: '新查询' })))
    await flush()
    // 旧的这时才回来
    await act(async () => {
      resolveFirst?.([entry('old')])
      await Promise.resolve()
    })

    const el = container.querySelector('[data-testid="state"]') as HTMLElement
    expect(el.getAttribute('data-ids')).toBe('new')
  })

  it('空查询不检索', async () => {
    const kbSearch = vi.fn<(q: string, t?: undefined, l?: number) => Promise<KnowledgeEntry[]>>(async () => [entry('a')])
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { kbSearch }

    const el = mount('   ')
    await flush()
    expect(kbSearch).not.toHaveBeenCalled()
    expect(el.getAttribute('data-ids')).toBe('null')
  })

  it('IPC 失败时把原因交回界面，不假装搜到了空结果', async () => {
    const kbSearch = vi.fn<(q: string, t?: undefined, l?: number) => Promise<KnowledgeEntry[]>>(async () => {
      throw new Error('数据库不可用')
    })
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { kbSearch }

    const el = mount('磁盘')
    await flush()
    expect(el.getAttribute('data-ids')).toBe('')
    expect(el.getAttribute('data-error')).toContain('数据库不可用')
  })
})
