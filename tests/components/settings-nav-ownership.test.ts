/**
 * 设置区导航与路由归属（阶段 F3 判据）
 *
 * 缺陷原型：SettingsLayout 的左栏列了「AI 引擎」和「关于」，
 * 但这两条路由当年照旧设计稿挂在 SettingsLayout 外面做"独立居中页"。
 * 点导航跳过去 → 整个布局连左栏一起卸载，高亮也丢，用户以为设置页坏了。
 *
 * 本测试锁住结构事实：导航指向的每个地址，都必须是 SettingsLayout 的嵌套子路由。
 * 用静态解析而不是渲染组件：router.tsx 全是 lazy()，在 jsdom 里挂整棵路由树
 * 会拖进十几个页面模块，测的反而不是"归属"这一件事。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const ROUTER = fs.readFileSync(path.join(ROOT, 'src/renderer/src/router.tsx'), 'utf8')
const LAYOUT = fs.readFileSync(path.join(ROOT, 'src/renderer/src/pages/SettingsLayout.tsx'), 'utf8')

/** 左栏导航声明的目标地址（去掉前导斜杠，与子路由 path 同口径） */
function navTargets(src: string): string[] {
  const block = src.match(/const SETTINGS_NAV[^=]*=\s*\[([\s\S]*?)\]/)
  if (!block) throw new Error('没找到 SETTINGS_NAV 数组——导航表结构变了，本测试需同步')
  return [...block[1].matchAll(/to:\s*'\/settings\/([^']+)'/g)].map((m) => m[1])
}

/** 截取 <Route path="settings" element={<SettingsLayout />}> 与其闭合标签之间的嵌套块 */
function nestedSettingsBlock(src: string): string {
  const open = src.match(/<Route\s+path="settings"\s+element=\{<SettingsLayout\s*\/>\}>/)
  if (!open) throw new Error('没找到 SettingsLayout 的路由挂载点')
  const rest = src.slice(open.index!)
  // 子路由一律是自闭合的，所以第一个 </Route> 就是这组的闭合
  const close = rest.indexOf('\n            </Route>')
  if (close < 0) throw new Error('SettingsLayout 路由组没有闭合——router.tsx 结构变了')
  return rest.slice(0, close)
}

/** 嵌套块里的子路由 path */
function nestedChildPaths(block: string): string[] {
  const paths = [...block.matchAll(/<Route\s+(?:index|path="([^"]+)")/g)].map((m) => m[1] ?? '(index)')
  return paths.filter(Boolean)
}

describe('设置区路由归属', () => {
  const targets = navTargets(LAYOUT)
  const children = nestedChildPaths(nestedSettingsBlock(ROUTER))

  it('导航表与嵌套子路由都解析到了内容（不是空跑）', () => {
    expect(targets.length).toBeGreaterThanOrEqual(4)
    expect(children.length).toBeGreaterThanOrEqual(targets.length)
  })

  it('左栏每一项指向的地址都是 SettingsLayout 的嵌套子路由', () => {
    const missing = targets.filter((t) => !children.includes(t))
    expect(missing, `这些导航项的目标不在 SettingsLayout 里，点进去会卸掉左栏：${missing.join(', ')}`).toEqual([])
  })

  it('router 里不存在挂在 SettingsLayout 之外的 settings/* 路由', () => {
    const standalone = [...ROUTER.matchAll(/<Route\s+path="(settings\/[^"]+)"/g)].map((m) => m[1])
    expect(standalone, `这些路由绕开了设置区布局：${standalone.join(', ')}`).toEqual([])
  })

  it('关于页不再自带返回条（返回靠常驻左栏）', () => {
    const about = fs.readFileSync(path.join(ROOT, 'src/renderer/src/pages/AboutSettings.tsx'), 'utf8')
    expect(about).not.toContain('set-ab-backbar')
    expect(about).not.toContain('data-dom-id="back-settings"')
  })
})
