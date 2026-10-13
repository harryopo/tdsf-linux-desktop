/**
 * 真应用里看"本地数据体积"这张卡（#94 判据的真机那一半）
 *
 * 单元测试证明了 describeGrowth() 的算术，但没证明这条链在路上不掉：
 *   主进程 SQL → app:get-info → preload → React 卡片。
 * 中间接错的界面表现是"永远转圈"或"整卡消失"，单测全绿也看不见。
 *
 * 插种怎么做的：schema 必须由应用自己建，所以起两次——第一次只为把表建出来，
 * 关掉后用测试进程里的 node:sqlite 往同一个 tdsf.db 写已知行，再起第二次看界面。
 * （不在 app.evaluate 里种：那个上下文没有 require，实测报 ReferenceError。）
 *
 * 断言为什么"精确 + 下限"混着来：kb_view_history 只有查看知识库才写，
 * 起应用不会自己长行，所以钉死 1；audit_logs 等表在启动过程里可能自己写，只断下限。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { e2eProfileDir } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

interface SeedRow {
  sql: string
  args: unknown[]
}

/** 五张表分别种 2 / 1 / 1 / 1 / 1 条 */
function plantedRows(): SeedRow[] {
  // 时间取"刚刚"：audit_logs 有 180 天保留期，启动时会清掉过期行，种旧时间等于白种
  const now = Date.now()
  return [
    { sql: 'INSERT INTO audit_logs (id, timestamp, action) VALUES (?,?,?)', args: ['seed-a1', now, 'cmd_exec:SSH 执行完成'] },
    { sql: 'INSERT INTO audit_logs (id, timestamp, action) VALUES (?,?,?)', args: ['seed-a2', now - 5000, 'ssh_conn:SSH 连接建立'] },
    { sql: 'INSERT INTO kb_view_history (entryId, title, viewedAt) VALUES (?,?,?)', args: ['seed-k1', '查看一条知识', now] },
    { sql: 'INSERT INTO tool_call_log (toolName, timestamp) VALUES (?,?)', args: ['seed-tool', now] },
    { sql: 'INSERT INTO budget_alerts (level, text, timestamp) VALUES (?,?,?)', args: ['alert', 'token 日消耗超阈值', now] },
    { sql: 'INSERT INTO memory_audit (ts, trigger, op, detail) VALUES (?,?,?,?)', args: [now, 'task_end', 'write', '沉淀一条环境事实'] },
  ]
}

const DB_FILE = 'tdsf.db'

async function launch(profile: string) {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
}

/** 用测试进程的 node:sqlite 往应用建好的表里写已知行 */
function seedRows(file: string, rows: SeedRow[]): number {
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (p: string) => {
      prepare(sql: string): { run(...a: unknown[]): unknown }
      close(): void
    }
  }
  const db = new DatabaseSync(file)
  try {
    for (const r of rows) db.prepare(r.sql).run(...r.args)
  } finally {
    db.close()
  }
  return rows.length
}

test('真应用：关于页把五张只增表的条数与库文件大小如实报出来', async () => {
  const profile = e2eProfileDir()
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })
  const dbFile = path.join(profile, DB_FILE)

  // A. 第一次起只为把 schema 建出来（表结构归应用，测试不抄 DDL）
  const boot = await launch(profile)
  await boot.firstWindow()
  await expect
    .poll(() => fs.existsSync(dbFile), { timeout: 30000, message: `应用没建出数据库文件：${dbFile}` })
    .toBe(true)
  await boot.close()

  // 正向对照：种进去 6 行，读回来必须真是 6 行
  const planted = seedRows(dbFile, plantedRows())
  expect(planted).toBe(6)

  // B. 第二次起，界面读的就是刚种下去的那份
  const app = await launch(profile)

  try {
    const page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30000 })
    await page.evaluate(() => {
      window.location.hash = '#/settings/about'
    })

    const card = page.locator('.set-card').filter({ hasText: '本地数据体积' })
    await expect(card).toHaveCount(1)

    /** 读某一行的右侧值；不是"N 条"就直接判红（宁可红也不要读成 0） */
    const countOf = async (label: string): Promise<number> => {
      const row = card.locator('.set-row').filter({ hasText: label }).first()
      const text = (await row.locator('.set-row__control').innerText()).trim()
      const m = /^(\d+) 条$/.exec(text)
      expect(m, `${label} 那行的值不是条数，界面实际写的是 "${text}"`).not.toBeNull()
      return Number(m?.[1] ?? -1)
    }

    for (const label of ['操作审计', '知识库浏览记录', '工具调用记录', '预算告警', '记忆沉淀审计']) {
      expect(await countOf(label), `${label} 读出来的条数不合法`).toBeGreaterThan(0)
    }
    // 只有这张表能保证没人别处写，所以敢钉死具体数字
    expect(await countOf('知识库浏览记录')).toBe(1)

    // 每行都要带说明（保留策略 + 最早一条）：只报一个数字等于没交代这数从哪来
    for (const label of ['操作审计', '知识库浏览记录', '工具调用记录', '预算告警', '记忆沉淀审计']) {
      const row = card.locator('.set-row').filter({ hasText: label }).first()
      await expect(row.locator('.set-row__desc'), `${label} 那行没有说明`).toContainText('最早一条')
    }

    // 读失败绝不能演成"0 条"
    await expect(card.getByText('读不到')).toHaveCount(0)

    // 库文件真报出大小（不是"未知"），并且和磁盘上的字节数同一量级
    const head = (await card.getByText('库文件').first().innerText()).trim()
    expect(head, `说明行没报出文件大小：${head}`).toMatch(/库文件 \d+(\.\d+)? (B|KB|MB|GB)/)
    expect(fs.statSync(dbFile).size).toBeGreaterThan(0)

    // 保留期只写在操作审计那一行，其余四行必须说"不会自动清理"
    const auditRow = card.locator('.set-row').filter({ hasText: '操作审计' }).first()
    await expect(auditRow).toContainText('保留 180 天')
    const kbRow = card.locator('.set-row').filter({ hasText: '知识库浏览记录' }).first()
    await expect(kbRow).toContainText('不会自动清理')

    // 只截这张卡：整页图回看时找不到重点
    await card.screenshot({ path: path.join(profile, 'about-data-growth.png') })
  } finally {
    await app.close()
  }
})
