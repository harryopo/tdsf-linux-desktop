/**
 * 知识库仓储单元测试
 *
 * 测试重点：
 *   - 增删改查
 *   - Jaccard 相似度搜索
 *   - 批量导入
 *   - 自动去重
 *
 * 注意：better-sqlite3 是原生模块，在纯 Node 测试环境可能不可用
 * （NODE_MODULE_VERSION 不匹配，为 Electron 编译的）。
 * 因此使用 MockDatabase 模拟 better-sqlite3 的接口，
 * 使用内存数据结构存储，避免加载原生模块。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { KnowledgeRepository, jaccardSimilarity } from '../../src/main/services/db/knowledge-repo'
import type { KnowledgeEntry } from '../../src/shared/models'
import type { DatabaseManager } from '../../src/main/services/db/database'

// ────────── Mock DatabaseManager ──────────

/**
 * 内存数据库 mock
 *
 * 模拟 better-sqlite3 的 prepare/all/get/run/exec 接口，
 * 使用 Map 存储表数据，支持基本的 SQL 操作。
 */
class MockDatabase {
  /** 表数据：表名 → 行数组 */
  private tables: Map<string, Record<string, unknown>[]> = new Map()
  /** 向量搜索是否可用 */
  private vectorEnabled: boolean = false

  /**
   * 模拟 prepare(sql).all(...params) / get(...params) / run(...params)
   */
  prepare(sql: string): {
    all: (...params: unknown[]) => Record<string, unknown>[]
    get: (...params: unknown[]) => Record<string, unknown> | undefined
    run: (...params: unknown[]) => { changes: number }
  } {
    const tableName = this.extractTableName(sql)
    return {
      all: (...params: unknown[]) => this.executeAll(sql, tableName, params),
      get: (...params: unknown[]) => this.executeGet(sql, tableName, params),
      run: (...params: unknown[]) => this.executeRun(sql, tableName, params)
    }
  }

  exec(_sql: string): void {
    // mock: 建表语句无需实际执行
  }

  isVectorEnabled(): boolean {
    return this.vectorEnabled
  }

  /** 设置向量搜索可用性（测试用） */
  setVectorEnabled(enabled: boolean): void {
    this.vectorEnabled = enabled
  }

  /** 获取原始连接（用于事务） */
  getRawConnection(): {
    transaction: <T>(fn: () => T) => () => T
  } {
    return {
      // mock 事务：直接执行函数
      transaction: <T>(fn: () => T) => {
        return () => fn()
      }
    }
  }

  // ────────── 内部方法 ──────────

