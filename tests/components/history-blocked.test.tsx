// @vitest-environment jsdom
/**
 * 历史页「被拦截的高危命令」区（2026-10-21 全维度审查 F1/E3）
 *
 * 拦截留痕写了 audit_logs，但此前没有任何界面消费者：产品最强的一次「救下」
 * 在界面上完全不可见。这里用假 IPC 喂一条拦截记录，断言它真的被渲染出来。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { HistoryPage } from '@renderer/pages/HistoryPage'

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      historyList: async () => [],
      historyStats: async () => ({
        total: 0,
        successRate: 0,
        avgConfidence: 0,
        avgDurationSec: 0,
        servers: [],
      }),
      historyBlocks: async () => [
        {
          id: 'blk-1',
          timestamp: Date.now(),
          source: '终端输入',
          command: 'rm -rf /',
          reason: '递归强制删除根级/系统目录',
          matched: 'rm -rf /',
          riskLevel: 'block',
        },
      ],
    },
  })
})

describe('HistoryPage 拦截记录区', () => {
  it('渲染拦截来源、命令与原因', async () => {
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    )
    expect(await screen.findByText('被拦截的高危命令')).toBeTruthy()
    expect(await screen.findByText('rm -rf /')).toBeTruthy()
    expect(screen.getByText(/递归强制删除/)).toBeTruthy()
    expect(screen.getByText('终端输入')).toBeTruthy()
  })
})
