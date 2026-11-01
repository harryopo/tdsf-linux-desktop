// @vitest-environment jsdom
/**
 * 终端命令块工具条（2026-11-01）
 *
 * 三件事各自都会"看起来成了其实没成"，所以分开钉：
 *   1. 位置换算：行 → 像素必须按 baseY 扣掉滚出去的行，否则滚动后工具条会错位；
 *   2. 读数：exit 与耗时要来自块本身，不是界面现算的猜数；
 *   3. 动作：重跑真的调回调、复制输出在没抄到正文时禁用（不给假按钮）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import {
  TerminalBlockOverlay,
  formatBlockDuration,
  layoutBlockToolbars,
} from '@/components/terminal/TerminalBlockOverlay'
import type { CommandBlock } from '../../../src/renderer/src/terminal/block-model'

function stubTerminal(baseY = 0, rows = 24): Terminal {
  return {
    buffer: { active: { baseY } },
    rows,
    onRender: () => ({ dispose: () => {} }),
    onScroll: () => ({ dispose: () => {} }),
  } as unknown as Terminal
}

function block(over: Partial<CommandBlock> = {}): CommandBlock {
  return {
    id: 1,
    command: 'ls -la',
    promptRow: 2,
    outputRow: 3,
    endRow: 5,
    exitCode: 0,
    state: 'done',
    startedAt: 1_000,
    endedAt: 3_400,
    ...over,
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('layoutBlockToolbars', () => {
  it('按 baseY 换算像素；滚出视口的块不画', () => {
    const layouts = layoutBlockToolbars([block()], { baseY: 0, rows: 24 }, 20)
    expect(layouts).toHaveLength(1)
    expect(layouts[0].y).toBe(100) // endRow 5 * 20
    expect(layouts[0].separatorY).toBe(40) // promptRow 2 * 20

    const scrolled = layoutBlockToolbars([block()], { baseY: 10, rows: 24 }, 20)
    expect(scrolled, '滚出屏幕的块不该还画着').toHaveLength(0)
  })

  it('没跑完的块贴在最后一行（还没有 endRow），坏退出码单独标出来', () => {
    const running = block({ id: 7, state: 'running', endRow: null, exitCode: null, endedAt: null })
    const layout = layoutBlockToolbars([running], { baseY: 0, rows: 24 }, 20)[0]
    expect(layout.y).toBe(40)
    expect(layout.durationMs).toBeNull()
    expect(layout.exitCode).toBeNull()

    const failed = layoutBlockToolbars([block({ exitCode: 127 })], { baseY: 0, rows: 24 }, 20)[0]
    expect(failed.ok).toBe(false)
    expect(failed.exitCode).toBe(127)
  })

  it('没有命令原文的块不画（只有提示符，没有可复制/可重跑的东西）', () => {
    expect(layoutBlockToolbars([block({ command: null })], { baseY: 0, rows: 24 }, 20)).toEqual([])
  })
})

describe('formatBlockDuration', () => {
  it('毫秒/秒/分三档，null 不显示', () => {
    expect(formatBlockDuration(null)).toBe('')
    expect(formatBlockDuration(850)).toBe('850ms')
    expect(formatBlockDuration(2_400)).toBe('2.4s')
    expect(formatBlockDuration(65_000)).toBe('1m5s')
  })
})

describe('TerminalBlockOverlay', () => {
  it('画出 exit 与耗时，并提供复制命令 / 重跑', () => {
    const onRerun = vi.fn()
    render(
      <TerminalBlockOverlay
        terminal={stubTerminal()}
        blocks={[block()]}
        visible
        onRerun={onRerun}
        cellHeightPx={20}
      />
    )
    const toolbar = document.querySelector('[data-dom-id="terminal-block-1"]')
    expect(toolbar).toHaveTextContent('exit 0')
    expect(toolbar).toHaveTextContent('2.4s')
    expect(toolbar).toHaveTextContent('ls -la')

    fireEvent.click(screen.getByRole('button', { name: /重跑：ls -la/ }))
    expect(onRerun).toHaveBeenCalledWith('ls -la')

    fireEvent.click(screen.getByRole('button', { name: /复制命令：ls -la/ }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ls -la')
  })

  it('没抄到输出正文时「输出」是禁用的按钮，不许看起来能按', () => {
    render(
      <TerminalBlockOverlay
        terminal={stubTerminal()}
        blocks={[block()]}
        visible
        onRerun={vi.fn()}
        cellHeightPx={20}
      />
    )
    expect(screen.getByRole('button', { name: /复制输出/ })).toBeDisabled()
  })

  it('有正文时复制的是正文；隐藏时整层不渲染', () => {
    const { rerender } = render(
      <TerminalBlockOverlay
        terminal={stubTerminal()}
        blocks={[block({ outputText: 'total 0\\n-rw-r--r-- 1 a b' })]}
        visible
        onRerun={vi.fn()}
        cellHeightPx={20}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /复制输出/ }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('total 0\\n-rw-r--r-- 1 a b')

    rerender(
      <TerminalBlockOverlay
        terminal={stubTerminal()}
        blocks={[block()]}
        visible={false}
        onRerun={vi.fn()}
        cellHeightPx={20}
      />
    )
    expect(document.querySelector('[data-dom-id="terminal-block-overlay"]')).toBeNull()
  })
})
