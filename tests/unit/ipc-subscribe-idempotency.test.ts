/**
 * W0 结构判据：挂在长生命周期事件源上的订阅必须能被摘掉
 *
 * 缺陷成因是"重复注册时订阅成倍叠加"：ipcMain.handle 重复注册会抛错，所以老代码靠
 * 先 removeHandler 再重注册来实现幂等；但直接 on() 到 SshConnectionManager /
 * SystemMonitor / McpGateway / 子 agent EventEmitter 上的转发回调没人摘，
 * 于是每重注册一轮，同一份数据就多推一次。
 *
 * 为什么读 AST 而不是跑起来：违规方式是"以后有人再加一处订阅，加了但没接卸载"，
 * 那种改动不会让现有行为测试变红（第一次注册看着是对的）。字符串匹配也不够——
 * 把返回值赋给一个没人调的变量，字符串上看着"接住了"，实际仍是叠加。
 * 所以判据落在结构上：**订阅调用不许是裸表达式语句**，必须被包进 push/赋值给最终
 * 会被返回的收纳处；ipc/index.ts 那侧必须真的把这四个模块的返回值收进 disposers。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()

/**
 * 需要在注册函数里可退订的订阅方法名
 *
 * 不含 onSessionClosed：那是"资源持有者自己回收"的订阅，按设计挂在实例创建处、
 * 跟着单例寿命走（monitor.ts 里写了理由），不该被这条规则逼进注册级 disposer。
 *
 * 不含 EventEmitter 的 .on：它的返回值本来就不是卸载函数（是 emitter 自己），
 * 收返回值没有意义，所以那条走另一条判据——同一个接收者必须同时出现 .off。
 */
const SUBSCRIPTIONS = [
  'onStateChanged',
  'onShellData',
  'onMonitorData',
  'onSystemInfo',
  'subscribeLifecycle',
]

/** 注册函数返回卸载函数的四个文件 */
const FILES = [
  'src/main/ipc/ssh.ts',
  'src/main/ipc/monitor.ts',
  'src/main/ipc/mcp.ts',
  'src/main/ipc/loop-engineering.ts',
]

type Bare = { line: number; name: string }

/** 这个调用表达式是不是"被收下了"（包在 push/赋值/变量初始化/return 里） */
function isCaptured(node: ts.CallExpression): boolean {
  const parent = node.parent
  if (!parent) return false
  // 被调用参数位（例如 disposers.push(x.on(...))）
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) return true
  // 被变量声明接住
  if (ts.isVariableDeclaration(parent)) return true
  // 被赋值接住
  if (ts.isBinaryExpression(parent) && parent.left === node) return false
  if (ts.isBinaryExpression(parent) && parent.right === node) return true
  if (ts.isReturnStatement(parent)) return true
  // 被对象属性值接住
  if (ts.isPropertyAssignment(parent)) return true
  return false
}

/** 找出"裸着的订阅调用"——表达式语句形态，返回值直接丢掉 */
function bareSubscriptions(fileName: string, src: string): Bare[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true)
  const out: Bare[] = []
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  function visit(node: ts.Node): void {
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression)
    ) {
      const name = node.expression.expression.name.text
      if (SUBSCRIPTIONS.includes(name) && !isCaptured(node.expression)) {
        out.push({ line: line(node), name })
      }
    }
    node.forEachChild(visit)
  }
  visit(sf)
  return out
}

/**
 * 返回类型是不是 `() => void`
 *
 * 走 AST 而不是比字符串：写成 `(() => void)`（带包裹括号）与 `() => void` 是同一个类型，
 * 字符串比会把合规写法报成违规。
 */
function isVoidFunctionType(node: ts.TypeNode | undefined): boolean {
  let t = node
  while (t && ts.isParenthesizedTypeNode(t)) t = t.type
  return !!t && ts.isFunctionTypeNode(t) && t.parameters.length === 0 && t.type.getText() === 'void'
}

/** 某个 register 函数是否以 () => void 返回并真的有 return 语句 */
function returnShapeOfRegister(src: string, fnName: string): { annotated: boolean; returns: boolean } {
  const sf = ts.createSourceFile(fnName, src, ts.ScriptTarget.Latest, true)
  let annotated = false
  let returns = false
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || stmt.name?.text !== fnName) continue
    annotated = isVoidFunctionType(stmt.type)
    returns = annotated
      ? /return\b/.test(stmt.getText(sf))
      : /return\s+(unsubscribe|off|\(\)\s*=>|dispose)/.test(stmt.getText(sf))
  }
  return { annotated, returns }
}

/**
 * 抓出某个方法名上的所有接收者（点号链形式）
 *
 * 只用于 .on/.off 这类"接收者就是那条总线"的配对检查——这里要判的是
 * "同一个 emitter 有没有配对的退订"，用不上完整 AST，正则反而更不容易被
 * 换行/括号形状骗到。方法名带括号是故意的，避免把 `.once(` 混进来。
 */
