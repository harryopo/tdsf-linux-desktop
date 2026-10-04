/**
 * 流式同步纯函数测试（阶段 C）
 *
 * 覆盖三块：会话闸门、增量合并、列表写入。
 * 全部用假时钟，不依赖定时器真实走表。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  acceptsStream,
  createDeltaCoalescer,
  DEFAULT_COALESCE_WINDOW_MS,
  indexOfId,
  lastIndexWhere,
  replaceAt,
  type CoalescerTimers,
} from '../../src/renderer/src/lib/messageSync'

/** 可手动推进的假时钟 */
function fakeTimers() {
  const queue: Array<{ at: number; cb: () => void; id: number }> = []
  let now = 0
  let nextId = 1
  const timers: CoalescerTimers = {
    schedule: (cb, ms) => {
      const id = nextId++
      queue.push({ at: now + ms, cb, id })
      return id
    },
    cancel: (handle) => {
      const i = queue.findIndex((e) => e.id === handle)
      if (i >= 0) queue.splice(i, 1)
    },
  }
  const advance = (ms: number) => {
    now += ms
    const due = queue.filter((e) => e.at <= now)
    for (const e of due) {
      const i = queue.indexOf(e)
      if (i >= 0) queue.splice(i, 1)
      e.cb()
    }
  }
  return { timers, advance, pendingJobs: () => queue.length }
}

describe('acceptsStream — 会话归属判定', () => {
  it('没有流在跑时谁都不认', () => {
    expect(acceptsStream(null, 'c-1')).toBe(false)
    expect(acceptsStream(null)).toBe(false)
  })

  it('只认当前这一条', () => {
    expect(acceptsStream('c-1', 'c-1')).toBe(true)
    expect(acceptsStream('c-1', 'c-2')).toBe(false)
  })

  it('切会话后旧会话的在途事件作废', () => {
    const active = 'c-2' // 新流开始，currentCorrelationId 被换掉
    expect(acceptsStream(active, 'c-1')).toBe(false)
    expect(acceptsStream(active, 'c-2')).toBe(true)
  })

  it('不带 correlationId 的旧数据放行（兼容），空串不放行', () => {
    expect(acceptsStream('c-1', undefined)).toBe(true)
    expect(acceptsStream('c-1', null)).toBe(true)
    expect(acceptsStream('c-1', '')).toBe(false)
  })
})

describe('createDeltaCoalescer — 增量合并', () => {
  it('同 key 多次 push 合并成一次吐出', () => {
    const sink = vi.fn()
    const { timers, advance } = fakeTimers()
    const c = createDeltaCoalescer(sink, { timers })
    c.push('text:c-1', '你好')
    c.push('text:c-1', '，世界')
    advance(DEFAULT_COALESCE_WINDOW_MS)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][0]).toEqual([['text:c-1', '你好，世界']])
  })

  it('正文与思考链分开累积，互不污染', () => {
    const sink = vi.fn()
    const { timers, advance } = fakeTimers()
    const c = createDeltaCoalescer(sink, { timers })
    c.push('text:c-1', 'A')
    c.push('reasoning:c-1', 'R')
    advance(DEFAULT_COALESCE_WINDOW_MS)
    expect(sink.mock.calls[0][0]).toEqual([
      ['text:c-1', 'A'],
      ['reasoning:c-1', 'R'],
    ])
  })

  it('窗口内多次 push 只排一个定时器', () => {
    const { timers, advance, pendingJobs } = fakeTimers()
    const c = createDeltaCoalescer(() => {}, { timers })
    c.push('k', '1')
    c.push('k', '2')
    c.push('k', '3')
    expect(pendingJobs()).toBe(1)
    advance(DEFAULT_COALESCE_WINDOW_MS)
    expect(pendingJobs()).toBe(0)
  })

  it('flush 立即吐出并取消定时器（done/error 前必须先落尾部）', () => {
    const sink = vi.fn()
    const { timers, pendingJobs } = fakeTimers()
    const c = createDeltaCoalescer(sink, { timers })
    c.push('k', 'tail')
    c.flush()
    expect(sink).toHaveBeenCalledTimes(1)
    expect(pendingJobs()).toBe(0)
    expect(c.pending()).toBe(false)
  })

  it('flush 幂等：空缓冲时不调用 sink', () => {
    const sink = vi.fn()
    const { timers } = fakeTimers()
    const c = createDeltaCoalescer(sink, { timers })
    c.flush()
    c.flush()
    expect(sink).not.toHaveBeenCalled()
  })

  it('空增量不进缓冲', () => {
    const sink = vi.fn()
    const { timers, advance } = fakeTimers()
    const c = createDeltaCoalescer(sink, { timers })
    c.push('k', '')
    advance(DEFAULT_COALESCE_WINDOW_MS)
    expect(sink).not.toHaveBeenCalled()
  })
})

describe('列表写入原语', () => {
  type Msg = { id: string; text: string }
  const list: Msg[] = [{ id: 'a', text: '1' }, { id: 'b', text: '2' }, { id: 'c', text: '3' }]

  it('replaceAt 只换目标项，其余保持同一引用', () => {
    const next = replaceAt(list, 1, { id: 'b', text: 'x' })
    expect(next).not.toBeNull()
    expect(next![1]).toEqual({ id: 'b', text: 'x' })
    expect(next![0]).toBe(list[0])
    expect(next![2]).toBe(list[2])
    expect(list[1]).toEqual({ id: 'b', text: '2' }) // 原数组不被改
  })

  it('下标越界返回 null 让调用方回退', () => {
    expect(replaceAt(list, -1, list[0])).toBeNull()
    expect(replaceAt(list, 99, list[0])).toBeNull()
  })

  it('内容没变返回 null，省掉一次 setState', () => {
    expect(replaceAt(list, 0, list[0])).toBeNull()
  })

  it('lastIndexWhere 从尾巴找，找不到给 -1', () => {
    expect(lastIndexWhere(list, (m) => m.id === 'a')).toBe(0)
    expect(lastIndexWhere(list, (m) => m.id === 'zzz')).toBe(-1)
  })

  it('indexOfId 找不到给 -1', () => {
    expect(indexOfId(list, 'c')).toBe(2)
    expect(indexOfId(list, 'nope')).toBe(-1)
  })
})
