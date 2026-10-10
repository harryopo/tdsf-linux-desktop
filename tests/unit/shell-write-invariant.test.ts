/**
 * A1 不变量：裸 shell write 只能是"人手敲的"
 *
 * `ssh:shell:write` 与 `local-tty:write` 在主进程都不做命令判定（逐键输入无法当整条命令
 * 评估），因此任何"命令由模型/决策记录起草"的路径都必须走对应的 run-authored
 * （`ssh:shell:run-authored` / `local-tty:run-authored`，过风险闸）。
 * 本机终端是 W3 新加的通道——只盯 sshShellWrite 等于给绕过留了一扇门，
 * 所以这里按同一套规则扫两条通道，而不是给本机终端另写一份。
 *
 * 这个测试读源码而不是跑起来，因为违规方式是"以后有人新增一处调用"。
 *
 * 为什么走 AST 而不是匹配 `sshShellWrite(` 字符串（计划 §A1 判据原话是"读 AST/引用表，不数字符串"）：
 * 起个别名就绕过去了 —— `const w = api.sshShellWrite; w(cmd)` 里根本没有
 * "sshShellWrite(" 这七个字符加括号。所以这里做**污点式引用追踪**：
 * 属性访问、`['sshShellWrite']` 下标、解构改名、以及从这些值再赋出去的局部变量，
 * 全都算引用点；连"没调用但把函数当值传出去"（escape）也算违规——能力一旦漏出对象就管不住了。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/** 以仓库根为基准（vitest 的 cwd 就是仓库根），避开 Windows 下 URL→路径的盘符坑 */
const RENDERER = join(process.cwd(), 'src', 'renderer', 'src')
/** 两条"人手敲的"裸写通道：远端与本机，规则一模一样 */
const RAW_WRITE_TARGETS = ['sshShellWrite', 'localTtyWrite']
/** 两条"代写命令"通道：都必须过主进程的风险闸 */
const AUTHORED_TARGETS = ['sshRunAuthored', 'localTtyRunAuthored']
/** 唯一允许直接碰 run-authored 的文件：终端启动器（界面只该调 resolveShellForCommand / runAuthoredInShell） */
const AUTHORED_OWNER = 'terminal/shell-launcher.ts'

/** 允许调用裸 write 的文件：只有这两处是用户手势直接驱动 */
const ALLOWED_RAW_WRITE = new Set([
  'components/terminal/TerminalView.tsx', // 用户键盘 onData
  'components/terminal/TerminalCompletionAddon.tsx', // 用户按 Tab 补全，插的是补全文本不是命令
])

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectSources(full, out)
    else if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full)
  }
  return out
}

type UseKind = 'call' | 'escape'
type Use = { line: number; kind: UseKind }

/** 这个表达式是不是"取到了这条裸 write"（含别名与下标写法） */
function isTargetExpr(node: ts.Node, target: string, aliases: Set<string>): boolean {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === target
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression
    return ts.isStringLiteral(arg) && arg.text === target
  }
  if (ts.isIdentifier(node)) return aliases.has(node.text)
  return false
}

/** 解构改名：`const { sshShellWrite: w } = api` 里的 w */
function aliasFromBindingElement(
  el: ts.BindingElement,
  target: string,
  aliases: Set<string>,
): string | null {
  const propName = el.propertyName ?? el.name
  if (!ts.isIdentifier(propName)) return null
  if (propName.text !== target && !aliases.has(propName.text)) return null
  return ts.isIdentifier(el.name) ? el.name.text : null
}

/**
 * "能力在不在"的存在性判断位（`if (!api?.sshShellWrite)`）不算使用：
 * 它既不发送也不把函数交出去。不区分就会把这种守卫报成违规（实测第一版就误报了 DecisionDetailPage）。
 */
function isProbePosition(node: ts.Node): boolean {
  const p = node.parent
  if (!p) return false
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return isProbePosition(p)
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind
    if (
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.InKeyword ||
      op === ts.SyntaxKind.InstanceOfKeyword
    ) {
      return true
    }
  }
  if (ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p) || ts.isForStatement(p)) return true
  if (ts.isConditionalExpression(p) && p.condition === node) return true
  return false
}

function analyze(fileName: string, src: string, target: string): Use[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const aliases = new Set<string>()

  // 先把所有变量声明收下来，再迭代到不动点——别名可以链式传递（const w2 = w）
  const decls: ts.VariableDeclaration[] = []
  sf.forEachChild(function walk(node: ts.Node): void {
    if (ts.isVariableDeclaration(node)) decls.push(node)
    node.forEachChild(walk)
  })
  let grew = true
  while (grew) {
    grew = false
    for (const d of decls) {
      const init = d.initializer
      if (!init) continue
      // const w = api.sshShellWrite / const w2 = w（别名链）
      if (ts.isIdentifier(d.name) && isTargetExpr(init, target, aliases) && !aliases.has(d.name.text)) {
        aliases.add(d.name.text)
        grew = true
      }
      // const { sshShellWrite: w } = api
      if (ts.isObjectBindingPattern(d.name)) {
        for (const el of d.name.elements) {
          if (!ts.isBindingElement(el)) continue
          const alias = aliasFromBindingElement(el, target, aliases)
          if (alias && !aliases.has(alias)) {
            aliases.add(alias)
            grew = true
          }
        }
      }
    }
  }

  const uses: Use[] = []
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  function visit(node: ts.Node): void {
    const parent = node.parent
    const isRef = isTargetExpr(node, target, aliases)
    if (isRef && parent && !isProbePosition(node)) {
      // `api.sshShellWrite` 里的 .name 只是属性名，不算一次引用（整个属性访问才是）
      const isPropName = ts.isPropertyAccessExpression(parent) && parent.name === node
      if (!isPropName) {
        const isCallee = ts.isCallExpression(parent) && parent.expression === node
        uses.push({ line: line(node), kind: isCallee ? 'call' : 'escape' })
      }
    }
    node.forEachChild(visit)
  }
  visit(sf)
  return uses
}