  private extractTableName(sql: string): string {
    // 从 SQL 中提取表名
    const insertMatch = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)/i)
    if (insertMatch) return insertMatch[1]
    const selectMatch = sql.match(/FROM\s+(\w+)/i)
    if (selectMatch) return selectMatch[1]
    const updateMatch = sql.match(/UPDATE\s+(\w+)/i)
    if (updateMatch) return updateMatch[1]
    const deleteMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i)
    if (deleteMatch) return deleteMatch[1]
    return 'unknown'
  }

  private executeAll(
    sql: string,
    tableName: string,
    params: unknown[]
  ): Record<string, unknown>[] {
    const rows = this.tables.get(tableName) ?? []
    // 处理 WHERE type = ? 的情况
    if (/WHERE\s+type\s*=\s*\?/i.test(sql) && params.length > 0) {
      return rows.filter((r) => r.type === params[0])
    }
    // 处理 ORDER BY（向量搜索）的情况 —— 返回所有有 embedding 的行
    if (/embedding\s+IS\s+NOT\s+NULL/i.test(sql)) {
      return rows.filter((r) => r.embedding != null)
    }
    return [...rows]
  }

  private executeGet(
    sql: string,
    tableName: string,
    params: unknown[]
  ): Record<string, unknown> | undefined {
    const rows = this.tables.get(tableName) ?? []
    // 处理 WHERE id = ? 的情况
    if (/WHERE\s+id\s*=\s*\?/i.test(sql) && params.length > 0) {
      return rows.find((r) => r.id === params[0])
    }
    return rows[0]
  }

  private executeRun(
    sql: string,
    tableName: string,
    params: unknown[]
  ): { changes: number } {
    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, [])
    }
    const rows = this.tables.get(tableName)!

    // INSERT
    if (/^INSERT/i.test(sql)) {
      // 判断是 INSERT OR REPLACE
      const isReplace = /INSERT\s+OR\s+REPLACE/i.test(sql)
      const row = params[0] as Record<string, unknown>
      if (isReplace) {
        const idx = rows.findIndex((r) => r.id === row.id)
        if (idx >= 0) {
          rows[idx] = row
        } else {
          rows.push(row)
        }
      } else {
        rows.push(row)
      }
      return { changes: 1 }
    }

    // UPDATE
    if (/^UPDATE/i.test(sql)) {
      // 处理 UPDATE ... SET useCount = useCount + 1 WHERE id = ?
      if (/useCount\s*=\s*useCount\s*\+\s*1/i.test(sql)) {
        const id = params[0] as string
        const idx = rows.findIndex((r) => r.id === id)
        if (idx >= 0) {
          rows[idx].useCount = ((rows[idx].useCount as number) ?? 0) + 1
          return { changes: 1 }
        }
        return { changes: 0 }
      }
      // 处理 UPDATE ... SET successRate = ? WHERE id = ?
      if (/SET\s+successRate\s*=\s*\?/i.test(sql)) {
        const newRate = params[0] as number
        const id = params[1] as string
        const idx = rows.findIndex((r) => r.id === id)
        if (idx >= 0) {
          rows[idx].successRate = newRate
          return { changes: 1 }
        }
        return { changes: 0 }
      }
      // 处理 UPDATE ... SET type=@type ... WHERE id=@id（带命名参数对象）
      if (params[0] && typeof params[0] === 'object' && 'id' in params[0]) {
        const newData = params[0] as Record<string, unknown>
        const id = newData.id as string
        const idx = rows.findIndex((r) => r.id === id)
        if (idx >= 0) {
          rows[idx] = { ...newData }
          return { changes: 1 }
        }
        return { changes: 0 }
      }
      // 处理 UPDATE ... WHERE id = ?（通用分支，params[0] 是对象）
      if (/WHERE\s+id\s*=\s*\?/i.test(sql) && params.length >= 2) {
        const newData = params[0] as Record<string, unknown>
        const id = params[1] as string
        const idx = rows.findIndex((r) => r.id === id)
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], ...newData, id }
          return { changes: 1 }
        }
        return { changes: 0 }
      }
      return { changes: 0 }
    }

    // DELETE
    if (/^DELETE/i.test(sql)) {
      if (/WHERE\s+id\s*=\s*\?/i.test(sql) && params.length > 0) {
        const id = params[0] as string
        const idx = rows.findIndex((r) => r.id === id)
        if (idx >= 0) {
          rows.splice(idx, 1)
          return { changes: 1 }
        }
      }
      return { changes: 0 }
    }

    return { changes: 0 }
  }
}

// ────────── 测试辅助 ──────────

/** 创建测试用知识条目 */
function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'command_skill',
    title: '查看磁盘使用情况',
    problem: '磁盘空间不足',
    commands: ['df -h', 'du -sh /var/log/*'],
    keywords: ['磁盘', 'disk', '空间', 'space', 'df'],
    tags: ['运维', '磁盘'],
    successRate: 0.9,
    useCount: 10,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

/** 创建 mock DatabaseManager */
function createMockDb(): DatabaseManager {
  const mock = new MockDatabase()
  // 返回 mock 作为 DatabaseManager（类型断言）
  return mock as unknown as DatabaseManager
}

// ────────── 测试用例 ──────────

