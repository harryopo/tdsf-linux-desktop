/**
 * 「功能调用统计」只算口径修正之后的行
 *
 * 用户报的是屏幕上那个 214。记账点搬到仓储层只保证"以后不再把翻页算成检索"，
 * 库里已经躺着的那 214 行不会自己消失——表里只有工具名与时间戳，
 * 事后分不出哪条是真检索，所以不删数据，改成按 stats.toolCallCutoffAt 起算。
 *
 * 这两条把起算机制钉住：
 *   1. 起算点第一次读到就落盘，之后每次读都拿同一个值
 *      （否则每次启动都把"最近"往前挪，等于永远只显示今天）
 *   2. 查询真的把起算点当参数带下去（假库按同一个 WHERE 语义过滤：
 *      早于起算点的行不许出现在结果里）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DatabaseManager } from '../../src/main/services/db/database'

const box = vi.hoisted(() => ({
  config: new Map<string, unknown>(),
  /** 最近一次 prepare 拿到的 SQL 与参数 */
  lastSql: '',
  lastParams: [] as unknown[],
  /** 表里的行（timestamp 由用例决定） */
  rows: [] as Array<{ toolName: string; timestamp: number }>,
}))

vi.mock('../../src/main/services/storage/config-store', () => ({
  ConfigStore: {
    get: (k: string) => box.config.get(k),
    set: (k: string, v: unknown) => {
      box.config.set(k, v)
    },
  },
}))

vi.mock('../../src/main/services/log/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const db = {
  isAvailable: () => true,
  prepare(sql: string) {
    return {
      all: (...params: unknown[]) => {
        box.lastSql = sql
        box.lastParams = params
        // 只实现这一条判据需要的那一种查询：带 timestamp 起算点的分组计数
        const cutoff = Number(params[0] ?? 0)
        const counts = new Map<string, number>()
        for (const r of box.rows) {
          if (r.timestamp < cutoff) continue
          counts.set(r.toolName, (counts.get(r.toolName) ?? 0) + 1)
        }
        return [...counts].map(([toolName, cnt]) => ({ toolName, cnt }))
      },
      get: () => undefined,
      run: () => ({ changes: 1 }),
    }
  },
}

/** 装载被测模块（每例都拿一份干净的模块状态） */
async function load() {
  vi.resetModules()
  const tcl = await import('../../src/main/services/db/tool-call-log')
  const ms = await import('../../src/main/ipc/model-stats')
  return { cutoffMs: tcl.toolCallCutoffMs, KEY: tcl.TOOL_CALL_CUTOFF_KEY, register: ms.registerModelStatsHandlers }
}

/** 抓住 ipcMain.handle 注册的处理器 */
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))

beforeEach(() => {
  box.config.clear()
  box.lastSql = ''
  box.lastParams = []
  box.rows = []
  handlers.clear()
})

describe('工具调用统计的起算点', () => {
  it('第一次读就落盘，之后每次读都是同一个值', async () => {
    const { cutoffMs, KEY } = await load()
    const first = cutoffMs()
    expect(Number.isFinite(first) && first > 0, '起算点必须是一个真实时间戳').toBe(true)
    expect(box.config.get(KEY)).toBe(first)
    // 再读一次不许变（否则"最近"会随启动次数往前挪，历史永远显示不出来）
    expect(cutoffMs()).toBe(first)
  })

  it('早于起算点的行不进统计，之后的照常分组计数', async () => {
    const { cutoffMs, register } = await load()
    const t0 = cutoffMs()
    box.rows = [
      // 口径修正之前躺着的历史行（用户看到的那个 214）
      ...Array.from({ length: 214 }, (_, i) => ({ toolName: '知识库检索', timestamp: t0 - 1000 - i })),
      // 修正之后的两行
      { toolName: '知识库检索', timestamp: t0 + 1 },
      { toolName: '终端命令执行', timestamp: t0 + 2 },
    ]
    register(db as unknown as DatabaseManager)
    const handler = handlers.get('model:toolCalls')
    expect(handler, 'model:toolCalls 没注册').toBeTruthy()
    const stats = (await handler!({})) as Array<{ name: string; count: number }>

    const kb = stats.find((s) => s.name === '知识库检索')
    expect(kb?.count, '旧行仍被算进来 → 用户看到的还是 214').toBe(1)
    expect(stats.find((s) => s.name === '终端命令执行')?.count).toBe(1)
    // 起算点确实是当参数带下去的，不是只在内存里比
    expect(box.lastParams[0]).toBe(t0)
  })
})
