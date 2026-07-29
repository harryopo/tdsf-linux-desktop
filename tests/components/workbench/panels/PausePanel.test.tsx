/**
 * tests/components/workbench/panels/PausePanel.test.tsx
 * PausePanel 组件级 RTL 最小伴随测试（ui-story-snapshot 漂移修复）
 *
 * 覆盖范围：
 * 1. pause 数据缺失时渲染 null（防御分支）
 * 2. 标题 / 徽章 / 暂停时长 / 描述文案渲染
 * 3. P1 修复回归：只保留真实可用的"终止任务"按钮（无假"继续执行"按钮），
 *    并诚实提示"重新发送消息继续"
 * 4. 点击"终止任务"触发 onAction('terminateTask')
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type {} from '@testing-library/jest-dom'

import PausePanel from '@renderer/components/workbench/panels/PausePanel'
import type { AIToolPanel } from '@renderer/components/workbench/mock-data'

/** 构造带 pause 数据的面板 */
function makePanel(overrides: Partial<AIToolPanel> = {}): AIToolPanel {
  return {
    type: 'pause',
    title: '任务已暂停',
    badge: '等待确认',
    pause: { description: '高危命令需人工确认', pausedFor: '02:30' },
    ...overrides,
  }
}

describe('PausePanel — 暂停面板', () => {
  it('1. pause 数据缺失时渲染 null', () => {
    const { container } = render(<PausePanel panel={makePanel({ pause: undefined })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('2. 渲染标题 / 徽章 / 暂停时长 / 描述', () => {
    render(<PausePanel panel={makePanel()} />)
    expect(screen.getByText('任务已暂停')).toBeInTheDocument()
    expect(screen.getByText('等待确认')).toBeInTheDocument()
    expect(screen.getByText('02:30')).toBeInTheDocument()
    expect(screen.getByText('高危命令需人工确认')).toBeInTheDocument()
  })

  it('3. 只有"终止任务"一个按钮，且诚实提示重新发送消息（P1 回归）', () => {
    render(<PausePanel panel={makePanel()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('终止任务')
    // 不应出现后端不支持的假"继续执行"入口
    expect(screen.queryByText(/继续执行/)).toBeNull()
    expect(screen.getByText(/请在输入框重新发送消息/)).toBeInTheDocument()
  })

  it('4. 点击"终止任务"触发 onAction("terminateTask")', () => {
    const onAction = vi.fn()
    render(<PausePanel panel={makePanel()} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: /终止任务/ }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('terminateTask')
  })
})
