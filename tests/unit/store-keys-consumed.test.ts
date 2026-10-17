/**
 * store 的键必须有读者（#136）
 *
 * 病根：渲染层的 store 会攒出"只写不读"的键——action 定义了没人调、字段每次 set 完就沉底。
 * 它们不是无害的杂物：读代码的 AI 和人都会把 `useAIStore.messages` 当成对话的真状态，
 * 而对话早就走 agent-store 那条链了。ai-store 18 个键里 13 个是这样（2026-10-16 删掉），
 * 这条判据保证它不再长回来，并把其余 store 一起纳管。
 *
 * 判据口径（为什么这样算"有读者"）：
 * - 先按 import 说明符解出"谁引了这个 store"，只在引入方 + store 自己那份文件里找标识符，
 *   不按全仓名字匹配。同名键太多（messages / isStreaming / loaded / panelOpen），
 *   全仓匹配会把别人的引用算成它的读者＝假绿。
 * - 读位置只认 AST：属性访问 `s.foo`、解构绑定 `const { foo } =`、简写 `{ foo }`。
 *   注释和字符串里的名字不算读者（第一版用正则，把注释里的键名算成读者，一整批死键被判活）。
 * - store 自己 `set({ foo: ... })` 里的那次出现是**写**，不算读者。
 *
 * 这条判据偏松，不会冤枉活键：只要求"名字出现在读位置"，同名就算（`map.clear()` 会被算成
 * store 键 `clear` 的读者）。所以它报出来的死键要再用一次全仓 grep 复核才动手删；
 * 反过来"没报"不等于那个键真的有人用。做成"宁漏报不误删"是因为误删业务状态比留一个死键贵。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, normalize, sep } from 'node:path'
import ts from 'typescript'

const STORE_DIR = join(process.cwd(), 'src', 'renderer', 'src', 'stores')

/** 会被 store 状态影响的源码面（tests/ 里对 store 的 setState/getState 也算读者） */
const SCAN_ROOTS = ['src/renderer', 'src/main', 'src/preload', 'src/shared', 'tests']

function listSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) listSourceFiles(p, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p)
  }
  return out
}

const ALL_FILES = SCAN_ROOTS.reduce<string[]>((acc, r) => listSourceFiles(join(process.cwd(), r), acc), [])
const FILE_TEXT = new Map(ALL_FILES.map((f) => [f, readFileSync(f, 'utf8')]))

const norm = (p: string): string => p.split(sep).join('/')

/**
 * 路径别名从 tsconfig.web.json 的 paths 读，不在测试里手抄。
 *
 * 第一版只认 `@/` 和 `@shared/`，而仓里还在用 `@renderer/`（tsconfig 里有五条）。
 * 解不出来的说明符会被当成"这个文件没有引入这份 store"，于是引入方名单变短、
 * 活键被判成死键——monitor-store 的 clearAllMonitorData 就是这样被两个测试文件漏掉的。
 * 别名表与 tsconfig 同源，加第六条时这里自动跟上。
 */
function loadAliases(): Array<{ prefix: string; base: string }> {
  const raw = readFileSync(join(process.cwd(), 'tsconfig.web.json'), 'utf8')
  const parsed = ts.parseConfigFileTextToJson('tsconfig.web.json', raw).config as {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }
  }
  const paths = parsed?.compilerOptions?.paths ?? {}
  const baseUrl = parsed?.compilerOptions?.baseUrl ?? '.'
  const out: Array<{ prefix: string; base: string }> = []
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!pattern.endsWith('*') || !targets[0]) continue
    out.push({ prefix: pattern.slice(0, -1), base: norm(join(baseUrl, targets[0].slice(0, -1))) })
  }
  return out.sort((a, b) => b.prefix.length - a.prefix.length)
}

const ALIASES = loadAliases()

/** 解不出的 @ 前缀说明符（npm 包不算：@scope/pkg 里没有斜杠分段指向仓内文件） */
const UNRESOLVED_ALIASES = new Set<string>()

/** 把 import 说明符解成**绝对**路径；解不出返回 null */
function resolveSpec(spec: string, fromFile: string): string | null {
  if (spec.startsWith('.')) return norm(normalize(join(dirname(fromFile), spec)))
  for (const a of ALIASES) {
    if (spec.startsWith(a.prefix)) {
      return norm(join(process.cwd(), a.base, spec.slice(a.prefix.length)))
    }
  }
  if (spec.startsWith('@') && spec.split('/').length > 1) {
    // npm 的 @scope/pkg 解不到仓内文件是正常的，按 node_modules 里有没有这个包区分；
    // 没有这个包又是别名前缀，就是 tsconfig 加了 paths 而这里没跟上。
    const pkg = spec.split('/').slice(0, 2).join('/')
    if (!existsSync(join(process.cwd(), 'node_modules', pkg))) UNRESOLVED_ALIASES.add(spec.split('/')[0])
  }
  return null
}

