/**
 * 决策卡落库的信任边界（P0-5 的承诺级判据）
 *
 * 巡检 §7.2 的教训：`validateDecision()` 一直存在，但 history:save 的 handler
 * 是 `repo.save(card)` 一行 —— 防线造好了没插电。所以这里不测"函数存在"，
 * 测"用户做 X，产品记成 Y"：
 *
 *   1. 渲染层在载荷里塞进 risk / confidence / id / timestamp / status（运行时能塞，
 *      类型挡不住）→ 落库的必须是主进程算出来的值，一个都不许照抄
 *   2. 卡片不合法（没有证据）→ 拒存，且仓储一次都没被调用
 *   3. 命令本身是 CRITICAL → 拒存（风险由主进程评，不由渲染层声明）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: never[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => require('node:os').tmpdir(), getName: () => 'tdsf-test', on: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: never[]) => unknown) => {
      handlers.set(channel, fn)
    },
    removeHandler: (channel: string) => handlers.delete(channel),
    on: () => {},
    removeAllListeners: () => {},
  },
  BrowserWindow: class {},
}))

/** 仓储替身：只记录落库了什么 */
const { saved } = vi.hoisted(() => ({ saved: [] as Array<Record<string, unknown>> }))

vi.mock('@main/services/db/database', () => ({
  DatabaseManager: { getInstance: () => ({}) },
}))

vi.mock('@main/services/db/decision-repo', () => ({
  DecisionRepository: class {
    save(card: Record<string, unknown>): boolean {
      saved.push(card)
      return true
    }
  },
}))

import { HISTORY } from '@shared/ipc-channels'
import { registerHistoryHandlers } from '@main/ipc/history'

const fakeWindow = {
  isDestroyed: () => false,
  webContents: { isDestroyed: () => false, send: () => {} },
} as never

async function save(intent: unknown): Promise<boolean> {
  const fn = handlers.get(HISTORY.SAVE)
  if (!fn) throw new Error('history:save 没注册')
  return (await fn({} as never, ...([intent] as never[]))) as boolean
}

/** 一条最小可用的落库意图（内容真实、不含任何"该怎么判"的字段） */
function baseIntent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    command: 'journalctl --vacuum-size=200M',
    problem: '磁盘快满了',
    hypothesis: '日志占用大，建议清理',
    evidences: [
      {
        id: 'ev_1',
        source: 'command',
        sourceDetail: 'df -h',
        content: 'Use% 92%',
        drainMatch: 0.5,
        sourcePrior: 0.9,
        confidence: 0.9,
        timestamp: 1,
        verified: true,
      },
    ],
    executed: true,
    ...overrides,
  }
}

beforeEach(() => {
  handlers.clear()
  saved.length = 0
  registerHistoryHandlers(fakeWindow)
})

describe('history:save — 卡片由主进程构造', () => {
  it('渲染层塞进来的 risk / confidence / id / timestamp / status 一律不认', async () => {
    const forged = baseIntent({
      id: 'attacker-chosen-id',
      confidence: 999,
      risk: { level: 'SAFE', score: 0, matchedRules: [], description: 'x', requireConfirmation: false, blocked: false },
      status: 'verified',
      timestamp: 1000,
    })
    expect(await save(forged)).toBe(true)
    expect(saved).toHaveLength(1)
    const card = saved[0]
    expect(card.id, 'id 必须主进程生成').not.toBe('attacker-chosen-id')
    expect(String(card.id)).toMatch(/^dc_/)
    expect(card.confidence, '置信度必须落在 [0,1]，不能照抄 999').toBeLessThanOrEqual(1)
    expect(card.confidence).not.toBe(999)
    expect(card.status, 'status 由 executed 事实映射，不接受渲染层声明').toBe('executed')
    expect(card.timestamp).toBeGreaterThan(1e12)
    // 风险由 risk-engine 评：必须是主进程那套结构，不是载荷里塞的对象
    expect(card.risk).not.toBe(forged.risk)
    expect(typeof (card.risk as Record<string, unknown>).level).toBe('string')
  })

  it('executed=false 时记成 pending（不是渲染层想写的任何状态）', async () => {
    await save(baseIntent({ executed: false, status: 'executed' }))
    expect(saved[0].status).toBe('pending')
  })

  it('sessionId / serverId / durationMs 这些"事实字段"照实带上', async () => {
    await save(baseIntent({ sessionId: 'sess-9', serverId: 'srv-3', durationMs: 4200 }))
    expect(saved[0].sessionId).toBe('sess-9')
    expect(saved[0].serverId).toBe('srv-3')
    expect(saved[0].durationMs).toBe(4200)
  })
})

describe('history:save — 落库前校验（此前零校验）', () => {
  it('没有证据 → 拒存，仓储一次都没被调用', async () => {
    expect(await save(baseIntent({ evidences: [] }))).toBe(false)
    expect(saved, '拒绝之后不许已经写进库').toEqual([])
  })

  it('命令为空 → 拒存', async () => {
    expect(await save(baseIntent({ command: '   ' }))).toBe(false)
    expect(await save({})).toBe(false)
    expect(saved).toEqual([])
  })

  it('问题或假设为空 → 拒存（validateDecision 的必填项真的在跑）', async () => {
    expect(await save(baseIntent({ problem: '' }))).toBe(false)
    expect(await save(baseIntent({ hypothesis: '' }))).toBe(false)
    expect(saved).toEqual([])
  })

  it('CRITICAL 风险命令 → 拒存，风险等级是主进程评出来的', async () => {
    // rm -rf / 由 risk-engine 评到 CRITICAL，validateDecision 据此判不合法
    expect(await save(baseIntent({ command: 'rm -rf /' }))).toBe(false)
    expect(saved).toEqual([])
  })
})
