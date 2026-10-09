/**
 * cn() 的字阶登记闸（2026-10-08 查出）
 *
 * 病因：tailwind-merge 只认识 Tailwind 自带档位，本项目自定义的 `text-head` / `text-md` / `text-micro`
 * 会被当成**颜色类**（`text-*` 默认进 text-color 组）。于是 `cn('text-md text-ink')` 把前一个当冲突丢掉，
 * 界面上字号静默退回继承值——源码看着完全正常，全仓 179 行都踩在这个上面（AI 输入框 11px 就是这么查出来的）。
 *
 * 这里钉三件事：
 *   1. **每一个** CSS 里定义的字阶档位与颜色共存时都还得活着（登记生效）；
 *   2. 真冲突（两个颜色 / 两个字阶）仍然只留最后一个（没把合并器关掉）；
 *   3. 档位清单只从 tailwind.css 取，取空了就把"第一条恒绿"这件事本身揭穿。
 *    （原来第 3 条是"档位名必须出现在 utils.ts 的登记表里"，配一份写死的白名单——
 *     新增的 --text-title / --text-splash 先被白名单丢掉，那条永远绿，13 处 text-title 就这么过了闸。）
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { cn } from '@renderer/components/trae/utils'

/**
 * 档位全集只来自 CSS 单源：把 `--text-<档位>` 全捞出来，只排除 Tailwind 用作行高副变量的
 * `--text-<档位>--line-height`。
 *
 * 上一版这里用一份写死的名字白名单去 filter 扫描结果，等于"只检查我打算检查的那几档"——
 * 后来新增的 --text-title / --text-splash 先被白名单丢掉，第三条用例永远绿，
 * 于是同一批 13 处 text-title 就这么过了闸（真出问题是审查 agent 拿 tailwind-merge 实跑出来的）。
 */
const TIERS_FROM_THEME = [
  ...new Set(
    [...fs
      .readFileSync(path.join(process.cwd(), 'src/renderer/src/styles/tailwind.css'), 'utf8')
      .matchAll(/^[ \t]*--text-([a-z0-9]+):/gm)]
      .map((m) => m[1])
  ),
]

describe('cn() 字阶登记', () => {
  it('自定义字阶与颜色类共存：两个都留（登记生效）', () => {
    for (const tier of TIERS_FROM_THEME) {
      const merged = cn(`text-${tier} text-ink`)
      expect(merged, `text-${tier} 被 tailwind-merge 当成颜色类吞掉了`).toContain(`text-${tier}`)
      expect(merged).toContain('text-ink')
    }
  })

  it('真冲突仍然只留最后一个（没把合并器关掉）', () => {
    expect(cn('text-ink text-ink-mute')).toBe('text-ink-mute')
    expect(cn('text-md text-head')).toBe('text-head')
    expect(cn('px-2 px-4')).toBe('px-4')
  })

  it('取数面：档位确实来自 CSS（扫空了第一条就恒绿）', () => {
    expect(TIERS_FROM_THEME.length, '应当从 tailwind.css 扫出整套自定义字阶').toBeGreaterThanOrEqual(10)
    // text-sm 这类 Tailwind 自带档位不需要登记，所以"是否登记了"不是判据；
    // 判据是第一条用例那个**效果**：与颜色类共存时字号还在。这里只钉取数本身有结果。
    expect(TIERS_FROM_THEME).toContain('composer')
    expect(TIERS_FROM_THEME).toContain('title')
    expect(TIERS_FROM_THEME).toContain('splash')
  })
})
