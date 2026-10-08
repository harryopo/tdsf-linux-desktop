/**
 * A1 不变量：裸 shell write 只能是"人手敲的"
 *
 * `ssh:shell:write` 在主进程不做命令判定（逐键输入无法当整条命令评估），
 * 因此任何"命令由模型/决策记录起草"的路径都必须走 `ssh:shell:run-authored`（过风险闸）。
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
const TARGET = 'sshShellWrite'
/** 另一个名字，A1 之后 AI 路径唯一该用的那个 */
const AUTHORED = 'sshRunAuthored'

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

/** 这个表达式是不是"取到了裸 write"（含别名与下标写法） */
function isTargetExpr(node: ts.Node, aliases: Set<string>): boolean {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === TARGET
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression
    return ts.isStringLiteral(arg) && arg.text === TARGET
  }
  if (ts.isIdentifier(node)) return aliases.has(node.text)
  return false
}

/** 解构改名：`const { sshShellWrite: w } = api` 里的 w */
function aliasFromBindingElement(el: ts.BindingElement, aliases: Set<string>): string | null {
  const propName = el.propertyName ?? el.name
  if (!ts.isIdentifier(propName)) return null
  if (propName.text !== TARGET && !aliases.has(propName.text)) return null
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

function analyze(fileName: string, src: string): Use[] {
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
      if (ts.isIdentifier(d.name) && isTargetExpr(init, aliases) && !aliases.has(d.name.text)) {
        aliases.add(d.name.text)
        grew = true
      }
      // const { sshShellWrite: w } = api
      if (ts.isObjectBindingPattern(d.name)) {
        for (const el of d.name.elements) {
          if (!ts.isBindingElement(el)) continue
          const alias = aliasFromBindingElement(el, aliases)
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
    const isRef = isTargetExpr(node, aliases)
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

function scanAll(): Array<{ rel: string; uses: Use[] }> {
  const out: Array<{ rel: string; uses: Use[] }> = []
  for (const f of collectSources(RENDERER)) {
    const rel = f.slice(RENDERER.length + 1).replace(/\\/g, '/')
    if (rel.includes('.test.')) continue
    const uses = analyze(f, readFileSync(f, 'utf8'))
    if (uses.length > 0) out.push({ rel, uses })
  }
  return out
}

describe('sshShellWrite 调用面（A1，AST 引用追踪）', () => {
  it('渲染层只有用户手势路径引用裸 write，其余一律违规', () => {
    const offenders = scanAll()
      .filter((x) => !ALLOWED_RAW_WRITE.has(x.rel))
      .map((x) => `${x.rel}:${x.uses.map((u) => `${u.line}(${u.kind})`).join(',')}`)
    expect(offenders, `AI 起草的路径不许碰裸 write：${offenders.join(' | ')}`).toEqual([])
  })

  it('白名单不为空，且里面每个文件真的在引用（清单过期就要收紧）', () => {
    expect(ALLOWED_RAW_WRITE.size).toBeGreaterThan(0)
    const users = new Map(scanAll().map((x) => [x.rel, x.uses]))
    for (const allowed of ALLOWED_RAW_WRITE) {
      const uses = users.get(allowed)
      expect(uses, `${allowed} 已不再引用 sshShellWrite，请同步收紧白名单`).toBeDefined()
      expect(uses!.some((u) => u.kind === 'call'), `${allowed} 应当是直接调用`).toBe(true)
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
    const kinds = analyze('probe.tsx', src).map((u) => `${u.line}:${u.kind}`)
    // 别名调用 / 直接调用 / 下标调用 + 把函数取出来那一次 escape
    expect(kinds.length).toBeGreaterThanOrEqual(4)
    expect(kinds).toContain('3:call')
    expect(kinds).toContain('4:call')
    expect(kinds).toContain('5:call')
    // 第 6 行是 `if (!api?.sshShellWrite)`：守卫不是违规，误伤它这条闸就没人信了
    expect(kinds.filter((k) => k.startsWith('6:'))).toEqual([])
  })

  it('AI 面板确实改用 run-authored（AST 级：必须是真调用）', () => {
    const src = readFileSync(join(RENDERER, 'components/workbench/AIPanel.tsx'), 'utf8')
    const sf = ts.createSourceFile('AIPanel.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let called = 0
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === AUTHORED) called++
      node.forEachChild(visit)
    }
    visit(sf)
    expect(called, `AIPanel 里 ${AUTHORED} 的真实调用数`).toBeGreaterThan(0)
  })
})
