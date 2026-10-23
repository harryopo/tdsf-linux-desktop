/**
 * 对话历史的写入口必须按内容判（任务 #177，与 #97 同一族）
 *
 * 契约在 preload 那侧挡形状，这条判的是**主进程自己那道**：
 * 渲染进程按红线是沙箱且算不可信输入方，万一契约被改松、或者有人绕过 preload
 * 直接 ipcRenderer.invoke，库里就会进来角色乱、正文无限长、时间戳是字符串的行。
 * 那张表一旦有了脏行，"回看"就会在某个时刻整体炸掉——所以判据要能跑红。
 *
 * 另一件判的事同样容易假装通过：读不到库时必须抛错，不能回空数组。
 * 空数组在界面上长成"你没有历史对话"，那是把"读失败"演成"没有"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))
vi.mock('../../src/main/services/log/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/** 每次取当下那块库（测试里要能在"有库/没库"之间切换） */
const dbRef: { current: Db | null } = { current: null }
vi.mock('../../src/main/services/db/database', () => ({
  DatabaseManager: {
    getInstance: () => ({ getRawConnection: () => dbRef.current }),
  },
}))

import { ipcMain } from 'electron'
import { CHAT } from '@shared/ipc-channels'
import { applyMigrations } from '@main/services/db/schema-migrations'
import { ChatRepository } from '@main/services/db/chat-repo'
import { registerChatHistoryHandlers, rejectReason } from '@main/ipc/chat-history'
import type { ChatMessageRecord } from '@shared/chat-types'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

