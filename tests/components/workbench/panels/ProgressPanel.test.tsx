/**
 * tests/components/workbench/panels/ProgressPanel.test.tsx
 * ProgressPanel 组件级 RTL 最小伴随测试（ui-story-snapshot 漂移修复）
 *
 * 覆盖范围：
 * 1. 标题 / 徽章渲染
 * 2. 三种步骤状态（success / active / pending）分别渲染对应样式与耗时/提示
 * 3. P1 修复回归："停止"按钮（文案诚实化，非"暂停"）触发 onAction('pauseExec')
 * 4. "回滚"按钮触发 onAction('rollbackExec')
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type {} from '@testing-library/jest-dom'

import ProgressPanel from '@renderer/components/workbench/panels/ProgressPanel'
import type { AIToolPanel } from '@renderer/components/workbench/mock-data'

/** 构造执行进度面板（含三种状态的步骤） */
function makePanel(overrides: Partial<AIToolPanel> = {}): AIToolPanel {
  return {
    type: 'progress',
    title: '正在执行修复方案',
    badge: '执行中',
    steps: [
      { label: '备份配置文件', status: 'success', duration: 1.2 },
      { label: '重启 nginx 服务', status: 'active', hint: '进行中' },
      { label: '验证服务状态', status: 'pending', hint: '等待' },
    ],
    ...overrides,
  }
}

describe('ProgressPanel — 执行进度面板', () => {
  it('1. 渲染标题与徽章', () => {
    render(<ProgressPanel panel={makePanel()} />)
    expect(screen.getByText('正在执行修复方案')).toBeInTheDocument()
    expect(screen.getByText('执行中')).toBeInTheDocument()
  })

  it('2. 三种步骤状态分别渲染标签与耗时/提示', () => {
    render(<ProgressPanel panel={makePanel()} />)
    // success 步骤：显示标签 + 耗时（toFixed(1) + s）
    expect(screen.getByText('备份配置文件')).toBeInTheDocument()
    expect(screen.getByText('1.2s')).toBeInTheDocument()
    // active 步骤：显示标签 + hint
    expect(screen.getByText('重启 nginx 服务')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    // pending 步骤：显示标签 + hint
    expect(screen.getByText('验证服务状态')).toBeInTheDocument()
    expect(screen.getByText('等待')).toBeInTheDocument()
  })

  it('3. "停止"按钮触发 onAction("pauseExec")（P1 文案诚实化回归）', () => {
    const onAction = vi.fn()
    render(<ProgressPanel panel={makePanel()} onAction={onAction} />)
    // 文案必须是"停止"而非"暂停"（后端无恢复能力）
    expect(screen.queryByRole('button', { name: /暂停/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /停止/ }))
    expect(onAction).toHaveBeenCalledWith('pauseExec')
  })

  it('4. "回滚"按钮触发 onAction("rollbackExec")', () => {
    const onAction = vi.fn()
    render(<ProgressPanel panel={makePanel()} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: /回滚/ }))
    expect(onAction).toHaveBeenCalledWith('rollbackExec')
  })

  it('5. steps 为空时不渲染步骤行，但头部按钮仍可用', () => {
    render(<ProgressPanel panel={makePanel({ steps: undefined })} />)
    expect(screen.getByText('正在执行修复方案')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /停止/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /回滚/ })).toBeInTheDocument()
  })
})
