// @vitest-environment jsdom
/**
 * AI 记忆页（#189）：用户终于能看到并删掉 AI 记住的东西
 *
 * 记忆一直只在后端跑（supervisor 自动沉淀 + memory_recall 工具），
 * IPC 四件早在、渲染层零调用——"AI 记住了你什么"在界面上是查不到的。
 *
 * 判据：列表来自 memory:list、检索走 memory:search（不是前端过滤）、
 * 删除走 memory:delete 且删完从列表消失、审计来自 memory:audit。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const confirmMock = vi.fn(async () => true)
vi.mock('../../../src/renderer/src/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/renderer/src/ui')>()
  return { ...actual, confirmDialog: confirmMock }
})
vi.mock('../../../src/renderer/src/utils/electron-api', () => ({
  isElectronAPIAvailable: () => true,
}))

const MEMORY = {
  id: 'm-1',
  type: 'preference',
  key: 'prefers-systemd',
  text: '用户偏好用 systemctl 而不是 service 命令',
  why: '多次纠正过',
  useCount: 3,
  updatedAt: 1_700_000_000_000,
}

const api = {
  memoryList: vi.fn(async () => [MEMORY]),
  memorySearch: vi.fn(async () => [{ ...MEMORY, id: 'm-2', key: 'hit-by-search', text: '检索命中的记忆' }]),
  memoryDelete: vi.fn(async () => true),
  memoryAudit: vi.fn(async () => [{ ts: 1_700_000_000_000, trigger: 'extract', op: 'upsert', detail: 'prefers-systemd' }]),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = api
})

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

async function mount() {
  const { MemorySettings } = await import('../../../src/renderer/src/pages/MemorySettings')
  render(<MemorySettings />)
}

describe('AI 记忆页', () => {
  it('列出记忆与沉淀审计（都来自真 IPC）', async () => {
    await mount()
    expect(await screen.findByText(/用户偏好用 systemctl/)).toBeInTheDocument()
    expect(screen.getByText(/为什么记：多次纠正过/)).toBeInTheDocument()
    // 同一个 key 会同时出现在记忆条目与审计明细里，这里只要求"至少出现"
    expect(screen.getAllByText(/prefers-systemd/).length).toBeGreaterThanOrEqual(1)
    expect(api.memoryList).toHaveBeenCalledTimes(1)
    expect(api.memoryAudit).toHaveBeenCalledWith(20)
  })

  it('检索走 memory:search，结果替换列表', async () => {
    const user = userEvent.setup()
    await mount()
    await screen.findByText(/用户偏好用 systemctl/)

    const input = screen.getByRole('searchbox', { name: '检索记忆' })
    await user.type(input, '磁盘')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.memorySearch).toHaveBeenCalledWith('磁盘', 50))
    expect(await screen.findByText('检索命中的记忆')).toBeInTheDocument()
  })

  it('删除要确认，删完从列表消失', async () => {
    const user = userEvent.setup()
    await mount()
    await screen.findByText(/用户偏好用 systemctl/)

    await user.click(screen.getByRole('button', { name: /删除记忆 prefers-systemd/ }))

    await waitFor(() => expect(api.memoryDelete).toHaveBeenCalledWith('m-1'))
    await waitFor(() =>
      expect(screen.queryByText(/用户偏好用 systemctl/)).not.toBeInTheDocument()
    )
  })

  it('确认框点取消就不删', async () => {
    confirmMock.mockResolvedValueOnce(false)
    const user = userEvent.setup()
    await mount()
    await screen.findByText(/用户偏好用 systemctl/)

    await user.click(screen.getByRole('button', { name: /删除记忆 prefers-systemd/ }))
    expect(api.memoryDelete).not.toHaveBeenCalled()
  })
})
