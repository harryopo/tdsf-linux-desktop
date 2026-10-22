/**
 * 决策审计链必须能真的证明"没被动过"（任务 #174）
 *
 * 起因：详情页那张「决策审计日志 · SHA-256 链式哈希 · 逐行可验证篡改」以前是
 * 渲染层在看详情时按卡片字段**现编**的（旧 buildAuditRows，已随 #174 删除），
 * 哈希也是对这批现编的行算的。改库里的卡、或者改那个映射函数，下次打开照样是一条完整的链。
 * 那是视图，不是审计。
 *
 * 这里钉的是"审计"这个词该兑现的东西：
 *   1. 事件在**发生那一刻**落库，不是看时重建；
 *   2. 哈希在**写入时**算好并与行一起存；
 *   3. 校验拿存的那份比：改一个字节、删一行，都必须报断，并说断在第几行；
 *   4. 只有尾插，没有改与删的口子。
 *
 * 用真实 better-sqlite3 内存库（vitest 已把 better-sqlite3 列为 external），不 mock：
 * 链的正确性恰恰体现在真实 DDL 与真实行序上。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import { applyMigrations, MIGRATIONS } from '@main/services/db/schema-migrations'
import {
  DecisionAuditRepository,
  type DecisionAuditEvent,
} from '@main/services/db/decision-audit'

const ID = 'dc_probe_1'

const ev = (n: number, action = '证据采集 · df -h /var'): DecisionAuditEvent => ({
  actor: 'Collector',
  action,
  result: 'passed',
  timestamp: 1_700_000_000_000 + n,
})

let db: Db
let repo: DecisionAuditRepository

/**
 * 造一个"升级前"的库：只建迁移会碰到的三张表，故意不带 v1 补的那几列。
 * 真实产品里 `DatabaseManager.initTables()` 先建基表、再跑 applyMigrations，
 * 内存库拿不到 Electron 的 app 路径，所以这里按同一顺序手工搭出来。
 */
function createPreMigrationDatabase(handle: Db): void {
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
}

beforeEach(() => {
  db = new Database(':memory:')
  createPreMigrationDatabase(db)
  const r = applyMigrations(db)
  expect(r.error, r.error ?? '').toBeNull()
  repo = new DecisionAuditRepository(db)
})

describe('决策审计链的存储与校验', () => {
  it('迁移里有这一张表，且重复跑不报错（幂等）', () => {
    expect(MIGRATIONS.some((m) => m.description.includes('decision_audit'))).toBe(true)
    const again = applyMigrations(db)
    expect(again.applied).toEqual([])
    expect(
      (db.prepare("SELECT name FROM sqlite_master WHERE name='decision_audit'").get() as { name: string }).name
    ).toBe('decision_audit')
  })

  it('还没有事件时校验算通过（没有可断的链，不等于断）', () => {
    const v = repo.verify(ID)
    expect(v.intact).toBe(true)
    expect(v.rows).toEqual([])
    expect(v.brokenAtSeq).toBeNull()
  })

  it('三条事件：哈希各不相同，且逐行以前一行的哈希为前驱', () => {
    const rows = repo.append(ID, [ev(1), ev(2), ev(3)])
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => r.hash)).size).toBe(3)
    expect(rows[1].prevHash).toBe(rows[0].hash)
    expect(rows[2].prevHash).toBe(rows[1].hash)
    expect(repo.verify(ID).intact).toBe(true)
  })

  it('改一个字节必须报断，并说断在第几行', () => {
    const rows = repo.append(ID, [ev(1), ev(2), ev(3)])
    db.prepare('UPDATE decision_audit SET action = ? WHERE seq = ?').run('证据采集 · 被我改了', rows[1].seq)
    const v = repo.verify(ID)
    expect(v.intact, '改了内容还报"完好"＝这把尺子量不出篡改').toBe(false)
    expect(v.brokenAtSeq).toBe(rows[1].seq)
  })

  it('只改时间戳也要报断（链要盖住每一列，不是只盖 action）', () => {
    const rows = repo.append(ID, [ev(1), ev(2)])
    db.prepare('UPDATE decision_audit SET timestamp = ? WHERE seq = ?').run(1, rows[0].seq)
    expect(repo.verify(ID).intact).toBe(false)
  })

  it('删一行也必须报断（前驱对不上，不是"少一行看不出来"）', () => {
    const rows = repo.append(ID, [ev(1), ev(2), ev(3)])
    db.prepare('DELETE FROM decision_audit WHERE seq = ?').run(rows[1].seq)
    const v = repo.verify(ID)
    expect(v.intact).toBe(false)
    expect(v.brokenAtSeq).toBe(rows[2].seq)
  })

  it('分两批追加仍然是一条链（事件不是一次性写全的）', () => {
    const first = repo.append(ID, [ev(1)])
    const second = repo.append(ID, [ev(2, '风险评估 · HIGH'), ev(3, '人工批准 · 确认执行')])
    expect(second[0].prevHash).toBe(first[0].hash)
    expect(repo.verify(ID).intact).toBe(true)
    expect(repo.list(ID).map((r) => r.action)).toEqual([
      '证据采集 · df -h /var',
      '风险评估 · HIGH',
      '人工批准 · 确认执行',
    ])
  })

  it('创世块绑住 decisionId：同样的事件挂到别的决策上，哈希不一样', () => {
    const a = repo.append(ID, [ev(1)])[0]
    const b = repo.append('dc_other', [ev(1)])[0]
    expect(a.hash).not.toBe(b.hash)
    // 把 A 的整链搬到 B 名下必须验不过
    db.prepare('UPDATE decision_audit SET decisionId = ? WHERE decisionId = ?').run(ID, 'dc_other')
    expect(repo.verify(ID).intact).toBe(false)
  })

  it('两条决策的链互不干扰（各验各的）', () => {
    repo.append(ID, [ev(1), ev(2)])
    repo.append('dc_probe_2', [ev(3)])
    expect(repo.verify(ID).intact).toBe(true)
    expect(repo.verify('dc_probe_2').intact).toBe(true)
    expect(repo.list(ID)).toHaveLength(2)
  })
})

describe('仓储只给尾插的口子', () => {
  it('decision-audit 里没有 UPDATE / DELETE 语句（只有 INSERT 与 SELECT）', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const src = (
      fs.readFileSync(
        path.resolve(__dirname, '../../src/main/services/db/decision-audit.ts'),
        'utf8'
      ) || ''
    ).toUpperCase()
    expect(src).toContain('INSERT INTO DECISION_AUDIT')
    // 审计表一旦出现改/删的语句，"可验证篡改"就又是句空话
    expect(src).not.toMatch(/UPDATE DECISION_AUDIT|DELETE FROM DECISION_AUDIT/)
  })
})
