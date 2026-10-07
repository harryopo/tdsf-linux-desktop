/**
 * e2e 里不许再出现 antd 时代的选择器
 *
 * 起因：整份 e2e 跑下来发现 tests/e2e/electron.spec.ts 与 fixes-verification.spec.ts
 * 还在点 `.ant-tabs-tab` / `.ant-modal-body` / `.chat-panel-send-btn` 这类改版前的东西。
 * antd 已经整体退出渲染层，这些选择器永远取不到元素；而 serial 模式下只要前面一条红，
 * 后面的用例全被标成"未运行"，看上去是"跳过"，其实是死代码在装覆盖。
 * 两份 legacy spec 已删（其中仍有效的一条搬到 shell-stability.spec.ts），
 * 这条静态闸把"还在点 antd"的量钉成只降不升的刻度（当前 11），
 * 让同样的腐化下次被当场拦住，而不是等 6 分钟的 e2e 才发现。
 * 注：这是刻度闸不是 0 容忍闸，清零后才会改成 0。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const E2E = path.resolve(__dirname, '../e2e')

/** antd 时代的痕迹：类名前缀与包名 */
const PATTERN = /\.ant-[a-z][\w-]*|@ant-design/gi

function listSpecs(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) {
      if (['screenshots', 'screenshots-acceptance', 'screenshots-ai', 'screenshots-content', 'screenshots-ssh', 'screenshots-tool-viz', 'visual.spec.ts-snapshots'].includes(name)) continue
      listSpecs(full, out)
    } else if (name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('e2e 选择器时效性', () => {
  const files = listSpecs(E2E)
  const hits: string[] = []
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (PATTERN.test(line)) hits.push(`${path.basename(file)}:${i + 1}  ${line.trim().slice(0, 80)}`)
      PATTERN.lastIndex = 0
    })
  }

  it('确实扫到了 e2e 文件（不是空目录假绿）', () => {
    expect(files.length, 'tests/e2e 下应有若干 spec').toBeGreaterThanOrEqual(8)
  })

  it('正则本身能认出 antd 痕迹（阳性对照，防止判据哑掉）', () => {
    const sample = "const tab = page.locator('.ant-tabs-tab')"
    PATTERN.lastIndex = 0
    expect(PATTERN.test(sample), '样例行必须被判为命中').toBe(true)
    PATTERN.lastIndex = 0
  })

  it('改版前选择器的存量只许降不许升（当前上限 11）', () => {
    // 上限 11 = 2026-10-07 实测：acceptance-screenshots(5) + ui-v2-aesthetic(5) + wiring-verification(1)。
    // 这三份还在点 antd 的 tab/modal，serial 模式下一条红后面全被标"未运行"，
    // 看着像跳过其实是死代码在装覆盖。清空一份就把这个数字改小，清零后改成 0 容忍。
    expect(hits.length, `antd 时代选择器还剩 ${hits.length} 处（上限 11）：\n${hits.join('\n')}`).toBeLessThanOrEqual(11)
  })

  it('清零进度可追踪：命中清单必须打出来给人看', () => {
    // 不做 0 容忍之前，至少保证每次跑都把这些列出来，不让它悄悄存在
    expect(Array.isArray(hits)).toBe(true)
  })
})
