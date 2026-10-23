// @vitest-environment jsdom
/**
 * 回看拉回来的那一份要能真铺进列表（#177 的 store 侧）
 *
 * 三件事各自都可能"看起来成了其实没成"：
 * 1. 字段打折：库里存了思考链/工具卡/用量，铺进列表时只搬 content —— 界面上"有历史"，
 *    但思考链、命令卡、token 读数全没了；
 * 2. 重复灌：切走再切回会第二次 loadHistory，已存在的 id 不跳过就一条变两条；
 * 3. 插进正在流的那条：appendToken 反向找"最后一条 assistant"续字，
 *    流式中把历史插到它后面 = 往旧回答尾巴上写新内容。
 * 所以每条都配一个"另一档必须不成立"的对照，不是各写一条各自都绿的用例。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentStore, type AgentMessage } from '@renderer/stores/agent-store'
import type { ChatMessageRecord } from '@shared/chat-types'

const chatHistory = vi.fn()

function installApi(): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { chatHistory, chatAppend: vi.fn().mockResolvedValue(true) },
  })
}

const store = () => useAgentStore.getState()

function rec(overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id: 'm-1',
    role: 'assistant',
    content: '先看 df -h',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function find(id: string): AgentMessage | undefined {
  return store().messages.find((m) => m.id === id)
}

beforeEach(() => {
  chatHistory.mockReset()
  store().clearMessages()
  installApi()
})

describe('loadHistory 铺回列表', () => {
  it('库里那些字段一个不落地铺回来（回看不比当场看到的少）', async () => {
    chatHistory.mockResolvedValue([
      rec({
        id: 'a-full',
        correlationId: 'req-9',
        sshSessionId: 'sess-A',
        reasoning: '先看 df 再看 du',
        toolEvents: [{ toolCallId: 'c1', toolName: 'ssh_readonly', phase: 'result' }],
        providerId: 'deepseek',
        model: 'deepseek-chat',
        usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
        cancelled: true,
        contextTokens: 8123,
        contextNote: '已压缩较早的 12 条',
        cotEntropyTrajectory: [0.4, 0.9],
      }),
    ])
    await store().loadHistory('sess-A')

    const m = find('a-full')
    expect(m, '铺回来的那一条不在列表里').toBeTruthy()
    expect(m!.reasoning).toBe('先看 df 再看 du')
    expect(m!.toolEvents).toHaveLength(1)
    expect(m!.usage).toEqual({ inputTokens: 120, outputTokens: 40, totalTokens: 160 })
    expect(m!.providerId).toBe('deepseek')
    expect(m!.model).toBe('deepseek-chat')
    expect(m!.cancelled).toBe(true)
    expect(m!.correlationId).toBe('req-9')
    expect(m!.sshSessionId).toBe('sess-A')
    expect(m!.contextTokens).toBe(8123)
    expect(m!.contextNote).toBe('已压缩较早的 12 条')
    expect(m!.cotEntropyTrajectory).toEqual([0.4, 0.9])
    // 落库的是终态：回看绝不能把它标成"还在流"，否则面板永远转圈
    expect(m!.isStreaming).toBe(false)
  })

  it('本机那档（sshSessionId 为 null）铺回来时不带会话号，仍归未连接档', async () => {
    chatHistory.mockResolvedValue([rec({ id: 'local-1', sshSessionId: null })])
    await store().loadHistory(null)
    expect(find('local-1')!.sshSessionId, 'null 要还原成"没有会话"，不是字符串 null').toBeUndefined()
  })

  it('同一档读两次不会多出一条（切走再切回的现场）', async () => {
    chatHistory.mockResolvedValue([rec({ id: 'm-dup' })])
    await store().loadHistory('sess-A')
    await store().loadHistory('sess-A')
    const hits = store().messages.filter((m) => m.id === 'm-dup')
    expect(hits, '重复灌进列表 = 屏上两条一样的问答').toHaveLength(1)
  })

  it('流式进行中不插历史，流完后同样一份要能插进去（正反对照）', async () => {
    chatHistory.mockResolvedValue([rec({ id: 'm-live' })])
    // 正在流的那条是反向扫描要认领的目标，此时插历史会把它挤到末尾之后
    useAgentStore.setState({
      messages: [{ id: 'live', role: 'assistant', content: '说到一半', timestamp: 5, isStreaming: true } as AgentMessage],
      isStreaming: true,
      currentCorrelationId: 'c-live',
    })

    await store().loadHistory('sess-A')
    expect(store().messages.map((m) => m.id), '流式中不该动列表').toEqual(['live'])

    // 同一份数据、同一句话，只把"正在流"这个条件撤掉 —— 差值就是那条守卫本身
    useAgentStore.setState({ isStreaming: false })
    await store().loadHistory('sess-A')
    expect(store().messages.map((m) => m.id)).toEqual(['m-live', 'live'])
  })

  it('读失败时记下原因、列表一个字不改（不把失败演成"没有历史"）', async () => {
    useAgentStore.setState({
      messages: [{ id: 'keep', role: 'user', content: '已有的这条', timestamp: 3 } as AgentMessage],
    })
    chatHistory.mockRejectedValue(new Error('本地数据库不可用'))
    await store().loadHistory('sess-A')

    expect(store().historyError).toContain('本地数据库不可用')
    expect(store().messages.map((m) => m.id)).toEqual(['keep'])
  })

  it('下一次读成功要把原因清掉（否则横幅会赖在屏上不走）', async () => {
    chatHistory.mockRejectedValueOnce(new Error('库被锁住'))
    await store().loadHistory('sess-A')
    expect(store().historyError).toContain('库被锁住')

    chatHistory.mockResolvedValueOnce([rec({ id: 'm-after-ok' })])
    await store().loadHistory('sess-A')
    expect(store().historyError).toBeNull()
    expect(find('m-after-ok')).toBeTruthy()
  })

  it('清空对话把原因一起清掉（"我主动清了"与"读不到"不能留同一行话）', async () => {
    chatHistory.mockRejectedValue(new Error('库被锁住'))
    await store().loadHistory('sess-A')
    expect(store().historyError).toBeTruthy()
    store().clearMessages()
    expect(store().historyError).toBeNull()
  })

  it('没有 electronAPI.chatHistory 时静默跳过，不编一个失败原因出来', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} })
    await store().loadHistory('sess-A')
    expect(store().historyError, '通道都不存在却报"读失败"，是在给用户假故障').toBeNull()
  })
})
