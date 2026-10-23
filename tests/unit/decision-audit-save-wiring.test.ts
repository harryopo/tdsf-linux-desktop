/**
 * 审计链必须真的接在落库那一刻（任务 #174 的接线判据）
 *
 * 上一版 `decision-audit-chain.test.ts` 只证明了仓储本身能算链、能验断——
 * 但仓储造好了没插电，就等于没有（`ipc-history-decision-gate.test.ts` 的教训就是这一类）。
 * 这里钉的是"用户批准并执行了一条命令，库里必须留下这一刻写下的审计行"：
 *
 *   1. history:save 成功 → decision_audit 里真有对应行，且链验得过
 *   2. 行来自真实事件：每条证据一行（时间戳是证据自己的采集时刻，不是写库时刻）、
 *      风险评估一行（Risk Engine）、批准/执行各一行——actor 不许是猜出来的
 *   3. 校验没过（validateDecision 拒）→ 卡与审计行都不许落库
 *   4. 数据库不可用 → 落库照旧返回，但必须留下一句"审计链没写成"的话，不能静默
 *
 * 用真实 better-sqlite3 内存库 + 真实 DecisionRepository / generateDecisionCard：
 * 这条链的价值恰恰在于"写进去的那一行"，mock 掉仓储就什么也没证明。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import { applyMigrations } from '@main/services/db/schema-migrations'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const warns: Array<{ domain: string; message: string; meta?: unknown }> = []

/** 内存库：由每个用例决定它连不连得上（getRawConnection 可返回 null 演降级） */
let rawDb: Db | null = null

vi.mock('electron', () => ({
  app: { getPath: () => require('node:os').tmpdir(), getName: () => 'tdsf-test', on: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
    removeHandler: (channel: string) => handlers.delete(channel),
    on: () => {},
    removeAllListeners: () => {},
  },
  BrowserWindow: class {},
}))

vi.mock('@main/services/db/database', () => ({
  DatabaseManager: {
    getInstance: () => ({
      // DecisionRepository 只用到 prepare()；这一层透传到真库
      prepare: (sql: string) => {
        if (!rawDb) return { run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }
        return rawDb.prepare(sql)
      },
      // 审计仓储要的是原始连接：拿不到就说明库不可用
      getRawConnection: () => rawDb,
    }),
  },
}))

vi.mock('@main/services/log/logger', () => ({
  logger: {
    warn: (domain: string, message: string, meta?: unknown) => warns.push({ domain, message, meta }),
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}))

import { HISTORY } from '@shared/ipc-channels'
import { DecisionAuditRepository } from '@main/services/db/decision-audit'
import { registerHistoryHandlers } from '@main/ipc/history'
import { getCalibrationTuner } from '@main/core/agent/credibility/calibration/calibration-tuner'
import type { DecisionAuditView, DecisionCard } from '@shared/models'

/** registerHistoryHandlers 只要一个窗口引用；这里传类型正确的空壳 */
const fakeWindow = {} as unknown as Parameters<typeof registerHistoryHandlers>[0]

/** 证据的真实采集时刻：故意用两个不同的过去时间，行序与时间都得照它排 */
const EV_T1 = 1_700_000_000_000
const EV_T2 = 1_700_000_005_000

function intent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    command: 'journalctl --vacuum-size=200M',
    problem: '磁盘快满了',
    hypothesis: '日志占用大，建议清理',
    evidences: [
      {
        id: 'ev_1',
        source: 'command',
        sourceDetail: 'df -h /var',
        content: 'Use% 92%',
        drainMatch: null,
        sourcePrior: 0.9,
        confidence: 0.9,
        timestamp: EV_T2,
        verified: true,
      },
      {
        id: 'ev_0',
        source: 'log',
        sourceDetail: '/var/log/syslog',
        content: 'journal: disk full',
        drainMatch: 0.6,
        sourcePrior: 0.7,
        confidence: 0.7,
        timestamp: EV_T1,
        verified: false,
      },
    ],
    executed: true,
    ...overrides,
  }
}

async function save(payload: unknown): Promise<boolean> {
  const fn = handlers.get(HISTORY.SAVE)
  if (!fn) throw new Error('history:save 没注册')
  return (await fn({}, payload)) as boolean
}

async function audit(id: string): Promise<{ rows: ReturnType<DecisionAuditRepository['list']>; intact: boolean }> {
  const repo = new DecisionAuditRepository(rawDb as Db)
  return { rows: repo.list(id), intact: repo.verify(id).intact }
}

