/**
 * CI 里跑的每一把门，本地必须有一条脚本能叫得动它（2026-10-25 #215）
 *
 * 起因是一笔真实的 CI 连红：`scripts/quality/scripts-syntax-check.cjs` 的受检文件下限
 * 只有 CI 跑，本地那串 `lint && typecheck && … && test` 里没有它。#211 整删一次性脚本时
 * 少调了这把下限（53 → 实际 51），于是本地每次都是"全绿再提交"，远端从那一笔起连红三轮，
 * 而红话（"扫描面缩了"）说的正是我自己删掉的那几个文件。
 *
 * 判据不是"记得跑一下"——那句话没有执行体，下次照样漏。它钉的是形状：
 * `.github/workflows/ci.yml` 里每一条 `node scripts/...` 都必须原样出现在某个 npm 脚本里，
 * 这样"只在 CI 存在的门"这一整类结构盲区当场变红。
 *
 * 两条自证：① 抽取面必须真的抓到东西（少于 7 条就是取数坏了，不是"CI 很干净"）；
 * ② 造一条不存在的命令喂进同一个判定，它必须被判为"没覆盖"——否则这条判据恒真。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const WORKFLOW = path.join(ROOT, '.github/workflows/ci.yml')

/** CI 里以 `node scripts/...` 形式直接跑的门（不走 pnpm 别名的那批） */
function ciGateCommands(): string[] {
  const yml = fs.readFileSync(WORKFLOW, 'utf8')
  const out = new Set<string>()
  for (const raw of yml.split(/\r?\n/)) {
    // 两种写法都要认：块量里的裸命令行，和 `- run: node scripts/...` 这种一行式
    const line = raw
      .replace(/^\s*(?:-\s+)?run:\s*/, '')
      .replace(/^['"]|['"]\s*$/g, '')
      .trim()
    if (/^node\s+scripts\//.test(line) && !line.startsWith('#')) out.add(line)
  }
  return [...out].sort()
}

function npmScriptBodies(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  return Object.values(pkg.scripts)
}

describe('CI 门与本地脚本的对账（#215）', () => {
  const gates = ciGateCommands()

  it('取数面自证：CI 里那些 node 直跑的门真的被抓到了', () => {
    expect(gates.length, '一条都没抓到，说明工作流的写法变了，这条判据已经失明').toBeGreaterThanOrEqual(7)
    // 这几把是本轮真在 CI 里直跑的，抓不到就是正则的问题
    for (const probe of [
      'node scripts/quality/scripts-syntax-check.cjs',
      'node scripts/quality/doc-links.cjs --self-test',
      'node scripts/security/secret-gate.cjs --all',
    ]) {
      expect(gates, `CI 里明明有这一步却没被抓到：${probe}`).toContain(probe)
    }
  })

  it('每一条都必须能从 package.json 的某个脚本里叫动（不许再有"只在 CI 跑"的门）', () => {
    const bodies = npmScriptBodies()
    const orphan = gates.filter((g) => !bodies.some((v) => v.includes(g)))
    expect(
      orphan,
      `这些门只有 CI 会跑，本地喊一声"门禁全绿"就绕过去了：\n${orphan.join('\n')}\n` +
        '补进 package.json 的 gates:ci（或那把门自己的别名脚本）里。'
    ).toEqual([])
  })

  it('阳性对照：没被任何脚本覆盖的命令必须被判成孤儿', () => {
    const bodies = npmScriptBodies()
    const fake = 'node scripts/quality/zz-definitely-not-a-gate.cjs'
    expect(bodies.some((v) => v.includes(fake)), '这条假命令被判成"已覆盖"，说明匹配是恒真的').toBe(false)
    // 反向也要成立：真在用的那一条不许被误判成孤儿
    expect(bodies.some((v) => v.includes('node scripts/quality/doc-links.cjs --self-test'))).toBe(true)
  })
})
