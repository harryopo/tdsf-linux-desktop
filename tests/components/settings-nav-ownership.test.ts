/**
 * 设置区导航与路由归属（阶段 F3 判据）
 *
 * 缺陷原型 1：SettingsLayout 的左栏列了「AI 引擎」和「关于」，
 * 但这两条路由当年照旧设计稿挂在 SettingsLayout 外面做"独立居中页"。
 * 点导航跳过去 → 整个布局连左栏一起卸载，高亮也丢，用户以为设置页坏了。
 *
 * 缺陷原型 2：左栏与 /settings 目录页各写一份清单，于是目录页有「终端设置」
 * 左栏没有（点进去左栏空白无高亮），目录页还挂着知识库/教程/监控这类非设置入口。
 * 现在两处共读 settings-sections.ts，本测试锁双向：清单 ⊆ 嵌套子路由 且 嵌套子路由 ⊆ 清单。
 *
 * 用静态解析而不是渲染组件：router.tsx 全是 lazy()，在 jsdom 里挂整棵路由树
 * 会拖进十几个页面模块，测的反而不是"归属"这一件事。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const ROUTER = fs.readFileSync(path.join(ROOT, 'src/renderer/src/router.tsx'), 'utf8')
const SECTIONS = fs.readFileSync(
  path.join(ROOT, 'src/renderer/src/pages/settings-sections.ts'),
  'utf8',
)
const LAYOUT = fs.readFileSync(path.join(ROOT, 'src/renderer/src/pages/SettingsLayout.tsx'), 'utf8')
const OVERVIEW = fs.readFileSync(path.join(ROOT, 'src/renderer/src/pages/SettingsPage.tsx'), 'utf8')

/** 章节清单声明的目标地址（去掉前导斜杠，与子路由 path 同口径） */
function sectionTargets(src: string): string[] {
  const block = src.match(/export const SETTINGS_SECTIONS[^=]*=\s*\[([\s\S]*?)\n\]/)
  if (!block) throw new Error('没找到 SETTINGS_SECTIONS 数组——清单结构变了，本测试需同步')
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

/** 嵌套块里的子路由 path（含外层 settings 自身的匹配，由调用处剔掉） */
function nestedChildPaths(block: string): string[] {
  const paths = [...block.matchAll(/<Route\s+(?:index|path="([^"]+)")/g)].map((m) => m[1])
  return paths.filter((p) => p && p !== 'settings')
}

describe('设置区路由归属', () => {
  const targets = sectionTargets(SECTIONS)
  const children = nestedChildPaths(nestedSettingsBlock(ROUTER))

  it('章节清单解析到了内容（不是空跑）', () => {
    expect(targets.length).toBeGreaterThanOrEqual(4)
  })

  it('清单里每一项指向的地址都是 SettingsLayout 的嵌套子路由', () => {
    const missing = targets.filter((t) => !children.includes(t))
    expect(missing, `这些设置项的目标不在 SettingsLayout 里，点进去会卸掉左栏：${missing.join(', ')}`).toEqual([])
  })

  it('每条嵌套子路由都在清单里（左栏与目录页都能到达）', () => {
    const orphan = children.filter((c) => !targets.includes(c))
    expect(orphan, `这些设置子路由没有任何入口：${orphan.join(', ')}`).toEqual([])
  })

  it('router 里不存在挂在 SettingsLayout 之外的 settings/* 路由', () => {
    const standalone = [...ROUTER.matchAll(/<Route\s+path="(settings\/[^"]+)"/g)].map((m) => m[1])
    expect(standalone, `这些路由绕开了设置区布局：${standalone.join(', ')}`).toEqual([])
  })

  it('左栏与目录页都从同一份清单渲染（不再各写一份）', () => {
    expect(LAYOUT).toContain("import { SETTINGS_SECTIONS } from './settings-sections'")
    expect(OVERVIEW).toContain("import { SETTINGS_SECTIONS } from './settings-sections'")
    expect(LAYOUT).not.toMatch(/const SETTINGS_NAV/)
  })

  it('目录页只链到设置区，不再链主功能页', () => {
    const hrefs = [...OVERVIEW.matchAll(/to=['"]\/(?!settings)([^'"]+)['"]/g)].map((m) => m[1])
    expect(hrefs, `设置目录里混进了非设置入口：${hrefs.join(', ')}`).toEqual([])
  })

  it('每个设置子页的标题都取自章节清单（不在页面里各写一份）', () => {
    const pagesDir = path.join(ROOT, 'src/renderer/src/pages')
    const called = new Set<string>()
    for (const file of fs.readdirSync(pagesDir)) {
      if (!file.endsWith('.tsx')) continue
      const src = fs.readFileSync(path.join(pagesDir, file), 'utf8')
      for (const m of src.matchAll(/settingsHeader\('(\/settings\/[^']+)'\)/g)) called.add(m[1])
    }
    const hardcoded = [...new Set(
      targets.filter((t) => !called.has(`/settings/${t}`)),
    )]
    expect(
      hardcoded,
      `这些设置页还在自己写标题/图标/说明，会和左栏漂移：${hardcoded.join(', ')}`,
    ).toEqual([])
  })

  it('关于页不再自带返回条（返回靠常驻左栏）', () => {
    const about = fs.readFileSync(path.join(ROOT, 'src/renderer/src/pages/AboutSettings.tsx'), 'utf8')
    expect(about).not.toContain('set-ab-backbar')
    expect(about).not.toContain('data-dom-id="back-settings"')
  })
})
