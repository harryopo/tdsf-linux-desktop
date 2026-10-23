/**
 * tests/unit/db-growth-report.test.ts — 只增表体积台账（#94）
 *
 * 存在理由：这些只增表只写不读、也没人说过它们有多大。用户拍板"日志留着方便排查
 * 问题"，所以交付的是读数而不是清理按钮。三条纪律在本文件里逐条可证伪：
 *   1) 读数是真的（往真库里插真行，断言条数与最早/最新时间）
 *   2) 读失败不许演成"0 条"（拆掉一张表再读，那一行必须 error 且 rows=null）
 *   3) 台账不许漏表（新加的无界自增表若没登记，结构闸直接红）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseManager } from '../../src/main/services/db/database'
import { describeGrowth, growthTableNames } from '../../src/main/services/db/growth-report'
import { describeGrowthRow, formatBytes } from '../../src/renderer/src/pages/about-settings.constants'

/** 只增表台账的最小写入：列名按建表语句，只填 NOT NULL 的那几个 */
const SEEDS: Array<{ table: string; sql: string; args: unknown[] }> = [
  { table: 'audit_logs', sql: 'INSERT INTO audit_logs (id, timestamp, action) VALUES (?,?,?)', args: ['a-1', 1_700_000_000_000, 'cmd_exec:SSH 执行完成'] },
  { table: 'audit_logs', sql: 'INSERT INTO audit_logs (id, timestamp, action) VALUES (?,?,?)', args: ['a-2', 1_700_000_090_000, 'ssh_conn:SSH 连接建立'] },
  { table: 'kb_view_history', sql: 'INSERT INTO kb_view_history (entryId, title, viewedAt) VALUES (?,?,?)', args: ['k-1', '查看历史', 1_700_000_010_000] },
  { table: 'tool_call_log', sql: 'INSERT INTO tool_call_log (toolName, timestamp) VALUES (?,?)', args: ['ssh_exec', 1_700_000_020_000] },
  { table: 'budget_alerts', sql: 'INSERT INTO budget_alerts (level, text, timestamp) VALUES (?,?,?)', args: ['alert', 'token 日消耗超阈值', 1_700_000_030_000] },
  { table: 'memory_audit', sql: 'INSERT INTO memory_audit (ts, trigger, op, detail) VALUES (?,?,?,?)', args: [1_700_000_040_000, 'task_end', 'write', '沉淀一条环境事实'] },
  {
    table: 'decision_audit',
    sql: 'INSERT INTO decision_audit (decisionId, timestamp, actor, action, result, prevHash, hash) VALUES (?,?,?,?,?,?,?)',
    args: ['dc_seed', 1_700_000_050_000, 'Risk Engine', '风险评估 · LOW · 10 分', 'completed', 'f'.repeat(64), 'e'.repeat(64)],
  },
  {
    table: 'chat_messages',
    sql: 'INSERT INTO chat_messages (id, role, content, createdAt) VALUES (?,?,?,?)',
    args: ['msg_seed', 'user', '磁盘满了怎么办', 1_700_000_060_000],
  },
]

/** 时间列逐表不同，测试自己也要有一份，才能证明报上来的不是同一个数 */
const TIME_COLUMN: Record<string, string> = {
  audit_logs: 'timestamp',
  kb_view_history: 'viewedAt',
  tool_call_log: 'timestamp',
  budget_alerts: 'timestamp',
  memory_audit: 'ts',
  decision_audit: 'timestamp',
  chat_messages: 'createdAt',
}

function seed(db: DatabaseManager): void {
  for (const s of SEEDS) db.prepare(s.sql).run(...(s.args as never[]))
}

function rowOf(growth: ReturnType<typeof describeGrowth>, table: string) {
  const row = growth.tables.find((t) => t.table === table)
  if (!row) throw new Error(`台账里没有 ${table} 这一行`)
  return row
}

