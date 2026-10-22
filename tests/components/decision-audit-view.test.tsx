// @vitest-environment jsdom
/**
 * 决策审计链的界面表态必须诚实（任务 #174）
 *
 * 这一版把详情页那张表从"打开时现编"改成"读库里那一份"，界面上的说法必须跟着改口径：
 *
 *   1. 有行且完好 → 才许说"链校验通过"，并把行数报出来；
 *   2. 库里 0 行 → 不许出现"校验通过"字样：仓储对空链也返回 intact=true（没有可断的链 ≠ 断），
 *      界面要是照抄 intact 就会把"没有留痕"演成"验证过了"；
 *   3. 断链 → 指出断在第几行，并把那一行标出来；
 *   4. 渲染层只排版：内容来自 props，页面不自己算哈希（源码级判据在最后一组）。
 *
 * 判据的负向对照是第 2 条：把空态渲染成"通过"，这个文件必须红。
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DecisionAuditRow } from '@shared/models'
import { ExecutionResult } from '@renderer/components/decision/ExecutionResult'
import { parseCommandSegments, toAuditRows, auditChainStatus } from '@renderer/utils/decision-mappers'

const ROOT = resolve(__dirname, '../..')

const HEX = (seed: string, n: number): string => {
  let s = `${seed}-${n}`
  for (let i = 0; i < 4; i++) s = `${s}${s.length.toString(16)}`
  return s.padEnd(64, '0').slice(0, 64)
}

/** 库里的三行（seq 由 DB 自增；时间戳是事件自己的时刻） */
function dbRows(): DecisionAuditRow[] {
  return [
    {
      seq: 11,
      decisionId: 'dc_1',
      timestamp: 1_700_000_000_000,
      actor: 'Log Collector',
      action: '证据落定 · /var/log/syslog',
      result: 'completed',
      prevHash: HEX('genesis', 11),
      hash: HEX('a', 11),
    },
    {
      seq: 12,
      decisionId: 'dc_1',
      timestamp: 1_700_000_001_000,
      actor: 'Risk Engine',
      action: '风险评估 · MEDIUM · 45 分',
      result: 'completed',
      prevHash: HEX('a', 11),
      hash: HEX('b', 12),
    },
    {
      seq: 13,
      decisionId: 'dc_1',
      timestamp: 1_700_000_002_000,
      actor: 'Executor',
      action: '发送终端 · journalctl --vacuum-size=200M',
      result: 'blocked',
      prevHash: HEX('b', 12),
      hash: HEX('c', 13),
    },
  ]
}

function renderTable(status: 'ok' | 'broken' | 'empty' | 'unavailable', rows = dbRows(), brokenAtSeq: number | null = 12) {
  return render(
    <ExecutionResult
      decisionId="dc_1"
      commandSegments={parseCommandSegments('journalctl --vacuum-size=200M')}
      impact="日志分区"
      rollback="N/A"
      auditRows={toAuditRows(rows)}
      auditStatus={status}
      auditBrokenAtSeq={brokenAtSeq}
      mode="readonly"
      statusLabel="已执行"
    />
  )
}

