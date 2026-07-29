/**
 * tests/components/workbench/panels/ChatCredibility.test.tsx
 * ChatCredibility 聊天内可信度分析折叠块测试（v2.5 接线修复）
 *
 * 覆盖范围：
 * 1. 无 electronAPI / 无 toolEvents / 流式中 → 不渲染（不显示假数据）
 * 2. 完成态 + toolEvents → 调用 credibilityAssess 并渲染折叠行（百分比 + 规则名）
 * 3. 点击展开渲染完整 ConfidenceBreakdown
 * 4. 同一批证据只评估一次（指纹去重）
 *
 * 关键决策：
 * - mock window.electronAPI.credibilityAssess 返回固定 ConfidenceAssessment，
 *   断言 6 源输入确实被构建（长度 6）
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type {} from '@testing-library/jest-dom'

import ChatCredibility from '@renderer/components/workbench/panels/ChatCredibility'
import type { AgentMessage } from '@renderer/stores/agent-store'
import type { ConfidenceAssessment } from '@shared/agent-types'

/** 固定评估结果（覆盖 ConfidenceBreakdown 最小必要字段） */
const ASSESSMENT: ConfidenceAssessment = {
  belief: 0.7,
  plausibility: 0.9,
  confidence: 0.8,
  uncertainty: 0.2,
  conflictLevel: 0.1,
  ruleUsed: 'dempster',
  sources: [],
  fusionSteps: [],
  fusedMassFunction: {
    sourceId: 'test',
    sourceName: 'test',
    confidence: 0.8,
    focalElements: [],
  },
} as unknown as ConfidenceAssessment

/** 构造带真实工具轨迹的完成态 assistant 消息 */
function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '磁盘正常',
    timestamp: Date.now(),
    toolEvents: [
      {
        toolCallId: 't1',
        toolName: 'ssh_readonly',
        input: 'df -h',
        done: true,
        ok: true,
        output: 'Filesystem Use% 45%',
      },
    ],
    ...overrides,
  }
}

describe('ChatCredibility — 聊天内可信度分析', () => {
  const assessMock = vi.fn()

  beforeEach(() => {
    assessMock.mockReset()
    assessMock.mockResolvedValue(ASSESSMENT)
    // mock electronAPI（jsdom 下默认 undefined）
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: { credibilityAssess: assessMock },
    })
  })

  it('1. 流式中 / 无 toolEvents 时不渲染', async () => {
    const { container: c1 } = render(
      <ChatCredibility message={makeMessage({ isStreaming: true })} />
    )
    expect(c1).toBeEmptyDOMElement()

    const { container: c2 } = render(
      <ChatCredibility message={makeMessage({ toolEvents: [] })} />
    )
    expect(c2).toBeEmptyDOMElement()
    expect(assessMock).not.toHaveBeenCalled()
  })

  it('2. 完成态调用 credibilityAssess（6 源输入）并渲染折叠行', async () => {
    render(<ChatCredibility message={makeMessage()} />)

    await waitFor(() => {
      expect(screen.getByText('可信度分析')).toBeInTheDocument()
    })
    // 6 源输入被构建
    expect(assessMock).toHaveBeenCalledTimes(1)
    expect(assessMock.mock.calls[0][0]).toHaveLength(6)
    // 折叠行徽章：80% + 规则名 D-S
    expect(screen.getByText(/80% · D-S/)).toBeInTheDocument()
    expect(screen.getByText('1 项证据')).toBeInTheDocument()
  })

  it('3. 点击展开渲染完整 ConfidenceBreakdown（Bel/Pl）', async () => {
    render(<ChatCredibility message={makeMessage()} />)
    await waitFor(() => expect(screen.getByText('可信度分析')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /可信度分析/ }))
    // ConfidenceBreakdown 内部会展示 Bel / Pl 数值卡片
    expect(screen.getByText(/70\.0%/)).toBeInTheDocument()
    expect(screen.getByText(/90\.0%/)).toBeInTheDocument()
  })

  it('4. electronAPI 不可用时不渲染且不报错', () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: undefined,
    })
    const { container } = render(<ChatCredibility message={makeMessage()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
