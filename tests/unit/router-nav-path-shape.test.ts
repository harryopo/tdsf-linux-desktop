/**
 * 路由跳转的参数形状：navigate/to 一律给绝对路径，不许带 `#` 前缀
 *
 * 起因（用户 2026-10-16 实测："连接新主机点击没反应"）：应用用 HashRouter，
 * 有人把浏览器地址栏写法 `#/settings/ssh` 当成了路由地址。react-router 的
 * parsePath 会把 `#` 之后的部分解析成 **hash**、前面的空字符串则"不改动 pathname"，
 * 于是 navigate('#/settings/ssh') 的结果是"留在当前页 + 追加一段畸形 hash"，
 * 界面一动不动——按钮看着是活的，点了没反应，地址栏还多出一个 `#/settings/ssh` 尾巴。
 *
 * 这类写法静态读代码很容易看漏（字符串"看起来就是个地址"），所以做成常驻闸：
 * 扫 src/renderer 下每个跳转参数，命中 `#` 前缀就报文件行号。
 *
 * 三条判据缺一不可：
 *   1. 真源码里 0 命中（这次的修复）
 *   2. 扫描器对已知的错写法必须报红（阳性对照——否则"0 命中"只是量具坏了）
 *   3. 真源码里必须扫到 >0 个合法跳转（证明扫的东西就是路由器在用那些出口）
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'out') continue
      tsFiles(p, acc)
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      acc.push(p)
    }
  }
  return acc
}

/** 跳转出口：navigate(<参数>) 与 to=<参数>（Link / NavLink / Navigate 共用这个名字） */
const NAV_ARG = /(?:\bnavigate\s*\(|\bto\s*=\{?)(['"`])([^'"`]*)\1/g

/**
 * 一条源码算不算"把 hash 写进了路由参数"。
 *
 * 单独抽成纯函数是为了让阳性对照能直接喂给它：闸说"0 命中"之前，
 * 得先证明同样的闸咬得住已知的错写法。
 */
function isHashPrefixedTarget(target: string): boolean {
  return target.startsWith('#')
}

interface NavSite {
  file: string
  line: number
  target: string
}

function navSites(): NavSite[] {
  const out: NavSite[] = []
  for (const f of tsFiles(path.join(ROOT, 'src', 'renderer'))) {
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(NAV_ARG)) {
      const target = m[2]
      // 空参数是 <Navigate> 之外的动态写法（to={x}），扫不到字符串就该放过，不许误报
      if (!target) continue
      out.push({
        file: path.relative(ROOT, f).replace(/\\/g, '/'),
        line: text.slice(0, m.index).split('\n').length,
        target,
      })
    }
  }
  return out
}

describe('路由跳转参数不许带 # 前缀', () => {
  const sites = navSites()

  it('扫描器确实扫到了跳转出口（闸不能只对空气生效）', () => {
    expect(
      sites.length,
      'src/renderer 下没扫到任何 navigate()/to= 的字符串参数，说明这个闸的匹配式失效了',
    ).toBeGreaterThan(0)
  })

  it('真源码里 0 个 # 前缀目标', () => {
    const bad = sites
      .filter((s) => isHashPrefixedTarget(s.target))
      .map((s) => `${s.file}:${s.line} -> ${JSON.stringify(s.target)}`)
    expect(
      bad,
      `这些跳转载荷把浏览器地址栏写法当成了路由地址，点了不会换页：\n${bad.join('\n')}\n` +
        `正确写法：navigate('/settings/ssh')（HashRouter 自己负责 # 前缀）`,
    ).toEqual([])
  })

  it('阳性对照：已知的错写法必须被判出来', () => {
    const samples = ['#/settings/ssh', '#/workbench', '#/']
    for (const s of samples) {
      expect(isHashPrefixedTarget(s), `"${s}"是这次致坏的具体形状，闸必须认得`).toBe(true)
    }
    // 反向：合法写法不许误判，否则这条闸只会逼人绕路
    for (const ok of ['/settings/ssh', '/workbench', '../model']) {
      expect(isHashPrefixedTarget(ok), `"${ok}"是正常路由地址，不许误报`).toBe(false)
    }
  })
})
