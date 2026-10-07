/**
 * 死按钮静态闸（0 容忍）
 *
 * 判据来源：2026-10-07 按钮真伪普查（tests/e2e/button-truth-census.spec.ts）首轮报出
 * 11 个「按了没反应」的按钮，逐个核实后归成三类成因：
 *   1. 只读读数被写成 <button>（状态栏的 SSH/AI/光标/编码/命令块）——读屏会报出一个
 *      按不动的按钮，用户按下去也确实什么都没发生；
 *   2. 真死按钮（教程「查看全部学习路径」：没有第二个视图可去）；
 *   3. 空输入下的动作钮（教程「搜索」：检索词为空时直接 return）。
 * 三类都已修。普查要 6 分钟且依赖打包产物，这条静态扫把同一件事变成毫秒级红灯，
 * 新人再写一个没有 onClick 的 <button> 时当场就能被拦下。
 *
 * 只扫原生 <button> 开标签；<Button>/<Chip> 等原语组件由调用方传 onClick，
 * 静态扫看不到，那部分由普查覆盖。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const RENDERER = path.resolve(__dirname, '../../src/renderer/src')

/** 遍历 .tsx（跳过产物目录） */
function listTsx(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'out' || name === 'dist') continue
      listTsx(full, out)
    } else if (name.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** 去掉块注释与行注释——注释里写的 <button> 不是界面 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 从 '<button' 的下标取出它的开标签（按大括号深度找到不被表达式吃掉的 '>'） */
function openTag(text: string, start: number): string {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return text.slice(start, i + 1)
  }
  return text.slice(start)
}

/** 开标签里带这些就算有反应：事件、提交、透传 props、或本来就是禁用态 */
const HANDLED = /onClick|onSelect|onChange|type="submit"|\{\.\.\.|disabled/

function findDeadButtons(): string[] {
  const hits: string[] = []
  for (const file of listTsx(RENDERER)) {
    const text = stripComments(fs.readFileSync(file, 'utf8'))
    let idx = -1
    while ((idx = text.indexOf('<button', idx + 1)) !== -1) {
      const next = text[idx + 7]
      if (next && /[A-Za-z]/.test(next)) continue // 形如 <buttons 的标签，不算
      const tag = openTag(text, idx)
      if (HANDLED.test(tag)) continue
      const line = text.slice(0, idx).split(/\r?\n/).length
      hits.push(`${path.relative(RENDERER, file)}:${line}  ${tag.replace(/\s+/g, ' ').slice(0, 100)}`)
    }
  }
  return hits
}

describe('原生 button 必须有反应', () => {
  const dead = findDeadButtons()

  it('扫描真的跑到了东西（不是空扫报假绿）', () => {
    // 抽查阳性对照：全仓确实存在大量原生 button，若扫到 0 个说明解析挂了
    let total = 0
    for (const file of listTsx(RENDERER)) {
      const text = stripComments(fs.readFileSync(file, 'utf8'))
      total += (text.match(/<button(?![A-Za-z])/g) ?? []).length
    }
    expect(total, '渲染层应能扫到原生 <button>').toBeGreaterThan(20)
  })

  it('没有既没有事件处理、也不是 disabled 的原生按钮', () => {
    expect(dead, '按了不会有任何反应的 <button>：\n' + dead.join('\n')).toEqual([])
  })
})
