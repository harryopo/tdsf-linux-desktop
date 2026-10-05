/**
 * 命令块模型判据
 *
 * 这里钉的是"AI 说上一条命令失败了"这句话的可信度：
 * 块不能凭空造、连续提示符不能刷出一堆空块、退出码缺失要如实标 unknown
 * 而不是默认 0。
 */
import { describe, it, expect } from 'vitest'
import {
  createBlockModel,
  finishedBlocks,
  lastBlock,
  markCommandEnd,
  markCommandStart,
  markOutput,
  markPrompt,
  setCommandLine,
  setProperty,
  toAiContext,
  activeBlock,
  MAX_BLOCKS,
} from '../../src/renderer/src/terminal/block-model'
import { handleOsc133, handleOsc633 } from '../../src/renderer/src/terminal/block-collector'

describe('block-model：一次命令的生命周期', () => {
  it('A→B→C→D;0 产出一个已完成块并记下退出码', () => {
    const m = createBlockModel()
    markPrompt(m, 10)
    markCommandStart(m, 10)
    setCommandLine(m, 'df -h', 10)
    markOutput(m, 11)
    markCommandEnd(m, 14, 0)

    expect(m.blocks).toHaveLength(1)
    const b = m.blocks[0]
    expect(b).toMatchObject({ command: 'df -h', state: 'done', exitCode: 0, outputRow: 11, endRow: 14 })
    expect(activeBlock(m)).toBeNull()
  })

  it('退出码非 0 要保留原值（AI 判断成败靠它）', () => {
    const m = createBlockModel()
    markPrompt(m, 1)
    setCommandLine(m, 'systemctl status nginx', 1)
    markOutput(m, 2)
    markCommandEnd(m, 5, 3)
    expect(lastBlock(m)?.exitCode).toBe(3)
  })

  it('连续两次提示符不产生第二个空块', () => {
    const m = createBlockModel()
    markPrompt(m, 1)
    markPrompt(m, 2)
    markPrompt(m, 3)
    expect(m.blocks).toHaveLength(1)
    expect(lastBlock(m)?.promptRow).toBe(3)
  })

  it('命令结束但找不到未完成的块时忽略，不凭空造块', () => {
    const m = createBlockModel()
    markCommandEnd(m, 9, 1)
    expect(m.blocks).toHaveLength(0)
  })

  it('633;E 落在已在跑的块上时另起一块，不把命令挂到别的命令上', () => {
    const m = createBlockModel()
    markPrompt(m, 1)
    setCommandLine(m, 'free -m', 1)
    markOutput(m, 2)
    setCommandLine(m, 'uptime', 3)
    expect(m.blocks).toHaveLength(2)
    expect(m.blocks[0].command).toBe('free -m')
    expect(m.blocks[1].command).toBe('uptime')
  })

  it('633;P 的 Cwd 挂到当前块', () => {
    const m = createBlockModel()
    markPrompt(m, 1)
    setCommandLine(m, 'ls', 1)
    setProperty(m, 'Cwd=/etc/nginx')
    expect(lastBlock(m)?.cwd).toBe('/etc/nginx')
  })

  it('块数超过上限丢最旧的，保留最近的', () => {
    const m = createBlockModel()
    for (let i = 0; i < MAX_BLOCKS + 20; i++) {
      markPrompt(m, i)
      setCommandLine(m, `cmd-${i}`, i)
      markCommandEnd(m, i, 0)
    }
    expect(m.blocks.length).toBe(MAX_BLOCKS)
    expect(m.blocks[m.blocks.length - 1].command).toBe(`cmd-${MAX_BLOCKS + 19}`)
    expect(m.blocks[0].command).toBe('cmd-20')
  })
})

describe('block-model：给 AI 的摘要', () => {
  it('只收已完成且有命令原文的块，并给出退出码与输出行范围', () => {
    const m = createBlockModel()
    markPrompt(m, 1)
    setCommandLine(m, 'df -h', 1)
    markOutput(m, 2)
    markCommandEnd(m, 4, 0)
    markPrompt(m, 5) // 这条还没执行完，不该进摘要
    const text = toAiContext(m)
    expect(text).toBe('$ df -h [ok] 行 2-4')
  })

  it('失败命令标 exit=N，退出码缺失标 unknown（不许默认成成功）', () => {
    const m = createBlockModel()
    markPrompt(m, 1)
    setCommandLine(m, 'false', 1)
    markOutput(m, 2)
    markCommandEnd(m, 3, 1)
    markPrompt(m, 4)
    setCommandLine(m, 'no-exit-code', 4)
    markOutput(m, 5)
    markCommandEnd(m, 6, null)
    const text = toAiContext(m)
    expect(text).toContain('$ false [exit=1]')
    expect(text).toContain('$ no-exit-code [unknown]')
  })

  it('没有块时返回空串（调用方据此判断"无历史"）', () => {
    expect(toAiContext(createBlockModel())).toBe('')
  })
})

describe('收集器接线（源码级，防止只写了模块没挂上）', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../src/renderer/src/components/terminal/TerminalView.tsx'),
    'utf8'
  )

  it('TerminalView 挂上收集器，并在卸载时撤掉', () => {
    expect(src).toContain('attachBlockCollector(')
    expect(src).toContain('blockCollector.dispose()')
    expect(src).toContain('setCommandBlocks(null)')
  })

  it('状态栏消费摘要，不再显示编出来的 0 Errors 与 P99 180ms', () => {
    const bar = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/renderer/src/components/workbench/StatusBar.tsx'),
      'utf8'
    )
    expect(bar).toContain('commandBlocks')
    expect(bar).not.toContain('0 Errors')
    expect(bar).not.toContain('P99 180ms')
  })
})

describe('OSC 解析（与 xterm 无关的纯函数部分）', () => {
  it('133 的四种子序列都能落到模型上', () => {
    const m = createBlockModel()
    handleOsc133(m, 'A', 1)
    handleOsc133(m, 'B', 1)
    handleOsc133(m, 'C', 2)
    handleOsc133(m, 'D;127', 9)
    expect(lastBlock(m)).toMatchObject({ state: 'done', exitCode: 127 })
  })

  it('133;D 不带退出码时记 null，不记 0', () => {
    const m = createBlockModel()
    handleOsc133(m, 'A', 1)
    handleOsc133(m, 'D', 2)
    expect(lastBlock(m)?.exitCode).toBeNull()
  })

  it('未知子序列不改模型也不抛', () => {
    const m = createBlockModel()
    handleOsc133(m, 'X;1', 1)
    handleOsc633(m, 'Z', 1)
    expect(m.blocks).toHaveLength(0)
  })

  it('633;E 带分号的命令原文要完整保留（管道命令里有 ;）', () => {
    const m = createBlockModel()
    handleOsc133(m, 'A', 1)
    handleOsc633(m, 'E;cd /tmp; ls -la', 1)
    expect(lastBlock(m)?.command).toBe('cd /tmp; ls -la')
  })

  it('finishedBlocks 是 done 且有命令的子集', () => {
    const m = createBlockModel()
    handleOsc133(m, 'A', 1)
    handleOsc133(m, 'C', 2)
    handleOsc133(m, 'D;0', 3) // 无命令原文
    handleOsc133(m, 'A', 4)
    setCommandLine(m, 'echo hi', 4)
    handleOsc133(m, 'D;0', 5)
    expect(finishedBlocks(m).map((b) => b.command)).toEqual(['echo hi'])
  })
})
