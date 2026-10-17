/**
 * store 的键必须有读者（#136）
 *
 * 病根：渲染层的 store 会攒出"只写不读"的键——action 定义了没人调、字段每次 set 完就沉底。
 * 它们不是无害的杂物：读代码的 AI 和人都会把 `useAIStore.messages` 当成对话的真状态，
 * 而对话早就走 agent-store 那条链了。ai-store 18 个键里 13 个是这样（2026-10-16 删掉），
 * 这条判据保证它不再长回来，并把其余 store 一起纳管。
 *
 * 判据口径（为什么这样算"有读者"）：
 * - 先按 import 说明符解出"谁引了这个 store"，只在引入方 + store 自己那份文件里找读位置，
 *   不按全仓名字匹配。
 * - **读位置必须挂在这份 store 上**：`useXStore((s) => s.k)` 的选择器形参、
 *   `useXStore.getState().k`、`const m = useXStore.getState(); m.k` 这种一层别名、
 *   `const state = () => useXStore.getState(); state().k` 这种无参助手、
 *   以及 `const { k } = useXStore.getState()` 的解构绑定。
 *   第一版只要求"这个文件里出现过 `x.k` 这个名字"，于是 `map.clear()` 替 preview-store 的
 *   死键 `clear` 当了读者（EditorArea 里的 `watching.clear()` 就是它）——同名就算＝假绿。
 *   2026-10-17 收紧成按对象判定后，一次量出 4 个真死键（editor-store.selection、
 *   preview-store.clear、terminal-store.setShellTitle / shellsOf），已全部删掉。
 * - store 自己 `set({ foo: ... })` 里的那次出现是**写**，不算读者；
 *   注释和字符串里的名字也不算（第一版用正则，把注释里的键名算成读者，一整批死键被判活）。
 *
 * 仍偏松的一处（下面"量具边界"那条把它钉成文字）：解构出来就算读者，
 * 哪怕那个局部变量之后再没被引用。收紧它要加作用域分析，那是另一件事。
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

const unwrapParen = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ? unwrapParen(e.expression) : e

/** 这个文件从 storeBase 那一条 import 里拿到了哪些本地标识符名（改名引入也算） */
function importedNamesOf(file: string, storeBase: string): string[] {
  const text = FILE_TEXT.get(file) ?? ''
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true)
  const names: string[] = []
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteralLike(st.moduleSpecifier)) continue
    if (resolveSpec(st.moduleSpecifier.text, file) !== storeBase) continue
    const clause = st.importClause
    if (!clause) continue
    if (clause.name) names.push(clause.name.text)
    const nb = clause.namedBindings
    if (!nb) continue
    if (ts.isNamedImports(nb)) for (const el of nb.elements) names.push(el.name.text)
    else names.push(nb.name.text)
  }
  return names
}

/** store 自己那份文件里 `export const useXStore = create...` 的钩子名 */
function ownHookNames(storeFile: string): string[] {
  const text = FILE_TEXT.get(storeFile) ?? readFileSync(storeFile, 'utf8')
  const sf = ts.createSourceFile(storeFile, text, ts.ScriptTarget.ES2022, true)
  // create(fn) / create<S>()(fn)：外层调用的接收者递归剥到标识符，看到 create 就算
  const createsStore = (node: ts.Expression): boolean => {
    const e = unwrapParen(node)
    if (!ts.isCallExpression(e)) return false
    if (ts.isIdentifier(e.expression)) return e.expression.text === 'create'
    return createsStore(e.expression)
  }
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && createsStore(node.initializer)) {
      out.push(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/**
 * 一份文件里，**确实读到了这份 store 状态**的键名。
 *
 * 认这几种形状（都是仓里实际在用的写法）：
 *   useX((s) => s.k)                      选择器形参
 *   useX.getState().k                     直接读
 *   const m = useX.getState(); m.k        一层别名
 *   const { k } = useX.getState()         解构绑定
 *   const st = () => useX.getState(); st().k   无参助手（测试里到处是这种）
 *   useX((s) => { ... }) 块体同上
 * 不认的：同名但接收者是别的对象（`map.clear()`、组件 prop `selection`）——
 * 这正是 2026-10-17 收紧的动因：那种写法会把死键判成活键。
 */
function strictReadNamesOf(fileName: string, text: string, hookNames: string[]): Set<string> {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true)
  const reads = new Set<string>()
  const hooks = new Set(hookNames)
  const aliases = new Set<string>()
  const stateParams = new Set<string>()
  const getters = new Set<string>()

  const isStoreCall = (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node)) return false
    const callee = node.expression
    if (ts.isIdentifier(callee) && (hooks.has(callee.text) || getters.has(callee.text))) return true
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      hooks.has(callee.expression.text) &&
      /^(get|getState|getInitialState)$/.test(callee.name.text)
    )
      return true
    return false
  }

  const returnsStoreCall = (body: ts.ConciseBody | ts.Block | undefined): boolean => {
    if (!body) return false
    if (ts.isBlock(body))
      return body.statements.some((s) => ts.isReturnStatement(s) && s.expression && isStoreCall(unwrapParen(s.expression)))
    return isStoreCall(unwrapParen(body as ts.Expression))
  }

  // 第 0 遍先收"调一下就返回状态对象"的无参助手，否则第 1 遍认不出 st().k
  const pass0 = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const init = unwrapParen(node.initializer)
      if (
        (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
        init.parameters.length === 0 &&
        returnsStoreCall(init.body)
      )
        getters.add(node.name.text)
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.parameters.length === 0 && returnsStoreCall(node.body)) {
      getters.add(node.name.text)
    }
    ts.forEachChild(node, pass0)
  }
  pass0(sf)

  const pass1 = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && isStoreCall(unwrapParen(node.initializer))) {
      if (ts.isIdentifier(node.name)) aliases.add(node.name.text)
      if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          if (!ts.isIdentifier(el.name)) continue
          const prop = el.propertyName
          reads.add(prop && ts.isIdentifier(prop) ? prop.text : el.name.text)
        }
      }
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parameters.length) {
      const parent = node.parent
      if (parent && ts.isCallExpression(parent) && isStoreCall(parent)) {
        const p = node.parameters[0]
        if (ts.isIdentifier(p.name)) stateParams.add(p.name.text)
        if (ts.isObjectBindingPattern(p.name)) {
          for (const el of p.name.elements) if (ts.isIdentifier(el.name)) reads.add(el.name.text)
        }
      }
    }
    ts.forEachChild(node, pass1)
  }
  pass1(sf)

  const pass2 = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
      const recv = node.expression
      if (ts.isIdentifier(recv) && (aliases.has(recv.text) || stateParams.has(recv.text))) reads.add(node.name.text)
      else if (ts.isCallExpression(recv) && isStoreCall(recv)) reads.add(node.name.text)
      else if (
        ts.isPropertyAccessExpression(recv) &&
        ts.isIdentifier(recv.expression) &&
        (hooks.has(recv.expression.text) || aliases.has(recv.expression.text))
      )
        reads.add(node.name.text)
    }
    // store 自己文件里的 get().k（工厂第二个形参）也是真读
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'get' &&
      node.expression.arguments.length === 0
    )
      reads.add(node.name.text)
    ts.forEachChild(node, pass2)
  }
  pass2(sf)

  return reads
}

