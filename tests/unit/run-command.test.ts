/**
 * 外部命令统一入口（P1-9）
 *
 * 两件事分开钉：
 * 1. runCommand 的行为 —— 超时真的会杀进程、输出上限真的拦得住、非零退出与
 *    命令不存在要分得开（调用方要能分别处置）；
 * 2. src/main 里不许再有"裸的外部命令调用" —— AST 静态断言 + 注入式阴性对照。
 *    判据不钉源码字符串，也不按行号（行号一动就假红）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'
import { vi, describe, expect, it } from 'vitest'
import {
  CommandFailedError,
  CommandOutputTooLargeError,
  CommandTimeoutError,
  runCommand,
} from '../../src/main/services/exec/run-command'

// 本文件的每条用例都要起一个真子进程跑门禁脚本：全量并行时 20 秒全局预算不够（现量见
// scripts/quality/subprocess-test-timeout.cjs 的文件头），所以只给这一份放宽。
vi.setConfig({ testTimeout: 60000 })

const ROOT = path.resolve(__dirname, '../..')
const NODE = process.execPath

describe('runCommand · 行为', () => {
  it('正常跑完拿到 stdout 与退出码', async () => {
    const r = await runCommand(NODE, ['-e', 'console.log("hi")'], { label: 'node echo' })
    expect(r.stdout.trim()).toBe('hi')
    expect(r.code).toBe(0)
  })

  it('卡住的命令必须被超时杀掉并抛 CommandTimeoutError（这条就是 P1-9 的本体）', async () => {
    const startedAt = Date.now()
    await expect(
      runCommand(NODE, ['-e', 'setTimeout(() => {}, 60000)'], { label: 'node hang', timeoutMs: 400 })
    ).rejects.toBeInstanceOf(CommandTimeoutError)
    // 超时是真的生效，不是"恰好等到它自己结束"
    expect(Date.now() - startedAt).toBeLessThan(5000)
  }, 15_000)

  it('输出超限直接终止，不把主进程内存吃光', async () => {
    await expect(
      runCommand(NODE, ['-e', 'console.log("x".repeat(4_000_000))'], {
        label: 'node spew',
        maxBufferBytes: 1_000_000,
      })
    ).rejects.toBeInstanceOf(CommandOutputTooLargeError)
  }, 20_000)

  it('非零退出抛 CommandFailedError，错误里带退出码', async () => {
    const e = await runCommand(NODE, ['-e', 'process.exit(3)'], { label: 'node exit3' }).catch(
      (x: unknown) => x
    )
    expect(e).toBeInstanceOf(CommandFailedError)
    expect((e as CommandFailedError).code).toBe('E_COMMAND_EXIT')
    expect((e as Error).message).toContain('退出码 3')
  })

  it('命令不存在时只报 label，不把 argv 泄进错误文本', async () => {
    const e = await runCommand('tdsf-no-such-binary-xyz', ['--secret-path=/p/k'], {
      label: '不存在的命令',
    }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(CommandFailedError)
    expect((e as CommandFailedError).code).toBe('E_COMMAND_SPAWN')
    expect((e as Error).message).not.toContain('--secret-path')
  })

  it('等输入的指令不会挂住：stdin 是 ignore，读到 EOF 就往下走', async () => {
    // `read x` 在没有 stdin 时立刻拿到 EOF；换成不给 stdin 的裸 spawn 就是永久 pending
    const r = await runCommand(NODE, ['-e', 'let s="";process.stdin.on("data",d=>s+=d);' +
      'process.stdin.on("end",()=>console.log("eof:"+s.length))'], { label: 'node stdin eof' })
    expect(r.stdout.trim()).toBe('eof:0')
  }, 15_000)
})

/* ------------------------------------------------------------------ *
 * 静态闸：src/main 里不许出现"没有超时、又不在豁免名单上"的外部命令调用
 * ------------------------------------------------------------------ */

const CHILD_FNS = new Set(['execFile', 'execFileSync', 'spawn', 'spawnSync', 'exec', 'execSync'])

/**
 * 豁免名单：每条都要写清为什么可以不经过 runCommand。
 * 加名字的同时必须加理由 —— 空理由等于没审。
 */
