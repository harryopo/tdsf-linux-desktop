/**
 * 退出 antd 第 1 批：message 不许再回来
 *
 * 提示条已经从 antd 的 message.* 换成 sonner 的 toast.*（App.tsx 里挂了 Toaster）。
 * 换掉之后 .ant-message-* 那组 !important 覆盖也一起删了。
 * 这里钉住三件事，防止以后图省事又把 antd 的 message 引回来：
 *   1. 没有任何文件从 antd 导入 message
 *   2. 渲染层不再出现 message.success/error/info/warning 这类调用
 *   3. global.css 里不再有 .ant-message 选择器
 * 目的是把 global.css 的活跃 !important 从 187 降到目标 < 80（阶段 E 判据）。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 返回相对仓库根、统一正斜杠的路径列表 */
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

const files = walk('src/renderer/src')

describe('提示条已统一到 sonner toast', () => {
  it('扫到了源码文件（不是空跑）', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('没有文件从 antd 导入 message', () => {
    const hits = files
      .map((rel) => ({ rel, stmt: read(rel).match(/import\s*\{([^}]*)\}\s*from\s*'antd'/g) ?? [] }))
      .filter((x) => x.stmt.some((s) => /\bmessage\b/.test(s)))
      .map((x) => x.rel)
    expect(hits, `这些文件还从 antd 导入 message：\n${hits.join('\n')}`).toEqual([])
  })

  it('渲染层不再有 message.success/error/info/warning 调用', () => {
    const hits = files
      .map((rel) => ({
        rel,
        n: (read(rel).match(/\bmessage\.(success|error|info|warning|warn|loading)\(/g) ?? []).length,
      }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.rel}×${x.n}`)
    expect(hits, `还在调用 antd message：\n${hits.join('\n')}`).toEqual([])
  })

  it('global.css 里 .ant-message 覆盖已随迁移删除', () => {
    // 只看规则：注释里交代"哪七条被删了"是处置记录，不算回流
    const css = read('src/renderer/src/styles/global.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/\.ant-message/)
  })

  it('antd 静态方法调用为 0（Modal.confirm / notification.*）', () => {
    const hits = files
      .filter((rel) => rel !== 'src/renderer/src/main.tsx') // 那处只剩说明性注释
      .map((rel) => ({
        rel,
        n: (read(rel).match(/\bModal\.(confirm|info|success|error|warning|useModal)\s*\(/g) ?? [])
          .length + (read(rel).match(/\bnotification\.[a-z]+\(/g) ?? []).length,
      }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.rel}×${x.n}`)
    expect(
      hits,
      `又有人用 antd 静态方法（React 19 下依赖官方补丁）：\n${hits.join('\n')}`,
    ).toEqual([])
  })

  it('确认框宿主挂在 App 里，否则 confirmDialog 的 Promise 永远不 resolve', () => {
    const app = read('src/renderer/src/App.tsx')
    expect(app).toMatch(/import \{[^}]*ConfirmHost[^}]*\} from '\.\/ui'/)
    expect(app).toMatch(/<ConfirmHost\s*\/>/)
  })
})
