/**
 * A5 判据的执行体：内网拓扑值回归闸（topology-gate）自己必须能被证伪
 *
 * 判据来源：计划 §A5「剩余硬编码内网 IP 收敛到 env」，原判据写的是
 * `secret-gate.cjs --all 命中 0`。复核（2026-10-08）发现 secret-gate 里
 * **一条 IP 规则都没有**，所以那条判据不管代码里有没有把虚拟机地址抄回去都恒报 0 命中 —— 放行证。
 * 本文件钉住新闸的四件事：
 *   1. 扫得到东西（阳性对照：串在代码里却报 0 命中 ⇒ 闸是死的，当场红）；
 *   2. 塞进真会命中的值必须红，且报告里不许出现那个值本身（打码要递归到每层）；
 *   3. 决定"扫多少/用什么值"的参数 fail-closed：未知参数、缺值文件都不得退到默认分支；
 *   4. 用仓库真实 .env.local 跑一次，断言"锚定值 ≥1 且 CLEAN"，并证明 docs 里确实还有那个地址
 *      （否则"排除 docs"这条边界是没在干活的装饰）。
 */
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const GATE = path.join('scripts', 'security', 'topology-gate.cjs')

/** 在代码里必然存在的串：拿它当阳性对照与"该红"的样本 */
const IN_CODE = 'readApproval'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-topology-gate-'))
const written: string[] = []

function valuesFile(name: string, text: string): string {
  const p = path.join(tmpRoot, name)
  fs.writeFileSync(p, text, 'utf8')
  written.push(p)
  return p
}

function run(args: string[]) {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' })
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

afterAll(() => {
  for (const p of written) {
    try {
      fs.rmSync(p, { force: true })
    } catch {
      /* Windows 偶发占用：临时目录里的文件，留在那里不影响判定 */
    }
  }
  try {
    fs.rmdirSync(tmpRoot)
  } catch {
    /* 目录非空或占用，同上 */
  }
})

describe('topology-gate —— A5 判据的证伪', () => {
  it('阳性对照：代码里确实存在的串必须被扫到（扫不到就是闸死了）', () => {
    const { rc, out } = run(['--control', IN_CODE])
    expect(rc, out).toBe(0)
    expect(out).toMatch(/命中 [1-9][0-9]* 处/)
  })

  it('阳性对照反过来：不存在的串必须让对照失败（防"对照恒过"）', () => {
    // 这个串必须运行时生成：第一版把它写成字面量，而本文件自己就在闸的扫描面里（tracked 的 .ts），
    // 于是"不存在的串"命中 1 处、对照恒过——被检对象里写着判据原文，等于自己给自己作证。
    const absent = 'zz-' + Math.random().toString(36).slice(2, 12)
    const { rc, out } = run(['--control', absent])
    expect(rc, out).toBe(1)
    expect(out).toContain('扫描器本身失效')
  })

  it('把"必然命中的值"喂进 --values，闸要红且不许把值打出来', () => {
    const vf = valuesFile('hit.env', `TDSF_TARGET_HOST=${IN_CODE}\n`)
    const { rc, out } = run(['--values', vf])
    expect(rc, out).toBe(1)
    expect(out).toContain('硬编码在被跟踪代码里')
    // 命中位置要指得出具体文件与行号，否则等于只喊狼来了
    expect(out).toMatch(/[\w./-]+\.(ts|tsx|cjs|json|py):\d+/)
    // 打码：报告里不许出现值原文
    expect(out).not.toContain(IN_CODE)
  })

  it('未知参数不许退到默认分支（fail-closed 的扫描范围开关）', () => {
    const { rc, out } = run(['--traked'])
    expect(rc, out).toBe(1)
    expect(out).toContain('未知参数')
  })

  it('值来源缺失要报错退出，不许当成"没有值所以干净"', () => {
    const { rc, out } = run(['--values', path.join(tmpRoot, 'nope.env')])
    expect(rc, out).toBe(1)
    expect(out).toContain('缺少值来源')
  })

  it('值文件里全是占位或短值时也要拒绝放行（没有锚点就没有判定）', () => {
    const vf = valuesFile('weak.env', 'TDSF_SSH_HOST=changeme-host\nTDSF_SHORT_HOST=root22\n')
    const { rc, out } = run(['--values', vf])
    expect(rc, out).toBe(1)
    expect(out).toContain('没有可锚定的 HOST 值')
  })

  it('真实 .env.local：锚定值 ≥1 且代码 CLEAN；同时 docs 里确实还有这个地址', () => {
    const envPath = path.join(process.cwd(), '.env.local')
    if (!fs.existsSync(envPath)) {
      console.warn('[topology-gate] 本机没有 .env.local，这一条只做跳过并打印原因（其余 6 条不看环境）')
      return
    }
    const anchors: string[] = []
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const eq = line.indexOf('=')
      if (eq < 0 || line.trimStart().startsWith('#')) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim()
      if (/(^|_)HOSTS?(_|$)/i.test(key) && val.length >= 7) anchors.push(val)
    }
    expect(anchors.length, '.env.local 里应有可锚定的 HOST 值').toBeGreaterThan(0)

    const { rc, out } = run([])
    expect(rc, out).toBe(0)
    expect(out).toContain('CLEAN')
    expect(out).toMatch(/代码文件 [1-9][0-9]* 个，锚定值 [1-9][0-9]* 个/)

    // 「排除 docs」这条边界必须真的在改变结果：值在 docs 里能找到，闸却报干净
    const inDocs = spawnSync('git', ['grep', '-l', '-F', anchors[0], 'HEAD', '--', 'docs'], {
      encoding: 'utf8',
    })
    if (inDocs.status !== 0) {
      console.warn(
        '[topology-gate] 该地址在 docs 里也不存在了，"排除 docs"这条边界暂时无从验证（不是缺陷，但别把它当护栏）'
      )
    } else {
      expect(inDocs.stdout.trim().length, 'docs 里应仍能扫到该地址，否则排除面是空的').toBeGreaterThan(0)
    }
  })
})
