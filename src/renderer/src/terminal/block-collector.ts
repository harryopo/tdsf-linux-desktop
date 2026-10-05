/**
 * 命令块收集器（xterm 侧接线）
 *
 * 规矩（写进 AGENTS.md，并有链测试钉住）：
 *   注册 OSC handler 一律 return false。
 * 原因是 xterm 的 OSC 链按"同 id 后注册的先调用"，谁先 return true 链就断，
 * 后面的 handler 与 xterm 内建处理都收不到——主力项目栽过一次：
 * 本地终端一条命令块都产不出来，SSH 侧因为注册顺序侥幸没事。
 * 我们只"旁听"这些序列，不接管，所以永远返回 false。
 */
import type { IDisposable, Terminal } from '@xterm/xterm'
import {
  markCommandEnd,
  markCommandStart,
  markOutput,
  markPrompt,
  setCommandLine,
  setProperty,
  type BlockModel,
} from './block-model'

/** 解析 OSC 133 载荷：A / B / C / D;<exit> */
export function handleOsc133(m: BlockModel, data: string, row: number): void {
  const [sub, ...rest] = data.split(';')
  const value = rest.join(';')
  switch (sub) {
    case 'A':
      markPrompt(m, row)
      return
    case 'B':
      markCommandStart(m, row)
      return
    case 'C':
      markOutput(m, row)
      return
    case 'D': {
      const exit = value === '' ? null : Number.parseInt(value, 10)
      markCommandEnd(m, row, Number.isFinite(exit as number) ? (exit as number) : null)
      return
    }
    default:
      // 未知子序列：不改模型，但仍要让 xterm 继续处理（调用方返回 false）
      return
  }
}

/** 解析 OSC 633 载荷（VS Code 系 shell integration）：E=命令原文，P=属性 */
export function handleOsc633(m: BlockModel, data: string, row: number): void {
  const [sub, ...rest] = data.split(';')
  const value = rest.join(';')
  switch (sub) {
    case 'E':
      if (value) setCommandLine(m, value, row)
      return
    case 'P':
      if (value) setProperty(m, value)
      return
    default:
      return
  }
}

/** 当前光标所在的 buffer 绝对行（含滚出屏幕的部分） */
function cursorRow(term: Terminal): number {
  const b = term.buffer.active
  return b.baseY + b.cursorY
}

/**
 * 挂上收集器。返回的 dispose 只撤我们自己的两个 handler，
 * 不动 xterm 内建行为（见文件头的 return false 规矩）。
 */
export function attachBlockCollector(
  term: Terminal,
  model: BlockModel,
  onChange: (m: BlockModel) => void
): IDisposable {
  const h133 = term.parser.registerOscHandler(133, (data: string) => {
    handleOsc133(model, data, cursorRow(term))
    onChange(model)
    return false
  })
  const h633 = term.parser.registerOscHandler(633, (data: string) => {
    handleOsc633(model, data, cursorRow(term))
    onChange(model)
    return false
  })
  return {
    dispose: () => {
      h133.dispose()
      h633.dispose()
    },
  }
}
