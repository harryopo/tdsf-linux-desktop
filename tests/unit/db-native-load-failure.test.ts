/**
 * 原生模块加载失败时的降级上报（A4 判据的字面场景）
 *
 * 计划原文是"人为让 better-sqlite3 加载失败 → UI 必须显示'数据不会持久化'横幅"。
 * `database-status.test.ts` 覆盖的是另一条分支（库文件打不开）；
 * 代码里这两条各有自己的 degradedReason（database.ts:105 与 :118），只测一条等于另一条从没走过。
 *
 * 为什么不用 vi.mock：实测拦不住——`loadBetterSqlite3()` 里是运行时 `require('better-sqlite3')`，
 * vitest 的模块图打桩对它无效（available 仍然是 true）。所以直接给 Node 的模块加载器下钩子，
 * 让这一次 require 抛错，测完还原。产品代码不为测试开口子。
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest'
import Module from 'node:module'
import { DatabaseManager } from '../../src/main/services/db/database'

const origLoad = Module._load as (request: string, parent: unknown, isMain: boolean) => unknown
let armed = false
Module._load = function patched(this: unknown, request: string, parent: unknown, isMain: boolean): unknown {
  if (armed && request === 'better-sqlite3') {
    throw new Error('NODE_MODULE_VERSION 125 vs 137（测试打桩：模拟 ABI 不匹配）')
  }
  return origLoad.call(this, request, parent, isMain)
}

afterAll(() => {
  Module._load = origLoad
})
afterEach(() => {
  armed = false
  DatabaseManager.resetInstance()
})

describe('better-sqlite3 加载失败（A4 的模块加载分支）', () => {
  it('getInstance 不抛异常，available=false 且原因指名是"未能加载"', () => {
    armed = true
    let db: DatabaseManager | null = null
    expect(() => {
      db = DatabaseManager.getInstance(':memory:')
    }, '加载失败必须降级，而不是把主进程启动炸掉').not.toThrow()

    const status = db!.getStatus()
    expect(status.available, '模块加载失败必须报 available=false').toBe(false)
    expect(status.degradedReason, '原因要能区分"模块没加载"与"文件打不开"').toContain('未能加载')
    expect(status.degradedReason).toContain('NODE_MODULE_VERSION')
    expect(status.vectorEnabled).toBe(false)
    expect(status.available).toBe(db!.isAvailable())
  })

  it('降级时写入响亮失败、读取安静返回空（不许假装存住了）', () => {
    armed = true
    const db = DatabaseManager.getInstance(':memory:')
    expect(db.isAvailable()).toBe(false)
    expect(db.getRawConnection(), '降级时不该有一个假连接漏给调用方').toBeNull()
    expect(() => db.exec('CREATE TABLE t (a TEXT)')).not.toThrow()

    const write = db.prepare('INSERT INTO t (a) VALUES (?)') as unknown as { run: (v: string) => unknown }
    expect(() => write.run('x'), '写操作必须抛错，否则调用方以为已经落盘').toThrow(/Database unavailable/)

    const read = db.prepare('SELECT * FROM t') as unknown as {
      all: () => unknown[]
      get: () => unknown
      run: () => { changes: number }
    }
    expect(read.all()).toEqual([])
    expect(read.get()).toBeUndefined()
    expect(read.run().changes).toBe(0)
  })

  it('不下钩子时同一个入口是 available=true（证明上面测的是失败分支）', () => {
    armed = false
    const db = DatabaseManager.getInstance(':memory:')
    const status = db.getStatus()
    expect(status.available, '这条是阴性对照：不打桩时必须正常').toBe(true)
    expect(status.degradedReason).toBeNull()
  })
})
