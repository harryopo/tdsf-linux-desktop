/**
 * 孤儿模块常驻闸（2026-10-25 #226）
 *
 * 口径：一个 `src/**` 下的 .ts/.tsx 文件，如果 src 里没有任何文件 import 它（静态、`export from`、
 * 动态 `import()`、副作用 `import 'x'` 四种写法都算消费者），而它又不是进程入口，
 * 那它对产品就是死的。tests/ 里引它**不算**消费者——"只有自己的测试在引"正是 #225 那一批的形状，
 * 也是这一族最难看见的原因：测试全绿、类型全绿、`audit:ipc` 也全绿（那把尺子按 preload 暴露的键取数，
 * 而孤儿模块压根不在 IPC 面上），knip 的 `exports` 档又只打印不拦。
 *
 * 判死按"谁引这个文件"，不按"文件里出现什么词"：第一版横扫是逐行找 import 语句里的导出名，
 * 跨行写的 import 认不出，461 个文件里假阳 104 个。这一版解析模块指示符并补全扩展名与 index 形式，
 * 阳性对照钉住四份明知有人引的文件，抽不到就说明量具坏了（第 4 条），不说明产品坏了。
 *
 * 本批判掉的四个（共 473 行）：
 * - `src/main/services/llm/vercel-ai-service.ts`：`VercelAiService` 在 src 里零引用，真在跑的 LLM 路是 `client.ts`
 * - `src/main/services/observability/llm-trace.ts`：`withLlmTrace` / `TracedLlmClient` / `getTracedLlmClient` 零引用
 * - `src/renderer/src/components/workbench/panels/ProgressPanel.tsx` 与 `PausePanel.tsx`：AIPanel 只在注释里提它们，
 *   没有任何 import；这两块面板屏上根本不画
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..')
const SRC = join(ROOT, 'src')

/** 进程入口：由 package.json 的 main、webPreferences.preload、index.html 的 script 加载，不会被 import */
const ENTRIES = new Set([
  'src/main/index.ts',
  'src/preload/index.ts',
  'src/renderer/src/main.tsx',
])

const SPEC_FROM_RE = /(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]/g
const DYN_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const BARE_IMPORT_RE = /^import\s*['"]([^'"]+)['"]/gm

function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

function walkTs(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) walkTs(abs, out)
    else if (/\.tsx?$/.test(entry)) out.push(abs)
  }
  return out
}

/**
 * 把"文件相对路径 => 正文"这张表变成"被引集合 + 孤儿集合"。
 * 合成图与真实仓库走同一个函数，第 5 条的负向对照才有意义。
 */
function analyze(files: Map<string, string>): { imported: Set<string>; orphans: string[] } {
  const imported = new Set<string>()
  for (const [file, body] of files) {
    for (const re of [SPEC_FROM_RE, DYN_IMPORT_RE, BARE_IMPORT_RE]) {
      re.lastIndex = 0 // 全局正则跨文件复用必须归零，否则第二个文件起就一条都找不到
      let m: RegExpExecArray | null
      while ((m = re.exec(body))) {
        const target = resolveSpecifier(files, file, m[1])
        if (target) imported.add(target)
      }
    }
  }
  const orphans = [...files.keys()].filter(
    (f) => !f.endsWith('.d.ts') && !ENTRIES.has(f) && !imported.has(f)
  )
  return { imported, orphans: orphans.sort() }
}

/** 模块指示符 -> 表里的真实键；npm 包与解析不出的返回 null */
function resolveSpecifier(files: Map<string, string>, fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('.')) base = join(ROOT, dirname(fromFile), spec)
  else if (spec.startsWith('@shared/')) base = join(ROOT, 'src/shared', spec.slice('@shared/'.length))
  else if (spec.startsWith('@renderer/')) base = join(ROOT, 'src/renderer/src', spec.slice('@renderer/'.length))
  else if (spec.startsWith('@/')) base = join(ROOT, 'src/renderer/src', spec.slice(2))
  else if (spec.startsWith('@main/')) base = join(ROOT, 'src/main', spec.slice('@main/'.length))
  else return null

  const cands = [
    base + '.ts',
    base + '.tsx',
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ]
  // 顺序要紧：先对 ROOT 取相对路径，再统一成斜杠。
  // 反过来（先换斜杠再 relative）在 Windows 上会让 relative 拿到两种分隔符，返回绝对路径，
  // 于是"谁引了这个文件"永远查不到——455 个文件全被判成孤儿，是量具坏了不是产品死了。
  for (const c of cands) {
    const key = toPosix(relative(ROOT, c))
    if (files.has(key)) return key
  }
  return null
}

