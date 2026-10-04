/**
 * DatabaseManager 状态上报单元测试（A4：SQLite 降级可见化）
 *
 * 核心判据："人为制造失败"时 available 必须为 false 且带原因，
 * 并且 getInstance() 不得抛异常 —— 否则主进程启动直接崩，用户只会看到白窗。
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'node:path'
import { DatabaseManager, resolveDbPath } from '../../src/main/services/db/database'
import { TARGET_SCHEMA_VERSION } from '../../src/main/services/db/schema-migrations'

afterEach(() => {
  DatabaseManager.resetInstance()
})

describe('resolveDbPath', () => {
  it('在 userData 下拼出 tdsf.db', () => {
    expect(resolveDbPath('/tmp/tdsf-user-data')).toBe(path.join('/tmp/tdsf-user-data', 'tdsf.db'))
  })
})

describe('正常库：状态可读且迁移到位', () => {
  it(':memory: 库 available=true，schema 版本已到目标值', () => {
    const db = DatabaseManager.getInstance(':memory:')
    const status = db.getStatus()

    expect(status.available).toBe(true)
    expect(status.degradedReason).toBeNull()
    expect(status.migrationError).toBeNull()
    expect(status.migrationPending).toBe(false)
    expect(status.schemaVersion).toBe(TARGET_SCHEMA_VERSION)
    expect(status.targetSchemaVersion).toBe(TARGET_SCHEMA_VERSION)
    // 与既有 API 保持一致，避免两条真相来源
    expect(status.available).toBe(db.isAvailable())
    expect(status.vectorEnabled).toBe(db.isVectorEnabled())
  })

  it('状态可重复读取，结果一致', () => {
    const db = DatabaseManager.getInstance(':memory:')
    expect(db.getStatus()).toEqual(db.getStatus())
  })
})

describe('人为制造失败：库文件打不开', () => {
  /** 指向一个不存在目录下的库文件，SQLite 会以 unable to open database file 失败 */
  const UNOPENABLE = path.join('__tdsf_definitely_missing_dir__', 'tdsf.db')

  it('getInstance 不抛异常，而是进入降级态', () => {
    let db: DatabaseManager | undefined
    expect(() => {
      db = DatabaseManager.getInstance(UNOPENABLE)
    }).not.toThrow()

    const status = db!.getStatus()
    expect(status.available).toBe(false)
    expect(status.degradedReason).toContain('数据库文件未能打开')
    expect(status.schemaVersion).toBeNull()
    // 降级时无从判断迁移状态，不得谎报"迁移未完成"
    expect(status.migrationPending).toBe(false)
  })

  it('降级态下写入被拒绝（不静默丢弃）', () => {
    const db = DatabaseManager.getInstance(UNOPENABLE)
    expect(db.isAvailable()).toBe(false)
    expect(() => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run()).toThrow(
      /Database unavailable/
    )
  })

  it('降级态下读取返回空结果（保持旧降级链路）', () => {
    const db = DatabaseManager.getInstance(UNOPENABLE)
    expect(db.prepare('SELECT * FROM settings').all()).toEqual([])
    expect(db.prepare('SELECT * FROM settings').get()).toBeUndefined()
    expect(() => db.exec('SELECT 1')).not.toThrow()
  })
})
