/**
 * 决策审计链仓储（任务 #174）
 *
 * 为什么要有这一张表：详情页那张「决策审计日志 · SHA-256 链式哈希 · 逐行可验证篡改」
 * 以前是渲染层在打开详情时按卡片字段现编的（旧 buildAuditRows，已随本次改造删除），
 * 哈希也是对这批现编的行算的。改库里的卡、或者改那个映射函数，下次打开照样是一条完整有效的链——
 * 那是忠实的视图，不是审计。
 *
 * 这张表兑现的是"审计"这个词：
 *   1. 事件由主进程在决策落库那一步写进来（`core/decision-engine.ts` 的 buildAuditEvents），
 *      每行带**事件自己的真实时刻**：证据行用采集时刻，评估与批准行用落库时刻；
 *   2. 哈希在**写入时**算好并与行一起存，前驱是上一行存的哈希，创世块绑住 decisionId；
 *   3. 校验拿存的那份重算比对：改一个字节、改时间戳、删一行、把 A 的链搬到 B 名下，都要报断；
 *   4. 只有尾插。这里不暴露 UPDATE / DELETE，判据
 *      `tests/unit/decision-audit-chain.test.ts` 盯着源码里不许出现那两条语句。
 *
 * 这条链证明的是"写进去的内容之后没被动过"，不证明"某个时刻真的发生过某件事"——
 * 后者要靠事件自己的出处，界面别把它说成前者（判据见
 * `tests/components/decision-audit-view.test.tsx`）。
 */
import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  DecisionAuditEvent,
  DecisionAuditRow,
  DecisionAuditView,
} from '@shared/models'

export type { DecisionAuditEvent, DecisionAuditRow, DecisionAuditView } from '@shared/models'

/** 换绑过 decisionId 也算篡改，所以创世块必须由 decisionId 推出来 */
const GENESIS_SALT = 'tdsf-decision-audit-v1'

function sha256(payload: string): string {
  return createHash('sha256').update(payload).digest('hex')
}

function genesisHash(decisionId: string): string {
  return sha256(`${GENESIS_SALT}|${decisionId}`)
}

/**
 * 行哈希覆盖**除 seq 之外的每一列**。
 * 顺序由 prevHash 锁住（上一行的哈希不在，下一行就接不上），所以不需要把库自己分配的
 * 行号算进哈希——反过来说，删一行一定会让下一行的 prevHash 对不上，这正是要抓的。
 * 少盖一列就是留一个"改了也查不出来"的洞——时间戳单独被改过一次的案例见测试。
 */
function rowHash(row: {
  decisionId: string
  timestamp: number
  actor: string
  action: string
  result: string
  prevHash: string
}): string {
  return sha256(
    JSON.stringify([
      row.decisionId,
      row.timestamp,
      row.actor,
      row.action,
      row.result,
      row.prevHash,
    ])
  )
}

export class DecisionAuditRepository {
  constructor(private readonly db: Database) {}

  /**
   * 尾插一批事件，返回带哈希的行。
   * 整批一个事务：要么全进，要么全不进——半条链比没有链更坏。
   */
  append(decisionId: string, events: DecisionAuditEvent[]): DecisionAuditRow[] {
    if (events.length === 0) return []
    const last = this.db
      .prepare('SELECT hash FROM decision_audit WHERE decisionId = ? ORDER BY seq DESC LIMIT 1')
      .get(decisionId) as { hash: string } | undefined
    let prev = last?.hash ?? genesisHash(decisionId)

    const insert = this.db.prepare(`
      INSERT INTO decision_audit (decisionId, timestamp, actor, action, result, prevHash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const written: DecisionAuditRow[] = []
    this.db.transaction(() => {
      for (const e of events) {
        const hash = rowHash({ ...e, decisionId, prevHash: prev })
        const info = insert.run(decisionId, e.timestamp, e.actor, e.action, e.result, prev, hash)
        written.push({ seq: Number(info.lastInsertRowid), decisionId, ...e, prevHash: prev, hash })
        prev = hash
      }
    })()
    return written
  }

  /** 按链序读出某条决策的全部审计行 */
  list(decisionId: string): DecisionAuditRow[] {
    return this.db
      .prepare(`
        SELECT seq, decisionId, timestamp, actor, action, result, prevHash, hash
        FROM decision_audit
        WHERE decisionId = ?
        ORDER BY seq ASC
      `)
      .all(decisionId) as DecisionAuditRow[]
  }

  /**
   * 重算并与**存的那份**比：任一行内容变了、少了一行、或者被换到别的 decisionId 下，都报断。
   * 返回断在哪一行与两个哈希，界面要能指出"第 3 行对不上"，而不是只说"校验失败"。
   */
  verify(decisionId: string): DecisionAuditView {
    const rows = this.list(decisionId)
    let prev = genesisHash(decisionId)
    for (const row of rows) {
      if (row.prevHash !== prev) {
        return { intact: false, rows, brokenAtSeq: row.seq, expectedHash: prev, storedHash: row.prevHash }
      }
      const expected = rowHash(row)
      if (expected !== row.hash) {
        return { intact: false, rows, brokenAtSeq: row.seq, expectedHash: expected, storedHash: row.hash }
      }
      prev = row.hash
    }
    return { intact: true, rows, brokenAtSeq: null, expectedHash: null, storedHash: null }
  }
}
