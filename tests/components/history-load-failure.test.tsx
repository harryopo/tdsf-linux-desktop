// @vitest-environment jsdom
/**
 * 历史页读取失败态（2026-10-21 发布前收口）
 *
 * 病根：historyList 的 catch 里只 setRecords([])，界面于是把「库读不出来」
 * 演成「还没有决策记录」——用户会以为自己的审计记录消失了，也没有重试入口。
 * 判据两半：失败必须报原因且不冒充空记录；点重试要真的重新拉取并把记录画出来。
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { DecisionCard } from '@shared/models'
import { HistoryPage } from '@renderer/pages/HistoryPage'

const OK_CARD: DecisionCard = {
  id: 'dec-1',
  problem: '磁盘已满',
  hypothesis: '日志占满根分区',
  evidences: [],
  confidence: 0.9,
  risk: {
    level: 'LOW',
    score: 10,
    matchedRules: [],
    description: '只读命令',
    requireConfirmation: false,
    blocked: false,
  },
  fixCommand: 'df -h',
  fixDescription: '查看分区占用',
  status: 'executed',
  timestamp: Date.now(),
}

function installApi(historyList: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      historyList,
      historyStats: async () => null,
      historyBlocks: async () => [],
    },
  })
}

describe('HistoryPage 读取失败态', () => {
  it('失败时报原因并给重试；重试成功后显示真实记录', async () => {
    const historyList = vi
      .fn()
      .mockRejectedValueOnce(new Error('SQLITE_CORRUPT'))
      .mockResolvedValueOnce([OK_CARD])
    installApi(historyList)

    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    )

    expect(await screen.findByText('读取决策历史失败')).toBeTruthy()
    expect(screen.getByText(/SQLITE_CORRUPT/)).toBeTruthy()
    expect(screen.queryByText('还没有决策记录')).toBeNull()

    fireEvent.click(screen.getByLabelText('重新读取决策历史'))

    expect(await screen.findByText('磁盘已满')).toBeTruthy()
    await waitFor(() => expect(historyList).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('读取决策历史失败')).toBeNull()
  })
})
