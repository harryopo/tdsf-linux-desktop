/**
 * 流式更新只重渲染"正在长的那一行"（AI 面板的流畅度地基）
 *
 * 现场：AIPanel 把四个回调直接写成行内箭头函数 / 组件体内的普通函数，
 * 每次渲染都是新对象。它们一路传到 memo(LiveMessageRow) 的 props 上，
 * 浅比较当场比不过——于是**每来一个 token，整屏历史消息全部重渲染一遍**。
 * 每条消息里还有 MarkdownMessage 在重解析，长对话越说越卡就是这么来的。
 *
 * 判据不量时间（机器一忙就假红），量的是"渲染次数"这个确定性事实：
 * 往正在流的那条消息追加一个 token，其余行的渲染次数必须是 0。
 *
 * 配套一条阳性对照：同一个判据在"父层传不稳定回调"时必须涨。
 * 没有这条对照，"0 次"既可能是修好了，也可能是替身根本没接上计数。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, type FC } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/** 每行 LiveMessageRow 的渲染次数（按 message.id 记） */
let renders: Record<string, number> = {}

vi.mock('@renderer/components/workbench/panels/LiveMessageRow', async () => {
  const { memo } = await import('react')
  const Stub: FC<{ message: { id: string } }> = ({ message }) => {
    renders[message.id] = (renders[message.id] ?? 0) + 1
    return null
  }
  // 被测代码用 memo() 包过，替身也要走同一条路才有可比性
  return { default: memo(Stub) }
})

vi.mock('@renderer/components/workbench/AIPanelHeader', () => ({ default: () => null }))
vi.mock('@renderer/components/workbench/Composer', () => ({ default: () => null }))
vi.mock('@renderer/dock/permission-bar', () => ({ PermissionBar: () => null }))
vi.mock('@renderer/terminal/shell-launcher', () => ({
  resolveShellForCommand: vi.fn(),
  runAuthoredInShell: vi.fn(),
}))
vi.mock('react-router-dom', () => {
  // 真 useNavigate 每轮渲染返回的是同一个 navigate 函数；替身也必须给同一个，
  // 否则 useCallback([navigate]) 的依赖每轮都变，量到的又是替身而不是被测代码
  const navigate = () => undefined
  return { useNavigate: () => navigate }
})
vi.mock('sonner', () => {
  const noop = () => undefined
  const toast = Object.assign(noop, { success: noop, error: noop, info: noop, warning: noop })
  return { toast }
})

/** useAgentChat 的替身：messages 仍从真 store 取，这样 store 更新才会驱动重渲染 */
vi.mock('@renderer/components/workbench/useAgentChat', async () => {
  const { useAgentStore } = await import('@renderer/stores/agent-store')
  const noop = () => undefined
  /*
   * 函数身份必须提到工厂外层：真 hook 里 send/cancel/clear/compressContext/retryLast
   * 全是 useCallback 出来的稳定引用（useAgentChat.ts:169/307/321/329/339）。
   * 替身要是每次调用都现造，AIPanel 的 useCallback 依赖数组就会每轮都变，
   * 这条判据量到的就不是被测代码而是替身自己——第一版就是这么假红的。
   */
  const stable = {
    setSelectedProviderId: noop,
    setThinkingStrength: noop,
    resetSessionCost: noop,
    send: async () => undefined,
    cancel: async () => undefined,
    clear: noop,
    compressContext: () => ({ compressed: false, reason: '测试替身' }),
    retryLast: async () => undefined,
  }
  return {
    useAgentChat: () => ({
      messages: useAgentStore((s) => s.messages),
      isStreaming: useAgentStore((s) => s.isStreaming),
      lastError: useAgentStore((s) => s.lastError),
      currentCorrelationId: useAgentStore((s) => s.currentCorrelationId),
      providers: [],
      selectedProviderId: null,
      thinkingStrength: 'auto',
      tokenStats: null,
      costStats: null,
      sessionCost: null,
      ...stable,
    }),
  }
})

vi.mock('@renderer/components/workbench/useLoopEngineering', () => ({
  useLoopEngineering: () => ({ phase: 'idle', workflowState: null, decisionCard: null, finalCard: null }),
}))

vi.mock('@renderer/components/workbench/usePaorLoop', () => ({
  usePaorLoop: () => ({ plan: null, iterations: [], isRunning: false, error: null, result: null }),
}))

import AIPanel from '@renderer/components/workbench/AIPanel'
import MessageList from '@renderer/components/workbench/MessageList'
import { useAgentStore, type AgentMessage } from '@renderer/stores/agent-store'

