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

  it('六个出口全部改走带标记的截断（模型 3 个 + 文件 1 个 + 界面预览 2 个 + 提示词 1 个）', () => {
    const src = readFileSync('src/main/core/agent/supervisor.ts', 'utf8')
    for (const needle of [
      'limitToolTextOnly(r.stdout, TOOL_STDOUT_CHAR_LIMIT',
      'limitToolTextOnly(r.stderr, TOOL_STDERR_CHAR_LIMIT',
      'limitToolText(safe, TOOL_STDOUT_CHAR_LIMIT',
      'limitToolTextOnly(outStr, TOOL_EVENT_PREVIEW_CHAR_LIMIT',
      'limitToolTextOnly(inputStr, TOOL_INPUT_PREVIEW_CHAR_LIMIT',
      'limitToolTextOnly(top.content, PROMPT_SNIPPET_CHAR_LIMIT',
      'limitToolTextOnly(output, PROMPT_SNIPPET_CHAR_LIMIT',
    ]) {
      expect(src, `缺接线：${needle}`).toContain(needle)
    }
  })
})
