/**
 * 对话历史仓储（任务 #177）
 *
 * 为什么要有这张表：`stores/agent-store.ts` 是纯内存的，重启后所有对话全丢；
 * 而显示侧读的是未过滤的全量列表，于是切了服务器还能看见上一台的回答，
 * `recordChatDecision` 拿"最后一条用户/助手消息"时也照着这份全量列表——
 * 决策卡会把别的服务器上的话记到当前这台名下。
 *
 * 三条口径写在这里，别处不要再各写一遍：
 * 1. **一条消息一行，按 id 覆盖**：流式期先落半截、done 之后补全同一 id；
 *    变成两行就等于界面上永远看得到那条半截的。
 * 2. **按会话取，NULL 单独一档**：`sshSessionId IS ?`（不是 `=`），
 *    没连服务器时的对话也是合法的一档，但不与任何服务器混。
 * 3. **回看不能比当场看到的少**：思考链、工具卡、用量（含 estimated 标记）、
 *    取消与失败两档都进出要同形，所以 JSON 列在仓储层负责解析，不甩给调用方。
 */
import type { Database } from 'better-sqlite3'
import type { ChatMessageRecord } from '@shared/chat-types'

// 形状只在 @shared/chat-types 定义一份：主进程、契约、渲染层三方共用，抄本会静默漂。
export type { ChatMessageRecord }

/** 库里的一行：JSON 列还是字符串，布尔还是 0/1 */
interface ChatRow {
  id: string
  correlationId: string | null
  sshSessionId: string | null
  role: string
  content: string
  reasoning: string | null
  toolEvents: string | null
  providerId: string | null
  model: string | null
  usage: string | null
  cancelled: number
  isError: number
  errorCode: string | null
  errorMessage: string | null
  contextTokens: number | null
  contextNote: string | null
  cotEntropyTrajectory: string | null
  createdAt: number
}

/** 0 是合法值，不能顺手写成"没给" */
function boolToInt(v: boolean | undefined): number {
  return v ? 1 : 0
}

/** 这两列由本仓储自己 JSON.stringify 写进去，读回也自己解；不给"半解析"的余地 */
function parseJson<T>(raw: string | null, empty: T): T {
  return raw === null ? empty : (JSON.parse(raw) as T)
}

export class ChatRepository {
  constructor(private readonly db: Database) {}

  /** 落一条消息（同 id 覆盖）。返回是否真的写进去 */
  save(m: ChatMessageRecord): boolean {
    const info = this.db
      .prepare(
        `INSERT INTO chat_messages (
           id, correlationId, sshSessionId, role, content, reasoning,
           toolEvents, providerId, model, usage, cancelled, isError, errorCode,
           errorMessage, contextTokens, contextNote, cotEntropyTrajectory, createdAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           reasoning = excluded.reasoning,
           toolEvents = excluded.toolEvents,
           providerId = excluded.providerId,
           model = excluded.model,
           usage = excluded.usage,
           cancelled = excluded.cancelled,
           isError = excluded.isError,
           errorCode = excluded.errorCode,
           errorMessage = excluded.errorMessage,
           contextTokens = excluded.contextTokens,
           contextNote = excluded.contextNote,
           cotEntropyTrajectory = excluded.cotEntropyTrajectory`
      )
      .run(
        m.id,
        m.correlationId ?? null,
        m.sshSessionId ?? null,
        m.role,
        m.content,
        m.reasoning ?? null,
        m.toolEvents === null || m.toolEvents === undefined ? null : JSON.stringify(m.toolEvents),
        m.providerId ?? null,
        m.model ?? null,
        m.usage === null || m.usage === undefined ? null : JSON.stringify(m.usage),
        boolToInt(m.cancelled),
        boolToInt(m.isError),
        m.errorCode ?? null,
        m.errorMessage ?? null,
        m.contextTokens ?? null,
        m.contextNote ?? null,
        m.cotEntropyTrajectory === null || m.cotEntropyTrajectory === undefined
          ? null
          : JSON.stringify(m.cotEntropyTrajectory),
        m.createdAt
      )
    return info.changes > 0
  }

  /**
   * 某个会话最近 limit 条，**时间正序**返回。
   * 传 null 取"没连服务器时的那一档"——两档互不共享，这是这张表存在的理由之一。
   */
  listBySession(sshSessionId: string | null, limit: number): ChatMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM chat_messages WHERE sshSessionId IS ? ORDER BY createdAt DESC, id DESC LIMIT ?`
      )
      .all(sshSessionId, Math.max(1, Math.floor(limit))) as ChatRow[]
    return rows.reverse().map((r) => ChatRepository.toRecord(r))
  }

  /** 该会话已存多少条（数据库增长报告与"回看被截断"都要说实话） */
  countBySession(sshSessionId: string | null): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE sshSessionId IS ?')
      .get(sshSessionId) as { n: number }
    return row.n
  }

  /**
   * 删掉某一档的全部记录，返回删掉的条数（#178）。
   *
   * 为什么要有这一手：面板头那颗「清空对话」原本只清内存。落盘之后它就不算数了——
   * 重启一回看，被"清掉"的问答原样回来。删按 `IS ?` 走，null 只删本机那一档，
   * 不会顺手把所有服务器的记录一起带走。
   */
  clearBySession(sshSessionId: string | null): number {
    return this.db
      .prepare('DELETE FROM chat_messages WHERE sshSessionId IS ?')
      .run(sshSessionId).changes
  }

  private static toRecord(r: ChatRow): ChatMessageRecord {
    return {
      id: r.id,
      correlationId: r.correlationId,
      sshSessionId: r.sshSessionId,
      role: r.role === 'user' ? 'user' : 'assistant',
      content: r.content,
      reasoning: r.reasoning,
      toolEvents: parseJson<unknown[]>(r.toolEvents, []),
      providerId: r.providerId,
      model: r.model,
      usage: parseJson<unknown>(r.usage, null),
      cancelled: r.cancelled === 1,
      isError: r.isError === 1,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      contextTokens: r.contextTokens,
      contextNote: r.contextNote,
      cotEntropyTrajectory: parseJson<number[] | null>(r.cotEntropyTrajectory, null),
      createdAt: r.createdAt,
    }
  }
}
