/**
 * A1 不变量：裸 shell write 只能是"人手敲的"
 *
 * `ssh:shell:write` 在主进程不做命令判定（逐键输入无法当整条命令评估），
 * 因此任何"命令由模型/决策记录起草"的路径都必须走 `ssh:shell:run-authored`（过风险闸）。
 * 这个测试读源码而不是跑起来，因为违规方式是"以后有人新增一处调用"。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 以仓库根为基准（vitest 的 cwd 就是仓库根），避开 Windows 下 URL→路径的盘符坑 */
const RENDERER = join(process.cwd(), 'src', 'renderer', 'src')

/** 允许调用裸 write 的文件：只有这两处是用户手势直接驱动 */
const ALLOWED_RAW_WRITE = new Set([
  'components/terminal/TerminalView.tsx', // 用户键盘 onData
  'components/terminal/TerminalCompletionAddon.tsx', // 用户按 Tab 补全，插的是补全文本不是命令
])

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectTsx(full, out)
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full)
  }
  return out
}

describe('sshShellWrite 调用面（A1）', () => {
  it('渲染层只有用户手势路径调用裸 write，AI 起草的路径一律走 run-authored', () => {
    const files = collectTsx(RENDERER)
    const offenders: string[] = []
    for (const f of files) {
      const rel = f.slice(RENDERER.length + 1).replace(/\\/g, '/')
      if (rel.includes('types/electron.d.ts') || rel.includes('.test.')) continue
      const src = readFileSync(f, 'utf8')
      if (/sshShellWrite\s*\(/.test(src) && !ALLOWED_RAW_WRITE.has(rel)) {
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  it('白名单本身不为空（防止有人把规则删光让测试恒绿）', () => {
    expect(ALLOWED_RAW_WRITE.size).toBeGreaterThan(0)
    const files = collectTsx(RENDERER)
    const users = files
      .map((f) => ({ rel: f.slice(RENDERER.length + 1).replace(/\\/g, '/'), src: readFileSync(f, 'utf8') }))
      .filter((x) => /sshShellWrite\s*\(/.test(x.src) && !x.rel.includes('types/electron.d.ts'))
      .map((x) => x.rel)
    // 白名单里的文件必须真的在调用，否则说明清单过期
    for (const allowed of ALLOWED_RAW_WRITE) {
      expect(users, `${allowed} 已不再调用 sshShellWrite，请同步收紧白名单`).toContain(allowed)
    }
  })

  it('AI 面板确实改用 run-authored', () => {
    const src = readFileSync(join(RENDERER, 'components/workbench/AIPanel.tsx'), 'utf8')
    expect(src).toContain('sshRunAuthored(')
  })
})