describe('KnowledgeRepository — 知识库仓储', () => {
  let db: DatabaseManager
  let repo: KnowledgeRepository

  beforeEach(() => {
    db = createMockDb()
    repo = new KnowledgeRepository(db)
  })

  // ────────── 增删改查 ──────────

  it('add + getById: 添加并获取知识条目', () => {
    const entry = makeEntry({ id: 'test-1', title: '测试条目' })
    const added = repo.add(entry)
    expect(added).toBe(true)

    const retrieved = repo.getById('test-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.title).toBe('测试条目')
    expect(retrieved!.commands).toEqual(entry.commands)
    expect(retrieved!.keywords).toEqual(entry.keywords)
  })

  it('getById: 不存在的 ID 返回 null', () => {
    const result = repo.getById('nonexistent')
    expect(result).toBeNull()
  })

  it('update: 更新知识条目字段', () => {
    const entry = makeEntry({ id: 'test-2', title: '原标题' })
    repo.add(entry)

    const updated = repo.update('test-2', { title: '新标题', successRate: 0.95 })
    expect(updated).toBe(true)

    const retrieved = repo.getById('test-2')
    expect(retrieved!.title).toBe('新标题')
    expect(retrieved!.successRate).toBe(0.95)
  })

  it('update: 不存在的 ID 返回 false', () => {
    const result = repo.update('nonexistent', { title: '新标题' })
    expect(result).toBe(false)
  })

  it('delete: 删除知识条目', () => {
    const entry = makeEntry({ id: 'test-3' })
    repo.add(entry)
    expect(repo.getById('test-3')).not.toBeNull()

    const deleted = repo.delete('test-3')
    expect(deleted).toBe(true)
    expect(repo.getById('test-3')).toBeNull()
  })

  it('delete: 不存在的 ID 返回 false', () => {
    const result = repo.delete('nonexistent')
    expect(result).toBe(false)
  })

  // ────────── Jaccard 相似度搜索 ──────────

  it('search: 关键词匹配返回相关条目', () => {
    const entry1 = makeEntry({
      id: 'search-1',
      keywords: ['磁盘', 'disk', '空间', 'space']
    })
    const entry2 = makeEntry({
      id: 'search-2',
      keywords: ['内存', 'memory', 'oom']
    })
    repo.add(entry1)
    repo.add(entry2)

    // 使用空格分隔关键词（与分词器行为一致）
    const results = repo.search('磁盘 空间')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('search-1')
  })

  it('search: 无匹配时返回空数组', () => {
    repo.add(makeEntry({ id: 'search-3', keywords: ['磁盘', 'disk'] }))
    const results = repo.search('网络配置')
    expect(results).toEqual([])
  })

  it('search: 按类型过滤', () => {
    repo.add(makeEntry({ id: 'skill-1', type: 'command_skill', keywords: ['磁盘'] }))
    repo.add(makeEntry({ id: 'case-1', type: 'incident_case', keywords: ['磁盘'] }))

    const skills = repo.search('磁盘', 'command_skill')
    expect(skills).toHaveLength(1)
    expect(skills[0].id).toBe('skill-1')

    const cases = repo.search('磁盘', 'incident_case')
    expect(cases).toHaveLength(1)
    expect(cases[0].id).toBe('case-1')
  })

  it('search: 结果按相似度降序排序', () => {
    // entry1 与查询有 3 个共同关键词
    repo.add(makeEntry({
      id: 'high-sim',
      keywords: ['磁盘', '空间', '不足', 'disk']
    }))
    // entry2 与查询有 1 个共同关键词
    repo.add(makeEntry({
      id: 'low-sim',
      keywords: ['磁盘', '网络', '配置', 'network']
    }))

    const results = repo.search('磁盘 空间 不足 disk')
    expect(results.length).toBe(2)
    expect(results[0].id).toBe('high-sim') // 相似度更高的排前面
  })

  it('search: limit 参数限制返回数量', () => {
    repo.add(makeEntry({ id: 'lim-1', keywords: ['磁盘'] }))
    repo.add(makeEntry({ id: 'lim-2', keywords: ['磁盘'] }))
    repo.add(makeEntry({ id: 'lim-3', keywords: ['磁盘'] }))

    const results = repo.search('磁盘', undefined, 2)
    expect(results).toHaveLength(2)
  })

  // ────────── 批量导入 ──────────

  it('importEntries: 批量导入知识条目', () => {
    const entries = [
      makeEntry({ id: 'imp-1', keywords: ['磁盘'] }),
      makeEntry({ id: 'imp-2', keywords: ['内存'] }),
      makeEntry({ id: 'imp-3', keywords: ['CPU'] })
    ]

    const count = repo.importEntries(entries)
    expect(count).toBe(3)

    expect(repo.getById('imp-1')).not.toBeNull()
    expect(repo.getById('imp-2')).not.toBeNull()
    expect(repo.getById('imp-3')).not.toBeNull()
  })

  // ────────── 自动去重 ──────────

  it('importEntries: 相似度 > 0.6 的条目自动合并', () => {
    // 先添加一个条目
    const existing = makeEntry({
      id: 'exist-1',
      keywords: ['磁盘', 'disk', '空间', 'space', 'df'],
      useCount: 20,
      successRate: 0.95
    })
    repo.add(existing)

    // 导入一个相似度很高的条目（4个共同关键词）
    const similar = makeEntry({
      id: 'similar-1',
      keywords: ['磁盘', 'disk', '空间', 'space', 'full'],
      useCount: 5,
      successRate: 0.8
    })

    const count = repo.importEntries([similar])
    expect(count).toBe(1)

    // 原条目应被更新（合并），新条目不应单独添加
    const updated = repo.getById('exist-1')
    expect(updated).not.toBeNull()
    // 合并后 useCount 应累加
    expect(updated!.useCount).toBe(25) // 20 + 5
  })

  // ────────── 导出 ──────────

  it('exportAll: 导出全部知识条目', () => {
    repo.add(makeEntry({ id: 'exp-1', type: 'command_skill' }))
    repo.add(makeEntry({ id: 'exp-2', type: 'incident_case' }))

    const all = repo.exportAll()
    expect(all).toHaveLength(2)
  })

  it('exportAll: 按类型导出', () => {
    repo.add(makeEntry({ id: 'exp-3', type: 'command_skill' }))
    repo.add(makeEntry({ id: 'exp-4', type: 'incident_case' }))

    const skills = repo.exportAll('command_skill')
    expect(skills).toHaveLength(1)
    expect(skills[0].type).toBe('command_skill')
  })

  // ────────── 使用次数和成功率 ──────────

  it('incrementUseCount: 使用次数 +1', () => {
    repo.add(makeEntry({ id: 'use-1', useCount: 5 }))
    repo.incrementUseCount('use-1')

    const entry = repo.getById('use-1')
    expect(entry!.useCount).toBe(6)
  })

  it('updateSuccessRate: 成功率加权更新', () => {
    repo.add(makeEntry({ id: 'rate-1', successRate: 0.9 }))

    // success=true: newRate = 0.9 * 0.9 + 1 * 0.1 = 0.91
    repo.updateSuccessRate('rate-1', true)
    const entry = repo.getById('rate-1')
    expect(entry!.successRate).toBeCloseTo(0.91, 2)
  })

  it('updateSuccessRate: 失败时成功率下降', () => {
    repo.add(makeEntry({ id: 'rate-2', successRate: 0.9 }))

    // success=false: newRate = 0.9 * 0.9 + 0 * 0.1 = 0.81
    repo.updateSuccessRate('rate-2', false)
    const entry = repo.getById('rate-2')
    expect(entry!.successRate).toBeCloseTo(0.81, 2)
  })

  // ────────── 向量搜索降级 ──────────

  it('searchByVector: 向量扩展不可用时返回空数组', () => {
    const results = repo.searchByVector([1, 2, 3], 5)
    expect(results).toEqual([])
  })
})

// ────────── Jaccard 相似度单元测试 ──────────

describe('jaccardSimilarity — Jaccard 相似度算法', () => {
  it('完全相同的集合相似度为 1', () => {
    const a = new Set(['磁盘', '空间', '不足'])
    const b = new Set(['磁盘', '空间', '不足'])
    expect(jaccardSimilarity(a, b)).toBe(1)
  })

  it('完全不同的集合相似度为 0', () => {
    const a = new Set(['磁盘', '空间'])
    const b = new Set(['内存', 'CPU'])
    expect(jaccardSimilarity(a, b)).toBe(0)
  })

  it('部分交集的集合相似度为 交集/并集', () => {
    const a = new Set(['磁盘', '空间', '不足'])
    const b = new Set(['磁盘', '空间', '满'])
    // 交集 = {磁盘, 空间} = 2
    // 并集 = {磁盘, 空间, 不足, 满} = 4
    // J = 2/4 = 0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5)
  })

  it('空集合相似度为 0', () => {
    expect(jaccardSimilarity(new Set(), new Set(['a']))).toBe(0)
    expect(jaccardSimilarity(new Set(['a']), new Set())).toBe(0)
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0)
  })
})
