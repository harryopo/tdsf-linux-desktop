/**
 * 退出 antd 第 3 批：悬浮提示与右键菜单
 *
 * Tooltip 换成自研（radix tooltip 包一层，content 为空即不出现），
 * 右键菜单换成 ui/ContextMenu（radix dropdown-menu + 光标处 0 尺寸 trigger 当锚点）。
 * 换完这两类，global.css 里 .ant-tooltip* 与 .ant-dropdown* 两组覆盖整组删掉（21 处 !important）。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(p, acc)
    else if (/\.tsx$/.test(e.name)) acc.push(p)
  }
  return acc
}

const files = walk('src/renderer/src')

describe('悬浮提示与菜单已统一到自研原语', () => {
  it('没有任何文件从 antd 导入 Tooltip / Dropdown / MenuProps', () => {
    const hits = files
      .map((rel) => ({
        rel,
        stmt: (read(rel).match(/import\s*\{[^}]*\}\s*from\s*'antd'/g) ?? []).filter((s) =>
          /\b(Tooltip|Dropdown|MenuProps)\b/.test(s)
        ),
      }))
      .filter((x) => x.stmt.length > 0)
      .map((x) => x.rel)
    expect(hits, `又引回 antd 的提示/菜单了：\n${hits.join('\n')}`).toEqual([])
  })

  it('global.css 里 .ant-tooltip 与 .ant-dropdown 覆盖已随迁移删除', () => {
    const css = read('src/renderer/src/styles/global.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/\.ant-tooltip/)
    expect(css).not.toMatch(/\.ant-dropdown/)
  })

  it('右键菜单用光标锚定的 0 尺寸 trigger，而不是新引一个 radix 包', () => {
    const overlay = read('src/renderer/src/ui/overlay.tsx')
    expect(overlay).toMatch(/function ContextMenu/)
    expect(overlay).toMatch(/pointerEvents: 'none'/)
    // 不新增依赖：package.json 里不该出现 context-menu 专用包
    const pkg = read('package.json')
    expect(pkg).not.toMatch(/@radix-ui\/react-context-menu/)
  })
})