describe('体积台账：真实读数', () => {
  let db: DatabaseManager

  beforeEach(() => {
    DatabaseManager.resetInstance()
    db = DatabaseManager.getInstance(':memory:')
    seed(db)
  })

  it('登记的表全在台账里，且顺序与登记一致', () => {
    const growth = describeGrowth(db, { auditRetentionDays: 180 })
    expect(growth.tables.map((t) => t.table)).toEqual(growthTableNames())
    expect(growthTableNames()).toEqual([
      'audit_logs',
      'kb_view_history',
      'tool_call_log',
      'budget_alerts',
      'memory_audit',
      'decision_audit',
      'chat_messages',
    ])
  })

  it('条数与最早/最新时间逐表对得上（不是把同一个数抄了几遍）', () => {
    const growth = describeGrowth(db, { auditRetentionDays: 180 })
    expect(rowOf(growth, 'audit_logs').rows).toBe(2)
    expect(rowOf(growth, 'audit_logs').oldestAt).toBe(1_700_000_000_000)
    expect(rowOf(growth, 'audit_logs').newestAt).toBe(1_700_000_090_000)

    // 逐表清单从 SEEDS 推，不在这个测试里再抄一份表名：
    // 上一版抄了，加一张表就漏检一张（本仓为这类分叉记过账）。
    const seeded = new Map<string, number>()
    for (const s of SEEDS) seeded.set(s.table, (seeded.get(s.table) ?? 0) + 1)
    for (const [table, count] of seeded) {
      if (table === 'audit_logs') continue // 上面逐值判过了
      const row = rowOf(growth, table)
      expect(row.rows, `${table} 应当是 ${count} 条`).toBe(count)
      expect(row.oldestAt, `${table} 最早时间（列 ${TIME_COLUMN[table]}）`).toBeTypeOf('number')
      expect(row.error).toBeNull()
    }
    // 每张表的最早时间各不相同——这正是"逐表真读过自己的时间列"的反证：
    // 若台账把同一个数抄给所有表，这里立刻塌成 1。
    const oldest = new Set(growth.tables.map((t) => t.oldestAt))
    expect(oldest.size, '各表最早时间出现重复：台账可能在抄同一个数').toBe(growth.tables.length)
  })

  it('空表报 0 条且不带 error（"没数据"是事实，不是故障）', () => {
    db.prepare('DELETE FROM tool_call_log').run()
    const row = rowOf(describeGrowth(db, { auditRetentionDays: 180 }), 'tool_call_log')
    expect(row.rows).toBe(0)
    expect(row.oldestAt).toBeNull()
    expect(row.error).toBeNull()
  })

  it('只有操作审计带保留天数，其余各张报 null = 永久累积', () => {
    const growth = describeGrowth(db, { auditRetentionDays: 90 })
    expect(rowOf(growth, 'audit_logs').retentionDays).toBe(90)
    for (const t of growth.tables.filter((x) => x.table !== 'audit_logs')) {
      expect(t.retentionDays, `${t.table} 没有任何删除路径，不许谎报保留期`).toBeNull()
    }
  })

  it('库文件：内存库报 null，真文件报实际字节数', () => {
    expect(describeGrowth(db, { auditRetentionDays: 180 }).fileBytes).toBeNull()
    expect(describeGrowth(db, { auditRetentionDays: 180 }).filePath).toBe(':memory:')

    const dir = resolve(tmpdir(), `tdsf-growth-${process.pid}`)
    const file = join(dir, 'growth.sqlite')
    mkdirSync(dir, { recursive: true })
    DatabaseManager.resetInstance()
    const disk = DatabaseManager.getInstance(file)
    try {
      seed(disk)
      const growth = describeGrowth(disk, { auditRetentionDays: 180 })
      expect(growth.filePath).toBe(file)
      expect(growth.fileBytes).toBeTypeOf('number')
      expect(growth.fileBytes).toBeGreaterThan(0)
      expect(growth.fileBytes).toBe(statSync(file).size)
    } finally {
      DatabaseManager.resetInstance()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('体积台账：读失败不许演成 0 条', () => {
  it('表被拆掉时该行 rows=null 且 error 非空，其余各行照常出数', () => {
    DatabaseManager.resetInstance()
    const db = DatabaseManager.getInstance(':memory:')
    seed(db)
    db.prepare('DROP TABLE budget_alerts').run()

    const growth = describeGrowth(db, { auditRetentionDays: 180 })
    const broken = rowOf(growth, 'budget_alerts')
    expect(broken.rows).toBeNull()
    expect(broken.error).toBeTruthy()
    expect(rowOf(growth, 'audit_logs').rows).toBe(2)
    // 界面口径：rows=null 显示"读不到"，绝不显示"0 条"
    expect(describeGrowthRow(broken).value).toBe('读不到')
    expect(describeGrowthRow(broken).ok).toBe(false)
  })

  it('降级库（isAvailable=false）逐行报降级原因，而不是几张空表', () => {
    let prepareCalls = 0
    const stub = {
      isAvailable: () => false,
      getFilePath: () => join('C:', 'fake', 'tdsf.sqlite'),
      getStatus: () => ({ degradedReason: '原生模块 better-sqlite3 未能加载' }),
      prepare: () => {
        prepareCalls += 1
        throw new Error('降级库不该被查询')
      },
    } as unknown as DatabaseManager

    const growth = describeGrowth(stub, { auditRetentionDays: 180 })
    expect(growth.fileBytes).toBeNull()
    // 每张登记的表都要有一行——按登记表反查，不抄份数字进来当基线
    expect(growth.tables).toHaveLength(growthTableNames().length)
    for (const row of growth.tables) {
      expect(row.rows, `${row.table} 不许显示 0`).toBeNull()
      expect(row.error).toBe('原生模块 better-sqlite3 未能加载')
    }
    // 降级分支根本不碰 SQL：碰了就是上面那个 throw
    expect(prepareCalls).toBe(0)
  })
})

describe('体积台账：显示口径', () => {
  it('字节数按阈值换单位，null 报"未知"', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatBytes(null)).toBe('未知')
  })

  it('保留策略写进说明：null = 不会自动清理，有值 = 保留 N 天', () => {
    const base = { table: 'x', label: 'X', rows: 3, oldestAt: 1_700_000_000_000, newestAt: 1_700_000_090_000, error: null, retentionDays: null }
    expect(describeGrowthRow({ ...base, retentionDays: null }).desc).toContain('不会自动清理')
    expect(describeGrowthRow({ ...base, retentionDays: 180 }).desc).toContain('保留 180 天')
    expect(describeGrowthRow({ ...base, rows: 0, oldestAt: null }).desc).toContain('目前是空的')
  })
})

describe('结构闸：台账不许漏掉新的无界表', () => {
  /** 扫 src/main 全部 .ts，收集"被 DELETE FROM 过的表名" */
  function deletedTables(): Set<string> {
    const out = new Set<string>()
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith('.ts')) {
          const src = readFileSync(full, 'utf8')
          for (const m of src.matchAll(/DELETE\s+FROM\s+([A-Za-z_][\w]*)/gi)) out.add(m[1])
        }
      }
    }
    walk(resolve(__dirname, '../../src/main'))
    return out
  }

  it('阳性对照：扫描真的抓到东西（扫到 0 个就说明量具坏了）', () => {
    const deleted = deletedTables()
    expect(deleted.size).toBeGreaterThan(3)
    expect(deleted.has('audit_logs')).toBe(true)
  })

  it('库里每张 AUTOINCREMENT 表，只要没人删它，就必须登记在台账里', () => {
    DatabaseManager.resetInstance()
    const db = DatabaseManager.getInstance(':memory:')
    const rows = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL")
      .all() as Array<{ name: string; sql: string }>
    expect(rows.length, 'sqlite_master 只读到 0 行 = 量具坏了').toBeGreaterThan(10)

    // 虚拟表的影子表（sqlite-vec 自己建的 knowledge_vec_chunks 等）由扩展托管，
    // 不是应用往里追加的日志表；按"虚拟表名前缀"排除，将来新增虚拟表也自动排除。
    const virtuals = rows
      .filter((r) => /CREATE\s+VIRTUAL\s+TABLE/i.test(r.sql))
      .map((r) => r.name)
    const isShadowOfVirtual = (name: string): boolean =>
      virtuals.some((v) => name === v || name.startsWith(`${v}_`))

    const deleted = deletedTables()
    const unbounded = rows
      .filter(
        (r) => /AUTOINCREMENT/i.test(r.sql) && !deleted.has(r.name) && !isShadowOfVirtual(r.name)
      )
      .map((r) => r.name)
      .sort()
    const registered = growthTableNames()
    expect(unbounded.length, '过滤后连 4 张已知无界表都不在 = 这条判据是死的').toBeGreaterThanOrEqual(4)
    const missing = unbounded.filter((t) => !registered.includes(t))
    expect(missing, `新增的无界只增表没登记进体积台账：${missing.join(', ')}`).toEqual([])
  })
})
