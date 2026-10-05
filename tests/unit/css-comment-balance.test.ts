/**
 * CSS 块注释配对横扫
 *
 * 触发原因：注释正文里写了「星号斜杠」的变量通配写法（radius 与 space 两族并列那种），
 * 把注释提前闭合，下一行声明就变成语法错误。这种错误在 CSS 里最阴——
 * 读文本的测试（令牌覆盖率、断链检查）全都不会报，只有打包时 postcss 才炸。
 * 所以按整类扫一遍：src 下每个 CSS 文件的 /* 与 *／ 必须成对且不倒序。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

function cssFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) cssFiles(p, acc)
    else if (e.name.endsWith('.css')) acc.push(p)
  }
  return acc
}

const files = cssFiles(path.join(ROOT, 'src'))

/**
 * 状态机扫一遍：CSS 块注释不嵌套，注释正文里的 /* 只是文字，
 * 只有星号斜杠才真的收尾。所以"注释外的星号斜杠"= 上一处被提前闭合的证据。
 * 早先按行配对数的写法把注释正文里的 /* 也算成开注释，误报了 20 多个文件。
 */
function commentErrors(text: string): { stray: number[]; unclosed: boolean } {
  const stray: number[] = []
  let inComment = false
  let line = 1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') {
      line++
      continue
    }
    const pair = ch + (text[i + 1] ?? '')
    if (pair === '/*') {
      if (inComment) continue // 注释内的 /* 是文字
      inComment = true
      i++
      continue
    }
    if (pair === '*/') {
      if (!inComment) stray.push(line)
      inComment = false
      i++
      continue
    }
  }
  return { stray, unclosed: inComment }
}

describe('CSS 注释配对', () => {
  it('扫到了 CSS 文件（不是空跑）', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('每个 CSS 文件的块注释都成对闭合', () => {
    const bad: string[] = []
    for (const f of files) {
      const { stray, unclosed } = commentErrors(fs.readFileSync(f, 'utf8'))
      const rel = path.relative(ROOT, f).replace(/\\/g, '/')
      if (stray.length) bad.push(`${rel} 注释在 ${stray.join(',')} 行被提前闭合`)
      if (unclosed) bad.push(`${rel} 到文件尾仍有未闭合注释`)
    }
    expect(bad, `注释配对问题：\n${bad.join('\n')}`).toEqual([])
  })
})
