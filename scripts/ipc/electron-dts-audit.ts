/**
 * electron.d.ts 与真实实现的对账闸（P1-8）
 *
 * 三个文件都在描述同一件事 —— `window.electronAPI` 到底长什么样：
 *   1. `src/preload/index.ts` 里那个真被 contextBridge 暴露出去的对象（唯一实现）；
 *   2. `src/renderer/src/types/electron.d.ts` 里手写的成员表。
 * （手写表已经 `extends` 了由 1 派生的 `ElectronAPI`，所以名字这一层不会漂，会漂的是签名。）
 *
 * 判据不靠肉眼也不靠 grep，让 tsc 自己回答：用 TypeChecker 取继承基类型的成员表，
 * 与手写本体逐位比 typeToString + 可选性 + 修饰符，分成四类：
 *   - redundant：与实现完全同型 ⇒ 纯冗余，删掉不改变任何判定（--prune 就是删这批）；
 *   - divergent：与实现同类型不同串 ⇒ interface extends 要求兼容才不报错，
 *     所以一定是"更松的那版在盖着真相"，需要人判（默认不拦，按只降不升的刻度盯）；
 *   - phantom：实现里根本没有 ⇒ 渲染层编译通过、运行时 undefined，必须为 0；
 *   - duplicate：同一个名字在手写本体里出现两次 ⇒ 那是无意的重载，必须为 0。
 *
 * 用法：
 *   npx tsx scripts/ipc/electron-dts-audit.ts             # 报告（含每条偏差的两边签名）
 *   npx tsx scripts/ipc/electron-dts-audit.ts --json      # 机器可读
 *   npx tsx scripts/ipc/electron-dts-audit.ts --prune     # 删掉 redundant 那批（先跑报告）
 *   npx tsx scripts/ipc/electron-dts-audit.ts --dedupe    # 折叠类型串完全相同的重复声明
 *   npx tsx scripts/ipc/electron-dts-audit.ts --gate      # redundant/phantom/duplicate 不为 0 就退出码 1
 */
import ts from 'typescript'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const DTS = path.join(ROOT, 'src/renderer/src/types/electron.d.ts')
const REL = path.relative(ROOT, DTS).split(path.sep).join('/')
/**
 * divergent 的现存数量刻度：只许降不许升。
 * 2026-10-12 建闸时 69；删掉 182 个纯冗余成员并把 13 处重复声明折叠后降到 49。
 * 同日 #79 第一批（删 7 条撒谎的手写声明）降到 42；第二批把 kb/history/tutorial/
 * model-stats/budget 的返回类型搬到 preload 标上、再删掉渲染层那 15 条覆盖，降到 24。
 * 剩下的 24 条集中在 sidecar / loop 事件 / 审计报告 / boot 阶段联合类型 与参数名不一致，
 * 收敛一批就把这个数往下改一次（只许降不许升）。
 */
const DIVERGENT_CAP = 24

const argv = process.argv.slice(2)
const MODE = argv.includes('--prune')
  ? 'prune'
  : argv.includes('--dedupe')
    ? 'dedupe'
    : argv.includes('--gate')
      ? 'gate'
      : argv.includes('--json')
        ? 'json'
        : 'report'

function buildProgram(): {
  checker: ts.TypeChecker
  iface: ts.InterfaceDeclaration
  sf: ts.SourceFile
} {
  const configPath = path.join(ROOT, 'tsconfig.web.json')
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) throw new Error(`tsconfig.web.json 读不出来：${JSON.stringify(read.error)}`)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT)
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(DTS)
  if (!sf) throw new Error(`没把 ${REL} 编进 program`)
  let iface: ts.InterfaceDeclaration | undefined
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === 'ElectronAPI') iface = stmt
  }
  if (!iface) throw new Error(`${REL} 里找不到 interface ElectronAPI，判据失去基准`)
  return { checker, iface, sf }
}

interface Member {
  name: string
  type: string
  optional: boolean
  readonly: boolean
  node: ts.TypeElement
}

function optionalityOf(decl: ts.Declaration | undefined): boolean {
  if (!decl) return false
  return (
    (ts.isPropertySignature(decl) || ts.isMethodSignature(decl)) && !!decl.questionToken
  )
}

