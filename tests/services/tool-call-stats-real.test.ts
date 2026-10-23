/**
 * 「功能调用统计」里的知识库那一笔，记的必须是真检索
 *
 * 用户 2026-10-16 实测："知识库调用记录是假的"。截图上「知识库检索 214 / 99%」而
 * 「终端命令执行 1」。成因不在前端也不在数据库，在**记账的位置**：
 * 原来记在 `kb:search` 这个 IPC 入口，而知识库页每次打开都用空查询
 * `kbSearch('', undefined, 100)` 只是把条目列一遍 —— 于是"翻了 214 次页面"
 * 被画成"检索了 214 次"；反过来 AI 真的查知识库（supervisor 的 kb_search 工具、
 * MCP 知识工具）走的是别的入口，一条都不记。
 *
 * 现在记账点挪到所有检索都会经过的仓储层，且空查询（=浏览全部）不记账。
 * 这四条就是钉住这个口径：
 *   1. 空查询一笔都不记（页面列表加载不再是"检索"）
 *   2. 带关键词的查询记且只记一笔，标签与设置页展示口径同字
 *   3. 数据库不可用时主流程照跑（统计是旁路，不能把检索带崩）
 *   4. 阳性对照：量具真看得见 INSERT——没有这条，前三条可能只是"什么都没跑到"
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { KnowledgeRepository } from '../../src/main/services/db/knowledge-repo'
import type { DatabaseManager } from '../../src/main/services/db/database'

/** 只记 INSERT 的假库：SELECT 一律回空行，INSERT 把 (表名, 参数) 抓下来给判据看 */
function makeFakeDb(rows: Array<{ sql: string; params: unknown[] }> = []) {
  const inserts: Array<{ sql: string; params: unknown[] }> = []
  const db = {
    isAvailable: () => true,
    prepare(sql: string) {
      return {
        all: () => rows,
        get: () => undefined,
        run: (...params: unknown[]) => {
          inserts.push({ sql, params })
          return { changes: 1 }
        },
      }
    },
  }
  return { db: db as unknown as DatabaseManager, inserts }
}

/** 从抓到的 INSERT 里挑出写进 tool_call_log 的那几条，取回工具名 */
function loggedTools(inserts: Array<{ sql: string; params: unknown[] }>): string[] {
  return inserts
    .filter((i) => /INSERT INTO tool_call_log/.test(i.sql))
    .map((i) => String(i.params[0]))
}

let repo: KnowledgeRepository

beforeEach(() => {
  const { db } = makeFakeDb()
  repo = new KnowledgeRepository(db)
})

describe('知识库检索记账', () => {
  it('空查询=浏览全部，不记一笔（这正是"214 次"的来源）', () => {
    const { db, inserts } = makeFakeDb()
    const r = new KnowledgeRepository(db)
    r.search('')
    r.search('   ')
    expect(loggedTools(inserts), '翻页面不该被算成检索').toEqual([])
  })

  it('带关键词的查询记一笔「知识库检索」，且只记一笔', () => {
    const { db, inserts } = makeFakeDb()
    const r = new KnowledgeRepository(db)
    r.search('nginx 502', undefined, 3)
    expect(loggedTools(inserts)).toEqual(['知识库检索'])
  })

  it('写不进去时检索照跑，不抛（记账是旁路，不许把主流程带崩）', () => {
    // 夹具要说准：降级的是"写 tool_call_log 这一笔"，读候选还得正常——
    // 否则异常是从检索自己的 SELECT 抛的，测的就不是记账那一层了（第一版就踩了这个坑）
    const db = {
      isAvailable: () => true,
      prepare: (sql: string) => ({
        all: () => [] as unknown[],
        get: () => undefined,
        run: (..._params: unknown[]) => {
          throw new Error('tool_call_log 写入失败（磁盘满/表没建起来都算这种）')
        },
      }),
    } as unknown as DatabaseManager
    const r = new KnowledgeRepository(db)
    expect(() => r.search('磁盘满了怎么办')).not.toThrow()
  })

  it('阳性对照：量具真的认得这条 INSERT（前三条不是空跑）', () => {
    const prepared: string[] = []
    const runs: Array<{ sql: string; params: unknown[] }> = []
    const db = {
      isAvailable: () => true,
      prepare: (sql: string) => {
        prepared.push(sql)
        return {
          all: () => [] as unknown[],
          get: () => undefined,
          run: (...params: unknown[]) => {
            runs.push({ sql, params })
            return { changes: 1 }
          },
        }
      },
    } as unknown as DatabaseManager
    const r = new KnowledgeRepository(db)
    r.search('systemd')
    // 一次检索 = 读候选（all）+ 记账（run 到 tool_call_log）。
    // 只看 run 会被"prepare 都没被调到"糊过去，所以 prepared 也一起数。
    expect(prepared.filter((s) => /FROM knowledge_entries/.test(s)), '检索没真去读候选').toHaveLength(1)
    const logged = runs.filter((i) => /INSERT INTO tool_call_log/.test(i.sql))
    expect(logged, '一句都没写进 tool_call_log，说明量具没接上真写入路径').toHaveLength(1)
    expect(logged[0].params[0], '写的必须是工具名，参数顺序错了统计就是空的').toBe('知识库检索')
    expect(typeof logged[0].params[1], '第二笔必须是时间戳').toBe('number')
  })
})

/**
 * 记账点必须只有一个：入口再各自记一次就会重复计数，一个都不记就回到"假 0"。
 *
 * #180 起检索有两条互斥路径（混合检索命中 / 关键词兜底），两条都要记、且只能记一次。
 * 结构上的保证是：标签字符串与 recordToolCall 调用都收在知识库仓储里，
 * 另一条路径只是调 repo.recordRetrieval() 借它记——所以这里钉两件事：
 *   1. 谁都不许绕过常量、直接把「知识库检索」写进 recordToolCall；
 *   2. 这个常量只在 knowledge-repo.ts 声明。
 * "每条路径各记一笔、不翻倍"由 kb-search-hybrid.test.ts 按次数实测。
 */
describe('知识库这一项没有第二个记账点', () => {
  it('标签只由知识库仓储声明，没有别处绕过它直接记账', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '../../src/main')
    const direct: string[] = []
    const declared: string[] = []
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const text = fs.readFileSync(p, 'utf8')
          const rel = path.relative(root, p).replace(/\\/g, '/')
          if (/recordToolCall\([^)]*['"]知识库检索['"]/.test(text)) direct.push(rel)
          if (/export const KNOWLEDGE_RETRIEVAL_LABEL\s*=/.test(text)) declared.push(rel)
        }
      }
    }
    walk(root)

    expect(direct, `不许绕过常量直接记账：${direct.join(', ')}`).toEqual([])
    expect(declared, `「知识库检索」这个标签只能声明一次：${declared.join(', ')}`).toEqual([
      'services/db/knowledge-repo.ts',
    ])
  })
})
