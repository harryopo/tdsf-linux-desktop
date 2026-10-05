/**
 * 禁止把编出来的数字显示给用户
 *
 * 这个产品对外承诺"可信决策"，界面上出现一条来历不明的记录，
 * 用户就没法再相信其它记录是真的。所以凡是本轮清掉的假数据，
 * 都在这里留一条断言，防止以后又被塞回来。
 *
 * 判据是"源码里不许出现这些字面量"，不是"运行时看起来正常"——
 * 假数据一旦进 JSX，运行时也是"看起来正常"。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const RENDERER = path.join(ROOT, 'src/renderer/src')

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p)
  }
  return acc
}

const files = walk(RENDERER)

/** 曾经真实出现在界面上的编造值：主机名、统计数、延迟、错误数 */
const BANNED = ['prod-web-01', 'prod-db-02', 'backup-01', 'staging-web', '94.3%', 'P99 180ms', 'MOCK_CHAT_MESSAGES']

describe('渲染层不许出现编造数据', () => {
  it('扫到了页面文件（不是空跑）', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('历史决策页不再自带示例记录', () => {
    const src = fs.readFileSync(path.join(RENDERER, 'pages/HistoryPage.tsx'), 'utf8')
    expect(src).not.toMatch(/DEFAULT_RECORDS|DEFAULT_STATS/)
    // 统计卡必须由 IPC 或当前记录派生，不许写基线值
    expect(src).not.toMatch(/value:\s*'247'/)
  })

  it('状态栏不写死错误数与延迟', () => {
    const src = fs.readFileSync(path.join(RENDERER, 'components/workbench/StatusBar.tsx'), 'utf8')
    expect(src).not.toContain('0 Errors')
    expect(src).not.toContain('P99 180ms')
  })

  it('全渲染层没有那批假主机名与假统计值', () => {
    const hits: string[] = []
    for (const f of files) {
      // 只看代码：本轮清掉假数据时，注释里会提到被删的值（"移除原硬编码的 94.3%"），
      // 那是记录处置过程，不是回流
      const text = fs
        .readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      for (const bad of BANNED) {
        if (text.includes(bad)) hits.push(`${path.relative(ROOT, f).replace(/\\/g, '/')} → ${bad}`)
      }
    }
    expect(hits, `疑似编造数据回流：\n${hits.join('\n')}`).toEqual([])
  })
})