function matchReceivers(src: string, method: '.on(' | '.off('): string[] {
  const name = method.slice(1, -1)
  const re = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\.(on|off)\(/g
  const out: string[] = []
  for (const m of src.matchAll(re)) {
    if (m[2] === name) out.push(m[1])
  }
  return out
}

describe('订阅可退订（结构闸）', () => {
  it('四个注册模块里没有裸着的订阅调用', () => {
    const offenders: string[] = []
    for (const rel of FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      for (const b of bareSubscriptions(rel, src)) {
        offenders.push(`${rel}:${b.line} 丢了 ${b.name}() 的返回值`)
      }
    }
    expect(offenders, `订阅必须被收下并能在重注册时摘掉：\n${offenders.join('\n')}`).toEqual([])
  })

  it('EventEmitter 订阅（xxx.events.on）必须配对的 off', () => {
    const unpaired = FILES.flatMap((rel) => {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      const onReceivers = new Set(matchReceivers(src, '.on('))
      const offReceivers = new Set(matchReceivers(src, '.off('))
      return [...onReceivers]
        .filter((r) => r.endsWith('.events'))
        .filter((r) => !offReceivers.has(r))
        .map((r) => `${rel} 里 ${r}.on(...) 没有配对的 off`)
    })
    expect(unpaired, unpaired.join('\n')).toEqual([])
    // 注入自证：少了 off 的写法必须被这条抓到，否则它就是一张放行证
    const synthetic = 'const h = 1\nsub.events.on("a", h)\nother.on("b", h)'
    const withoutOff = matchReceivers(synthetic, '.on(').filter((r) => r.endsWith('.events'))
    expect(withoutOff).toEqual(['sub.events'])
    expect(matchReceivers('sub.events.on("a", h)\nsub.events.off("a", h)', '.off(')).toEqual([
      'sub.events',
    ])
  })

  it('四个 register 函数都声明返回 () => void（不声明就是没打算让人摘）', () => {
    const names = [
      ['src/main/ipc/ssh.ts', 'registerSshIpcHandlers'],
      ['src/main/ipc/monitor.ts', 'registerMonitorIpcHandlers'],
      ['src/main/ipc/mcp.ts', 'registerMcpStateHandlers'],
      ['src/main/ipc/loop-engineering.ts', 'registerLoopEngineeringHandlers'],
    ] as const
    for (const [rel, fnName] of names) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      const shape = returnShapeOfRegister(src, fnName)
      expect(shape.annotated, `${fnName} 的返回类型要显式写成 () => void`).toBe(true)
      expect(shape.returns, `${fnName} 里没有 return 卸载函数`).toBe(true)
    }
  })

  it('ipc/index.ts 把这四个返回值都收进 disposer 收纳处', () => {
    const src = readFileSync(join(ROOT, 'src/main/ipc/index.ts'), 'utf8')
    const sf = ts.createSourceFile('index.ts', src, ts.ScriptTarget.Latest, true)
    const pushed = new Set<string>()
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sf) === 'ipcDisposers' &&
        node.expression.name.text === 'push' &&
        ts.isCallExpression(node.arguments[0]) &&
        ts.isIdentifier(node.arguments[0].expression)
      ) {
        pushed.add(node.arguments[0].expression.text)
      }
      node.forEachChild(visit)
    }
    visit(sf)
    for (const fnName of [
      'registerSshIpcHandlers',
      'registerMonitorIpcHandlers',
      'registerMcpStateHandlers',
      'registerLoopEngineeringHandlers',
    ]) {
      expect(pushed.has(fnName), `${fnName} 的返回值没进 ipcDisposers`).toBe(true)
    }
    // 还要真的会摘：重注册前跑一遍收纳处（只收不跑等于没闸）
    expect(src).toMatch(/for\s*\(\s*const\s+dispose\s+of\s+ipcDisposers/)
  })

  it('自证：裸订阅与没接住返回值的写法会被上面的分析报出来', () => {
    const bare = [
      'export function registerX(w: any): void {',
      '  w.onMonitorData((d: string) => { w.send(d) })',
      '}',
    ].join('\n')
    expect(bareSubscriptions('synthetic.ts', bare).map((b) => b.name)).toEqual(['onMonitorData'])

    const captured = [
      'export function registerY(w: any): (() => void) {',
      '  const offs: Array<() => void> = []',
      '  offs.push(w.onMonitorData((d: string) => { w.send(d) }))',
      '  return () => { offs.forEach((f) => f()) }',
      '}',
    ].join('\n')
    expect(bareSubscriptions('synthetic-ok.ts', captured)).toEqual([])
    expect(returnShapeOfRegister(captured, 'registerY')).toEqual({ annotated: true, returns: true })

    // 没有返回类型声明的写法必须被第二条判据拦住
    const noReturn = ['export function registerZ(w: any): void {', '  registerZX(w)', '}'].join('\n')
    expect(returnShapeOfRegister(noReturn, 'registerZ').annotated).toBe(false)
  })

  it('注入自证：被扫文件确实存在且非空（否则会全线空过）', () => {
    for (const rel of FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src.length, `${rel} 读出来是空的`).toBeGreaterThan(200)
    }
  })
})