function msg(overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id: 'm-1',
    role: 'assistant',
    content: '这是回答',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function call(channel: string, ...args: unknown[]): unknown {
  const h = handlers.get(channel)
  if (!h) throw new Error(`通道 ${channel} 没注册，判据在对着空集说话`)
  return h({}, ...args)
}

beforeEach(() => {
  handlers.clear()
  vi.mocked(ipcMain.handle).mockClear()
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE decision_cards (id TEXT PRIMARY KEY); CREATE TABLE agent_memories (id TEXT PRIMARY KEY); CREATE TABLE knowledge_entries (id TEXT PRIMARY KEY);`)
  applyMigrations(db)
  dbRef.current = db
  registerChatHistoryHandlers()
  for (const [channel] of vi.mocked(ipcMain.handle).mock.calls as Array<[string, Handler]>) {
    const [, fn] = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel) as [
      string,
      Handler
    ]
    handlers.set(channel, fn)
  }
})

describe('注册与形状', () => {
  it('三条通道都真注册了（写入口、回看、删这一档）', () => {
    expect([...handlers.keys()].sort()).toEqual([CHAT.APPEND, CHAT.CLEAR, CHAT.LIST].sort())
  })

  it('合法消息落库，回看能取到（正反两向，证明不是恒 true）', () => {
    expect(call(CHAT.APPEND, msg({ id: 'ok-1' }))).toBe(true)
    // 没带 sshSessionId 的消息就是"没连服务器时那一档"，取它要传 null
    const mine = call(CHAT.LIST, null) as ChatMessageRecord[]
    expect(mine.map((m) => m.id)).toEqual(['ok-1'])
    expect(call(CHAT.LIST, 'sess-a'), '某一档不能看见另一档').toEqual([])
  })
})

describe('拒脏数据', () => {
  it('角色只能是 user / assistant', () => {
    for (const role of ['system', 'tool', '', 'ASSISTANT']) {
      expect(rejectReason(msg({ role: role as ChatMessageRecord['role'] })), role).toContain('角色')
    }
  })

  it('正文超长、时间戳非正或不是数、id 空 —— 一律拒', () => {
    expect(rejectReason(msg({ content: 'x'.repeat(200_001) }))).toContain('content')
    expect(rejectReason(msg({ createdAt: 0 }))).toContain('createdAt')
    expect(rejectReason(msg({ createdAt: Number.NaN }))).toContain('createdAt')
    expect(rejectReason(msg({ createdAt: Number.POSITIVE_INFINITY }))).toContain('createdAt')
    expect(rejectReason(msg({ id: '' }))).toContain('id')
    expect(rejectReason(msg({ cancelled: 'yes' as unknown as boolean }))).toContain('cancelled')
  })

  it('走 IPC 也一样：被拒的写不进库', () => {
    expect(call(CHAT.APPEND, msg({ id: 'bad-1', role: 'system' as ChatMessageRecord['role'] }))).toBe(
      false
    )
    expect(new ChatRepository(dbRef.current!).listBySession(null, 10)).toEqual([])
  })

  it('回看保真新加的四样也要判类型（给错拒掉，null 与缺省放行）', () => {
    expect(rejectReason(msg({ errorMessage: 123 as unknown as string }))).toContain('errorMessage')
    expect(rejectReason(msg({ contextNote: {} as unknown as string }))).toContain('contextNote')
    expect(rejectReason(msg({ contextNote: 'x'.repeat(4_001) }))).toContain('contextNote')
    expect(rejectReason(msg({ contextTokens: -1 }))).toContain('contextTokens')
    expect(rejectReason(msg({ contextTokens: 1.5 as unknown as number }))).toContain('contextTokens')
    expect(
      rejectReason(msg({ cotEntropyTrajectory: [0.5, 'x'] as unknown as number[] }))
    ).toContain('cotEntropyTrajectory')
    // null / 缺省是"这一项没有"，不是脏数据：拒了就等于整条消息存不下
    expect(rejectReason(msg({ errorMessage: null, contextTokens: null }))).toBeNull()
    expect(rejectReason(msg({ contextNote: undefined }))).toBeNull()
  })

  it('渲染层真发的形状：sshSessionId 给 null 是本机那一档，写得进也取得出', () => {
    // 契约那边 nullish 不收 null 的话，这一条在 preload 就抛了；这里守的是主进程这道，
    // 但它证明的是"null 是合法一档"这个口径没被哪一道改成"必须 undefined"。
    expect(call(CHAT.APPEND, msg({ id: 'local-1', sshSessionId: null }))).toBe(true)
    const local = new ChatRepository(dbRef.current!).listBySession(null, 10)
    expect(local.map((m) => m.id)).toEqual(['local-1'])
    expect(call(CHAT.LIST, 'sess-a'), '本机那档不能混进任何服务器').toEqual([])
  })
})

describe('库不可用时说实话', () => {
  it('回看抛错并带上原因，绝不回空数组', () => {
    dbRef.current = null
    expect(() => call(CHAT.LIST, 'sess-a')).toThrow(/数据库不可用/)
    expect(() => call(CHAT.APPEND, msg())).toThrow(/数据库不可用/)
  })
})

describe('删这一档（chat:clear，#178）', () => {
  it('干净入参只删那一档，返回删掉的条数', () => {
    call(CHAT.APPEND, msg({ id: 'a1', sshSessionId: 'sess-a' }))
    call(CHAT.APPEND, msg({ id: 'a2', sshSessionId: 'sess-a' }))
    call(CHAT.APPEND, msg({ id: 'b1', sshSessionId: 'sess-b' }))
    call(CHAT.APPEND, msg({ id: 'l1', sshSessionId: null }))

    expect(call(CHAT.CLEAR, 'sess-a')).toBe(2)
    const repo = new ChatRepository(dbRef.current!)
    expect(repo.listBySession('sess-a', 10)).toEqual([])
    expect(repo.listBySession('sess-b', 10).map((m) => m.id)).toEqual(['b1'])
    expect(repo.listBySession(null, 10).map((m) => m.id), '删 A 档带走了本机那档').toEqual(['l1'])
  })

  it('入参不是字符串也不是 null 时一条都不删（宁可没删，不能删错档）', () => {
    call(CHAT.APPEND, msg({ id: 'a1', sshSessionId: 'sess-a' }))
    for (const bad of [undefined, '', 0, {}, ['sess-a'], true]) {
      expect(() => call(CHAT.CLEAR, bad), JSON.stringify(bad)).toThrow(/会话/)
    }
    expect(new ChatRepository(dbRef.current!).listBySession('sess-a', 10).map((m) => m.id)).toEqual(['a1'])
  })

  it('库不可用时抛错，不演成"删了 0 条"', () => {
    dbRef.current = null
    expect(() => call(CHAT.CLEAR, 'sess-a')).toThrow(/数据库不可用/)
  })
})

describe('回看窗口由服务端定', () => {
  it('渲染层要 10 万条也只给到上限；默认取 50 条', () => {
    const repo = new ChatRepository(dbRef.current!)
    for (let i = 0; i < 260; i++) {
      repo.save(msg({ id: `m${i}`, content: `第 ${i} 条`, createdAt: 1_000 + i }))
    }
    expect((call(CHAT.LIST, null, 100_000) as ChatMessageRecord[]).length).toBe(200)
    expect((call(CHAT.LIST, null) as ChatMessageRecord[]).length).toBe(50)
    expect((call(CHAT.LIST, null, 7) as ChatMessageRecord[]).length).toBe(7)
  })
})