const msg = (id: string, role: 'user' | 'assistant', content: string, isStreaming = false): AgentMessage =>
  ({ id, role, content, timestamp: Date.now(), isStreaming }) as AgentMessage

let root: Root | null = null

/** 12 条历史 + 最后一条正在流 */
function seed(): AgentMessage[] {
  const list: AgentMessage[] = []
  for (let i = 0; i < 6; i++) {
    list.push(msg(`u${i}`, 'user', `第 ${i} 轮提问内容`))
    list.push(msg(`a${i}`, 'assistant', `第 ${i} 轮回答，**加粗** 与一段代码 \`ls -l\``))
  }
  list.push(msg('live', 'assistant', '正在说', true))
  useAgentStore.setState({ messages: list, isStreaming: true, currentCorrelationId: 'c-test' })
  return list
}

function mount(node: Parameters<Root['render']>[0]): void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(node))
}

/** 换一轮渲染：把整棵子树再 render 一次（父组件因此重跑，子件是否重跑取决于 props 稳不稳） */
function rerender(node: Parameters<Root['render']>[0]): void {
  act(() => root?.render(node))
}

const listProps = (messages: AgentMessage[], unstable: boolean) => ({
  providers: [],
  navigate: () => undefined,
  hasLoopRunning: false,
  activeSessionId: null,
  paorApprovals: [],
  onPaorApprove: () => undefined,
  paorPlan: null,
  paorIterations: [],
  paorRunning: false,
  messagesEndRef: { current: null },
  hasLiveConversation: true,
  liveMessages: messages,
  lastError: null,
  isStreaming: true,
  // unstable=true 时每次调用都现造一个新函数——这正是修之前 AIPanel 干的事
  onToolAction: unstable ? () => undefined : STABLE.onToolAction,
  onMessageNavigate: unstable ? () => undefined : STABLE.onMessageNavigate,
  onRetryMessage: unstable ? () => undefined : STABLE.onRetryMessage,
  onCompressContext: unstable ? () => undefined : STABLE.onCompressContext,
})

/** 稳定回调（对照实验的"修好"那一侧） */
const STABLE = {
  onToolAction: () => undefined,
  onMessageNavigate: () => undefined,
  onRetryMessage: () => undefined,
  onCompressContext: () => undefined,
}

beforeEach(() => {
  renders = {}
  useAgentStore.getState().clearMessages()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.textContent = ''
})

describe('流式渲染隔离', () => {
  it('挂上去时 13 行各渲染一次（量具自己得真渲染到东西）', () => {
    seed()
    mount(createElement(AIPanel))
    expect(Object.keys(renders).length, '一行都没渲染 = 替身没接上，后面的 0 不作数').toBe(13)
    expect(Object.values(renders).every((n) => n === 1)).toBe(true)
  })

  it('追加一个 token：只有正在流的那一行重渲染，其余 12 行一次都不该重跑', () => {
    seed()
    mount(createElement(AIPanel))
    renders = {}

    act(() => {
      // 真信封形状：AgentChunkPayload 只要 correlationId + delta，不需要任何断言式收窄
      useAgentStore.getState().appendToken({ correlationId: 'c-test', delta: '中' })
    })

    expect(renders.live, '正在流的那行必须更新，否则"其余为 0"是反着假绿').toBeGreaterThan(0)
    const others = Object.entries(renders)
      .filter(([id]) => id !== 'live')
      .map(([id, n]) => `${id}=${n}`)
    expect(
      others,
      '历史行被连带重渲染 = 每来一个字整屏重画，长对话必然越说越卡',
    ).toEqual([])
  })

  it('阳性对照：父层传不稳定回调时，同一把尺必须数到整屏重渲染', () => {
    const list = seed()
    mount(createElement(MessageList, listProps(list, false)))
    renders = {}

    // 稳定回调：再渲染一轮，历史行不该动
    rerender(createElement(MessageList, listProps(list, false)))
    expect(Object.values(renders).reduce((a, b) => a + b, 0), '稳定 props 下不该有任何行重渲染').toBe(0)

    // 不稳定回调：内容一个字没变，但每次都是新函数 → memo 失效 → 13 行全重跑
    rerender(createElement(MessageList, listProps(list, true)))
    expect(
      Object.keys(renders).length,
      '计数没涨说明这把尺量不出"不稳定回调"，上面那条 0 是假绿',
    ).toBe(13)
  })
})