function cardRow(id: string): DecisionCard {
  const row = (rawDb as Db)
    .prepare('SELECT * FROM decision_cards WHERE id = ?')
    .get(id) as Record<string, unknown>
  return {
    id: String(row.id),
    problem: String(row.problem),
    hypothesis: String(row.hypothesis),
    evidences: JSON.parse(String(row.evidences)),
    confidence: Number(row.confidence),
    risk: JSON.parse(String(row.risk)),
    fixCommand: String(row.fixCommand),
    fixDescription: '',
    status: String(row.status) as DecisionCard['status'],
    timestamp: Number(row.timestamp),
  }
}

/** 找出库里那条刚落库的决策（id 由主进程生成，测试不知道） */
function onlyDecision(): DecisionCard {
  const rows = (rawDb as Db).prepare('SELECT id FROM decision_cards').all() as Array<{ id: string }>
  expect(rows).toHaveLength(1)
  return cardRow(rows[0].id)
}

/**
 * 造一个"升级前"的库并按产品顺序跑迁移（建基表 → applyMigrations），
 * 这样 decision_audit 才是由迁移 v3 建出来的，跟真机一样。
 */
function freshDatabase(): Db {
  const handle = new Database(':memory:')
  handle.exec(`
    CREATE TABLE decision_cards (
      id TEXT PRIMARY KEY, problem TEXT NOT NULL, hypothesis TEXT NOT NULL,
      evidences TEXT NOT NULL, confidence REAL NOT NULL, risk TEXT NOT NULL,
      fixCommand TEXT NOT NULL, fixDescription TEXT, rollbackCommand TEXT,
      status TEXT NOT NULL, timestamp INTEGER NOT NULL, sessionId TEXT
    );
    CREATE TABLE agent_memories (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, key TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE knowledge_entries (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, problem TEXT NOT NULL,
      rootCause TEXT, commands TEXT NOT NULL, confidence REAL NOT NULL, source TEXT NOT NULL,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    );
  `)
  const r = applyMigrations(handle)
  if (r.error) throw new Error(`迁移失败：${r.error}`)
  return handle
}

beforeEach(() => {
  handlers.clear()
  warns.length = 0
  rawDb = freshDatabase()
  registerHistoryHandlers(fakeWindow)
})

describe('history:save 把审计链一起写进库', () => {
  it('落库成功 → 审计表里有行，且这条链验得过', async () => {
    expect(await save(intent())).toBe(true)
    const card = onlyDecision()
    const { rows, intact } = await audit(card.id)
    expect(rows.length, '一条决策至少要有：两条证据 + 风险评估 + 批准 + 执行').toBeGreaterThanOrEqual(5)
    expect(intact, '刚写进去的链必须验得过').toBe(true)
  })

  it('每条证据占一行，时间戳是证据自己的采集时刻（不是写库那一刻）', async () => {
    await save(intent())
    const card = onlyDecision()
    const { rows } = await audit(card.id)
    const evidenceRows = rows.filter((r) => r.action.startsWith('证据落定'))
    expect(evidenceRows.map((r) => r.timestamp)).toEqual([EV_T1, EV_T2])
    expect(evidenceRows.map((r) => r.actor)).toEqual(['Log Collector', 'SSH Executor'])
    // 证据行的时间必须早于卡片落库时间——否则"当场落库"就是句空话
    expect(Math.max(...evidenceRows.map((r) => r.timestamp))).toBeLessThan(card.timestamp)
  })

  it('证据的 Ground-Check 结果进 result：verified 是 passed，没验过不是 passed', async () => {
    await save(intent())
    const card = onlyDecision()
    const { rows } = await audit(card.id)
    const byAction = new Map(rows.map((r) => [r.action, r.result]))
    expect(byAction.get('证据落定 · /var/log/syslog')).toBe('completed')
    expect(byAction.get('证据落定 · df -h /var')).toBe('passed')
  })

  it('风险评估那一行写着主进程评出来的等级，actor 是 Risk Engine', async () => {
    await save(intent())
    const card = onlyDecision()
    const { rows } = await audit(card.id)
    const riskRow = rows.find((r) => r.actor === 'Risk Engine')
    expect(riskRow, '风险评估必须留一行审计').toBeTruthy()
    expect(riskRow?.action).toContain(card.risk.level)
    expect(riskRow?.action).toContain(String(card.risk.score))
  })

  it('executed=true → 批准与发送终端各一行；executed=false → 只有一行待确认，没有执行行', async () => {
    await save(intent())
    const executed = await audit(onlyDecision().id)
    expect(executed.rows.some((r) => r.action.startsWith('人工批准'))).toBe(true)
    const sent = executed.rows.filter((r) => r.actor === 'Executor')
    expect(sent).toHaveLength(1)
    expect(sent[0].action).toContain('journalctl')

    rawDb = freshDatabase()
    handlers.clear()
    registerHistoryHandlers(fakeWindow)
    await save(intent({ executed: false }))
    const pending = await audit(onlyDecision().id)
    expect(pending.rows.some((r) => r.actor === 'Executor'), '没执行却记下"发送终端"＝假账').toBe(false)
    expect(pending.rows.some((r) => r.result === 'waiting')).toBe(true)
  })

  it('渲染层塞进来的字段变不出审计行：命令里带 CRITICAL 被拒 → 表里一行也没有', async () => {
    expect(await save(intent({ command: 'rm -rf /' }))).toBe(false)
    const cards = (rawDb as Db).prepare('SELECT id FROM decision_cards').all()
    expect(cards).toEqual([])
    const rows = (rawDb as Db).prepare('SELECT seq FROM decision_audit').all()
    expect(rows, '卡片被拒了，审计行也不许留下').toEqual([])
    expect(warns.some((w) => w.message.includes('拒绝保存'))).toBe(true)
  })

  it('链写坏要报断：直接把库里那一行的 action 改掉，history:audit 必须说断在哪一行', async () => {
    await save(intent())
    const card = onlyDecision()
    const repo = new DecisionAuditRepository(rawDb as Db)
    const target = repo.list(card.id)[2]
    ;(rawDb as Db)
      .prepare('UPDATE decision_audit SET action = ? WHERE seq = ?')
      .run('把这一行改成没发生过的话', target.seq)

    const fn = handlers.get(HISTORY.AUDIT)
    if (!fn) throw new Error('history:audit 没注册')
    const view = (await fn({}, card.id)) as DecisionAuditView
    expect(view.rows.length).toBeGreaterThanOrEqual(5)
    expect(view.intact, '改了库里的一行还报完好＝这把尺子量不出篡改').toBe(false)
    expect(view.brokenAtSeq).toBe(target.seq)
    expect(view.expectedHash).not.toBe(view.storedHash)
  })
})

