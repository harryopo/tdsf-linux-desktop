// @vitest-environment jsdom
/**
 * 知识详情页的删除入口（#203）
 *
 * 这条键以前全仓零调用：用户能贡献、能改，唯独删不掉自己写错的那条。
 * 而仓储那一版 `delete()` 把"删掉了 / 本来就不在 / 数据库出错"压成一个 `false`，
 * 所以接之前先改了返回形状——这里钉的就是**界面拿到三种结果要说三种话**，
 * 尤其不许把出错说成"已删除"或"已经不在了"。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ConfirmHost } from '../../../src/renderer/src/ui/confirm'
import type { KnowledgeDeleteResult } from '../../../src/shared/models'

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(() => 'id'),
  dismiss: vi.fn(),
}

const ENTRY = {
  id: 'kb-1',
  type: 'incident_case',
  title: '磁盘满了怎么办',
  problem: '根分区被打满',
  commands: ['df -h'],
  keywords: ['磁盘'],
  tags: ['storage'],
  successRate: 0,
  useCount: 1,
  createdAt: 1,
  updatedAt: 1,
}

const api = {
  kbGet: vi.fn(async () => ENTRY),
  kbView: vi.fn(async () => undefined),
  kbUpdate: vi.fn(async () => true),
  kbDelete: vi.fn(async (): Promise<KnowledgeDeleteResult> => ({ kind: 'deleted' })),
}

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: (...a: unknown[]) => toast.success(...a),
    error: (...a: unknown[]) => toast.error(...a),
    info: (...a: unknown[]) => toast.info(...a),
    warning: (...a: unknown[]) => toast.warning(...a),
    loading: () => toast.loading(),
    dismiss: () => toast.dismiss(),
  }),
}))

async function mount() {
  const { KnowledgeDetailPage } = await import('../../../src/renderer/src/pages/KnowledgeDetailPage')
  return render(
    <>
      <ConfirmHost />
      <MemoryRouter initialEntries={['/knowledge/kb-1']}>
        <Routes>
          <Route path="/knowledge/:id" element={<KnowledgeDetailPage />} />
          <Route path="/knowledge" element={<p>列表页</p>} />
        </Routes>
      </MemoryRouter>
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.kbGet.mockResolvedValue(ENTRY)
  api.kbDelete.mockResolvedValue({ kind: 'deleted' })
  ;(window as unknown as { electronAPI: unknown }).electronAPI = api
})

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('[knowledge-delete-ui] 三种结果说三种话', () => {
  it('确认删除 ⇒ 真调 kbDelete、说"已删除"、并退回列表', async () => {
    const user = userEvent.setup()
    await mount()

    await user.click(await screen.findByRole('button', { name: '删除这条知识' }))
    await user.click(await screen.findByRole('button', { name: '删除' }))

    await waitFor(() => expect(api.kbDelete).toHaveBeenCalledWith('kb-1'))
    expect(toast.success).toHaveBeenCalledWith('已删除')
    expect(await screen.findByText('列表页')).toBeInTheDocument()
  })

  it('确认框里点"先不删" ⇒ 一下都不许删', async () => {
    const user = userEvent.setup()
    await mount()

    await user.click(await screen.findByRole('button', { name: '删除这条知识' }))
    await user.click(await screen.findByRole('button', { name: '先不删' }))

    expect(api.kbDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '删除这条知识' })).toBeInTheDocument()
  })

  it('主进程说 not-found ⇒ 报"这条已经不在了"，不许报"已删除"', async () => {
    const user = userEvent.setup()
    api.kbDelete.mockResolvedValue({ kind: 'not-found' })
    await mount()

    await user.click(await screen.findByRole('button', { name: '删除这条知识' }))
    await user.click(await screen.findByRole('button', { name: '删除' }))

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('这条已经不在了'))
    expect(toast.success, '没删成就不许说"已删除"').not.toHaveBeenCalled()
  })

  it('主进程说 error ⇒ 把原因带出来，不许糊成"已经不在了"', async () => {
    const user = userEvent.setup()
    api.kbDelete.mockResolvedValue({ kind: 'error', message: 'database is locked' })
    await mount()

    await user.click(await screen.findByRole('button', { name: '删除这条知识' }))
    await user.click(await screen.findByRole('button', { name: '删除' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('没删掉：database is locked'))
    expect(toast.info).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '删除这条知识' }), '没删成就不许跳走').toBeInTheDocument()
  })
})
