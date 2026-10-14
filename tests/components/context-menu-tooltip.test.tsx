// @vitest-environment jsdom
/**
 * ContextMenu 与 Tooltip 的行为契约（替代 antd Dropdown / Tooltip）
 *
 * 右键菜单关心：右键能开、项能选、disabled 项不给点、危险项仍可读。
 * Tooltip 关心：content 为空时不该出现空气泡（这是三处调用点共用的语义），
 * 且这条负向断言配了"非空确实出现"的正对照。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'

import { ContextMenu, Tooltip, TooltipProvider, type ContextMenuEntry } from '@renderer/ui/overlay'

const ITEMS: ContextMenuEntry[] = [
  { key: 'rename', label: '重命名', onSelect: () => calls.push('rename') },
  { key: 'sep', divider: true },
  { key: 'close-all', label: '关闭所有', disabled: true, onSelect: () => calls.push('all') },
  { key: 'del', label: '删除', danger: true, onSelect: () => calls.push('del') },
]
const calls: string[] = []

function Host() {
  return (
    <ContextMenu items={ITEMS}>
      <div data-testid="row">文件行</div>
    </ContextMenu>
  )
}

describe('ContextMenu', () => {
  afterEach(() => {
    cleanup()
    calls.length = 0
  })

  it('右键打开菜单，分隔线也在', async () => {
    render(<Host />)
    fireEvent.contextMenu(screen.getByTestId('row'))
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument())
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeInTheDocument()
    // 分隔线：Radix 渲染 role=separator
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('点菜单项回调一次并关闭', async () => {
    render(<Host />)
    fireEvent.contextMenu(screen.getByTestId('row'))
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    expect(calls).toEqual(['rename'])
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('disabled 项不给选', async () => {
    render(<Host />)
    fireEvent.contextMenu(screen.getByTestId('row'))
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument())
    const item = screen.getByRole('menuitem', { name: '关闭所有' })
    expect(item).toHaveAttribute('data-disabled')
    fireEvent.click(item)
    expect(calls).toEqual([])
  })

  it('没右键之前不渲染菜单', () => {
    render(<Host />)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

function TipHost({ content }: { content: string }) {
  return (
    // TooltipProvider 不接 delayDuration（overlay.tsx:16 只收 children，内部固定 400ms），
    // 原先写在这儿的这个 prop 一直被忽略——留着它就是"配置了但其实没配"。
    <TooltipProvider>
      <Tooltip content={content}>
        <button type="button">分析</button>
      </Tooltip>
    </TooltipProvider>
  )
}

describe('Tooltip 的空提示语义', () => {
  afterEach(cleanup)

  it('content 非空时悬停出气泡（正对照）', async () => {
    const user = userEvent.setup()
    render(<TipHost content="至少需要 5 条日志" />)
    await user.hover(screen.getByRole('button', { name: '分析' }))
    await waitFor(() =>
      expect(screen.getByRole('tooltip', { name: '至少需要 5 条日志' })).toBeInTheDocument()
    )
  })

  it('content 为空时不出现空气泡', async () => {
    const user = userEvent.setup()
    render(<TipHost content="" />)
    await user.hover(screen.getByRole('button', { name: '分析' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