function readSrcTree(): Map<string, string> {
  const map = new Map<string, string>()
  for (const abs of walkTs(SRC, [])) {
    const key = relative(ROOT, abs).replace(/\\/g, '/')
    map.set(key, readFileSync(abs, 'utf8'))
  }
  return map
}

const GONE = [
  'src/main/services/llm/vercel-ai-service.ts',
  'src/main/services/observability/llm-trace.ts',
  'src/renderer/src/components/workbench/panels/ProgressPanel.tsx',
  'src/renderer/src/components/workbench/panels/PausePanel.tsx',
]

/** 这四份是"明知一定有人引"的：解析不到就说明量具坏了 */
const WITNESSES = [
  'src/main/core/agent/supervisor.ts',
  'src/main/core/command-gate.ts',
  'src/shared/ipc-channels.ts',
  'src/renderer/src/pages/WorkbenchPage.tsx',
]

describe('src 里不许有整文件无人引（#226 起的常驻闸）', () => {
  it('1. 孤儿集为空——现量并把名字打出来', () => {
    const files = readSrcTree()
    expect(files.size).toBeGreaterThanOrEqual(400)
    const { orphans } = analyze(files)
    expect(orphans, '这些 src 文件没有任何 src 消费者：' + orphans.join(', ')).toEqual([])
  })

  it('2. 四个已判死的文件不许回来', () => {
    for (const rel of GONE) {
      expect(existsSync(join(ROOT, rel)), `还在盘上：${rel}`).toBe(false)
    }
    // 它们的专属测试一起走：留着就是给已删的实现守灵
    for (const t of [
      'tests/services/vercel-ai-service.test.ts',
      'tests/services/llm-trace.test.ts',
      'tests/components/workbench/panels/ProgressPanel.test.tsx',
      'tests/components/workbench/panels/PausePanel.test.tsx',
    ]) {
      expect(existsSync(join(ROOT, t)), `专属测试还在：${t}`).toBe(false)
    }
  })

  it('3. 反过度砍：真在跑的 LLM 路与 AI 面板路必须还在并被引', () => {
    const files = readSrcTree()
    const { imported } = analyze(files)
    for (const live of [
      'src/main/services/llm/client.ts',
      'src/main/services/llm/llm-config-resolver.ts',
      'src/renderer/src/components/workbench/AIPanelHeader.tsx',
      'src/renderer/src/components/workbench/MessageList.tsx',
    ]) {
      expect(existsSync(join(ROOT, live)), `活的实现被误砍：${live}`).toBe(true)
      expect(imported.has(live), `活的实现没人引了：${live}`).toBe(true)
    }
  })

  it('4. 阳性对照：四份明知有人引的文件必须解析得到，否则量具坏了', () => {
    const files = readSrcTree()
    const { imported } = analyze(files)
    const missing = WITNESSES.filter((w) => !imported.has(w))
    expect(missing, '解析不到这些明知在跑的文件 ⇒ 是量具坏了，不是产品死了：' + missing.join(', ')).toEqual([])
  })

  it('5. 负向对照：合成图里只许报出那个真孤儿', () => {
    const synth = new Map<string, string>([
      ['src/main/index.ts', "import { a } from './core/a'"],
      ['src/main/core/a.ts', "export const a = 1\nimport './b'"],
      ['src/main/core/b.ts', 'export const b = 2'],
      ['src/main/core/orphan.ts', 'export const nobodyCallsMe = 3'],
      ['src/main/types.d.ts', 'export type T = number'],
    ])
    const { imported, orphans } = analyze(synth)
    expect(imported.has('src/main/core/a.ts')).toBe(true)
    expect(imported.has('src/main/core/b.ts'), '副作用 import 也算消费者').toBe(true)
    expect(orphans).toEqual(['src/main/core/orphan.ts'])
  })

  it('6. AIPanel 的门牌不许再把两块已删面板写成"迁出在那儿"', () => {
    const text = readFileSync(
      join(ROOT, 'src/renderer/src/components/workbench/AIPanel.tsx'),
      'utf8'
    )
    expect(text).not.toContain('ProgressPanel')
    expect(text).not.toContain('PausePanel')
  })
})
