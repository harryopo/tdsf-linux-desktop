/**
 * 只增类表的体积台账（#94：一条都不删，但要看得见在长多大）
 *
 * 背景：这五张表只往里写，界面上从来不说它们长到什么程度。用户拍板的是
 * "日志留着方便排查问题"，所以这里只做读数，不做清理、也不提供清理按钮——
 * 有删除入口就等于把一个"要不要留着"的决定塞进了设置页的角落。
 *
 * 唯一有保留期的是 audit_logs：main/index.ts 每次启动调 AuditRepo.pruneExpired()，
 * 天数取 risk.auditRetention（脏值回 180）。这条读数因此必须一起报出来，
 * 否则"永久累积"这句话对审计表就是假的。
 *
 * 判据：tests/unit/db-growth-report.test.ts
 */

import { statSync } from 'node:fs'
import { ConfigStore } from '../storage/config-store'
import { AUDIT_RETENTION_KEY, resolveRetentionDays } from './audit-repo'
import type { DatabaseManager } from './database'
import type { DbGrowth, DbTableGrowth } from '@shared/db-types'
import { logger } from '../log/logger'

/** 时间列名五张表各不相同（历史遗留），逐表登记，别让 SQL 去猜 */
interface GrowthTableSpec {
  table: string
  label: string
  /** 该表用于算"最早/最新"的整数时间列 */
  timeColumn: string
  /** true = 有自动保留期，天数由 auditRetention 决定；其余四张永久累积 */
  hasRetention: boolean
}

/** 顺序即展示顺序，界面上不再自己排 */
const GROWTH_TABLES: readonly GrowthTableSpec[] = [
  { table: 'audit_logs', label: '操作审计', timeColumn: 'timestamp', hasRetention: true },
  { table: 'kb_view_history', label: '知识库浏览记录', timeColumn: 'viewedAt', hasRetention: false },
  { table: 'tool_call_log', label: '工具调用记录', timeColumn: 'timestamp', hasRetention: false },
  { table: 'budget_alerts', label: '预算告警', timeColumn: 'timestamp', hasRetention: false },
  { table: 'memory_audit', label: '记忆沉淀审计', timeColumn: 'ts', hasRetention: false },
]

/** describeGrowth 的可注入项：测试传死值，生产走 ConfigStore 实际配置 */
export interface GrowthDeps {
  auditRetentionDays?: number
}

/** 读取当前审计保留天数；配置层抛错时回默认值（读数不能因为设置坏了就没了一张表） */
function readAuditRetention(): number {
  try {
    return resolveRetentionDays(ConfigStore.get(AUDIT_RETENTION_KEY))
  } catch (err) {
    logger.warn('DB.GROWTH', `读取 ${AUDIT_RETENTION_KEY} 失败，按默认保留期显示`, {
      error: (err as Error).message,
    })
    return resolveRetentionDays(undefined)
  }
}

/** 单表读数；任何 SQL 失败都只污染这一行，不塌掉整张台账 */
function describeOne(db: DatabaseManager, spec: GrowthTableSpec, retentionDays: number): DbTableGrowth {
  const base: DbTableGrowth = {
    table: spec.table,
    label: spec.label,
    rows: null,
    oldestAt: null,
    newestAt: null,
    retentionDays: spec.hasRetention ? retentionDays : null,
    error: null,
  }
  try {
    // 表名与列名来自本文件的常量表，不接受任何外部输入
    const row = db
      .prepare(
        `SELECT COUNT(*) AS rows, MIN(${spec.timeColumn}) AS oldest, MAX(${spec.timeColumn}) AS newest ` +
          `FROM ${spec.table}`
      )
      .get() as { rows: number | null; oldest: number | null; newest: number | null } | undefined
    if (!row) return { ...base, error: '查询没有返回行' }
    return { ...base, rows: Number(row.rows ?? 0), oldestAt: row.oldest, newestAt: row.newest }
  } catch (err) {
    const message = (err as Error).message
    logger.warn('DB.GROWTH', `读取表 ${spec.table} 体积失败`, { error: message })
    return { ...base, error: message }
  }
}

/**
 * 组装本地数据体积台账
 *
 * 库不可用时五张表都带同一条降级原因、行数为 null —— 界面不许把"读不到"
 * 显示成"0 条"，那是把故障演成清白。
 */
export function describeGrowth(db: DatabaseManager, deps: GrowthDeps = {}): DbGrowth {
  const filePath = db.getFilePath()
  const retentionDays = deps.auditRetentionDays ?? readAuditRetention()

  if (!db.isAvailable()) {
    const reason = db.getStatus().degradedReason ?? '数据库不可用'
    return {
      fileBytes: null,
      filePath,
      tables: GROWTH_TABLES.map((spec) => ({
        table: spec.table,
        label: spec.label,
        rows: null,
        oldestAt: null,
        newestAt: null,
        retentionDays: spec.hasRetention ? retentionDays : null,
        error: reason,
      })),
    }
  }

  let fileBytes: number | null = null
  if (filePath !== ':memory:') {
    try {
      fileBytes = statSync(filePath).size
    } catch (err) {
      logger.warn('DB.GROWTH', '读取库文件大小失败', { error: (err as Error).message })
    }
  }

  return {
    fileBytes,
    filePath,
    tables: GROWTH_TABLES.map((spec) => describeOne(db, spec, retentionDays)),
  }
}

/** 台账登记表的名字集合（测试用它反查"新加的只增表有没有漏登记"） */
export function growthTableNames(): string[] {
  return GROWTH_TABLES.map((s) => s.table)
}
