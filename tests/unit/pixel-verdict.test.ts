/**
 * 像素判据（F5）的可证伪判据
 *
 * 逻辑本体在 scripts/design/pixel-verdict.mjs（纯函数），这里注入假读数验证它会红。
 * 为什么单独测函数而不跑 ui-audit.mjs：那支要真起 Electron 窗口、最小化还会挂住截图，
 * 放进单测就变成一条每天靠运气的慢判据。函数能证伪，接线由最后两条结构核对兜住。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import * as ts from 'typescript'

const ROOT = path.resolve(__dirname, '../..')
const PROBE = path.join(ROOT, 'scripts/design/ui-audit.mjs')

interface Shot {
  name: string
  kind: string
  bytes: number
  hash: string
}

let pixelVerdict: (log: Shot[], opts?: { noShots?: boolean; limits?: Record<string, number> }) => Verdict
let limits: { shotMin: number; pageShotMin: number; blankBytes: number; bootName: string }

/** 造一份"该过"的账本：boot 两张 + 18 张互不相同的模块页 + 补齐到下限 */

interface Verdict {
  bad: string[]
  notes: string[]
}

/**
 * 说明符走变量：字面量会被 tsc 解析成"没有声明文件的 .mjs 模块"（TS7016）而 .mjs 也不该为一条
 * 判据去补 .d.ts；运行时 vite 仍按本文件的相对路径解析。
 */
const MODULE_SPEC = '../../scripts/design/pixel-verdict.mjs'

beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ MODULE_SPEC)) as {
    pixelVerdict: typeof pixelVerdict
    PIXEL_LIMITS: typeof limits
  }
  pixelVerdict = mod.pixelVerdict
  limits = mod.PIXEL_LIMITS
})

function page(i: number): Shot {
  return { name: `${String(i).padStart(2, '0')}-page-${i}.png`, kind: 'page', bytes: 60_000, hash: `h-page-${i}` }
}
function other(name: string, hash: string, bytes = 40_000): Shot {
  return { name, kind: 'other', bytes, hash }
}
function healthy(): Shot[] {
  const shots: Shot[] = [other('00-boot-early.png', 'h-boot-early'), other(limits.bootName, 'h-boot-late')]
  for (let i = 0; i < 18; i++) shots.push(page(i))
  while (shots.length < limits.shotMin) shots.push(other(`zz-${shots.length}.png`, `h-other-${shots.length}`))
  return shots
}

describe('像素判据（截图互不相同 / 张数 / 非空白）', () => {
  it('达标读数一条不红（反向对照，否则这条闸只会误伤）', () => {
    const v = pixelVerdict(healthy())
    expect(v.bad, v.bad.join('\n')).toEqual([])
  })

  it('两张模块页像素一致必须红，并点名是哪两张', () => {
    const shots = healthy()
    shots[4] = { ...shots[4], hash: shots[3].hash }
    const v = pixelVerdict(shots)
    expect(v.bad.join('\n'), '同一帧算两页＝导航没发生，这条必须说话').toMatch(/像素完全一致/)
    expect(v.bad.join('\n')).toContain(shots[3].name)
    expect(v.bad.join('\n')).toContain(shots[4].name)
  })

  it('模块页与启动页同帧 → 判定"路由没切过去"', () => {
    const shots = healthy()
    shots[6] = { ...shots[6], hash: 'h-boot-late' }
    const v = pixelVerdict(shots)
    expect(v.bad.join('\n')).toMatch(/和启动页像素一致/)
  })

  it('低于空白帧字节线 → 点名那张（张张不同也可能是整屏空白）', () => {
    const shots = healthy()
    shots[5] = { ...shots[5], bytes: limits.blankBytes - 1 }
    const v = pixelVerdict(shots)
    expect(v.bad.join('\n')).toMatch(/空白帧/)
    expect(v.bad.join('\n')).toContain(shots[5].name)
  })

  it('取证中途断掉（张数不足）→ 红，不把"没跑完"当通过', () => {
    const shots = healthy().slice(0, limits.shotMin - 4)
    const v = pixelVerdict(shots)
    expect(v.bad.join('\n')).toMatch(/只写出 \d+ 张截图/)
  })

  it('拿不到启动页那张 → 明说这条判据无从成立（不是沉默放行）', () => {
    const shots = healthy().filter((s) => s.name !== limits.bootName)
    const v = pixelVerdict(shots)
    expect(v.bad.join('\n')).toMatch(/无从成立/)
  })

  it('--no-shots 只记"未跑"，不判红也不判过', () => {
    const v = pixelVerdict([], { noShots: true })
    expect(v.bad).toEqual([])
    expect(v.notes.join(' ')).toMatch(/未跑/)
  })

  it('弹窗/菜单两张同帧不许红（假阳性防线：那条射程只管模块页）', () => {
    const shots = healthy()
    shots.push(other('14-modal-form-connect.png', 'same-dialog-frame'))
    shots.push(other('14-dialog-confirm.png', 'same-dialog-frame'))
    const v = pixelVerdict(shots)
    expect(v.bad, v.bad.join('\n')).toEqual([])
  })

  it('页太少（探针没走完路由表）单独说话', () => {
    const shots = [other('00-boot-early.png', 'a'), other(limits.bootName, 'b')]
    for (let i = 0; i < limits.pageShotMin - 1; i++) shots.push(page(i))
    while (shots.length < limits.shotMin) shots.push(other(`qq-${shots.length}.png`, `q-${shots.length}`))
    const v = pixelVerdict(shots)
    expect(v.bad.join('\n')).toMatch(/模块页截图只写出/)
  })

  it('接线核对：探针脚本真的把账本交给了这条判据', () => {
    const src = fs.readFileSync(PROBE, 'utf8')
    const sf = ts.createSourceFile(PROBE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    let callsVerdict = false
    let logsInShot = false
    let pageKindPassed = false
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText()
        if (callee === 'pixelVerdict' && n.arguments.length >= 1) callsVerdict = true
        if (callee === 'shot' && n.arguments.length >= 3 && n.arguments[2].getText().includes("'page'")) pageKindPassed = true
      }
      if (ts.isFunctionDeclaration(n) && n.name?.getText() === 'shot') {
        const body = n.body?.getText() || ''
        if (body.includes('SHOT_LOG.push')) logsInShot = true
      }
      ts.forEachChild(n, walk)
    }
    walk(sf)
    expect(callsVerdict, 'ui-audit 没把截图账本交给 pixelVerdict，这条判据等于没接上').toBe(true)
    expect(logsInShot, 'shot() 没往 SHOT_LOG 记账，交给判据的永远是空表').toBe(true)
    expect(pageKindPassed, '路由表那一圈没标 kind=page，"只比模块页"就落空').toBe(true)
  })
})