function readsForStore(storeFile: string): Set<string> {
  const base = norm(storeFile).replace(/\.ts$/, '')
  const own = ownHookNames(storeFile)
  const out = new Set<string>()
  for (const f of [...importersOf(storeFile), storeFile]) {
    const hooks = [...new Set([...importedNamesOf(f, base), ...own])]
    for (const r of strictReadNamesOf(f, FILE_TEXT.get(f) ?? '', hooks)) out.add(r)
  }
  return out
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
    const readers = readsForStore(storeFile)
    const dead = keys.filter((k) => !readers.has(k))
    if (dead.length > 0) {
      offenders.push(norm(storeFile))
      details.push(`${norm(storeFile)} (${importers.length} 个引入方): ${dead.join(', ')}`)
    }
  }

  it('没有只写不读的键', () => {
    expect(details, '以下 store 键没有任何"挂在这份 store 上"的读位置，删掉或接上消费者').toEqual([])
  })

  it('阳性对照：写位置不算读者、各种真读形状都算（否则这条闸没有分辨力）', () => {
    const base = `
      interface S { foo: number }
      const use = create<S>()((set) => ({ foo: 1, setFoo: (v: number) => set({ foo: v }) }))
    `
    // 走的就是判据自己那套收集器（strictReadNamesOf），不是另写一份简化版
    const read = (extra: string): boolean => strictReadNamesOf('probe.ts', base + extra, ['use']).has('foo')

    expect(strictReadNamesOf('probe.ts', base, ['use']).has('foo'), 'set({ foo }) 是写，不该产出读者').toBe(false)
    expect(read('\nuse.getState().foo\n'), 'useX.getState().foo 是读').toBe(true)
    expect(read('\nuse((s) => s.foo)\n'), '选择器形参上的 s.foo 是读').toBe(true)
    expect(read('\nuse((s) => { const n = s.foo; return n })\n'), '块体选择器里的 s.foo 是读').toBe(true)
    expect(read('\nconst m = use.getState(); m.foo\n'), '一层别名 m.foo 是读').toBe(true)
    expect(read('\nconst st = () => use.getState(); st().foo\n'), '无参助手 st().foo 是读').toBe(true)
    expect(read('\nfunction st2() { return use.getState() }\nst2().foo\n'), 'function 形式的助手也是读').toBe(true)
    expect(read('\nconst { foo } = use.getState()\n'), '解构绑定是读').toBe(true)
  })

  it('阴性对照：同名的别家属性不算读者（收紧的全部理由）', () => {
    const decl = `
      interface S { clear: () => void; selection: string }
      const use = create<S>()((set) => ({ clear: () => set({}), selection: '' }))
    `
    // 这两种写法在 2026-10-17 之前会把死键判成活键：Map 自己的 clear、别家对象的同名字段
    expect(strictReadNamesOf('a.ts', decl + '\nconst watching = new Map()\nwatching.clear()\n', ['use']).has('clear'), 'Map.clear() 不该替 store 的 clear 当读者').toBe(false)
    expect(strictReadNamesOf('b.ts', decl + '\nconst props = { selection: "" }\nprops.selection\n', ['use']).has('selection'), '另一个对象上的 .selection 不该算读者').toBe(false)
    // 而挂在真状态对象上的别名读，必须认
    expect(strictReadNamesOf('c.ts', decl + '\nconst st = use.getState()\nst.selection\n', ['use']).has('selection'), 'const st = use.getState(); st.selection 是真读').toBe(true)
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
      strictReadNamesOf('probe.ts', destructuredButUnused, ['use']).has('deadKey'),
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
