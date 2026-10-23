/**
 * 知识包导入与向量产出（#180，真 better-sqlite3 库）
 *
 * 这条链以前断在两处：kb:import 有通道但界面上没有任何入口，
 * 而且 knowledge_entries.embedding 一列从来没有人写——于是向量检索那条腿
 * 每次都静默返回空，"语义检索"只剩文档里那句话。
 *
 * 判据一律读回库里那一行，不看函数返回值自证。
 * 向量器做成可注入的：真正的 ONNX 模型不在单测里跑（它要几百 MB 文件），
 * 但"导入有没有真的把向量写进库"这条必须用真库证。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseManager } from '../../src/main/services/db/database'
import { KnowledgeRepository } from '../../src/main/services/db/knowledge-repo'
import { importKnowledgeFiles, type KbEmbedder } from '../../src/main/services/knowledge/kb-import'
import {
  knowledgeEmbeddingText,
  reindexKnowledgeEmbeddings,
} from '../../src/main/services/knowledge/kb-embedding'
import type { KnowledgeEntry } from '../../src/shared/models'

let dir: string
let dbm: DatabaseManager
let repo: KnowledgeRepository

/** 每次调用记下这一批发进去的文本，用于证"内容没变就不重算" */
function fakeEmbedder(available = true): KbEmbedder & { batches: string[][] } {
  const batches: string[][] = []
  return {
    batches,
    async ensureReady() {
      return available ? null : '本地向量模型还没下载好'
    },
    async embed(texts: string[]) {
      batches.push(texts)
      return texts.map((text) => {
        // 维度必须是真的 512：vec0 虚拟表按 float[512] 建，短向量会被触发器拒绝
        const vec = new Float32Array(512)
        // 向量跟着文本变：正文一改，重算出来的向量就该不一样
        vec[0] = Array.from(text).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 997
        vec[1] = text.length
        return vec
      })
    },
  }
}

function writeNote(name: string, lines: string[]): string {
  const path = join(dir, name)
  writeFileSync(path, lines.join('\n'), 'utf8')
  return path
}

/** 读库里那一行的向量列（判据要看落盘结果，不看返回对象） */
function rawEmbedding(id: string): string | null {
  const row = dbm.prepare('SELECT embedding FROM knowledge_entries WHERE id = ?').get(id) as
    | { embedding: string | null }
    | undefined
  return row?.embedding ?? null
}

