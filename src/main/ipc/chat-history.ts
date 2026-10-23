/**
 * 对话历史落盘 IPC（任务 #177 / #178）
 *
 * 三条通道：
 * - `chat:append` 落一条消息（同 id 覆盖）；
 * - `chat:list`   按会话回看最近若干条（时间正序）；
 * - `chat:clear`  删掉某一档的全部记录（面板头那颗「清空对话」按下的就是它）。
 *
 * 为什么写入口在渲染层：`stores/agent-store.ts` 才是"界面看到什么"的正本——
 * 思考链、工具卡、实测/估算用量、取消与失败两档都是它拼出来的。主进程重新拼一份
 * 只会得到更少的那一半，回看于是比当场看到的少。
 *
 * 但渲染层按红线是沙箱、算不可信输入方，所以这里**再判一遍**：
 * 契约在 preload 挡形状与上限，这里挡角色、长度与时间戳——
 * 两道不是重复，任何一道都可能被单独改松（判据 tests/unit/chat-history-ipc.test.ts）。
 */
import { ipcMain } from 'electron'
import { CHAT } from '@shared/ipc-channels'
import { CHAT_ROLES, CHAT_HISTORY_MAX_LIMIT, type ChatMessageRecord } from '@shared/chat-types'
import { ChatRepository } from '../services/db/chat-repo'
import { DatabaseManager } from '../services/db/database'
import { logger } from '../services/log/logger'

/** 正文与思考链的硬上限（与契约同值；两处都改才会漂，改一处会在这里被拒） */
const TEXT_MAX = 200_000
/** 压缩说明是一行话；给它一个正文的额度等于允许人拿它当仓库写 */
const CONTEXT_NOTE_MAX = 4_000

/** 拿库；不可用时抛错而不是回空数组——"读不到"和"没有历史"是两件事 */
function repo(): ChatRepository {
  const db = DatabaseManager.getInstance().getRawConnection()
  if (!db) throw new Error('本地数据库不可用，无法读写对话历史')
  return new ChatRepository(db)
}

/** 渲染层递来的那条消息能不能落库；返回拒绝原因，null 表示放行 */
export function rejectReason(m: ChatMessageRecord): string | null {
  if (!m || typeof m !== 'object') return '入参不是对象'
  if (typeof m.id !== 'string' || m.id.length === 0 || m.id.length > 64) return 'id 不合法'
  if (!CHAT_ROLES.includes(m.role)) return `角色只能是 ${CHAT_ROLES.join('/')}`
  if (typeof m.content !== 'string' || m.content.length > TEXT_MAX) return 'content 不合法或超长'
  if (typeof m.createdAt !== 'number' || !Number.isFinite(m.createdAt) || m.createdAt <= 0) {
    return 'createdAt 必须是正的有限数'
  }
  if (typeof m.cancelled !== 'boolean' && m.cancelled !== undefined) return 'cancelled 必须是布尔'
  if (typeof m.isError !== 'boolean' && m.isError !== undefined) return 'isError 必须是布尔'
  // 回看保真那四样（#177）同样按内容判：null/缺省是"这一项没有"，放行；
  // 类型不对就整条拒——脏行进库以后，回看在某一刻会连着这一档一起读炸。
  if (m.errorMessage !== null && m.errorMessage !== undefined) {
    if (typeof m.errorMessage !== 'string') return 'errorMessage 必须是字符串'
    if (m.errorMessage.length > TEXT_MAX) return 'errorMessage 超长'
  }
  if (m.contextNote !== null && m.contextNote !== undefined) {
    if (typeof m.contextNote !== 'string') return 'contextNote 必须是字符串'
    if (m.contextNote.length > CONTEXT_NOTE_MAX) return 'contextNote 超长'
  }
  if (
    m.contextTokens !== null &&
    m.contextTokens !== undefined &&
    (!Number.isInteger(m.contextTokens) || m.contextTokens < 0)
  ) {
    return 'contextTokens 必须是 ≥0 的整数'
  }
  if (
    m.cotEntropyTrajectory !== null &&
    m.cotEntropyTrajectory !== undefined &&
    !(
      Array.isArray(m.cotEntropyTrajectory) &&
      m.cotEntropyTrajectory.every((v) => typeof v === 'number' && Number.isFinite(v))
    )
  ) {
    return 'cotEntropyTrajectory 必须是有限数数组'
  }
  return null
}

export function registerChatHistoryHandlers(): void {
  // ------------------------------------------------------------------
  // chat:append — 落一条消息（同 id 覆盖）
  // ------------------------------------------------------------------
  ipcMain.handle(CHAT.APPEND, (_event, message: ChatMessageRecord) => {
    const reason = rejectReason(message)
    if (reason) {
      // 拒了要留在日志：渲染层若开始往这里灌别的东西，这行就是唯一的现场
      logger.warn('IPC.CHAT', `chat:append 被拒：${reason}`, { id: message?.id?.slice(0, 24) })
      return false
    }
    try {
      return repo().save(message)
    } catch (err) {
      throw new Error(`保存对话消息失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // chat:list — 按会话回看（正序）
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // chat:clear — 删掉某一档的全部记录（#178）
  // ------------------------------------------------------------------
  /**
   * 这条是**删数据**的通道，所以判得比写入口更硬：会话号必须是字符串或 null，
   * 别的值（undefined、空串、对象、数组）一概抛错。宁可没删，也不能因为
   * 调用方把参数搞丢了就退化成"删所有档"。
   */
  ipcMain.handle(CHAT.CLEAR, (_event, sshSessionId: unknown) => {
    if (sshSessionId !== null && typeof sshSessionId !== 'string') {
      logger.warn('IPC.CHAT', 'chat:clear 被拒：会话标识不是字符串也不是 null', {
        got: typeof sshSessionId,
      })
      throw new Error(`删除对话记录被拒：会话标识必须是字符串或 null（收到的是 ${typeof sshSessionId}）`)
    }
    if (sshSessionId !== null && (sshSessionId.length === 0 || sshSessionId.length > 64)) {
      // 空串不是"没连服务器"那一档（那一档用 null），当会话号收下就等于开了一个删全部的后门
      logger.warn('IPC.CHAT', 'chat:clear 被拒：会话标识是空串或过长', { len: sshSessionId.length })
      throw new Error('删除对话记录被拒：会话标识不合法')
    }
    try {
      return repo().clearBySession(sshSessionId)
    } catch (err) {
      throw new Error(`删除对话记录失败: ${(err as Error).message}`)
    }
  })

  /**
   * 参数：(sshSessionId: string | null, limit?: number)
   * 传 null 取"没连服务器时"那一档；limit 由服务端夹到上限，
   * 不接受渲染层递来的任意大数（这张表会一直长，回看窗口不能由要回看的那一方说了算）。
   */
  ipcMain.handle(CHAT.LIST, (_event, sshSessionId: string | null, limit?: number) => {
    const safeLimit = Math.min(
      CHAT_HISTORY_MAX_LIMIT,
      typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50
    )
    try {
      return repo().listBySession(sshSessionId, safeLimit)
    } catch (err) {
      throw new Error(`读取对话历史失败: ${(err as Error).message}`)
    }
  })
}
