/**
 * tests/components/pages/no-fake-data-fallback.test.ts — 阶段 F4 判据的回归锁
 *
 * 计划里 F4 的要求是"删掉 HistoryPage 非 Electron 兜底与 KnowledgeDetailPage 示例数据"，
 * 判据是"假数据兜底 grep 命中 0"。光靠 grep 挡不住下一次有人顺手加回一行假记录，
 * 所以这里用渲染结果锁住行为：拿不到真实数据时必须是诚实空态，不许出现示例条目。
 *
 * 不 mock electronAPI：jsdom 下 window.electronAPI 天然 undefined，
 * 正好就是"非 Electron / 没有本地库"这条要验的路径。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type {} from '@testing-library/jest-dom'

import { HistoryPage } from '@renderer/pages/HistoryPage'
import { KnowledgeDetailPage } from '@renderer/pages/KnowledgeDetailPage'

/** 设计稿时代那批假数据的特征字：出现任何一个都说明兜底又长回来了 */
const FAKE_MARKERS = [
  'prod-web-01',
  'web-02',
  'KB-NGINX-014',
  '诊断步骤',
  '示例数据条目',
]

describe('阶段 F4：拿不到真实数据时不得回退到示例数据', () => {
  it('历史页（无本地决策库）显示诚实空态，且不渲染任何示例记录', () => {
    render(
      <MemoryRouter initialEntries={['/history']}>
        <HistoryPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('浏览器预览环境读不到本机决策库')).toBeInTheDocument()
    for (const marker of FAKE_MARKERS) {
      expect(screen.queryByText(new RegExp(marker))).not.toBeInTheDocument()
    }
  })

  it('知识详情页（条目取不到）显示不存在空态，而不是假文章', async () => {
    render(
      <MemoryRouter initialEntries={['/knowledge/nope']}>
        <Routes>
          <Route path="/knowledge/:id" element={<KnowledgeDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/知识条目不存在或已删除/)).toBeInTheDocument()
    for (const marker of FAKE_MARKERS) {
      expect(screen.queryByText(new RegExp(marker))).not.toBeInTheDocument()
    }
  })
})
