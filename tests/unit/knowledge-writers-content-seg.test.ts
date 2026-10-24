/**
 * 常驻闸：任何写 knowledge_entries 的地方都要带上 contentSeg（#181）
 *
 * 为什么需要这条静态闸：FTS 只索引 contentSeg 这一列，漏写一次的后果不是报错，
 * 而是"这条知识在中文全文检索里静默不存在"——单测与界面都看不出来。
 * 改造时就有 5 处插入/更新（仓储、两套种子、教程爬取两条路径），
 * 靠人记着"下次新增写入也要加"是不成立的。
 *
 * 规则（按结构取数，不钉具体字符串）：
 *   - 每个 `INSERT [OR REPLACE] INTO knowledge_entries` 所在文件必须提到 contentSeg；
 *   - 每个 `UPDATE knowledge_entries SET ...` 且同时改 title/problem 的，也必须提到 contentSeg
 *     （只改 embedding 的更新不算——它不动被索引的文本）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../src/main')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}

describe('知识库写入方都带全文检索列', () => {
  it('插入与改文本的更新都写 contentSeg', () => {
    const inserters: string[] = []
    const textUpdaters: string[] = []
    const missing: string[] = []

    for (const file of walk(ROOT)) {
      const text = readFileSync(file, 'utf8')
      const rel = relative(ROOT, file).replace(/\\/g, '/')
      const inserts = /INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+knowledge_entries/i.test(text)
      // 只看真的在改被索引字段的 UPDATE；只写 embedding 列的那种不算
      const updateBlocks = [...text.matchAll(/UPDATE\s+knowledge_entries\s+SET([\s\S]{0,600}?)WHERE/gi)]
      const textUpdate = updateBlocks.some((m) => /title|problem/i.test(m[1]))
      const hasSeg = /\bcontentSeg\b/.test(text)

      if (inserts) {
        inserters.push(rel)
        if (!hasSeg) missing.push(`${rel}（有 INSERT 但没写 contentSeg）`)
      }
      if (textUpdate) {
        textUpdaters.push(rel)
        if (!hasSeg) missing.push(`${rel}（改了 title/problem 但没写 contentSeg）`)
      }
    }

    // 量具自证：扫描面必须真的扫到了写入方，否则"0 处遗漏"是空跑
    expect(inserters.length, '没扫到任何插入方，闸等于没跑').toBeGreaterThanOrEqual(3)
    expect(textUpdaters.length, '没扫到任何改文本的更新方，闸等于没跑').toBeGreaterThanOrEqual(2)
    expect(missing, `这些写入方会让条目在中文检索里静默消失：${missing.join('；')}`).toEqual([])
  })
})
