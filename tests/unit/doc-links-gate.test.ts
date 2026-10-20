/**
 * doc-links 闸的判据本身要能被跑红（常驻，别只在 CI 里指望它）
 *
 * 钉三件事：
 *  1. 闸的阳性对照必须过 —— 它现在除了断链还判"文档里的 文件.ts:行号 引用对不对得上现场"，
 *     这两条新判据各自配了必失败样本（见 doc-links.cjs 的 selfTest），样本抓不到就当场红。
 *  2. 真扫当前必须 0 处（断链 / 死引用 / 行号越界 / 歧义），红了就是有人在文档里写了不存在的坐标。
 *  3. 豁免名单里声明的每一个名字必须**真的被用到过**——
 *     一条没人用的豁免等于给将来同名的死引用提前开的许可证，这种"宽松一档就静默少干活"
 *     本项目已经付过学费（见记忆 feedback-instrument-fitness-must-falsify 第 26 条）。
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const SCRIPT = path.join(ROOT, 'scripts/quality/doc-links.cjs')

function run(args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  })
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

describe('doc-links 闸', () => {
  it('阳性对照必须过：断链、仓库外、死引用、行号越界四类样本都要被抓到，活引用不许误报', () => {
    const r = run(['--self-test'])
    expect(r.out, '自检输出：\n' + r.out).toMatch(/自检 OK/)
    expect(r.rc, '--self-test 退出码非 0，说明这条闸自己坏了').toBe(0)
  })

  it('真扫当前必须干净（断链 0 / 死引用 0 / 越界 0 / 歧义 0 / 裸路径幽灵 0 / 机器绝对路径 0）', () => {
    const r = run(['--json'])
    expect(r.rc, '闸报红：\n' + r.out).toBe(0)
    const json = JSON.parse(r.out)
    expect(json.dead, '有断链：' + JSON.stringify(json.dead)).toEqual([])
    expect(json.refMissing, '文档里有指向不存在文件的行号引用').toEqual([])
    expect(json.refBeyond, '文档里的行号已经越过正本末尾（多半是删过代码没回头改文档）').toEqual([])
    expect(json.refAmbiguous, '有写法歧义的引用（同名候选多于一个，请补全路径）').toEqual([])
    expect(json.bareGhostFile, '文档里引用了不存在的路径（幽灵表行那一类：文件/通道/preload 方法名都不存在）').toEqual([])
    expect(json.bareGhostDir, '文档里引用了不存在的目录（单复数写错也是这一类）').toEqual([])
    expect(json.bareAbspath, '文档里写了本机盘符开头的绝对路径（访客那台机器永远打不开）').toEqual([])
    expect(json.docs, '扫描面里一份 markdown 都没有，这条闸等于摆设').toBeGreaterThan(10)
  })

  it('豁免必须真的在用：src/utils/hub.js 这种依赖内部路径两种写法都走同一条豁免', () => {
    const json = JSON.parse(run(['--json']).out) as {
      refExternal: Array<{ target: string }>
    }
    const names = json.refExternal.map((h) => h.target.split(':')[0].split('/').pop())
    expect(new Set(names).size, '豁免读数里出现名单外的名字：\n' + JSON.stringify(json.refExternal)).toBe(1)
    // 同一个依赖文件被引用了两次（带行号 + 裸路径），说明两条判据共用一份名单没分叉
    expect(json.refExternal.length, 'hub.js 的两种引用形状应当都被计入同一条豁免').toBeGreaterThanOrEqual(2)
  })

  it('每一条声明过的第三方豁免都必须真的在文档里被用到（不许留空豁免）', () => {
    const declared = [
      ...fs
        .readFileSync(SCRIPT, 'utf8')
        .matchAll(/const EXTERNAL_CODE_REFS = new Set\(\[([^\]]*)\]\)/g),
    ]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
      .sort()
    expect(declared.length, '没从闸的源码里解析出豁免名单，判据无从对齐').toBeGreaterThan(0)

    const json = JSON.parse(run(['--json']).out) as { refExternal: Array<{ target: string }> }
    const used = [...new Set(json.refExternal.map((h) => h.target.split(':')[0].split('/').pop()))].sort()
    expect(used, '名单里声明了但文档里没人引用的豁免（把它删掉，别给将来留许可证）').toEqual(declared)
  })
})
