/**
 * 对话历史落盘与按会话取数（任务 #177，删那一档见 #178）
 *
 * 这一张表要兑现的两件事，都只能靠真库判：
 *   1. 重启后还在 —— 所以必须有 INSERT，且同一条消息收尾那一笔是覆盖不是新增
 *      （流式期先落一行空的、done 之后补全文本，若变成两行，回看就会看到半截+全截各一条）；
 *   2. 切了服务器不再看到上一台的话 —— 所以取数必须按 sshSessionId 过滤，
 *      且"未连接时的对话"（NULL）要单独成档，不能被 IS NULL 之外的任何条件捞走。
 *
 * 用真实 better-sqlite3 内存库跑迁移建表（不 mock）：
 * 判的是真 SQL 的行为，尤其是 NULL 相等这种"看起来一样其实不一样"的地方。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import { applyMigrations } from '@main/services/db/schema-migrations'
import { ChatRepository, type ChatMessageRecord } from '@main/services/db/chat-repo'

function record(overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    correlationId: 'req-1',
    sshSessionId: 'sess-a',
    role: 'user',
    content: '磁盘满了怎么办',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

let db: Db
let repo: ChatRepository

beforeEach(() => {
  db = new Database(':memory:')
  // 与产品同一条路：先建基表再跑迁移，chat_messages 是 v4 建的
  db.exec(`CREATE TABLE decision_cards (id TEXT PRIMARY KEY); CREATE TABLE agent_memories (id TEXT PRIMARY KEY); CREATE TABLE knowledge_entries (id TEXT PRIMARY KEY);`)
  applyMigrations(db)
  repo = new ChatRepository(db)
})

describe('写入与回读', () => {
  it('存进去的一条能原样读回来（文本、时间、角色都不打折）', () => {
    const r = record()
    expect(repo.save(r)).toBe(true)
    const got = repo.listBySession('sess-a', 10)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ id: r.id, role: 'user', content: '磁盘满了怎么办' })
  })

  it('同一条消息第二次落库是覆盖，不是多出一行', () => {
    // 流式期先写半截、done 之后补全 —— 变成两行就等于界面上永远看得到半截那一条
    const first = record({ id: 'm1', content: '正在' })
    repo.save(first)
    repo.save(record({ id: 'm1', content: '正在回答：/var 用满，先清理日志' }))
    const got = repo.listBySession('sess-a', 10)
    expect(got).toHaveLength(1)
    expect(got[0].content).toBe('正在回答：/var 用满，先清理日志')
  })

  it('思考链、工具卡、用量与 estimated 口径都要往返（回看不该比当场看到的少）', () => {
    repo.save(
      record({
        id: 'm2',
        role: 'assistant',
        content: '结论',
        reasoning: '先看 df 再看 du',
        toolEvents: [{ toolCallId: 'c1', toolName: 'ssh_readonly', phase: 'result' }],
        usage: { inputTokens: 120, outputTokens: 40, estimated: false },
        providerId: 'deepseek',
        model: 'deepseek-chat',
      })
    )
    const got = repo.listBySession('sess-a', 10)[0]
    expect(got.reasoning).toBe('先看 df 再看 du')
    expect(got.toolEvents).toEqual([
      { toolCallId: 'c1', toolName: 'ssh_readonly', phase: 'result' },
    ])
    // #137 那条口径：实测用量与估算用量必须分得开，落一次盘就把 estimated 抹平是假账
    expect(got.usage).toEqual({ inputTokens: 120, outputTokens: 40, estimated: false })
    expect(got.providerId).toBe('deepseek')
    expect(got.model).toBe('deepseek-chat')
  })

  it('取消与失败两档要能分得开（半截回答标"已停止"靠这两列）', () => {
    repo.save(record({ id: 'm3', role: 'assistant', content: '说到一半', cancelled: true }))
    repo.save(
      record({ id: 'm4', role: 'assistant', content: '', isError: true, errorCode: 'rate-limited' })
    )
    const [cancelled, failed] = repo
      .listBySession('sess-a', 10)
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(cancelled.id).toBe('m3')
    expect(cancelled.cancelled).toBe(true)
    expect(cancelled.isError).toBe(false)
    expect(failed.isError).toBe(true)
    expect(failed.errorCode).toBe('rate-limited')
    expect(failed.cancelled).toBe(false)
  })

  it('报错原文、真实占用 tokens、压缩说明与熵轨迹要往返（这四样界面上各占一处）', () => {
    // 少落任何一样，重启后对应的界面就静默变样：报错行空白、徽章虚高、
    // 压缩那行消失、可信度卡的熵图不画。判据字段覆盖闸（chat-record-field-coverage）
    // 只保证"有地方放"，放得进取得出要这里量。
    repo.save(
      record({
        id: 'm5',
        role: 'assistant',
        content: '说到一半',
        isError: true,
        errorCode: 'auth',
        errorMessage: '401 unauthorized（key 已失效）',
        contextTokens: 8123,
        contextNote: '已压缩较早的 12 条对话',
        cotEntropyTrajectory: [0.41, 0.87, 0.02],
      })
    )
    const got = repo.listBySession('sess-a', 10)[0]
    expect(got.errorMessage).toBe('401 unauthorized（key 已失效）')
    // 徽章分子必须取 contextTokens：usage.inputTokens 是各步之和，多步工具链会虚高
    expect(got.contextTokens).toBe(8123)
    expect(got.contextNote).toBe('已压缩较早的 12 条对话')
    expect(got.cotEntropyTrajectory).toEqual([0.41, 0.87, 0.02])
  })

  it('没给这四样时读回来是空，不是 0 或空数组（0 与空数组都是陈述，不是事实）', () => {
    repo.save(record({ id: 'm6', role: 'assistant', content: '一切正常' }))
    const got = repo.listBySession('sess-a', 10)[0]
    expect(got.errorMessage ?? null).toBeNull()
    expect(got.contextTokens ?? null).toBeNull()
    expect(got.contextNote ?? null).toBeNull()
    expect(got.cotEntropyTrajectory ?? null).toBeNull()
  })
})

describe('按会话取数', () => {
  it('一台服务器的会话里读不到另一台的话（正反两向都要对）', () => {
    repo.save(record({ id: 'a1', sshSessionId: 'sess-a', content: 'A 机的问题' }))
    repo.save(record({ id: 'b1', sshSessionId: 'sess-b', content: 'B 机的问题' }))

    const a = repo.listBySession('sess-a', 10)
    expect(a.map((m) => m.id)).toEqual(['a1'])
    expect(a[0].content).toBe('A 机的问题')
    expect(repo.listBySession('sess-b', 10).map((m) => m.id)).toEqual(['b1'])
  })

  it('未连接时的对话单独成档，不和任何服务器混（NULL 不是"随便哪个"）', () => {
    repo.save(record({ id: 'n1', sshSessionId: null, content: '本机的问题' }))
    repo.save(record({ id: 'a1', sshSessionId: 'sess-a', content: 'A 机的问题' }))

    expect(repo.listBySession(null, 10).map((m) => m.id)).toEqual(['n1'])
    expect(repo.listBySession('sess-a', 10).map((m) => m.id)).toEqual(['a1'])
  })

  it('取最近 N 条，但返回的是时间正序（回看从上往下读，不是倒着拼）', () => {
    for (let i = 0; i < 5; i++) {
      repo.save(record({ id: `m${i}`, content: `第 ${i} 条`, createdAt: 1_000 + i }))
    }
    const got = repo.listBySession('sess-a', 3)
    expect(got.map((m) => m.content)).toEqual(['第 2 条', '第 3 条', '第 4 条'])
  })

  it('条数是按会话算的，不是一台机的量（否则切换会话时读数会说谎）', () => {
    repo.save(record({ id: 'a1', sshSessionId: 'sess-a' }))
    repo.save(record({ id: 'a2', sshSessionId: 'sess-a' }))
    repo.save(record({ id: 'b1', sshSessionId: 'sess-b' }))
    expect(repo.countBySession('sess-a')).toBe(2)
    expect(repo.countBySession('sess-b')).toBe(1)
    expect(repo.countBySession(null)).toBe(0)
  })
})

describe('删掉某一档（#178：面板头那颗「清空对话」）', () => {
  it('只删这一档，另两档一条不少（正反三向）', () => {
    repo.save(record({ id: 'a1', sshSessionId: 'sess-a' }))
    repo.save(record({ id: 'a2', sshSessionId: 'sess-a' }))
    repo.save(record({ id: 'b1', sshSessionId: 'sess-b' }))
    repo.save(record({ id: 'l1', sshSessionId: null }))

    expect(repo.clearBySession('sess-a')).toBe(2)
    expect(repo.listBySession('sess-a', 10), '这一档没删干净').toEqual([])
    expect(repo.listBySession('sess-b', 10).map((m) => m.id)).toEqual(['b1'])
    expect(repo.listBySession(null, 10).map((m) => m.id), '删 A 档把本机那档带走了').toEqual(['l1'])
  })

  it('本机那档（null）单独删得掉，且不会顺手删掉所有服务器', () => {
    repo.save(record({ id: 'l1', sshSessionId: null }))
    repo.save(record({ id: 'a1', sshSessionId: 'sess-a' }))
    expect(repo.clearBySession(null)).toBe(1)
    expect(repo.listBySession(null, 10)).toEqual([])
    expect(repo.listBySession('sess-a', 10).map((m) => m.id)).toEqual(['a1'])
  })

  it('第二次删同一档报 0 条（幂等，不谎报"又删了两条"）', () => {
    repo.save(record({ id: 'a1', sshSessionId: 'sess-a' }))
    repo.save(record({ id: 'a2', sshSessionId: 'sess-a' }))
    expect(repo.clearBySession('sess-a')).toBe(2)
    expect(repo.clearBySession('sess-a')).toBe(0)
  })
})
