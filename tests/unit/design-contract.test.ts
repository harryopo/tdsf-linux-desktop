/**
 * 设计契约闸（DESIGN.md ↔ 代码）
 *
 * 真正的判定逻辑在 scripts/design/design-contract.mjs，这里只做两件事：
 * 1) 把它接进 pnpm test，让"文档和令牌漂移"跟单元测试失败同权重；
 * 2) 断言这个闸本身不是空跑（负向对照见下）。
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const SCRIPT = path.join(ROOT, 'scripts/design/design-contract.mjs')

function runContract() {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--json'], { cwd: ROOT, encoding: 'utf8' })
    return { code: 0, json: JSON.parse(out) }
  } catch (e) {
    return { code: e.status ?? 1, json: JSON.parse(e.stdout || '{}'), stderr: e.stderr || '' }
  }
}

describe('设计契约（DESIGN.md 与代码同源）', () => {
  it('当前全部条款成立', () => {
    const r = runContract()
    expect(r.json.problems, (r.json.problems || []).join('\n')).toEqual([])
    expect(r.code).toBe(0)
  })

  it('闸确实扫到了条款，不是空跑（负向对照）', () => {
    const r = runContract()
    // 债务刻度三条 + 页面自写 h1 一条，少一条说明某个 grep 或解析失效了
    expect(r.json.notes.length, `只回收到 ${r.json.notes.length} 条刻度记录`).toBeGreaterThanOrEqual(3)
  })

  it('把文档数字改错，闸必须报漂移（证明它真的在比对）', () => {
    const file = path.join(ROOT, 'DESIGN.md')
    const original = fs.readFileSync(file, 'utf8')
    const broken = original.replace('`--ui-font-micro` | 11px', '`--ui-font-micro` | 12px')
    expect(broken, '测试夹具没改到东西：DESIGN.md 的字阶表格式变了').not.toBe(original)
    fs.writeFileSync(file, broken, 'utf8')
    try {
      const r = runContract()
      expect(r.code, '改错文档数字后闸仍然放行 = 这条闸是摆设').not.toBe(0)
      expect(r.json.problems.join('\n')).toMatch(/--ui-font-micro：DESIGN\.md 写 12px/)
    } finally {
      fs.writeFileSync(file, original, 'utf8')
    }
  })
})