const EXEMPT: Record<string, string> = {
  'src/main/services/exec/run-command.ts': '这一层就是统一入口本身，spawn 只能出现在这里',
  'src/main/core/sidecar/sidecar-manager.ts': '常驻 Python sidecar：生命周期由启停握手管，不该被 kill 定时器杀',
  'src/main/services/log/drain3-bridge.ts': '常驻 Drain3 桥：同上，按行读 JSON 响应直到进程自己结束',
}

/** 找出一个文件里"从 node:child_process 引进来、且没带 timeout"的调用 */
function bareChildCalls(file: string): string[] {
  const text = readSourceFile(file)
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true)
  const localNames = new Set<string>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue
    const spec = (st.moduleSpecifier as ts.StringLiteral).text
    if (spec !== 'node:child_process' && spec !== 'child_process') continue
    const nb = st.importClause.namedBindings
    if (!nb || !ts.isNamedImports(nb)) continue
    for (const el of nb.elements) localNames.add((el.name as ts.Identifier).text)
  }
  if (!localNames.size) return []

  const hits: string[] = []
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      localNames.has(node.expression.text) &&
      CHILD_FNS.has(node.expression.text)
    ) {
      const hasTimeout = node.arguments
        .slice(1)
        .some(
          (a) =>
            ts.isObjectLiteralExpression(a) &&
            a.properties.some(
              (p) =>
                ts.isPropertyAssignment(p) &&
                ((ts.isIdentifier(p.name) && p.name.text === 'timeout') ||
                  (ts.isStringLiteral(p.name) && p.name.text === 'timeout'))
            )
        )
      if (!hasTimeout) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/')
        hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return hits
}

/**
 * 扫描根。第二个是探针专用目录：静态判据要"注入一条假的才证明闸有牙"，
 * 但把假文件写进 src/main 会撞坏另外十几个普查 src 的测试
 * （它们"先列目录再读文件"，撞上探针被删的窗口就是随机 ENOENT —— 实测红过三个）。
 * 分类器是同一个，所以把探针放在 src 外面并不削弱自证；
 * 而"walk 真能覆盖到 src/main"由下面那条豁免名单测试负责。
 */
const SCAN_ROOTS = ['src/main', 'tests/fixtures/static-gates']

function childCallSites(): string[] {
  return SCAN_ROOTS.flatMap((r) =>
    listSourceFiles(path.join(ROOT, r)).flatMap((f) => bareChildCalls(f))
  )
}

describe('外部命令调用点 · 必须带超时或走统一入口', () => {
  it('src/main 里没有"裸的、没超时的"外部命令调用', () => {
    const offenders = childCallSites().filter((site) => {
      const file = site.split(':')[0]
      return !EXEMPT[file]
    })
    expect(
      offenders,
      `这些调用点没走 runCommand、也没显式 timeout（外部命令一阻塞 handler 就永久 pending）：${offenders.join(', ')}`
    ).toEqual([])
  })

  it('豁免名单里的文件必须真的还有裸调用（防止豁免变成僵尸条款）', () => {
    const sites = new Set(childCallSites().map((s) => s.split(':')[0]))
    for (const [file, reason] of Object.entries(EXEMPT)) {
      if (reason.length < 8) throw new Error(`${file} 的豁免理由太短，等于没写`)
      if (!sites.has(file)) {
        throw new Error(`${file} 已无裸调用，豁免该删掉（理由：${reason}）`)
      }
    }
  })

  it('注入一条裸 spawn 的假文件，这条闸必须变红（量具自证）', () => {
    const dir = path.join(ROOT, 'tests/fixtures/static-gates')
    const fake = path.join(dir, '__exec-canary__.ts')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      fake,
      "import { spawn } from 'node:child_process'\nexport const p = spawn('git', ['status'])\n",
      'utf8'
    )
    try {
      const hits = childCallSites().filter((s) => s.includes('__exec-canary__'))
      expect(hits.length, '假文件没被抓到 → 这条闸没有牙').toBeGreaterThan(0)
    } finally {
      fs.rmSync(fake, { force: true })
    }
  })
})
