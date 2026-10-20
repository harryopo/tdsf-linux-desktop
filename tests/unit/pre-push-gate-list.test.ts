/**
 * pre-push 闸清单的常驻判据（2026-10-20）
 *
 * 为什么要有这个文件：`.git/hooks/` 不入库，"钩子里装了哪几道闸"这句话原本没有任何执行体——
 * 少写一行、路径打错、脚本改名，本机的 push 只会少一道闸，而且 CI 看不见（CI 不 push）。
 * 2026-10-20 一天里两次把 master 的 CI 推红（都是"跑过门→又改文件→拿旧读数报全绿"），
 * 于是把 tests 类型闸加进 pre-push；加完就得有人盯着它别悄悄掉出去。
 *
 * 判据只认安装器里的 BLOCK 常量（它是唯一权威），不认 `.git/hooks/pre-push` ——
 * 那份是安装产物，别人机器上可能是旧版。
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const INSTALLER = join(ROOT, 'scripts/ai-coordination/install-hooks.cjs')
const src = readFileSync(INSTALLER, 'utf8')

/** 从 `const PUSH_BLOCK = [...]` 到 `].join` 之间取安装进 pre-push 的那几行 */
function pushBlock(): string {
  const m = src.match(/const PUSH_BLOCK = \[([\s\S]*?)\]\.join/)
  expect(m, '安装器里找不到 PUSH_BLOCK 常量——结构改了要同步这条判据').toBeTruthy()
  return m![1]
}

/** 提取块里点名的脚本路径（只认 `node "$repo_root/scripts/....cjs"` 这一种写法） */
function gateLines(block: string): string[] {
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith(`'node "$repo_root/`))
}

function scriptsIn(block: string): string[] {
  return [...gateLines(block).join('\n').matchAll(/repo_root\/(scripts\/[\w./-]+\.cjs)/g)].map((m) => m[1])
}

describe('pre-push 装了哪几道闸', () => {
  const block = pushBlock()
  const scripts = scriptsIn(block)

  it('四道闸一道不许少（少一道 = 那一类问题只能靠人记得）', () => {
    expect(scripts.sort()).toEqual(
      [
        'scripts/quality/tests-typecheck.cjs',
        'scripts/security/history-env-scan.cjs',
        'scripts/security/secret-gate.cjs',
        'scripts/security/topology-gate.cjs',
      ].sort()
    )
  })

  it('每一条都以 || exit 1 收尾（只跑不判退出码等于没装）', () => {
    const lines = gateLines(block)
    expect(lines.length, '抽取器一条闸行都没认出来，这条判据就是空转').toBeGreaterThan(0)
    for (const line of lines) {
      // 块里每行都是 JS 字符串字面量，所以结尾是 `exit 1',` —— 引号和逗号也要一起认，
      // 否则这条判据会因为"格式而不是语义"红
      expect(line, `这行没把失败传给 push：${line}`).toMatch(/\|\|\s*exit 1'?,$/)
    }
  })

  it('点名的脚本真的在仓库里（改名/删掉会让钩子静默跳过那道闸）', () => {
    for (const rel of scripts) {
      expect(() => readFileSync(join(ROOT, rel), 'utf8'), `pre-push 点名了 ${rel}，但文件不在`).not.toThrow()
    }
  })

  it('量具自己不是空转：往一段假块里塞一条就能抽出来', () => {
    // 合成样本必须与真块同形（JS 数组元素带前导单引号、行尾逗号），否则"抽取器认不得"
    // 会被演成"这段本来就没有闸"
    const synthetic = `'node "$repo_root/scripts/quality/tests-typecheck.cjs" || exit 1',`
    expect(scriptsIn(synthetic).length, '抽取器抽不到东西，上面三条就会假绿').toBe(1)
    expect(scriptsIn(`'echo 没有闸',`).length).toBe(0)
    expect(gateLines(`'echo 没有闸',`).length).toBe(0)
  })
})
