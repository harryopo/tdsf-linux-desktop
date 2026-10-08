/**
 * React 19 基线闸（阶段 B 判据的常驻版）
 *
 * 阶段 B 当时的结论是"React 19 的移除项在我们源码里全为 0"，但那是一次性静态核对：
 * 谁后来写一句 `ReactDOM.render(...)` 或给函数组件加 `defaultProps`，四道门禁一句都不会响
 * （React 19 里前者是运行时不存在，后者对函数组件是**静默忽略**——正是最难发现的那类）。
 * 本文件把它变成常驻闸，量两件事：
 *   1. 渲染层源码里不出现 React 19 删掉的 API（按 AST 判，注释里提到不算命中）；
 *   2. package.json 的主版本不许退回 18 / zustand 退回 4 / recharts 退回 2（B 的三份硬升级）。
 *
 * 扫描器自己带阳性对照（下面那条用例喂三段坏代码进内存判），
 * 因为"命中 0"最贵的一种解释是：解析根本没跑起来。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'

const RENDERER = path.join(process.cwd(), 'src', 'renderer', 'src')

/** 从 package.json 的依赖里读主版本号（"^19.3.0" → 19） */
function majorOf(dep: string): number {
  const m = /\D*(\d+)/.exec(dep)
  return m ? Number(m[1]) : Number.NaN
}

/**
 * 用一个内存里的渲染层文件当阳性对照，跑同一份扫描逻辑
 *
 * 不能只在仓库里"没找到就算过"：得先证明找得到东西。
 */
function scanSource(fileName: string, source: string): string[] {
  const found: string[] = []
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  // 裸调用 render(...) 只在"这个文件确实从 react-dom 引过东西"时才算命中，
  // 否则会把项目里自己起名叫 render 的函数（如 markdown 渲染）全误报一遍
  let importsReactDom = false
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const spec = st.moduleSpecifier.getText()
      if (/react-dom/.test(spec)) importsReactDom = true
    }
  }

  const walk = (node: ts.Node): void => {
    // ReactDOM.render / .hydrate / .unmountComponentAtNode —— React 19 已从 react-dom 删除
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text
      if (name === 'render' || name === 'hydrate' || name === 'unmountComponentAtNode') {
        if (/^ReactDOM$/.test(node.expression.getText())) {
          found.push(`${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ReactDOM.${name}`)
        }
      }
      // findDOMNode：React 19 移除
      if (name === 'findDOMNode' && /ReactDOM|ReactDom/.test(node.expression.getText())) {
        found.push(`${fileName} findDOMNode 已随 React 19 删除`)
      }
    }
    // 从 react-dom 直接 import 进来的那几个删除项
    if (importsReactDom && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const n = node.expression.text
      if (n === 'render' || n === 'hydrate' || n === 'unmountComponentAtNode' || n === 'findDOMNode') {
        found.push(`${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} 直接调用 ${n}`)
      }
    }
    // 字符串 ref（React 19 移除，改回调/ref 对象）
    if (ts.isJsxAttribute(node) && node.name.getText() === 'ref' && node.initializer) {
      const init = node.initializer
      if (ts.isStringLiteral(init)) {
        found.push(`${fileName}:${sf.getLineAndCharacterOfPosition(init.getStart()).line + 1} 字符串 ref`)
      }
    }
    // defaultProps：React 19 起对函数组件静默忽略（写了没效果，比报错更坏）
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left.getText()
      if (/\.defaultProps$/.test(left)) found.push(`${fileName} ${left}（函数组件的 defaultProps 会被忽略）`)
    }
    // 组件对象里字面量写 defaultProps
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'defaultProps') {
      found.push(`${fileName} 组件里写了 defaultProps`)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}

/** 渲染层全部源码文件（.ts/.tsx，跳过产物与测试快照） */
function collect(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) collect(full, out)
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full)
  }
  return out
}

describe('React 19 基线（阶段 B）', () => {
  it('扫描器自己是活的：三类坏代码都要被点名（阳性对照）', () => {
    const bad = [
      `import ReactDOM from 'react-dom/client'
       ReactDOM.render(<App />, document.getElementById('root'))
       function App() { return <input ref="name" /> }
       App.defaultProps = { a: 1 }`,
    ].join('\n')
    const hits = scanSource('probe.tsx', bad)
    expect(hits.some((h) => h.includes('ReactDOM.render')), '渲染入口删除项没抓到').toBe(true)
    expect(hits.some((h) => h.includes('字符串 ref')), '字符串 ref 没抓到').toBe(true)
    expect(hits.some((h) => h.includes('defaultProps')), 'defaultProps 没抓到').toBe(true)

    // 反向：注释里提到这些词不算命中（历史注释一大把，误报成灾的闸会被绕过）
    const onlyComments = `// 这里曾经用 ReactDOM.render，React 19 删了它
      /** App.defaultProps 已去掉 */
      export const App = () => null`
    expect(scanSource('comments.tsx', onlyComments)).toEqual([])
  })

  it('渲染层源码 0 处 React 19 移除项', () => {
    const files = collect(RENDERER)
    expect(files.length, '一个文件都没扫到，等于没扫').toBeGreaterThan(100)
    const all: string[] = []
    for (const f of files) all.push(...scanSource(path.relative(process.cwd(), f), fs.readFileSync(f, 'utf8')))
    expect(all, `这些地方在用 React 19 已经删掉的 API：\n${all.join('\n')}`).toEqual([])
  })

  it('依赖主版本不许退回升级前的那一档', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(majorOf(deps.react), 'React 必须留在 19.x（阶段 B 的升级）').toBeGreaterThanOrEqual(19)
    expect(majorOf(deps['react-dom']), 'ReactDOM 必须与 React 同主版本').toBeGreaterThanOrEqual(19)
    expect(majorOf(deps.zustand), 'Zustand 必须留在 5.x').toBeGreaterThanOrEqual(5)
    expect(majorOf(deps.recharts), 'recharts 必须留在 3.x（React 19 的硬阻塞项）').toBeGreaterThanOrEqual(3)
    // antd 已整体退出渲染层：出现就是有人把它加回来（design-contract 另有文件数上限 0）
    expect(deps.antd, 'antd 不该再出现在依赖里').toBeUndefined()
  })
})