function countRows(ids: string[]): number {
  const placeholders = ids.map(() => '?').join(',')
  const row = dbm
    .prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE id IN (${placeholders})`)
    .get(...ids) as { n: number }
  return row.n
}

beforeEach(() => {
  DatabaseManager.resetInstance()
  dbm = DatabaseManager.getInstance(':memory:')
  repo = new KnowledgeRepository(dbm)
  dir = mkdtempSync(join(tmpdir(), 'kb-import-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  DatabaseManager.resetInstance()
})

describe('导入落库', () => {
  it('两份小节进库，界面上说几条就是几条', async () => {
    const path = writeNote('ops.md', [
      '# nginx 502 排查',
      '',
      '先看上游是否活着。',
      '',
      '```bash',
      'nginx -t',
      '```',
      '',
      '# 磁盘满清理',
      '',
      '找大日志。',
    ])

    const result = await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder: fakeEmbedder() })

    expect(result.inserted).toBe(2)
    expect(result.updated).toBe(0)
    expect(result.rejected).toEqual([])
    expect(countRows(result.ids)).toBe(2)
    const stored = repo.getById(result.ids[0])
    expect(stored?.title).toBe('nginx 502 排查')
    expect(stored?.commands).toEqual(['nginx -t'])
  })

  it('同一份文件再导一次：不新增也不重写', async () => {
    const lines = ['# 磁盘满', '', '先看 df。', '', '# 网关 502', '', '看上游。']
    const path = writeNote('ops.md', lines)
    const embedder = fakeEmbedder()

    const first = await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder })
    const before = embedder.batches.length
    const second = await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder })

    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.unchanged).toBe(2)
    expect(countRows(first.ids)).toBe(2)
    // 内容一个字没变，一次推理都不该再发（这是幂等键顺带省下的开销）
    expect(embedder.batches.length).toBe(before)
  })

  it('改了正文再导：覆盖原来那一条，本机的使用次数与答复都保住', async () => {
    const path = writeNote('ops.md', ['# 磁盘满', '', '旧版本正文。'])
    const first = await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder: fakeEmbedder() })
    const id = first.ids[0]

    // 这台机器真用过它、用户也真答过它
    repo.incrementUseCount(id)
    repo.update(id, { feedback: 'helpful' }, { fromUserAnswer: true })

    writeNote('ops.md', ['# 磁盘满', '', '新版本正文：先 df -h 再找大日志。'])
    const second = await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder: fakeEmbedder() })

    expect(second.updated).toBe(1)
    const stored = repo.getById(id)
    expect(stored?.problem).toContain('新版本正文')
    expect(stored?.useCount).toBe(1)
    expect(stored?.feedback).toBe('helpful')
    expect(countRows([id])).toBe(1)
  })

  it('正文变了就把旧向量作废并重算（否则语义检索还在找老内容）', async () => {
    const path = writeNote('ops.md', ['# 磁盘满', '', '旧正文。'])
    const first = await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder: fakeEmbedder() })
    const beforeVec = JSON.parse(String(rawEmbedding(first.ids[0]))) as number[]
    expect(beforeVec.length).toBeGreaterThan(0)

    writeNote('ops.md', ['# 磁盘满', '', '新正文。'])
    await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder: fakeEmbedder() })
    const afterVec = JSON.parse(String(rawEmbedding(first.ids[0]))) as number[]
    expect(afterVec).not.toEqual(beforeVec)
  })

  it('向量真的写进 embedding 列（语义那条腿从此有东西）', async () => {
    const path = writeNote('ops.md', ['# 磁盘满', '', '看 df。'])
    const result = await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder: fakeEmbedder() })

    expect(result.embedded).toBe(1)
    const vec = JSON.parse(String(rawEmbedding(result.ids[0]))) as number[]
    expect(vec).toHaveLength(512)
  })

  it('模型不可用时导入照样成功，并把原因原样交给界面', async () => {
    const path = writeNote('ops.md', ['# 磁盘满', '', '看 df。'])
    const result = await importKnowledgeFiles({
      paths: [path],
      repo,
      db: dbm,
      embedder: fakeEmbedder(false),
    })

    expect(result.inserted).toBe(1)
    expect(result.embedded).toBe(0)
    expect(result.embedNote).toContain('模型')
  })

  it('后缀不支持的文件整份拒绝，一条都不写', async () => {
    const path = join(dir, 'id_rsa.pem')
    writeFileSync(path, '---- PRIVATE KEY ----', 'utf8')
    const result = await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder: fakeEmbedder() })

    expect(result.inserted).toBe(0)
    expect(result.rejected[0].reason).toContain('.pem')
  })

  it('超过体积上限的文件拒掉并说明（不做半份导入）', async () => {
    const path = join(dir, 'huge.md')
    writeFileSync(path, `# 超大\n\n${'x'.repeat(3 * 1024 * 1024)}`, 'utf8')
    const result = await importKnowledgeFiles({ paths: [path], repo, db: dbm, embedder: fakeEmbedder() })

    expect(result.inserted).toBe(0)
    expect(result.rejected[0].reason).toContain('MB')
  })

  it('读不到的文件不炸整批，回一条原因', async () => {
    const result = await importKnowledgeFiles({
      paths: [join(dir, '不存在的文件.md')],
      repo,
      db: dbm,
      embedder: fakeEmbedder(),
    })
    expect(result.inserted).toBe(0)
    expect(result.rejected).toHaveLength(1)
  })
})

describe('嵌入文本单源', () => {
  it('标题与正文一起进模型，正文过长按 1500 字符截', () => {
    const text = knowledgeEmbeddingText('磁盘满排查', '问'.repeat(3000))
    expect(text.startsWith('磁盘满排查\n\n')).toBe(true)
    expect(text.length).toBeLessThanOrEqual('磁盘满排查\n\n'.length + 1500)
  })
})

/** 内置种子也可能没向量，所以"还剩几条"一律现场数，不写死 */
function countMissingEmbedding(): number {
  const row = dbm
    .prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE embedding IS NULL OR embedding = ''`)
    .get() as { n: number }
  return row.n
}

function makeEntry(id: string, title: string): KnowledgeEntry {
  const now = Date.now()
  return {
    id,
    type: 'incident_case',
    title,
    problem: `${title}的处理办法`,
    commands: [],
    keywords: [title],
    tags: ['测试'],
    successRate: 0,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

describe('补齐语义索引', () => {
  it('按上限处理，剩下多少如实回报（不假装全做完）', async () => {
    for (const id of ['kb-r-1', 'kb-r-2', 'kb-r-3']) repo.add(makeEntry(id, id))
    const before = countMissingEmbedding()

    const out = await reindexKnowledgeEmbeddings(dbm, fakeEmbedder(), 2)

    expect(out.embedded).toBe(2)
    expect(countMissingEmbedding()).toBe(before - 2)
    expect(out.remaining).toBe(before - 2)
  })

  it('模型不可用时不假装补齐成功，把原因交给界面', async () => {
    repo.add(makeEntry('kb-r-4', '磁盘满'))
    const out = await reindexKnowledgeEmbeddings(dbm, fakeEmbedder(false))

    expect(out.embedded).toBe(0)
    expect(out.note).toContain('模型')
  })
})
