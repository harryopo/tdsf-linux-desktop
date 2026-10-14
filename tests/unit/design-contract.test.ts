/**
 * 设计契约闸（DESIGN.md ↔ 代码）
 *
 * 真正的判定逻辑在 scripts/design/design-contract.mjs，这里只做三件事：
 * 1) 把它接进 pnpm test，让"文档和令牌漂移"跟单元测试失败同权重；
 * 2) 断言这个闸本身不是空跑（负向对照见下）；
 * 3) 断言它不依赖任何外部命令（Windows 上没有 grep/wc，旧实现因此整机失效 —— P1-6）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { describe, expect, it, beforeAll } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const SCRIPT = path.join(ROOT, 'scripts/design/design-contract.mjs')
const DOC = path.join(ROOT, 'DESIGN.md')
/**
 * 下面"改错文档数字"那条判据要临时改这份**被跟踪的**文档，所以动笔前先落一份字节备份。
 * 2026-10-14 实测踩过：一次全量跑把 12px 留在了 DESIGN.md 上就再没还原，
 * 于是后面每一条判据都读到改坏的文档——一条判据把整份文档毒了，红的三条全是它的影子。
 * 备份让下一次开跑能自愈，并且把"上一轮被中途杀掉"这件事说出口，而不是留下无痕的红。
 */
const DOC_BAK = `${DOC}.tdsf-test-bak`

function runContract(env?: NodeJS.ProcessEnv) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--json'], { cwd: ROOT, encoding: 'utf8', env })
    return { code: 0, json: parseJson(out, 'stdout'), raw: out }
  } catch (err) {
    // 闸崩掉时 stdout 往往不是 JSON（旧实现里 grep 不在 PATH 就是这样）。
    // 直接把原始输出放进断言消息，别用 '{}' 兜底把真因盖成 "problems undefined"。
    // execFileSync 非零退出抛的是带 stdout/status/stderr 的 NodeError，但声明是 unknown，
    // 这里给一个最小形状（三处取值共用这一次收窄）。
    const e = err as { stdout?: string; stderr?: string; status?: number }
    const out = e.stdout || ''
    return { code: e.status ?? 1, json: parseJson(out, 'stdout'), raw: out, stderr: e.stderr || '' }
  }
}

interface ContractReport {
  problems: string[]
  notes: string[]
}

function parseJson(out: string, label: string): ContractReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error(`设计闸的 --json 输出不是 JSON（${label} 前 400 字）：\n${out.slice(0, 400)}`)
  }
  // 缺键=闸坏了，宁可在这里红，也不要让后面的 .length 拿到 undefined
  const { problems, notes } = parsed as { problems?: unknown; notes?: unknown }
  if (!Array.isArray(problems) || !Array.isArray(notes)) {
    throw new Error(`闸没返回 problems/notes 数组，输出：\n${out.slice(0, 400)}`)
  }
  return { problems: problems as string[], notes: notes as string[] }
}

describe('设计契约（DESIGN.md 与代码同源）', () => {
  beforeAll(() => {
    if (!fs.existsSync(DOC_BAK)) return
    const bak = fs.readFileSync(DOC_BAK)
    fs.writeFileSync(DOC, bak)
    fs.rmSync(DOC_BAK, { force: true })
    throw new Error(
      '上一轮跑把 DESIGN.md 留在了被改坏的状态（备份文件还在）—— 本轮已从字节备份还原。\n' +
        '这说明那次是在"改坏文档"和"还原"之间被中途杀掉的（worker 超时 / CI 取消 / 断电）。',
    )
  })

  it('当前全部条款成立', () => {
    const r = runContract()
    expect(Array.isArray(r.json.problems), `闸没返回 problems 数组，输出：\n${r.raw.slice(0, 400)}`).toBe(true)
    expect(r.json.problems, (r.json.problems || []).join('\n')).toEqual([])
    expect(r.code).toBe(0)
  })

  it('闸确实扫到了条款，不是空跑（负向对照）', () => {
    const r = runContract()
    // 债务刻度三条 + 页面自写 h1 一条，少一条说明某个 grep 或解析失效了
    expect(Array.isArray(r.json.notes), `闸没返回 notes 数组，输出：\n${r.raw.slice(0, 400)}`).toBe(true)
    expect(r.json.notes.length, `只回收到 ${r.json.notes.length} 条刻度记录`).toBeGreaterThanOrEqual(3)
  })

  it('把文档数字改错，闸必须报漂移（证明它真的在比对）', () => {
    const original = fs.readFileSync(DOC) // 按字节存，还原时不经过任何重编码
    const text = original.toString('utf8')
    const broken = text.replace('`--ui-font-micro` | 11px', '`--ui-font-micro` | 12px')
    expect(
      broken,
      '夹具没改到东西：DESIGN.md 的字阶表里找不到「`--ui-font-micro` | 11px」。' +
        '两种可能：表格写法变了（判据要跟着改），或上一轮中途被杀、盘上这格已经是 12px。',
    ).not.toBe(text)
    // 顺序是判据的一部分：先落备份再动文档，两者之间被杀掉才留得下还原的凭据
    fs.writeFileSync(DOC_BAK, original)
    fs.writeFileSync(DOC, broken, 'utf8')
    try {
      const r = runContract()
      expect(r.code, '改错文档数字后闸仍然放行 = 这条闸是摆设').not.toBe(0)
      expect(r.json.problems.join('\n')).toMatch(/--ui-font-micro：DESIGN\.md 写 12px/)
    } finally {
      fs.writeFileSync(DOC, original)
      if (!fs.readFileSync(DOC).equals(original)) {
        throw new Error('DESIGN.md 没还原成动笔前的字节 —— 后面的判据会读被改坏的文档并连环报红')
      }
      fs.rmSync(DOC_BAK, { force: true })
    }
  })

  it('不依赖外部命令：把 PATH 清成空目录后读数必须一模一样', () => {
    // Windows 上 grep/wc 不在系统 PATH（装了 Git Bash 的机器才有），旧实现用
    // execSync('grep ... | wc -l') 数债务刻度，于是这道闸在纯净 Windows 环境里必崩，
    // 且崩掉后 --json 输出为空 —— 调用方拿不到 problems，等于门禁消失。
    // 这条判据不查源码字符串，直接把外部工具拿不到手再跑一遍。
    const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-no-tools-'))
    const bareEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      // Windows 环境变量名不区分大小写，PATH 与 Path 会同时存在，两个都要摘
      if (v === undefined || k.toLowerCase() === 'path') continue
      bareEnv[k] = v
    }
    bareEnv.PATH = emptyBin
    try {
      // 先自证量具：这个 PATH 下必须真的找不到 grep，否则这条判据是空跑
      const probe = spawnSync('grep', ['--version'], { env: bareEnv, encoding: 'utf8' })
      const grepReachable = probe.error === undefined && probe.status === 0
      expect(grepReachable, `探针失效：清空后的 PATH（${emptyBin}）里仍能跑到 grep`).toBe(false)

      const withTools = runContract()
      const without = runContract(bareEnv as NodeJS.ProcessEnv)
      expect(
        without.code,
        `摘掉外部命令后闸退出码 ${without.code}，说明还在偷偷依赖 shell 工具。stderr：\n${String(without.stderr).slice(0, 500)}`,
      ).toBe(0)
      expect(without.json.problems, '摘掉外部命令后 problems 变了').toEqual(withTools.json.problems)
      expect(without.json.notes, '摘掉外部命令后债务刻度读数变了').toEqual(withTools.json.notes)
    } finally {
      fs.rmSync(emptyBin, { recursive: true, force: true })
    }
  })
})
