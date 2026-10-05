/**
 * 界面里不许用表情符号（阶段 E5 的收尾判据）
 *
 * 表情在桌面工具里有三个实际毛病：屏幕阅读器念出来是"警告标志""红圈"这类噪声；
 * 复制粘贴到别的终端/日志里可能变乱码；不同系统字形不一致，看起来就不是一套 UI。
 * 状态一律用文字（"已拦截""成功"）或 lucide 图标。
 *
 * 扫描范围与 scripts/design/tokens-audit.cjs 的 emoji 统计保持一致，
 * 这样"审计打印 0"和"测试绿"说的是同一件事。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/gu

function files(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) files(p, acc)
    else if (/\.(ts|tsx|css)$/.test(e.name)) acc.push(p)
  }
  return acc
}

const targets = [...files(path.join(ROOT, 'src/renderer/src')), ...files(path.join(ROOT, 'src/shared'))]

describe('界面不用表情符号', () => {
  it('扫到了源码文件（不是空跑）', () => {
    expect(targets.length).toBeGreaterThan(100)
  })

  it('src/renderer 与 src/shared 的 emoji 命中为 0', () => {
    const hits: string[] = []
    for (const f of targets) {
      fs.readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          const m = line.match(EMOJI_RE)
          if (m) hits.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1} ${m.join('')}`)
        })
    }
    expect(hits, `表情符号回流：\n${hits.join('\n')}`).toEqual([])
  })
})
