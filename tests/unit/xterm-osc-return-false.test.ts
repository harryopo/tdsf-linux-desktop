/**
 * xterm OSC handler 规矩：一律 return false
 *
 * 为什么要有这条（并写成测试）：
 * xterm 的 OSC 分发按"同一 id 后注册的先被调用"，回调返回 true 表示"我已处理，别再往下传"，
 * 于是**谁先 return true，后面的 handler 和 xterm 内建处理就全收不到**。
 * 主力项目 tdsf-terminal-agent-clone 栽过一次：本地终端一条命令块都产不出来，
 * SSH 侧因为注册顺序不同而侥幸没事——这种"只坏一半"的 bug 最难查。
 *
 * 我们的立场：所有 OSC handler 只旁听，不接管，因此一律 return false。
 * 这条判据同时检查 AGENTS.md 里规矩的文字还在（文档与测试不能只留一份）。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'out') continue
      tsFiles(p, acc)
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      acc.push(p)
    }
  }
  return acc
}

/** 从 index 处的 '{' 起做花括号配对，返回整个块体（含首尾花括号） */
function braceBlock(text: string, index: number): string {
  let depth = 0
  for (let i = index; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(index, i + 1)
    }
  }
  return text.slice(index)
}

/** 收集源码里所有 registerOscHandler 的回调体 */
function oscHandlers(): { file: string; line: number; body: string }[] {
  const out: { file: string; line: number; body: string }[] = []
  for (const f of tsFiles(path.join(ROOT, 'src'))) {
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(/registerOscHandler\s*\(/g)) {
      const open = text.indexOf('{', m.index!)
      if (open === -1) continue
      const line = text.slice(0, m.index).split('\n').length
      out.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), line, body: braceBlock(text, open) })
    }
  }
  return out
}

describe('OSC handler 必须 return false', () => {
  const handlers = oscHandlers()

  it('至少有一个 handler（规矩不能只对空气生效）', () => {
    expect(handlers.length, 'src 下没找到任何 registerOscHandler，说明块收集器没接线').toBeGreaterThan(0)
  })

  it('每个 handler 的回调体都以 return false 收尾，且不许出现 return true', () => {
    const bad: string[] = []
    for (const h of handlers) {
      if (!/return\s+false\s*;?\s*\}$/.test(h.body)) bad.push(`${h.file}:${h.line} 末尾不是 return false`)
      if (/return\s+true/.test(h.body)) bad.push(`${h.file}:${h.line} 出现了 return true（会掐断 OSC 链）`)
    }
    expect(bad, `违反 return false 规矩：\n${bad.join('\n')}`).toEqual([])
  })

  it('AGENTS.md 里这条规矩的文字还在', () => {
    const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('return false')
    expect(agents).toContain('registerOscHandler')
  })
})

/**
 * 「读屏只能读 term.buffer.active」这条也得有闸。
 *
 * AGENTS.md 把这句话写成规矩，但一直没有断言 —— 和"五个审批入口都走严格判定"同一个形状：
 * 规矩只在散文里，违反的人谁都不会报。xterm 的 buffer 有两个（normal / alternate），
 * 全屏程序（vim/top）切到 alternate 时读 normal 会拿到一屏旧内容；
 * 而 .xterm 的 innerText 在 WebGL/canvas 渲染器下恒空，静默失效更糟。
 */
describe('读屏只能走 term.buffer.active', () => {
  /**
   * src 下所有"从 xterm 终端对象取 buffer"的出现处
   *
   * 必须限定宿主：`messageSync.ts` 里也有 `.buffer`（增量合并用的 Map），
   * 不加限定第一版就把这种同名写法误报成违规（判据量错了东西，比没有判据更糟）。
   */
  function bufferReads(): { file: string; line: number; after: string }[] {
    const out: { file: string; line: number; after: string }[] = []
    for (const f of tsFiles(path.join(ROOT, 'src'))) {
      const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
      lines.forEach((ln, i) => {
        for (const m of ln.matchAll(/(?<=\b(?:term|terminal|xterm))\.buffer\b/g)) {
          out.push({
            file: path.relative(ROOT, f).replace(/\\/g, '/'),
            line: i + 1,
            after: ln.slice(m.index),
          })
        }
      })
    }
    return out
  }

  const reads = bufferReads()

  it('至少有一个读屏点（闸不能只对空气生效）', () => {
    expect(reads.length, 'src 下没有任何从终端对象取 buffer 的写法，说明终端读屏没接线').toBeGreaterThan(0)
  })

  it('每一处 .buffer 都紧跟 .active', () => {
    const bad = reads
      .filter((r) => !/^\.buffer\.active\b/.test(r.after))
      .map((r) => `${r.file}:${r.line} -> ${r.after.trim().slice(0, 60)}`)
    expect(bad, `绕过 buffer.active 的读屏写法：\n${bad.join('\n')}`).toEqual([])
  })

  it('不许用 DOM 的 innerText 读终端屏幕（WebGL 渲染器下恒空）', () => {
    const bad: string[] = []
    for (const f of tsFiles(path.join(ROOT, 'src/renderer/src/terminal'))) {
      const text = fs.readFileSync(f, 'utf8')
      if (/xterm['"]?\)?\.innerText|\.xterm\.innerText/.test(text)) {
        bad.push(path.relative(ROOT, f).replace(/\\/g, '/'))
      }
    }
    expect(bad, `从 DOM 读终端内容：\n${bad.join('\n')}`).toEqual([])
  })
})
