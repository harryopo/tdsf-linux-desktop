/**
 * ContextBadge 在"窗口未知"时的表现（#89）
 *
 * 这块界面是用户判断"要不要现在压缩上下文"的依据，所以最坏的情况不是数字难看，
 * 而是没数据时演出一个 0%。Composer 交下来的 pct 允许为 null，
 * 徽章必须老实说"未知"，同时把已用量照常显示出来。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ContextBadge from '@renderer/components/workbench/ContextBadge'

describe('ContextBadge', () => {
  it('窗口已知：显示真实百分比与窗口大小', () => {
    render(<ContextBadge ctxUsedPct={42} ctxUsedTokens="84K" ctxTotalTokens="200K" />)
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('窗口未知：显示"未知"，且不出现任何百分比数字', () => {
    render(<ContextBadge ctxUsedPct={null} ctxUsedTokens="12K" ctxTotalTokens="未知" />)
    expect(screen.getByText('未知')).toBeInTheDocument()
    expect(screen.queryByText(/\d+%/), '把"不知道"演成 0% 会误导用户继续灌水').toBeNull()
  })

  it('用量为 0 且窗口已知：这是真的空，可以显示 0%', () => {
    render(<ContextBadge ctxUsedPct={0} ctxUsedTokens="0" ctxTotalTokens="8K" />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})
