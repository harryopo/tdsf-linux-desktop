/**
 * 悬空相对 import 常驻闸（#282）
 *
 * 起因：#281 整删入站 MCP 一族后，`scripts/test-sidecar-integration.ts` 还在
 * `import { DiagnosticsService } from '../src/main/services/diagnostics/diagnostics-service'`
 * ——那个文件 2026-10-24 就随 #206 没了。它为什么能一直躺着：
 * ① 这类手工探针脚本不在 `package.json` 的 scripts 里，也没进 CI，**没人跑它就没人报错**；
 * ② `typecheck:node` 的 tsconfig 只罩 `src/main` 等生产面，脚本目录不在里面；
 * ③ `deadcode:gate`（knip）按"有没有人引用"判，引用一个不存在的文件对它来说不是死码，是看不见；
 * ④ `doc:links` 只扫 markdown，代码注释里那句"LogAnalyzer 还在用"它管不着。
 * ⇒ 全量跑一万条也不会红，只有真去点那条脚本才发现。这类"结构性断链"必须有闸。
 *
 * 口径与边界（刻意窄，免假红）：
 * - 只判**以 `.` 开头的相对说明符**，且只从 AST 上取（`import ... from`、`export ... from`、
 *   `import('...')`、`require('...')`）。字符串常量里出现同样的句子（判据常写
 *   `toContain("import { X } from './settings-sections'")`）**不算**——这是用 AST 而不是正则的原因。
 * - 别名（`@/`、`@shared/`、`node:`、裸包名）一律不判：那些由 tsc/vite/打包器解析，红在这里没有信息量。
 * - 取数面是 `git ls-files`（跟踪集），不是本地目录遍历：嵌套检出与本机 scratch 不参与。
 * - 解析候选按 tsconfig 的 `resolveJsonModule` 与实际写法给全：原样路径、`.ts/.tsx/.d.ts/.js/.mjs/.cjs/.json`、
 *   目录下的 `index.*`。
 */
import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as ts from 'typescript'

const ROOT = path.resolve(__dirname, '../..')

// 本文件每条用例都可能起一个 git 子进程；全量并行时 20 秒全局预算不够（口径见
// scripts/quality/subprocess-test-timeout.cjs 的文件头），所以只给这一份放宽。
vi.setConfig({ testTimeout: 60000 })

/** 一条断链：文件、行号、原样说明符 */
interface DanglingImport {
  file: string
  line: number
  specifier: string
}

/** tsconfig 允许的形状：写全扩展名的直接判在，没写的按候选后缀补 */
const SUFFIXES = ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.cjs', '.json']
const INDEXES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs']

function resolves(baseAbs: string): boolean {
  if (fs.existsSync(baseAbs) && fs.statSync(baseAbs).isFile()) return true
  for (const s of SUFFIXES) {
    if (fs.existsSync(baseAbs + s)) return true
  }
  for (const i of INDEXES) {
    const p = path.join(baseAbs, i)
    if (fs.existsSync(p)) return true
  }
  return false
}

/** 收集一个源文件里所有"真的是模块语法"的相对说明符（AST，不吃字符串常量） */
function relativeSpecifiers(sourceText: string, fileName: string): Array<{ specifier: string; line: number }> {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const found: Array<{ specifier: string; line: number }> = []
  const push = (node: ts.Expression | undefined): void => {
    if (!node || !ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return
    const specifier = node.text
    if (!specifier.startsWith('.')) return
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    found.push({ specifier, line: line + 1 })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      push(node.moduleSpecifier)
    } else if (ts.isCallExpression(node)) {
      // 只认 `import('...')` 与 `require('...')` 两种调用；`import x = require('y')` 那种
      // TS 独有写法本仓没有一处，故不去碰 ExternalModuleReference 的 argument/arguments——
      // 那个属性名在 TypeScript 版本间漂过（本仓踩过 AST 属性漂移的坑），少判一种写法比留一条会随版本炸的尺子好。
      const callee = node.expression
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require'
      if (isDynamicImport || isRequire) push(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/** 给定文件与其正文，返回它身上那些落不到的相对 import */
function findDanglingInFile(relFile: string, sourceText: string): DanglingImport[] {
  const dir = path.dirname(path.join(ROOT, relFile))
  const out: DanglingImport[] = []
  for (const { specifier, line } of relativeSpecifiers(sourceText, path.join(ROOT, relFile))) {
    if (!resolves(path.resolve(dir, specifier))) {
      out.push({ file: relFile.split(path.sep).join('/'), line, specifier })
    }
  }
  return out
}

/** 跟踪集里所有 TS 源文件（含 scripts/ 与 tests/，正是没人 typecheck 的那两面） */
function trackedTsFiles(): string[] {
  const raw = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  return raw
    .split('\0')
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
}

describe('悬空相对 import 常驻闸（#282）', () => {
  it('1. 全仓跟踪集里不许有落不到的相对 import', () => {
    const files = trackedTsFiles()
    // 量具自证：先证明取数面不是空的，否则"零命中"可以靠什么都没扫来恒绿
    expect(files.length, '一个 TS 文件都没取到——那不是零断链，那是没扫').toBeGreaterThan(400)
    const dangling: DanglingImport[] = []
    for (const rel of files) {
      const abs = path.join(ROOT, rel)
      if (!fs.existsSync(abs)) continue // 跟踪集与工作区瞬时不一致（别人刚删），不算断链
      dangling.push(...findDanglingInFile(rel, fs.readFileSync(abs, 'utf8')))
    }
    expect(
      dangling.map((d) => `${d.file}:${d.line}: ${d.specifier}`),
      '这些相对 import 指向的文件不存在——生产链路不会报错，只有真去跑它的那一刻才知道坏了'
    ).toEqual([])
  })

  it('2. 阳性对照：同一把尺必须抓到一条明知断链的 import', () => {
    const sample = [
      "import { A } from './definitely-not-here'",
      "export * from './also-not-here'",
      "const b = await import('./runtime-missing')",
      "const c = require('./cjs-missing')",
    ].join('\n')
    const hits = findDanglingInFile('src/main/__probe__.ts', sample)
    expect(hits.map((h) => h.specifier).sort()).toEqual(
      ['./also-not-here', './cjs-missing', './definitely-not-here', './runtime-missing'].sort()
    )
    expect(hits.map((h) => h.line).sort()).toEqual([1, 2, 3, 4])
  })

  it('3. 阴性对照：真在的文件与字符串常量都不许报（尺子不能见词就喊）', () => {
    const rel = 'src/main/core/sidecar/sidecar-manager.ts'
    const real = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    expect(findDanglingInFile(rel, real), '这个文件的 import 本来是全的——报了就是尺子坏').toEqual([])
    // 判据里常见的写法：句子出现在字符串里，不是模块语法
    const onlyStrings = [
      "const probe = \"import { X } from './not-a-real-file'\",",
      "expect(text).toContain(\"import('./also-not-a-real-file')\")",
      "expect(require('node:fs')).toBeTruthy()",
      "import * as fs from 'node:fs'",
      "import { Button } from '@/ui'",
    ].join('\n')
    expect(findDanglingInFile('tests/unit/__probe__.ts', onlyStrings)).toEqual([])
  })
})
