// @vitest-environment jsdom
/**
 * confirmDialog 的行为契约（替代 antd Modal.confirm）
 *
 * 关心三件事：
 * 1. 提示与两个动作都能用，Promise 的布尔值与点下的按钮一致
 * 2. Esc / 点遮罩 这种"没明确同意"的手势必须算 false（与底部审批条同一个 fail-closed 取向）
 * 3. 危险操作的默认焦点在"取消"，回车不该直接执行破坏性动作
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'

import { ConfirmHost, confirmDialog } from '@renderer/ui/confirm'

function Trigger({ label, danger }: { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        void confirmDialog({
          title: '删除服务器',
          description: '此操作不可撤销。',
          okText: '删除',
          danger,
        })
      }}
      aria-label={label}
    >
      {label}
    </button>
  )
}

describe('confirmDialog', () => {
  beforeEach(() => {
    render(
      <>
        <Trigger label="普通删除" />
        <Trigger label="危险删除" danger />
        <ConfirmHost />
      </>
    )
  })

  afterEach(() => cleanup())

  it('点确认 → true', async () => {
    const result = vi.fn()
    // 直接拿 Promise：先挂起再点按钮
    const p = confirmDialog({ title: '确认采纳执行', okText: '确认执行' })
    void p.then(result)
    await waitFor(() => expect(screen.getByText('确认采纳执行')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    await expect(p).resolves.toBe(true)
    await waitFor(() => expect(result).toHaveBeenCalledWith(true))
  })

  it('点取消 → false，且取消按钮在前', async () => {
    const p = confirmDialog({ title: '确认删除规则', okText: '删除', danger: true })
    await waitFor(() => expect(screen.getByText('确认删除规则')).toBeInTheDocument())
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons.indexOf('取消')).toBeLessThan(buttons.indexOf('删除'))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await expect(p).resolves.toBe(false)
  })

  it('危险操作的初始焦点在"取消"（回车不应直接删）', async () => {
    await userEvent.click(screen.getByLabelText('危险删除'))
    await waitFor(() => expect(screen.getByText('删除服务器')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
  })

  it('Esc 关掉算 false', async () => {
    const p = confirmDialog({ title: '丢弃未保存修改', okText: '丢弃并关闭全部', danger: true })
    await waitFor(() => expect(screen.getByText('丢弃未保存修改')).toBeInTheDocument())
    fireEvent.keyDown(screen.getByText('丢弃未保存修改'), { key: 'Escape', code: 'Escape' })
    await expect(p).resolves.toBe(false)
  })
})