describe('数据库不可用时不许静默', () => {
  it('拿不到原始连接 → 落库照旧返回，但必须留下一句审计链没写成的话', async () => {
    rawDb = null
    expect(await save(intent())).toBe(true)
    expect(warns.some((w) => w.message.includes('审计')), '降级必须留话，不能只在代码里 if 掉').toBe(true)
  })
})

/**
 * 校准样本的真实生产者（#188）
 *
 * 校准页整页讲 Temperature Scaling，但 tuner 从来没有样本——
 * 渲染层没调用过 add-calibration-sample，主进程也没有第二个调用点，
 * 于是「开始校准」永远 0 样本、T 恒为 1.0，看起来能用其实什么都不发生。
 * 现在决策落库那一刻顺手记一条：用户执行了 = 采纳（wasCorrect=true），
 * 只停在待确认 = 未采纳（false）。这里钉的是"真的接上了，而且方向没反"。
 */
describe('决策结果 → 校准样本', () => {
  it('用户执行了这条建议 → 记一条 wasCorrect=true，置信度用卡片自己的数', async () => {
    const addSpy = vi.spyOn(getCalibrationTuner(), 'addSample')
    expect(await save(intent({ executed: true }))).toBe(true)
    const card = onlyDecision()

    expect(addSpy).toHaveBeenCalledTimes(1)
    const sample = addSpy.mock.calls[0][0]
    expect(sample.wasCorrect).toBe(true)
    expect(sample.decisionId).toBe(card.id)
    expect(sample.reportedConfidence).toBeCloseTo(card.confidence, 6)
    addSpy.mockRestore()
  })

  it('卡片只停在待确认（没有执行）→ wasCorrect=false，不冒充采纳', async () => {
    const addSpy = vi.spyOn(getCalibrationTuner(), 'addSample')
    expect(await save(intent({ executed: false }))).toBe(true)

    expect(addSpy).toHaveBeenCalledTimes(1)
    expect(addSpy.mock.calls[0][0].wasCorrect).toBe(false)
    addSpy.mockRestore()
  })

  it('被校验拒掉的决策不记样本（没落库的决策不能变成校准依据）', async () => {
    const addSpy = vi.spyOn(getCalibrationTuner(), 'addSample')
    // validateDecision 会拒掉这条高危命令，handler 在落库前就返回 false
    expect(await save(intent({ command: 'rm -rf /' }))).toBe(false)
    expect(addSpy).not.toHaveBeenCalled()
    addSpy.mockRestore()
  })
})
