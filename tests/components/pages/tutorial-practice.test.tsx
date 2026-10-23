// @vitest-environment jsdom
/**
 * 教程详情的"实践/验证"必须是这篇教程自己的内容（#185），且沙箱能收回去（#186）
 *
 * 现场三处假象：
 *   1. 「动手实践」永远展示设计稿里那段 nginx 示例（含 `ab -n 10000 -c 500 http://localhost/`），
 *      没有真实命令时还会**真的去执行这条压测**；
 *   2. 「知识检查」是一份写死的 Nginx 三选题，所有教程共用，且初始值预填了正确答案
 *      （打开页面就显示"（正确）"）；
 *   3. 教程会创建 Docker 沙箱，但界面上没有停止/删除入口，资源只增不减。
 *
 * 判据：真实命令上屏、假题目/假压测不出现、执行用的是教程第一条命令、删得掉。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TutorialEntry } from '../../../src/shared/tutorial-types'

const ENTRY: TutorialEntry = {
  id: 'tut-1',
  title: '磁盘满了怎么办',
  summary: '清理根分区',
  difficulty: 'beginner',
  category: 'storage',
  readingTime: 10,
  source: { name: '内置', url: 'https://example.com/tut-1', crawledAt: 1, license: 'MIT' },
  tags: [],
  keywords: [],
  distros: [],
  commands: ['df -h', 'du -sh /var/log/*'],
  content: '第一段\n\n第二段',
  createdAt: 1,
  updatedAt: 1,
}

const api = {
  tutorialGet: vi.fn(async () => ENTRY),
  tutorialProgress: vi.fn(async () => []),
  tutorialUpdateProgress: vi.fn(async () => ({ ok: true })),
  onSandboxApprovalRequest: vi.fn(() => () => undefined),
  sandboxList: vi.fn(async () => ({ items: [] })),
  sandboxCreate: vi.fn(async () => ({ id: 'sb-1' })),
  sandboxExecute: vi.fn(async () => ({ stdout: 'Filesystem Size Used', stderr: '', exitCode: 0 })),
  sandboxDelete: vi.fn(async () => ({ success: true })),
}

vi.mock('../../../src/renderer/src/utils/electron-api', () => ({
  isElectronAPIAvailable: () => true,
}))
vi.mock('sonner', () => {
  const noop = () => undefined
  const toast = Object.assign(noop, { success: noop, error: noop, info: noop, warning: noop, loading: () => 'id', dismiss: noop })
  return { toast }
})

async function mount() {
  const { TutorialDetailPage } = await import('../../../src/renderer/src/pages/TutorialDetailPage')
  return render(
    <MemoryRouter initialEntries={['/tutorial/tut-1']}>
      <Routes>
        <Route path="/tutorial/:id" element={<TutorialDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = api
})

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('教程实践与验证', () => {
  it('展示教程自己的命令，不出现设计稿的压测命令与假测验', async () => {
    await mount()
    expect(await screen.findByText(/\$ df -h/)).toBeInTheDocument()
    expect(screen.getByText(/\$ du -sh \/var\/log\/\*/)).toBeInTheDocument()
    expect(screen.queryByText(/ab -n 10000/)).not.toBeInTheDocument()
    expect(screen.queryByText('知识检查')).not.toBeInTheDocument()
    expect(screen.queryByText(/（正确）/)).not.toBeInTheDocument()
    expect(screen.getByText('验证清单')).toBeInTheDocument()
  })

  it('沙箱执行的是教程第一条命令，执行完能删掉沙箱', async () => {
    const user = userEvent.setup()
    await mount()

    await user.click(await screen.findByRole('button', { name: '打开沙箱练习' }))
    await waitFor(() => expect(api.sandboxExecute).toHaveBeenCalledTimes(1))
    expect(api.sandboxExecute).toHaveBeenCalledWith('sb-1', 'df -h')

    const del = await screen.findByRole('button', { name: /删除沙箱/ })
    await user.click(del)
    await waitFor(() => expect(api.sandboxDelete).toHaveBeenCalledWith('sb-1'))
  })
})