/** 一次遍历建索引：被引入目标 → 引入它的那些文件 */
const IMPORT_INDEX = new Map<string, string[]>()
for (const f of ALL_FILES) {
  const text = FILE_TEXT.get(f) ?? ''
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ES2022, true)
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteralLike(st.moduleSpecifier)) continue
    const resolved = resolveSpec(st.moduleSpecifier.text, f)
    if (!resolved) continue
    const list = IMPORT_INDEX.get(resolved) ?? []
    list.push(f)
    IMPORT_INDEX.set(resolved, list)
  }
}

function importersOf(storeFile: string): string[] {
  const base = norm(storeFile).replace(/\.ts$/, '')
  return (IMPORT_INDEX.get(base) ?? []).filter((f) => norm(f) !== base)
}

/**
 * store 的状态形状 = create(...) 里那个对象字面量的顶层键 ∪ create<T>() 的类型参数 T 的成员。
 *
 * 第一版把文件里**每个** interface 的成员都收进来了，于是 terminal-store 的
 * CommandBlock.sentAt、editor-store 的 Selection.filePath 这类"子对象的字段"被判成 store 键，
 * 报出一片假死键。键只能来自状态形状本身。
 */
function stateKeysOf(storeFile: string): string[] {
  const text = FILE_TEXT.get(storeFile) ?? readFileSync(storeFile, 'utf8')
  const sf = ts.createSourceFile(storeFile, text, ts.ScriptTarget.ES2022, true)
  const keys = new Set<string>()
  const stateTypeNames = new Set<string>()

  const collectLiteral = (node: ts.ObjectLiteralExpression): void => {
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
        if (prop.name && ts.isIdentifier(prop.name)) keys.add(prop.name.text)
      }
    }
  }
  const unwrap = (e: ts.Node): ts.Node => (ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e)

  const collectArrowBody = (fn: ts.ArrowFunction | ts.FunctionExpression): void => {
    // 只有形参以 set 打头的箭头函数才是 store 的状态工厂；
    // set((state) => ({ ... })) 那种 updater 的形参是 state，收不到，正好。
    const first = fn.parameters[0]?.name
    if (!first || !ts.isIdentifier(first) || first.text !== 'set') return
    // (set) => ({ ... }) 的括号在 AST 里是一个 ParenthesizedExpression 节点，
    // 不剥掉就永远认不出对象字面量（第一版就这样把 12 份 store 全解成 0 个键）。
    const body = unwrap(fn.body)
    if (ts.isObjectLiteralExpression(body)) collectLiteral(body)
    else if (ts.isBlock(body)) {
      body.statements.forEach((s) => {
        if (ts.isReturnStatement(s) && s.expression) {
          const ret = unwrap(s.expression)
          if (ts.isObjectLiteralExpression(ret)) collectLiteral(ret)
        }
      })
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression
      if (ts.isIdentifier(expr) && expr.text === 'create' && node.typeArguments?.length) {
        const ta = node.typeArguments[0]
        if (ts.isTypeReferenceNode(ta) && ts.isIdentifier(ta.typeName)) stateTypeNames.add(ta.typeName.text)
      }
      for (const arg of node.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) collectArrowBody(arg)
      }
    }
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && stateTypeNames.has(node.name.text)) {
      const members = ts.isInterfaceDeclaration(node) ? node.members : ts.isTypeLiteralNode(node.type) ? node.type.members : []
      for (const m of members) if (m.name && ts.isIdentifier(m.name)) keys.add(m.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...keys]
}

/**
 * 一个文件把哪些标识符放在**读位置**上：
 * 属性访问的名字、解构绑定的名字、对象简写（= 读同名变量）。
 * `set({ foo: x })` 那种 PropertyAssignment 是写，不收。
 */
