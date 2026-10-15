/**
 * tests/components/ai/error-next-step.test.tsx — 报错之后要有一条能走的路（#114 Wave C）
 *
 * 主进程早就把错误分成 18 类，`code` 也随 IPC 一路送到渲染进程，但渲染层零消费：
 * "未配置 API Key"与"内容被安全策略拒绝"在界面上是同一句灰字，用户只能再按一次发送。
 *
 * 这里的硬规矩是**反假按钮**：按钮只在父组件真的给了回调时才出现。
 * 每条"有按钮"的判据都配一条"没回调就没有按钮"的对照，否则这道门只会保证
 * 界面上多了一堆点了没反应的东西（比没有更糟）。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LiveMessageRow from '@renderer/components/workbench/panels/LiveMessageRow'
import {
  errorActionTypes,
  resolveErrorNextStep,
} from '@renderer/components/workbench/error-next-step'
import { compressFeedback } from '@renderer/components/workbench/context-usage'
import {
  latestUserQuestion,
  useAgentStore,
  type AgentMessage,
} from '@renderer/stores/agent-store'
import { LLM_ERROR_CODES, type LlmErrorCode } from '@shared/agent-types'

function errorMsg(code: LlmErrorCode | undefined): AgentMessage {
  return {
    id: 'err-1',
    role: 'assistant',
    content: '[错误] 上游拒绝了这个请求',
    timestamp: 1,
    isError: true,
    ...(code ? { errorCode: code } : {}),
  }
}

function renderRow(msg: AgentMessage, props: Record<string, unknown> = {}) {
  return render(<LiveMessageRow message={msg} {...props} />)
}

describe('错误码表：每个码都要有话可说', () => {
  it('清单从单源取数（不是测试里手抄一份），且每个码都有下一步文案', () => {
    expect(LLM_ERROR_CODES.length).toBeGreaterThan(15)
    for (const code of LLM_ERROR_CODES) {
      const step = resolveErrorNextStep(code)
      expect(step, `码 ${code} 没有下一步`).not.toBeNull()
      expect(step!.hint.trim().length, `码 ${code} 的文案是空的`).toBeGreaterThan(0)
    }
  })

  it('表里出现的动作种类不超过界面真实现的那三种', () => {
    expect(errorActionTypes().sort()).toEqual(['compress', 'retry', 'settings'])
  })

  it('没有 code 时不渲染任何东西（旧错误记录不该被硬塞一条建议）', () => {
    expect(resolveErrorNextStep(undefined)).toBeNull()
  })

  it('"重试不会恢复"的那几类不许给重试按钮', () => {
    // 对不存在的事说"再试一次"是错的建议，与 QUOTA_EXHAUSTED 同一族
    expect(resolveErrorNextStep('QUOTA_EXHAUSTED')!.actions).not.toContain('retry')
    expect(resolveErrorNextStep('NO_API_KEY')!.actions).not.toContain('retry')
    expect(resolveErrorNextStep('CONTENT_POLICY')!.actions).toEqual([])
    expect(resolveErrorNextStep('CANCELLED')!.actions).toEqual([])
  })
})

describe('报错行：按钮只在接得到回调时出现', () => {
  beforeEach(() => {
    useAgentStore.getState().clearMessages()
  })

  it('NO_API_KEY + 有导航回调 → 出现"去设置 · 模型"，点击真的导航', () => {
    const onNavigate = vi.fn()
    renderRow(errorMsg('NO_API_KEY'), { onNavigate })
    const button = screen.getByRole('button', { name: '去设置 · 模型' })
    fireEvent.click(button)
    expect(onNavigate).toHaveBeenCalledWith('/settings/model')
  })

  it('同一个码但父组件没给导航回调 → 一个按钮都不许画（假 affordance 对照）', () => {
    renderRow(errorMsg('NO_API_KEY'), {})
    expect(screen.queryByRole('button', { name: '去设置 · 模型' })).toBeNull()
    // 文案还是要给的：不能因为没按钮就连"该干什么"都不说
    expect(screen.getByText(/补上 API Key/)).toBeInTheDocument()
  })

  it('UNKNOWN + 有重试回调 → 出现"重试"，点击重发最近提问', () => {
    const onRetry = vi.fn()
    renderRow(errorMsg('UNKNOWN'), { onRetry })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('CONTEXT_OVERFLOW 把"压缩上下文"排在第一位', () => {
    const onCompress = vi.fn()
    renderRow(errorMsg('CONTEXT_OVERFLOW'), { onCompress, onNavigate: vi.fn() })
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    const compressIdx = buttons.indexOf('压缩上下文')
    const settingsIdx = buttons.indexOf('去设置 · 模型')
    expect(compressIdx).toBeGreaterThanOrEqual(0)
    expect(compressIdx).toBeLessThan(settingsIdx)
    fireEvent.click(screen.getByRole('button', { name: '压缩上下文' }))
    expect(onCompress).toHaveBeenCalledTimes(1)
  })

  it('没带 code 的错误行保持原样（不加一行没依据的建议）', () => {
    const { container } = renderRow(errorMsg(undefined), { onRetry: vi.fn() })
    expect(container.textContent).toContain('[错误]')
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })
})

describe('重试的对象与压缩的反馈', () => {
  beforeEach(() => {
    useAgentStore.getState().clearMessages()
  })

  it('重试取最近一条非空提问，而不是第一条', () => {
    const list = [
      { id: 'u1', role: 'user', content: '第一个问题', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: '答', timestamp: 2 },
      { id: 'u2', role: 'user', content: '第二个问题', timestamp: 3 },
      { id: 'a2', role: 'assistant', content: '', timestamp: 4, isError: true },
    ] as AgentMessage[]
    expect(latestUserQuestion(list)).toBe('第二个问题')
  })

  it('空白提问不算（重试发一条空消息只会再报一次错）', () => {
    const list = [{ id: 'u1', role: 'user', content: '   ', timestamp: 1 }] as AgentMessage[]
    expect(latestUserQuestion(list)).toBeNull()
  })

  it('markError 把分类码记在消息上（渲染层唯一的取数入口）', () => {
    useAgentStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: '看下磁盘', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: '', timestamp: 2, isStreaming: true, correlationId: 'c-1' },
      ],
      isStreaming: true,
      currentCorrelationId: 'c-1',
    })
    useAgentStore.getState().markError({ correlationId: 'c-1', message: '未配置 API Key', code: 'NO_API_KEY' })
    const stored = useAgentStore.getState().messages[1]
    expect(stored.errorCode).toBe('NO_API_KEY')
    expect(stored.isError).toBe(true)
  })

  it('压缩反馈只有一处文案来源（徽章与报错行共用）', () => {
    expect(
      compressFeedback({ compressed: true, droppedMessages: 6, droppedTokens: 600 }),
    ).toContain('600')
    expect(compressFeedback({ compressed: false, droppedMessages: 0, droppedTokens: 0 })).toContain(
      '无需压缩'
    )
    expect(compressFeedback(undefined)).toContain('无需压缩')
  })
})
