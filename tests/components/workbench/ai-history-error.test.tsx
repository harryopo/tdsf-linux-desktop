// @vitest-environment jsdom
/**
 * 回看失败要在界面上说实话（#177）
 *
 * 现场：对话历史落库后，面板开机就拉一次。库里读不出来时（降级、被锁、迁移没跑完），
 * store 记了 historyError，但界面上一个字都没有——消息区照常画那张"你好，我是 TDSF AI 运维助手"
 * 的引导卡。那是把"我读不到"演成"你没聊过"，与 A4 数据库横幅、历史页失败态同一类错，
 * 而这一处更隐蔽：用户重启后正好最需要它。
 *
 * 挂的是真 hook（useAgentChat）+ 真 store，只替掉叶子渲染与无关订阅：
 * 量的是"electronAPI 报错 → 屏上有原因 → 点了真的再读一次 → 读回来就铺进列表"这一整条。
 * 替身只到"每条消息画成一个带 id 的 span"为止。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@renderer/components/workbench/AIPanelHeader', () => ({ default: () => null }))
vi.mock('@renderer/components/workbench/Composer', () => ({ default: () => null }))
vi.mock('@renderer/dock/permission-bar', () => ({ PermissionBar: () => null }))
vi.mock('@renderer/terminal/shell-launcher', () => ({
  resolveShellForCommand: vi.fn(),
  runAuthoredInShell: vi.fn(),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => undefined }))
vi.mock('sonner', () => {
  const noop = () => undefined
  const toast = Object.assign(noop, { success: noop, error: noop, info: noop, warning: noop })
  return { toast }
})
vi.mock('@renderer/components/workbench/useLoopEngineering', () => ({
  useLoopEngineering: () => ({ phase: 'idle', workflowState: null, decisionCard: null, finalCard: null }),
}))
vi.mock('@renderer/components/workbench/usePaorLoop', () => ({
  usePaorLoop: () => ({ plan: null, iterations: [], isRunning: false, error: null, result: null }),
}))
// 消息行只画一个带 id 的 span：这条判的是"回看失败时屏上有没有那句话"，不是行的长相
vi.mock('@renderer/components/workbench/panels/LiveMessageRow', () => ({
  default: ({ message }: { message: { id: string } }) => createElement('span', { 'data-msg': message.id }),
}))

import AIPanel from '@renderer/components/workbench/AIPanel'
import { useAgentStore } from '@renderer/stores/agent-store'
import type { ChatMessageRecord } from '@shared/chat-types'

const FAIL_COPY = '历史对话没读出来'
const chatHistory = vi.fn()

function installApi(): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { chatHistory, chatAppend: vi.fn().mockResolvedValue(true) },
  })
}

function record(overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id: 'm-old',
    role: 'user',
    content: '上次问过磁盘满了怎么办',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

let root: Root | null = null

async function mountPanel(): Promise<void> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(AIPanel))
  })
}

const bodyText = (): string => document.body.textContent ?? ''
const retryButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('重试'))

beforeEach(() => {
  chatHistory.mockReset()
  useAgentStore.getState().clearMessages()
  installApi()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.textContent = ''
})

describe('AI 面板的回看失败态', () => {
  it('开机回看失败：屏上有那句话、带上原因、给一个真能按的重试', async () => {
    chatHistory.mockRejectedValue(new Error('本地数据库不可用，无法读写对话历史'))
    await mountPanel()

    expect(chatHistory, '面板开机根本没试着回看：这条判据在对着空集说话').toHaveBeenCalled()
    expect(bodyText(), '读库失败却一个字都没显示，等于把"读不到"演成"话丢了"').toContain(FAIL_COPY)
    expect(bodyText()).toContain('本地数据库不可用')
    expect(retryButton(), '有失败原因却没有重试入口 = 假 affordance').toBeTruthy()
  })

  it('点重试：真的再读一次；读成功后那句话消失、历史铺进列表', async () => {
    chatHistory.mockRejectedValueOnce(new Error('本地数据库不可用'))
    await mountPanel()
    const before = chatHistory.mock.calls.length

    chatHistory.mockResolvedValue([record({ id: 'm-old' })])
    await act(async () => {
      retryButton()!.click()
    })

    expect(chatHistory.mock.calls.length, '点了重试但没再读一次').toBeGreaterThan(before)
    expect(bodyText()).not.toContain(FAIL_COPY)
    expect(document.querySelector('[data-msg="m-old"]'), '读回来的那条要真铺进列表').toBeTruthy()
  })

  it('正向对照：读得成功时那句话一个字都不出现（不是常驻文案）', async () => {
    chatHistory.mockResolvedValue([record()])
    await mountPanel()
    expect(bodyText()).not.toContain(FAIL_COPY)
    expect(retryButton(), '没有失败就不该挂着一颗重试按钮').toBeUndefined()
    expect(document.querySelector('[data-msg="m-old"]')).toBeTruthy()
  })

  it('切服务器时重新按那一档回看，另一档的对话不许混进来', async () => {
    // 回看按会话取：这一档读回来的只有这一档的。这里用两次调用参数对账，
    // 因为串话的现场就是"屏上出现了另一台服务器的话"，而那是同一段渲染路径。
    chatHistory.mockResolvedValue([record({ id: 'local-1', sshSessionId: null })])
    await mountPanel()
    expect(chatHistory.mock.calls.at(-1)?.[0], '未连接时那一档要按 null 取').toBeNull()

    chatHistory.mockResolvedValue([record({ id: 'sess-1', sshSessionId: 'sess-A' })])
    await act(async () => {
      const { useServerStore } = await import('@renderer/stores/server-store')
      useServerStore.setState({ activeSessionId: 'sess-A' })
    })
    expect(chatHistory.mock.calls.at(-1)?.[0]).toBe('sess-A')
    expect(document.querySelector('[data-msg="local-1"]'), '换档后上一档的对话还挂在屏上就是串话').toBeNull()
    expect(document.querySelector('[data-msg="sess-1"]')).toBeTruthy()
  })
})
