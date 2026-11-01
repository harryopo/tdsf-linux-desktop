// @vitest-environment jsdom
/**
 * 流式停滞提示（2026-11-01）
 *
 * 只钉三件事：
 *   1. 12 秒没有任何流式活动才出现（早了是噪音，晚了用户已经干瞪眼）；
 *   2. 秒数会自己走（不是写死"12 秒"）；
 *   3. 有新活动/流结束立刻消失（提示不能赖着不走）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { StreamStallHint, STALL_HINT_AFTER_MS } from '@/components/workbench/StreamStallHint'
import { useAgentStore } from '@/stores/agent-store'

function seed(isStreaming: boolean, idleMs: number | null): void {
  useAgentStore.setState({
    isStreaming,
    lastStreamActivityAt: idleMs === null ? null : Date.now() - idleMs,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-01T09:00:00'))
  seed(false, null)
})

describe('StreamStallHint', () => {
  it('没在流 / 刚有活动时不出现；到 12 秒才说话，且秒数自己走', () => {
    const { rerender } = render(<StreamStallHint />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    seed(true, 2_000)
    rerender(<StreamStallHint />)
    expect(screen.queryByRole('status'), '2 秒就提示是噪音').not.toBeInTheDocument()

    seed(true, STALL_HINT_AFTER_MS + 1_000)
    rerender(<StreamStallHint />)
    expect(screen.getByRole('status')).toHaveTextContent('13 秒')

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByRole('status')).toHaveTextContent('14 秒')
  })

  it('来了新活动（token / 工具事件）立刻收起', () => {
    seed(true, 30_000)
    const { rerender } = render(<StreamStallHint />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    seed(true, 0)
    rerender(<StreamStallHint />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('流结束后不残留（isStreaming=false 时一律不显示）', () => {
    seed(true, 30_000)
    const { rerender } = render(<StreamStallHint />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    seed(false, 30_000)
    rerender(<StreamStallHint />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
