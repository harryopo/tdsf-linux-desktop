/**
 * tests/components/workbench/MessageList.test.tsx
 * 欢迎态（面板第①笔）——那一列建议行是不是真入口
 *
 * 为什么单独一个文件：欢迎态是面板在没有对话时唯一的界面，而它以前是一张
 * "你好，我是 TDSF AI 运维助手"的能力网格。改版把它换成与消息流同左缘的一列建议行，
 * 判据跟着换：每一行点了要真把**它那一句**填进输入框，条件不满足时那两条引导行
 * 要出现、满足时要消失。行与提示词不同源（所有行填同一句）是最容易画上去的错，
 * 所以这里按标签里的关键词去核对填进来的那句。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { RefObject } from 'react'

import MessageList, { type MessageListProps } from '@renderer/components/workbench/MessageList'
import { QUICK_PROMPTS } from '@renderer/components/workbench/mock-data'
import { useEditorStore } from '@renderer/stores/editor-store'
import type { PersistedProviderConfig } from '@shared/agent-types'

const endRef = { current: null } as unknown as RefObject<HTMLDivElement | null>

function baseProps(overrides: Partial<MessageListProps> = {}): MessageListProps {
  return {
    providers: [],
    navigate: vi.fn(),
    activeSessionId: null,
    paorPlan: null,
    paorIterations: [],
    paorRunning: false,
    messagesEndRef: endRef,
    hasLiveConversation: false,
    liveMessages: [],
    lastError: null,
    isStreaming: false,
    onToolAction: vi.fn(),
    onMessageNavigate: vi.fn(),
    onRetryMessage: vi.fn(),
    onCompressContext: vi.fn(),
    ...overrides,
  }
}

const injected = () => useEditorStore.getState().injectedAtCommand

/** 按标签里那句人话找到那一行，返回它的提示词（点了之后 store 里落的那句） */
function clickRowByLabel(label: string): void {
  const row = screen.getByRole('button', { name: new RegExp(label) })
  fireEvent.click(row)
}

beforeEach(() => {
  useEditorStore.getState().clearInjectedAtCommand()
})

describe('MessageList — 欢迎态那一列建议行', () => {
  it('1. 四条真入口：点某一行，填进来的逐字等于单源那一句', () => {
    render(<MessageList {...baseProps()} />)
    const rows = screen.getAllByRole('button')
    expect(rows.length, '未连接又没配模型时应该是 4 条能力 + 2 条引导').toBe(6)

    clickRowByLabel('不对劲')
    // 比整句而不是比关键词：本地再抄一份"意思差不多"的句子，这里就该红
    expect(injected(), '「查这台机器哪里不对劲」填的不是单源那句').toBe(QUICK_PROMPTS['诊断'])

    useEditorStore.getState().clearInjectedAtCommand()
    clickRowByLabel('性能瓶颈')
    expect(injected(), '「找性能瓶颈」填的不是单源那句').toBe(QUICK_PROMPTS['性能'])
    expect(injected(), '两条行填回来的是同一句').not.toBe(QUICK_PROMPTS['诊断'])
  })

  it('2. 填提示词那几行都写清"填进输入框、不直接发送"——画成 ↵ 就是假 affordance', () => {
    render(<MessageList {...baseProps()} />)
    for (const label of ['不对劲', '性能瓶颈', '配置文件', '失败命令']) {
      const row = screen.getByRole('button', { name: new RegExp(label) })
      expect(row.getAttribute('title'), `${label} 那一行没交代点了会发生什么`).toContain('填入下方输入框')
      expect(row.textContent, `${label} 那一行画了个回车，看着像直接发送`).not.toMatch(/↵/)
    }
  })

  it('3. 未连接时给一条真能去的"去设置里连服务器"，连上了就消失', () => {
    const navigate = vi.fn()
    const { unmount } = render(<MessageList {...baseProps({ navigate })} />)
    clickRowByLabel('去设置里连服务器')
    expect(navigate).toHaveBeenCalledWith('/settings/ssh')
    unmount()

    const navigateAfter = vi.fn()
    render(<MessageList {...baseProps({ navigate: navigateAfter, activeSessionId: 'sess-1' })} />)
    expect(screen.queryByRole('button', { name: /去设置里连服务器/ })).toBeNull()
    expect(screen.getByText(/AI 只读地看日志/), '连上之后那句说明要跟着换口径').toBeInTheDocument()
    expect(navigateAfter, '连上了还替用户点了一次跳转').not.toHaveBeenCalled()
  })

  it('4. 一个模型都没有才催去配；配过就闭嘴', () => {
    const navigate = vi.fn()
    const { unmount } = render(<MessageList {...baseProps({ navigate })} />)
    clickRowByLabel('还没有可用的模型')
    expect(navigate).toHaveBeenCalledWith('/settings/model')
    unmount()

    const one = [{ id: 'p1' }] as unknown as PersistedProviderConfig[]
    render(<MessageList {...baseProps({ navigate, providers: one })} />)
    expect(screen.queryByRole('button', { name: /还没有可用的模型/ })).toBeNull()
  })

  it('5. 正对照：一进对话态，欢迎态一个字都不该留着', () => {
    render(
      <MessageList
        {...baseProps({
          hasLiveConversation: true,
          liveMessages: [
            {
              id: 'a1',
              role: 'assistant',
              content: '日志分区用到 92%。',
              timestamp: Date.now(),
            },
          ],
        })}
      />
    )
    expect(screen.queryByText('问问这台机器')).toBeNull()
    expect(screen.queryByRole('button', { name: /不对劲/ })).toBeNull()
    expect(screen.getByText(/日志分区用到/)).toBeInTheDocument()
  })
})