function classify(): {
  baseCount: number
  own: Member[]
  redundant: Member[]
  divergent: Array<{ name: string; own: string; base: string }>
  phantom: Member[]
  duplicate: string[]
  sourceText: string
} {
  const { checker, iface, sf } = buildProgram()
  const print = (t: ts.Type): string =>
    checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias)

  const base = new Map<string, Member>()
  for (const clause of iface.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
    for (const ref of clause.types) {
      const t = checker.getTypeAtLocation(ref)
      for (const sym of checker.getPropertiesOfType(t)) {
        const decl = sym.valueDeclaration
        base.set(sym.getName(), {
          name: sym.getName(),
          type: decl ? print(checker.getTypeOfSymbolAtLocation(sym, decl)) : '?',
          optional: decl ? optionalityOf(decl) : true,
          readonly: decl ? !!(ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Readonly) : false,
          node: undefined as never,
        })
      }
    }
  }

  const own: Member[] = []
  for (const m of iface.members) {
    if (!m.name || ts.isComputedPropertyName(m.name)) continue
    if (!ts.isMethodSignature(m) && !ts.isPropertySignature(m)) continue
    const name = m.name.getText().replace(/^['"]|['"]$/g, '')
    own.push({
      name,
      type: print(checker.getTypeOfSymbolAtLocation(m.symbol, m)),
      optional: optionalityOf(m),
      readonly: !!(ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Readonly),
      node: m,
    })
  }

  const seen = new Set<string>()
  const redundant: Member[] = []
  const divergent: Array<{ name: string; own: string; base: string }> = []
  const phantom: Member[] = []
  const duplicate: string[] = []
  for (const m of own) {
    if (seen.has(m.name)) duplicate.push(m.name)
    seen.add(m.name)
    const b = base.get(m.name)
    if (!b) {
      phantom.push(m)
      continue
    }
    if (b.type === m.type && b.optional === m.optional && b.readonly === m.readonly) {
      redundant.push(m)
    } else {
      divergent.push({ name: m.name, own: m.type, base: b.type })
    }
  }
  return { baseCount: base.size, own, redundant, divergent, phantom, duplicate, sourceText: sf.getFullText() }
}

/** 删掉与实现完全同型的手写成员（连同它前面的注释一起删，别留悬空 JSDoc） */
function prune(): number {
  const r = classify()
  const cuts = r.redundant
    .map((m) => ({ start: m.node.getFullStart(), end: m.node.getEnd() }))
    .sort((a, b) => b.start - a.start)
  let out = r.sourceText
  for (const c of cuts) out = out.slice(0, c.start) + out.slice(c.end)
  fs.writeFileSync(DTS, out, 'utf8')
  return cuts.length
}

/**
 * 折叠"同一个名字在手写本体里声明两次"的无意重载：
 * 只有两份的类型串完全相同才删（真重载的两份签名不同，会留在 divergent 里由人判）。
 * 这类重复是 interface 里前后各写了一遍同一个方法，TS 把它当成重载表放过来了。
 */
function dedupe(): number {
  const r = classify()
  const byName = new Map<string, Member>()
  const cuts: Array<{ start: number; end: number }> = []
  for (const m of r.own) {
    const first = byName.get(m.name)
    if (!first) {
      byName.set(m.name, m)
      continue
    }
    if (first.type === m.type && first.optional === m.optional) cuts.push({ start: m.node.getFullStart(), end: m.node.getEnd() })
  }
  let out = r.sourceText
  for (const c of cuts.sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + out.slice(c.end)
  fs.writeFileSync(DTS, out, 'utf8')
  return cuts.length
}

function report(): void {
  const r = classify()
  const line = (s: string): void => console.log(s)
  if (MODE === 'json') {
    line(
      JSON.stringify(
        {
          baseCount: r.baseCount,
          ownCount: r.own.length,
          redundant: r.redundant.map((m) => m.name),
          divergent: r.divergent,
          phantom: r.phantom.map((m) => m.name),
          duplicate: r.duplicate,
        },
        null,
        2
      )
    )
    return
  }

  line(`基类型（preload 实现 + 契约生成物）提供的成员数：${r.baseCount}`)
  line(`${REL} 本体手写成员数：${r.own.length}`)
  line(`  ├─ 与实现完全同型（纯冗余，可删）：${r.redundant.length}`)
  line(`  ├─ 与实现不同型（真偏差，需要人判）：${r.divergent.length}`)
  line(`  ├─ 实现里根本没有（幻影，运行时 undefined）：${r.phantom.length}`)
  line(`  └─ 本体里重复声明的名字（无意重载）：${r.duplicate.length}`)
  for (const m of r.phantom) line(`    幻影 ${m.name}`)
  for (const n of r.duplicate) line(`    重复 ${n}`)
  if (MODE === 'report') {
    for (const d of r.divergent) {
      line(`    偏差 ${d.name}\n      手写: ${d.own}\n      实现: ${d.base}`)
    }
  }

  if (MODE === 'gate') {
    const fails: string[] = []
    if (r.redundant.length > 0)
      fails.push(
        `又有 ${r.redundant.length} 个手写成员与实现完全同型（冗余会重新长回来），跑 ` +
          `npx tsx scripts/ipc/electron-dts-audit.ts --prune 删掉`
      )
    if (r.phantom.length > 0)
      fails.push(`有 ${r.phantom.length} 个成员 preload 根本没暴露：${r.phantom.map((m) => m.name).join(', ')} —— 渲染层调到就是 undefined`)
    if (r.duplicate.length > 0)
      fails.push(`本体里有重复声明：${[...new Set(r.duplicate)].join(', ')}`)
    if (r.divergent.length > DIVERGENT_CAP)
      fails.push(`真偏差从 ${DIVERGENT_CAP} 涨到 ${r.divergent.length}，只许降不许升`)
    if (fails.length) {
      for (const f of fails) console.error(`FAIL ${f}`)
      process.exit(1)
    }
    console.log(
      `PASS：手写表已与实现无冗余、无幻影、无重复；剩余 ${r.divergent.length}/${DIVERGENT_CAP} 条偏差待收敛`
    )
  }
}

if (MODE === 'prune') {
  console.log(`已删除 ${prune()} 个与实现完全同型的手写成员于 ${REL}`)
} else if (MODE === 'dedupe') {
  console.log(`已折叠 ${dedupe()} 处类型串完全相同的重复声明于 ${REL}`)
} else {
  report()
}