function readNamesOf(fileName: string, text: string): Set<string> {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true)
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
      names.add(node.name.text)
    } else if (ts.isShorthandPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      names.add(node.name.text)
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

function readPositions(file: string): Set<string> {
  return readNamesOf(file, FILE_TEXT.get(file) ?? '')
}

describe('store 的每个键都有读者', () => {
  // stores/ 目录里也有非 store 的模块（agent-stream-subscription 是订阅接线），
  // 判据只管真正 create 出来的那份状态。
  const storeFiles = readdirSync(STORE_DIR)
    .filter((n) => n.endsWith('.ts'))
    .map((n) => join(STORE_DIR, n))
    .filter((f) => /from 'zustand'/.test(FILE_TEXT.get(f) ?? readFileSync(f, 'utf8')))

  it('扫到了 store 文件（0 个等于判据空转）', () => {
    expect(storeFiles.length).toBeGreaterThan(0)
    // 每份 store 都必须解出键，否则"没有死键"是因为什么都没查到＝假绿
    const blind = storeFiles
      .filter((f) => stateKeysOf(f).length === 0)
      .map((f) => norm(f).split('/').pop())
    expect(blind, '解不出状态键：写法变了或工厂函数识别失效').toEqual([])
  })

  it('别名解析覆盖 tsconfig 里声明的每一条', () => {
    // 解不出的 @ 别名会让引入方名单变短，把活键误判成死键；这里让"漏了一条"先报出来。
    expect(ALIASES.length, 'tsconfig.web.json 的 paths 应至少有 5 条别名').toBeGreaterThanOrEqual(5)
    expect([...UNRESOLVED_ALIASES], '出现了没被解析的 @ 别名前缀').toEqual([])
  })

  const offenders: string[] = []
  const details: string[] = []

  for (const storeFile of storeFiles) {
    const keys = stateKeysOf(storeFile)
    const importers = importersOf(storeFile)
    const readers = new Set<string>()
    for (const f of [...importers, storeFile]) {
      for (const n of readPositions(f)) readers.add(n)
    }
    const dead = keys.filter((k) => !readers.has(k))
    if (dead.length > 0) {
      offenders.push(norm(storeFile))
      details.push(`${norm(storeFile)} (${importers.length} 个引入方): ${dead.join(', ')}`)
    }
  }

  it('没有只写不读的键', () => {
    expect(details, '以下 store 键没有任何读位置引用，删掉或接上消费者').toEqual([])
  })

  it('阳性对照：写位置不算读者、读位置才算（否则这条闸没有分辨力）', () => {
    const writeOnly = `
      interface S { foo: number }
      const use = create<S>()((set) => ({ foo: 1, setFoo: (v: number) => set({ foo: v }) }))
    `
    // 同一份代码，只是多了一处 `use.getState().foo` 的读位置
    const readOnly = writeOnly + '\nuse.getState().foo\n'

    // 走的就是判据自己那套收集器（readNamesOf），不是另写一份简化版
    expect(readNamesOf('probe.ts', writeOnly).has('foo'), 'set({ foo }) 是写，不该产出读者').toBe(false)
    expect(readNamesOf('probe.ts', readOnly).has('foo'), 's.foo 是读，必须被认成读者').toBe(true)
  })

  it('量具边界（已知偏松，写在这里防止被当成"已做完"）', () => {
    /*
     * 解构出来的名字就算读者，哪怕那个局部变量之后再没被用过。
     * 所以 `const { deadKey } = useXStore()` 会让 deadKey 躲过这条闸——
     * 判据是"宁漏报不误删"：误删一份业务状态比留一个死键贵得多。
     * 要收紧就得加作用域分析（解构后有没有被引用），那是另一件事，别以为这条已经覆盖。
     */
    const destructuredButUnused = `
      interface S { deadKey: number }
      const use = create<S>()((set) => ({ deadKey: 1 }))
      const { deadKey } = use()
    `
    expect(
      readNamesOf('probe.ts', destructuredButUnused).has('deadKey'),
      '这条断言是在登记盲区：哪天它变红了，说明有人收紧了判据（好事，但要回头改这段说明）'
    ).toBe(true)
  })

  it('引入方解析得通（解不出引入方＝判据会误报成死键）', () => {
    // 这条是给量具自己上的保险：第一版把 @/ 前缀解成了相对路径，
    // 于是 settings-store / db-status-store 等报"0 个引入方"，把一堆活键判成死键。
    const aiStore = join(STORE_DIR, 'ai-store.ts')
    expect(importersOf(aiStore).length, 'ai-store 至少有 Composer 与 SelectionPopover 两个引入方').toBeGreaterThanOrEqual(2)
    expect(stateKeysOf(aiStore).length).toBeGreaterThan(0)

    const orphanStores = storeFiles
      .filter((f) => importersOf(f).length === 0)
      .map((f) => norm(f).split('/').pop())
    expect(orphanStores, '解不出任何引入方的 store：要么说明符解析又坏了，要么整份 store 是死代码').toEqual([])
  })
})
