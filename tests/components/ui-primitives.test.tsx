// @vitest-environment jsdom
/**
 * 原语层（src/renderer/src/ui）判据
 *
 * 两条主线：
 * 1. 可访问性——图标按钮必须有名字、进行中状态必须有文字替代（不能只靠颜色和形状）；
 * 2. 颜色只能来自令牌——ui/ 下任何文件出现 hex/rgb 字面量就是往第二份真值上走。
 * 再加几条行为冒烟（折叠、分段切换、关闭按钮不吞选中）。
 */
import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button, IconButton, Chip, StatusDot, Collapse, Segmented, SessionTabs } from '@/ui'

const ROOT = path.resolve(__dirname, '../..')
const UI_DIR = path.join(ROOT, 'src/renderer/src/ui')

describe('ui 原语层的色值纪律', () => {
  it('ui/ 下没有色值字面量（一切颜色走令牌）', () => {
    const offenders: string[] = []
    for (const f of fs.readdirSync(UI_DIR)) {
      const text = fs.readFileSync(path.join(UI_DIR, f), 'utf8')
      text.split('\n').forEach((line, i) => {
        if (/#(?:[0-9a-f]{3,8})\b|rgba?\(|hsla?\(/i.test(line)) {
          offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 70)}`)
        }
      })
    }
    expect(offenders, `写死的颜色：\n${offenders.join('\n')}`).toEqual([])
  })

  it('折叠用 grid-template-rows，不用 max-height 猜高度', () => {
    const src = fs.readFileSync(path.join(UI_DIR, 'surface.tsx'), 'utf8')
    expect(src).toContain('gridTemplateRows')
    expect(src).not.toContain('maxHeight')
  })
})

describe('ui 原语层的行为与可访问性', () => {
  it('Button 默认 type=button，不会顺手提交表单', () => {
    render(<Button>保存</Button>)
    expect(screen.getByRole('button', { name: '保存' })).toHaveAttribute('type', 'button')
  })

  it('IconButton 把 label 同时给成 aria-label 与 title', () => {
    render(
      <IconButton label="切换 AI 面板">
        <span />
      </IconButton>
    )
    const btn = screen.getByRole('button', { name: '切换 AI 面板' })
    expect(btn).toHaveAttribute('title', '切换 AI 面板')
  })

  it('Chip 只是文本容器，不吞事件', () => {
    render(<Chip tone="warning">未连接</Chip>)
    expect(screen.getByText('未连接')).toBeInTheDocument()
  })

  it('进行中的状态点有文字替代（色盲用户不靠颜色判断）', () => {
    render(<StatusDot status="pending" />)
    expect(screen.getByRole('status', { name: '进行中' })).toBeInTheDocument()
  })

  it('终态状态点对辅助技术隐藏（旁边一定有文字）', () => {
    const { container } = render(<StatusDot status="success" />)
    expect(container.querySelector('span')).toHaveAttribute('aria-hidden', 'true')
  })

  it('Collapse 关闭时把行高压到 0fr，内容仍在 DOM 里', () => {
    const { container, rerender } = render(<Collapse open={false}>正文</Collapse>)
    const grid = container.firstElementChild as HTMLElement
    expect(grid.style.gridTemplateRows).toBe('0fr')
    expect(container).toHaveTextContent('正文')
    rerender(<Collapse open={true}>正文</Collapse>)
    expect(grid.style.gridTemplateRows).toBe('1fr')
  })

  it('Segmented 切换会回传新的 value', () => {
    const onValueChange = vi.fn()
    render(
      <Segmented
        ariaLabel="视图"
        value="todo"
        onValueChange={onValueChange}
        items={[
          { value: 'todo', label: 'Tasks' },
          { value: 'edits', label: 'Edits' },
        ]}
      />
    )
    // radix Tabs 在鼠标左键按下时就选中（真实交互里 mousedown 先于 click），
    // 只派发 click 测不到它
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Edits' }), { button: 0 })
    expect(onValueChange).toHaveBeenCalledWith('edits')
  })

  it('SessionTabs 的关闭按钮不会连带选中该标签', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <SessionTabs
        tabs={[
          { id: 'a', title: '会话 A' },
          { id: 'b', title: '会话 B' },
        ]}
        activeId="a"
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭 会话 B' }))
    expect(onClose).toHaveBeenCalledWith('b')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
