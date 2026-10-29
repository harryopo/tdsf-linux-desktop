// @vitest-environment jsdom
/**
 * 知识详情页与侧栏只报"真有生产者的数"（#268 的后续判决）
 *
 * 反馈票（有帮助/没帮助）整块删除后，`knowledge_entries.successRate` 再没有任何写入方：
 * 种子条目是出厂常量（0.9 / 0.95），手填条目是 0。以前界面有三处把它演成实测样子——
 * 页头「已验证」徽章（只看 successRate≥80）、元信息「匹配 X%」、侧栏「知识置信度」环
 * （环下那行小字还写着"按案例结果与读者答复逐次累积"，而答复已经不存在了）。
 * 三处一起撤，这里拿渲染结果钉住：常量再高也不许变成读数；真有生产者的阅读次数照常显示。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/** 出厂常量拉满的一条种子条目：任何 successRate 派生的读数都会在这里现形 */
const ENTRY = {
  id: 'kb-1',
  type: 'incident_case',
  title: '磁盘满了怎么办',
  problem: '根分区被打满',
  rootCause: '日志未轮转',
  commands: ['df -h'],
  rollbackCommands: [],
  verification: 'df -h 使用率回落',
  keywords: ['磁盘'],
  tags: ['storage'],
  successRate: 0.95,
  // useCount>0 是 kb:view 真自增出来的，这一格必须还在
  useCount: 7,
  createdAt: 1,
  updatedAt: 1,
}

const api = {
  kbGet: vi.fn(async () => ENTRY),
  kbView: vi.fn(async () => undefined),
  kbUpdate: vi.fn(async () => true),
  kbDelete: vi.fn(async () => ({ kind: 'deleted' })),
}

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: () => 'id',
    dismiss: vi.fn(),
  }),
}))

async function mount() {
  const { KnowledgeDetailPage } = await import('../../../src/renderer/src/pages/KnowledgeDetailPage')
  return render(
    <MemoryRouter initialEntries={['/knowledge/kb-1']}>
      <Routes>
        <Route path="/knowledge/:id" element={<KnowledgeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.kbGet.mockResolvedValue(ENTRY)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = api
})

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('[knowledge-detail-readouts] 没有生产者的数不许上界面', () => {
  it('successRate=0.95 也画不出置信度环、匹配百分比与已验证徽章', async () => {
    await mount()
    // 正文先渲染出来，确认真的拿到了这条条目（而不是停在加载态把断言全"混过去"）
    expect(await screen.findByRole('heading', { name: '磁盘满了怎么办' })).toBeInTheDocument()

    expect(screen.queryByText('知识置信度')).not.toBeInTheDocument()
    expect(screen.queryByText('综合置信度评分')).not.toBeInTheDocument()
    expect(screen.queryByText(/匹配\s*95%/)).not.toBeInTheDocument()
    expect(screen.queryByText('已验证')).not.toBeInTheDocument()
    expect(screen.queryByText(/成功率/)).not.toBeInTheDocument()
  })

  it('正向对照：kb:view 真自增的阅读次数照常上界面', async () => {
    await mount()
    expect(await screen.findByRole('heading', { name: '磁盘满了怎么办' })).toBeInTheDocument()

    // 侧栏元信息里那一行"使用次数"来自 useCount，是真实读数，不能被上一条一起扫掉
    expect(screen.getByText('元信息')).toBeInTheDocument()
    expect(screen.getByText('7 次')).toBeInTheDocument()
    // 页头那行是「<strong>7</strong> 次阅读」，数字与文字分属两个节点，按整页文本验
    expect(document.body.textContent).toContain('次阅读')
  })
})