describe('审计链的界面表态', () => {
  it('链完好：徽章报行数，表格把库里的动作原样列出来', () => {
    renderTable('ok')
    expect(document.querySelector('[data-dom-id="audit-chain-badge"]')?.textContent).toContain('链校验通过 · 3 行')
    // 只排版不改写：库里那一行的文字必须原样出现
    expect(document.body.textContent).toContain('证据落定 · /var/log/syslog')
    expect(document.body.textContent).toContain('发送终端 · journalctl --vacuum-size=200M')
    expect(document.querySelectorAll('[data-dom-id="audit-row"]')).toHaveLength(3)
    // 行号来自库里，不是渲染层自己数的
    expect(document.querySelector('[data-dom-id="audit-row"]')?.textContent).toContain('#11')
  })

  it('断链：说断在第几行，并把那一行标出来', () => {
    renderTable('broken')
    expect(document.querySelector('[data-dom-id="audit-chain-badge"]')?.textContent).toContain('链校验未通过')
    const note = document.querySelector('[data-dom-id="audit-broken-note"]')
    expect(note?.textContent).toContain('第 12 行')
    const broken = document.querySelector('[data-audit-broken="true"]')
    expect(broken, '断点那一行没有任何标记＝用户看不出哪一行不可信').toBeTruthy()
    expect(broken?.textContent).toContain('风险评估 · MEDIUM · 45 分')
  })

  it('库里 0 行：不许出现"校验通过"，要说明没有留痕', () => {
    renderTable('empty', [])
    const badgeText = document.querySelector('[data-dom-id="audit-chain-badge"]')?.textContent ?? ''
    expect(badgeText).toContain('这条记录没有审计链')
    expect(
      document.body.textContent,
      '"没有可断的链"不等于"校验通过"：空态必须说没留痕'
    ).not.toContain('校验通过')
    expect(document.querySelector('[data-dom-id="audit-empty-note"]')).toBeTruthy()
    expect(document.querySelectorAll('[data-dom-id="audit-row"]')).toHaveLength(0)
  })

  it('读不到：说读不到，不冒充空记录也不冒充通过', () => {
    renderTable('unavailable', [])
    const badgeText = document.querySelector('[data-dom-id="audit-chain-badge"]')?.textContent ?? ''
    expect(badgeText).toContain('审计链读不到')
    expect(document.body.textContent).not.toContain('校验通过')
    expect(document.querySelector('[data-dom-id="audit-unavailable-note"]')).toBeTruthy()
  })

  it('六种结果档位都有中文标签（漏一档就会在运行时画出一个 undefined tag）', () => {
    const results = ['passed', 'completed', 'waiting', 'pending', 'failed', 'blocked'] as const
    const rows = results.map((result, i) => ({
      ...dbRows()[0],
      seq: 21 + i,
      result,
      action: `档位演练 · ${result}`,
    }))
    renderTable('ok', rows)
    const tags = Array.from(document.querySelectorAll('[data-dom-id="audit-row"]')).map(
      (row) => row.lastElementChild?.textContent
    )
    expect(tags).toEqual(['通过', '完成', '等待', '待触发', '失败', '拦截'])
  })
})

describe('status 判定与源码接线', () => {
  it('auditChainStatus：0 行判 empty，不看 intact', () => {
    expect(
      auditChainStatus({ rows: [], intact: true, brokenAtSeq: null, expectedHash: null, storedHash: null })
    ).toBe('empty')
    expect(
      auditChainStatus({ rows: dbRows(), intact: true, brokenAtSeq: null, expectedHash: null, storedHash: null })
    ).toBe('ok')
    expect(
      auditChainStatus({ rows: dbRows(), intact: false, brokenAtSeq: 12, expectedHash: 'x', storedHash: 'y' })
    ).toBe('broken')
    expect(auditChainStatus(null)).toBe('unavailable')
  })

  const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8')

  it('渲染层不再自己算哈希、也不再现编事件', () => {
    const files = [
      'src/renderer/src/utils/decision-mappers.ts',
      'src/renderer/src/pages/DecisionDetailPage.tsx',
      'src/renderer/src/pages/HistoryDetailPage.tsx',
      'src/renderer/src/components/decision/ExecutionResult.tsx',
    ]
    for (const f of files) {
      const src = read(f)
      expect(src, `${f} 里不该自己算摘要`).not.toContain('crypto.subtle')
      expect(src, `${f} 里不该再有现编的审计行`).not.toContain('buildAuditRows')
    }
  })

  it('两个详情页都从 history:audit 读链（不是本地推出来）', () => {
    expect(read('src/renderer/src/pages/DecisionDetailPage.tsx')).toContain('historyAudit')
    expect(read('src/renderer/src/pages/HistoryDetailPage.tsx')).toContain('historyAudit')
  })
})
