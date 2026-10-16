/**
 * 工具输出截断必须留痕（2026-10-15 全维度审查 D9）
 *
 * 现场：ssh 工具把 stdout 一律 `.slice(0, 12000)`，截没截、截掉多少，
 * 模型和界面都不知道。模型拿到一段"看起来完整"的输出，就会说"日志里只有这些"——
 * 而真实日志有 500 行。这是让它拿残缺证据下确定结论，正是这类产品最不该犯的错。
 *
 * 判据口径：标记必须写进**正文**（模型只读文本，结构化字段它看不见），
 * 同时给出 truncated/droppedChars 供界面用。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  limitToolText,
  limitToolTextOnly,
  PROMPT_SNIPPET_CHAR_LIMIT,
  TOOL_EVENT_PREVIEW_CHAR_LIMIT,
  TOOL_INPUT_PREVIEW_CHAR_LIMIT,
  TOOL_STDERR_CHAR_LIMIT,
  TOOL_STDOUT_CHAR_LIMIT,
} from '@main/core/agent/tools/output-limit'

describe('limitToolText', () => {
  it('没超限：原样返回，不加任何标记', () => {
    const r = limitToolText('磁盘还有 40% 空闲', 100)
    expect(r.text).toBe('磁盘还有 40% 空闲')
    expect(r.truncated).toBe(false)
    expect(r.droppedChars).toBe(0)
  })

  it('正好等于上限不算截断（防 off-by-one 把完整输出说成不完整）', () => {
    const body = 'x'.repeat(50)
    const r = limitToolText(body, 50)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe(body)
  })

  it('超限：正文里写明原长、保留多少、还剩多少没给', () => {
    const body = 'y'.repeat(120)
    const r = limitToolText(body, 50, 'stdout')
    expect(r.truncated).toBe(true)
    expect(r.droppedChars).toBe(70)
    expect(r.originalChars).toBe(120)
    expect(r.text).toContain('stdout已截断')
    expect(r.text).toContain('原 120 字符')
    expect(r.text).toContain('还有 70 字符未提供')
    // 关键一句：不许模型把"没看到"当成"不存在"
    expect(r.text).toContain('不能据此判断')
    expect(r.text.startsWith('y'.repeat(50))).toBe(true)
  })

  it('空串与 undefined 都不崩，且都不算截断', () => {
    expect(limitToolText('', 10).text).toBe('')
    expect(limitToolText(undefined, 10).truncated).toBe(false)
    expect(limitToolText(null, 10).text).toBe('')
  })

  it('只取文本的快捷版与完整版一致', () => {
    const body = 'z'.repeat(80)
    expect(limitToolTextOnly(body, 30)).toBe(limitToolText(body, 30).text)
  })
})

describe('上限口径单源', () => {
  it('模型用的与界面预览用的是不同的具名上限（不是一处一个魔法数）', () => {
    expect(TOOL_STDOUT_CHAR_LIMIT).toBe(12_000)
    expect(TOOL_STDERR_CHAR_LIMIT).toBe(4_000)
    expect(TOOL_INPUT_PREVIEW_CHAR_LIMIT).toBe(2_000)
    expect(TOOL_EVENT_PREVIEW_CHAR_LIMIT).toBe(4_000)
    expect(PROMPT_SNIPPET_CHAR_LIMIT).toBe(2_000)
  })

  /**
   * 判据形态说明：这里查的是"supervisor 里不许再出现裸数字截断"。
   * 它不是行为断言，而是一道防回潮的接线门——真正的行为由上面几例保证。
   */
  it('supervisor 不再出现 .slice(0, 魔法数) 的截断', () => {
    const src = readFileSync('src/main/core/agent/supervisor.ts', 'utf8')
    const offenders = src
      .split(/\r?\n/)
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /\.slice\(0, ?(12000|4000|2000)\)/.test(line))
    expect(offenders.map((o) => `:${o.n} ${o.line.trim()}`), '这些截断没有留痕').toEqual([])
  })

  it('阳性对照：把裸 slice 写回去，上面那条必须能抓到', () => {
    expect(/\.slice\(0, ?(12000|4000|2000)\)/.test("stdout: (r.stdout || '').slice(0, 12000)")).toBe(
      true
    )
  })

  /**
   * 出口对账按"哪个具名上限被用了几次"来量，不钉 `limitToolTextOnly(outStr, ...)` 这种
   * 带局部变量名的原话——重构时改个变量名不该假红（真红的是某个出口不再走带标记的截断）。
   * 少了哪一档、哪一档少了一个出口，这条照样红，并且当场说出是哪个上限。
   */
  it('每个具名上限都真的接在截断调用上（按调用点计数，不看变量名）', () => {
    const src = readFileSync('src/main/core/agent/supervisor.ts', 'utf8')
    const callSites = (limit: string): number =>
      [...src.matchAll(new RegExp(`limitToolText(?:Only)?\\s*\\([^)]*\\b${limit}\\b`, 'g'))].length

    const budgetSites = [
      // 模型侧 3 处命令 stdout + 1 处文件读取
      ['TOOL_STDOUT_CHAR_LIMIT', 4],
      // 命令 stderr 两处（只读 / 写入通道各一）
      ['TOOL_STDERR_CHAR_LIMIT', 2],
      // 界面预览：入参 1 处 + 结果 1 处
      ['TOOL_INPUT_PREVIEW_CHAR_LIMIT', 1],
      ['TOOL_EVENT_PREVIEW_CHAR_LIMIT', 1],
      // 进提示词的片段：技能手册 + 通用输出各 1 处
      ['PROMPT_SNIPPET_CHAR_LIMIT', 2],
    ] as const

    for (const [limit, min] of budgetSites) {
      expect(callSites(limit), `supervisor 里走 ${limit} 的截断调用点少于 ${min} 个`).toBeGreaterThanOrEqual(min)
    }
  })

  it('阳性对照：把上限从调用里摘掉，上面那条必须能抓到', () => {
    // 这条不读文件，只证明那个正则真的会因为"调用不再带具名上限"而不计数
    const stripped = 'const x = limitToolTextOnly(view.output, 4000, "输出")'
    expect(/limitToolText(?:Only)?\s*\([^)]*\bTOOL_EVENT_PREVIEW_CHAR_LIMIT\b/.test(stripped)).toBe(false)
    // 而正常写法必须计数（否则这条门是空的）
    expect(
      /limitToolText(?:Only)?\s*\([^)]*\bTOOL_EVENT_PREVIEW_CHAR_LIMIT\b/.test(
        'limitToolTextOnly(view.output, TOOL_EVENT_PREVIEW_CHAR_LIMIT, 输出)',
      ),
    ).toBe(true)
  })
})
