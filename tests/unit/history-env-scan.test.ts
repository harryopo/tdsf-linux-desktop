/**
 * 历史值闸（history-env-scan）自己必须能被证伪
 *
 * 为什么单独一份：这道闸 2026-10-04 建好之后一直没有判据文件，
 * 于是"全历史 0 命中"这句话从没被证明过它扫得到东西（同 secret-gate --all 被当成
 * 全史扫描用的那次教训）。2026-10-13 补上申报通道（模型 API 口令）时，
 * 顺手把"申报了要核得动 / 没申报要大声说没核"钉成测试。
 *
 * 全部用例带 --max-revs：只扫最近若干提交树，一趟 1~4 秒。
 * 部分扫描本身也有一条断言（结论必须标注"部分扫描"），因为不标注的部分扫描会被读成 CLEAN。
 */
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const GATE = path.join('scripts', 'security', 'history-env-scan.cjs')

/** 历史里必然存在的串（approval 相关代码与文档都含它），当阳性对照与"该红"的申报值 */
const IN_HISTORY = 'readAp' + 'proval'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-history-env-scan-'))

/** 值来源：键名与值都按运行时拼接，源码里不留 `KEY=value` 形态（否则形态闸会把自己的测试当凭据拦下） */
function valuesFile(name: string): string {
  const p = path.join(tmpRoot, name)
  fs.writeFileSync(p, 'TDSF_SSH_' + 'PASSWORD' + '=' + 'placeholder-value-1234\n', 'utf8')
  return p
}

function anchorFile(name: string, text: string): string {
  const p = path.join(tmpRoot, name)
  fs.writeFileSync(p, text, 'utf8')
  return p
}

function run(args: string[]) {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' })
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const VALUES = valuesFile('env.local')
const NO_ANCHOR = path.join(tmpRoot, 'no-such-anchor.json')

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    /* Windows 偶发占用：临时目录里的东西留在那里，不影响判定 */
  }
})

describe('history-env-scan —— 历史值闸的证伪', () => {
  it('阳性对照：历史里确实存在的串必须扫得到（扫不到就是闸死了）', () => {
    const { rc, out } = run(['--control', IN_HISTORY, '--max-revs', '30'])
    expect(rc, out).toBe(0)
    expect(out).toMatch(/命中 [1-9][0-9]* 处/)
  })

  it('对照反向：不存在的串必须让对照失败（防"对照恒过"）', () => {
    const absent = 'zz-' + Math.random().toString(36).slice(2, 12)
    const { rc, out } = run(['--control', absent, '--max-revs', '30'])
    expect(rc, out).toBe(1)
    expect(out).toContain('扫描器本身失效')
  })

  it('申报的密钥真在历史里 ⇒ 红，且报告不许出现值本身', () => {
    const af = anchorFile('hit.json', JSON.stringify({ 'model-api-key': IN_HISTORY }))
    const { rc, out } = run(['--values', VALUES, '--anchor', af, '--max-revs', '30'])
    expect(rc, out).toBe(1)
    expect(out).toContain('申报:model-api-key')
    expect(out).toContain('仍可在 git 历史中读到')
    // 命中要指得出文件，否则等于只喊狼来了
    expect(out).toMatch(/文件：[\w./-]+/)
    // 值永不回显：整份输出里不许出现申报值原文
    expect(out).not.toContain(IN_HISTORY)
  })

  it('没申报文件 ⇒ 可以放行，但必须大声说"API 口令没核"', () => {
    const { rc, out } = run(['--values', VALUES, '--anchor', NO_ANCHOR, '--max-revs', '30'])
    expect(rc, out).toBe(0)
    expect(out).toContain('未申报额外密钥')
    expect(out).toContain('模型 API 口令未申报、未核对')
    // 申报数为 0 时，核对键数那行必须把 env/申报 拆开写，别让人以为核过密钥
    expect(out).toMatch(/env 1 \+ 申报 0/)
  })

  it('申报文件存在却没有任何可用值 ⇒ 红（申报了却没核得动 = 放行证）', () => {
    const af = anchorFile('empty.json', '{}')
    const { rc, out } = run(['--values', VALUES, '--anchor', af, '--max-revs', '30'])
    expect(rc, out).toBe(1)
    expect(out).toContain('没有任何长度 ≥6 的申报值')
  })

  it('申报文件不是合法 JSON ⇒ 红，不许当成"没有申报"', () => {
    const af = anchorFile('broken.json', '{ 这不是 JSON')
    const { rc, out } = run(['--values', VALUES, '--anchor', af, '--max-revs', '30'])
    expect(rc, out).toBe(1)
    expect(out).toContain('不是合法 JSON')
  })

  it('部分扫描必须在结论里标注（不标注的部分扫描会被读成全历史 CLEAN）', () => {
    const { rc, out } = run(['--values', VALUES, '--anchor', NO_ANCHOR, '--max-revs', '5'])
    expect(rc, out).toBe(0)
    const cleanLine = out.split('\n').find((l) => l.includes('结论: CLEAN')) || ''
    expect(cleanLine, 'CLEAN 那行必须自带"部分扫描"标注').toContain('部分扫描')
  })

  it('范围开关 fail-closed：--max-revs 不是正整数、缺值、以及未知参数，都得红', () => {
    for (const bad of ['abc', '0', '1.5']) {
      const { rc, out } = run(['--values', VALUES, '--max-revs', bad])
      expect(rc, '--max-revs ' + bad + ' 不该被接受：' + out).toBe(1)
      expect(out).toContain('正整数')
    }
    const missing = run(['--values', VALUES, '--max-revs'])
    expect(missing.rc, missing.out).toBe(1)
    expect(missing.out).toContain('正整数')

    // 负数走的是另一条路：它长得像个参数，被"未知参数"白名单挡下（同样 fail-closed）
    const negative = run(['--values', VALUES, '--max-revs', '-3'])
    expect(negative.rc, negative.out).toBe(1)
    expect(negative.out).toContain('未知参数')

    const typo = run(['--traked'])
    expect(typo.rc, typo.out).toBe(1)
    expect(typo.out).toContain('未知参数')
  })
})