/** 扫全部渲染层源码，返回"引用了这条裸 write"的文件 → 引用点 */
function scanAll(target: string): Array<{ rel: string; uses: Use[] }> {
  const out: Array<{ rel: string; uses: Use[] }> = []
  for (const f of collectSources(RENDERER)) {
    const rel = f.slice(RENDERER.length + 1).replace(/\\/g, '/')
    if (rel.includes('.test.')) continue
    const uses = analyze(f, readFileSync(f, 'utf8'), target)
    if (uses.length > 0) out.push({ rel, uses })
  }
  return out
}

/** 某个文件里对 target 的真实调用次数（AST，不是字符串） */
function callCount(rel: string, target: string): number {
  const full = join(RENDERER, rel)
  return analyze(full, readFileSync(full, 'utf8'), target).filter((u) => u.kind === 'call').length
}

describe('裸 write 调用面（A1，AST 引用追踪，远端与本机两条通道同规则）', () => {
  for (const target of RAW_WRITE_TARGETS) {
    it(`${target}：渲染层只有用户手势路径引用裸 write，其余一律违规`, () => {
      const offenders = scanAll(target)
        .filter((x) => !ALLOWED_RAW_WRITE.has(x.rel))
        .map((x) => `${x.rel}:${x.uses.map((u) => `${u.line}(${u.kind})`).join(',')}`)
      expect(offenders, `AI 起草的路径不许碰裸 write：${offenders.join(' | ')}`).toEqual([])
    })
  }

  it('白名单按整个裸 write 面成立：引用任一通道的文件集合必须正好等于白名单', () => {
    expect(ALLOWED_RAW_WRITE.size).toBeGreaterThan(0)
    const users = new Set<string>()
    for (const target of RAW_WRITE_TARGETS) for (const x of scanAll(target)) users.add(x.rel)
    expect([...users].sort(), '白名单过期（多了要收紧，少了说明有人在裸写）').toEqual(
      [...ALLOWED_RAW_WRITE].sort(),
    )
    // 注入自证：白名单里每个文件必须真的在调用，不是只把函数取了一下
    for (const allowed of ALLOWED_RAW_WRITE) {
      const calls = RAW_WRITE_TARGETS.reduce((n, t) => n + callCount(allowed, t), 0)
      expect(calls, `${allowed} 应当真的在调用裸 write`).toBeGreaterThan(0)
    }
  })

  it('别名写法必须被抓住；存在性判断位不算使用（这条是"为什么不数字符串"的自证）', () => {
    const src = [
      'const api = window.electronAPI',
      'const w = api.sshShellWrite',
      'w("rm -rf /")',
      'api.sshShellWrite("ls")',
      "api['sshShellWrite']('pwd')",
      'if (!api?.sshShellWrite) {',
      '  return',
      '}',
    ].join('\n')
    const kinds = analyze('probe.tsx', src, 'sshShellWrite').map((u) => `${u.line}:${u.kind}`)
    // 别名调用 / 直接调用 / 下标调用 + 把函数取出来那一次 escape
    expect(kinds.length).toBeGreaterThanOrEqual(4)
    expect(kinds).toContain('3:call')
    expect(kinds).toContain('4:call')
    expect(kinds).toContain('5:call')
    // 第 6 行是 `if (!api?.sshShellWrite)`：守卫不是违规，误伤它这条闸就没人信了
    expect(kinds.filter((k) => k.startsWith('6:'))).toEqual([])
  })

  it('阴性对照：本机通道的别名写法同样被抓（防"只扫了 ssh 那条"的假绿）', () => {
    const src = [
      'const api = window.electronAPI',
      'const w = api.localTtyWrite',
      'w("rm -rf /")',
      'if (!api?.localTtyWrite) return',
    ].join('\n')
    const kinds = analyze('probe.tsx', src, 'localTtyWrite').map((u) => `${u.line}:${u.kind}`)
    expect(kinds).toContain('3:call')
    expect(kinds.filter((k) => k.startsWith('4:'))).toEqual([])
  })
})

describe('代写命令只有一个出口（W3 收口）', () => {
  it('除 shell-launcher 外，任何文件不许直接调 run-authored', () => {
    const offenders: string[] = []
    for (const f of collectSources(RENDERER)) {
      const rel = f.slice(RENDERER.length + 1).replace(/\\/g, '/')
      if (rel.includes('.test.') || rel === AUTHORED_OWNER) continue
      for (const target of AUTHORED_TARGETS) {
        const uses = analyze(f, readFileSync(f, 'utf8'), target).filter((u) => u.kind === 'call')
        if (uses.length > 0) offenders.push(`${rel}:${uses.map((u) => u.line).join(',')}(${target})`)
      }
    }
    expect(
      offenders,
      `界面必须走 runAuthoredInShell，别绕过本机/远端分流：${offenders.join(' | ')}`,
    ).toEqual([])
  })

  it('shell-launcher 两条 run-authored 都真的调了（少一条就是本机或远端断了）', () => {
    for (const target of AUTHORED_TARGETS) {
      expect(callCount(AUTHORED_OWNER, target), `必须调用 ${target}`).toBeGreaterThan(0)
    }
  })
})
