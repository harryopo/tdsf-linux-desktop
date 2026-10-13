/**
 * 归档批次的真实语义判据（#94「假事务包装」）
 *
 * 被修掉的缺陷：ArchiveKnowledgeRepositoryAdapter.runInTransaction 长这样——
 *   const tx = raw.transaction(() => 'tx-ready'); tx(); return await fn()
 * 空事务在 fn 之前就已经 COMMIT，fn 里的写入全在事务外；注释还写着
 * "同步 transaction 会阻塞到 fn 返回的 Promise 被消费完"（不成立）。
 * 假装有的事务比没有更危险：出错时人会以为数据已经回滚。
 *
 * 现在锁三件事：
 *   1. 批次不再碰 transaction（量具：db.transaction 一旦被调用就抛）；
 *   2. 中途失败 ⇒ 错误原样冒出来，且**先前写入保留**（这就是"不原子"的书面语义，
 *      谁要改成真事务，必须连这条判据和端口注释一起改）；
 *   3. 正向对照：正常批次把 fn 的返回值原样交回去（防止"直接 return undefined"蒙过 2）。
 */
import { describe, it, expect } from 'vitest'
import { ArchiveKnowledgeRepositoryAdapter } from '../../src/main/services/scheduler/archive-repo-adapter'
import type { KnowledgeRepository } from '../../src/main/services/db/knowledge-repo'
import type { DatabaseManager } from '../../src/main/services/db/database'

function makeAdapter() {
  const saved: string[] = []
  const repo = {
    exportAll: () => [],
    add: (e: { id: string }) => {
      saved.push(e.id)
      return true
    },
    update: () => true,
  } as unknown as KnowledgeRepository

  // db.transaction 一被调用就抛：批次绝不该再开事务（开了也是假事务）
  const db = {
    getRawConnection: () => ({
      transaction: () => {
        throw new Error('不该再开事务：开了也不会包住 async 的批次')
      },
    }),
  } as unknown as DatabaseManager

  return { adapter: new ArchiveKnowledgeRepositoryAdapter(repo, db), saved }
}

describe('归档批次：不许再假装原子', () => {
  it('正向对照：正常批次把 fn 的返回值原样交回去', async () => {
    const { adapter } = makeAdapter()
    const r = await adapter.runBatch(async () => ({ archivedCount: 3 }))
    expect(r).toEqual({ archivedCount: 3 })
  })

  it('批次路径不再碰 transaction（旧实现会开一个空事务）', async () => {
    const { adapter } = makeAdapter()
    await expect(adapter.runBatch(async () => 'ok')).resolves.toBe('ok')
  })

  it('中途失败 ⇒ 错误原样抛出，且先前写入保留（这就是不原子，写在端口上）', async () => {
    const { adapter, saved } = makeAdapter()
    let calls = 0

    await expect(
      adapter.runBatch(async () => {
        saved.push(`entry-${++calls}`)
        saved.push(`entry-${++calls}`)
        throw new Error('第 3 条写坏了')
      })
    ).rejects.toThrow('第 3 条写坏了')

    // 前两条留在库里：归档按 relatedDecisionId 幂等，下次运行会跳过它们继续
    expect(saved).toEqual(['entry-1', 'entry-2'])
  })
})
