/**
 * Session Registry（v0.9.4 新增）
 *
 * 职责：
 * - 集中维护 sessionId → 会话元数据（含 AbortController）的 Map
 * - 支持 abort signal（中断长时运行 IPC 调用，如 agent:chat / claude-sdk:stream）
 * - 支持 TTL 自动清理（30 分钟过期，避免内存泄漏）
 * - 提供 list() 诊断接口（用于排查卡死的会话）
 *
 * 使用方：
 * - src/main/ipc/agent-runtime.ts：agent:chat 注册会话，agent:chat:cancel 查找并 abort
 * - src/main/ipc/claude-sdk.ts：claude-sdk:stream / generate 注册，claude-sdk:cancel 查找并 abort
 * - src/main/ipc/sandbox.ts：sandbox:execute 注册（用于追踪 + 取消 pending 审批）
 *
 * 设计要点：
 * - AbortController 不可跨 IPC 序列化，因此本注册表只在主进程内部使用
 * - SessionEntry（可序列化视图）通过 @shared/agent-types 暴露给 preload/renderer
 * - TTL 清理使用 setInterval（每 5 分钟扫一次），避免为每个会话独立 timer
 *
 * 方案书依据：v0.9.4 §2.1（sessionId）+ §2.2（abort signal）
 */

import type {
  SessionId,
  SessionKind,
  SessionEntry,
} from '@shared/agent-types'
import { generateSessionId } from '@shared/agent-types'
import { logger } from '../../services/log/logger'

/** 会话过期时间（30 分钟，超过后自动清理） */
const SESSION_TTL_MS = 30 * 60 * 1000

/** TTL 清理扫描间隔（5 分钟） */
const SESSION_GC_INTERVAL_MS = 5 * 60 * 1000

/**
 * 会话注册表内部条目（含不可序列化的 AbortController）
 */
interface SessionRecord {
  /** 会话 ID（唯一标识） */
  sessionId: SessionId
  /** 关联 ID（与流式事件中的 correlationId 一致） */
  correlationId: string
  /** 会话类型（标识来源 IPC 通道） */
  kind: SessionKind
  /** Provider ID（agent:chat / claude-sdk:* 通道用） */
  providerId?: string
  /** 模型名 */
  model?: string
  /** 启动时间戳（ms） */
  startedAt: number
  /** 最后活动时间戳（ms，用于 TTL 计算） */
  lastActiveAt: number
  /** 是否已取消 */
  cancelled: boolean
  /** AbortController（不可跨 IPC 序列化，仅主进程内部使用） */
  abortController: AbortController
}

/**
 * Session Registry 单例类
 *
 * 通过 getSessionRegistry() 获取全局唯一实例。
 * 在 app.whenReady 后由 IPC handler 首次调用时自动初始化（含 GC 定时器）。
 */
class SessionRegistry {
  /** 会话记录表：sessionId → SessionRecord */
  private readonly sessions = new Map<SessionId, SessionRecord>()

  /** sessionId → correlationId 反向索引（用于通过 correlationId 查找 sessionId） */
  private readonly correlationIndex = new Map<string, SessionId>()

  /** GC 定时器句柄 */
  private gcTimer: NodeJS.Timeout | null = null

  /** 受保护日志器 */
  private readonly log = logger.child('IPC.SESSION')

  /**
   * 注册新会话
   *
   * @param options 会话参数
   * @returns 新注册的 SessionId（如未提供则自动生成）
   */
  register(options: {
    /** 会话 ID（可选，未提供时自动生成） */
    sessionId?: string
    /** 关联 ID（用于流式事件推送） */
    correlationId: string
    /** 会话类型 */
    kind: SessionKind
    /** Provider ID */
    providerId?: string
    /** 模型名 */
    model?: string
  }): SessionId {
    const sessionId = (options.sessionId as SessionId) ?? generateSessionId(options.kind.replace(':', '-'))
    const now = Date.now()

    if (this.sessions.has(sessionId)) {
      this.log.warn('register: sessionId 已存在，覆盖旧记录', { sessionId, kind: options.kind })
      // 不主动 abort 旧会话，由调用方负责（避免误取消进行中的请求）
    }

    const record: SessionRecord = {
      sessionId,
      correlationId: options.correlationId,
      kind: options.kind,
      providerId: options.providerId,
      model: options.model,
      startedAt: now,
      lastActiveAt: now,
      cancelled: false,
      abortController: new AbortController(),
    }

    this.sessions.set(sessionId, record)
    this.correlationIndex.set(options.correlationId, sessionId)
    this.ensureGcStarted()

    this.log.debug('register: 会话已注册', {
      sessionId,
      correlationId: options.correlationId,
      kind: options.kind,
      providerId: options.providerId,
      model: options.model,
    })

    return sessionId
  }

  /**
   * 通过 sessionId 获取 AbortController（用于传递给 streamText / SDK 调用）
   *
   * @param sessionId 会话 ID
   * @returns AbortController 或 undefined（会话不存在）
   */
  getAbortController(sessionId: string): AbortController | undefined {
    const record = this.sessions.get(sessionId as SessionId)
    if (!record) {
      return undefined
    }
    record.lastActiveAt = Date.now()
    return record.abortController
  }

  /**
   * 通过 sessionId 取消会话（调用 AbortController.abort()）
   *
   * @param sessionId 会话 ID
   * @returns 是否成功取消（false 表示会话不存在或已结束）
   */
  abort(sessionId: string): boolean {
    const record = this.sessions.get(sessionId as SessionId)
    if (!record) {
      this.log.warn('abort: sessionId 不存在', { sessionId })
      return false
    }
    if (record.cancelled) {
      this.log.debug('abort: 会话已被取消过，跳过', { sessionId })
      return true
    }
    record.cancelled = true
    record.abortController.abort()
    this.log.info('abort: 已发出取消信号', {
      sessionId,
      correlationId: record.correlationId,
      kind: record.kind,
    })
    return true
  }

  /**
   * 通过 correlationId 取消会话（向后兼容：旧版调用方使用 correlationId）
   *
   * @param correlationId 关联 ID
   * @returns 是否成功取消
   */
  abortByCorrelationId(correlationId: string): boolean {
    const sessionId = this.correlationIndex.get(correlationId)
    if (!sessionId) {
      this.log.warn('abortByCorrelationId: correlationId 不存在', { correlationId })
      return false
    }
    return this.abort(sessionId)
  }

  /**
   * 通过 sessionId 或 correlationId 取消会话（兼容两种 ID）
   *
   * 优先按 sessionId 查找，找不到时回退到 correlationId。
   *
   * @param id sessionId 或 correlationId
   * @returns 是否成功取消
   */
  abortById(id: string): boolean {
    // 先按 sessionId 查找
    if (this.sessions.has(id as SessionId)) {
      return this.abort(id)
    }
    // 回退到 correlationId
    return this.abortByCorrelationId(id)
  }

  /**
   * 通过 sessionId 查询会话元数据（可序列化视图）
   *
   * @param sessionId 会话 ID
   * @returns SessionEntry 或 undefined
   */
  get(sessionId: string): SessionEntry | undefined {
    const record = this.sessions.get(sessionId as SessionId)
    if (!record) {
      return undefined
    }
    return this.toEntry(record)
  }

  /**
   * 列出所有活跃会话（用于诊断 / 排查卡死的会话）
   *
   * @returns SessionEntry 数组（按启动时间升序）
   */
  list(): SessionEntry[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((r) => this.toEntry(r))
  }

  /**
   * 移除会话（请求结束时调用，释放内存）
   *
   * @param sessionId 会话 ID
   * @returns 是否成功移除
   */
  remove(sessionId: string): boolean {
    const record = this.sessions.get(sessionId as SessionId)
    if (!record) {
      return false
    }
    this.sessions.delete(sessionId as SessionId)
    this.correlationIndex.delete(record.correlationId)
    this.log.debug('remove: 会话已移除', {
      sessionId,
      correlationId: record.correlationId,
      durationMs: Date.now() - record.startedAt,
    })
    return true
  }

  /**
   * 获取当前会话数（用于诊断 / 测试）
   */
  size(): number {
    return this.sessions.size
  }

  /**
   * 启动 GC 定时器（懒启动，首次 register 时触发）
   */
  private ensureGcStarted(): void {
    if (this.gcTimer) {
      return
    }
    this.gcTimer = setInterval(() => this.runGc(), SESSION_GC_INTERVAL_MS)
    // 允许进程退出（GC 定时器不阻止 Node.js 事件循环退出）
    if (this.gcTimer.unref) {
      this.gcTimer.unref()
    }
    this.log.info('Session Registry GC 定时器已启动', {
      intervalMs: SESSION_GC_INTERVAL_MS,
      ttlMs: SESSION_TTL_MS,
    })
  }

  /**
   * 执行 GC：清理过期会话（lastActiveAt 超过 TTL）
   *
   * 注意：GC 不会主动 abort 会话，只是清理元数据。
   * 长时运行的会话应通过 abort() 显式取消。
   */
  private runGc(): void {
    const now = Date.now()
    let cleaned = 0
    for (const [sessionId, record] of this.sessions.entries()) {
      const idleMs = now - record.lastActiveAt
      if (idleMs > SESSION_TTL_MS) {
        this.sessions.delete(sessionId)
        this.correlationIndex.delete(record.correlationId)
        cleaned++
        this.log.warn('GC: 清理过期会话', {
          sessionId,
          correlationId: record.correlationId,
          kind: record.kind,
          idleMs,
          cancelled: record.cancelled,
        })
      }
    }
    if (cleaned > 0) {
      this.log.info('GC: 清理完成', { cleaned, remaining: this.sessions.size })
    }
  }

  /**
   * SessionRecord → SessionEntry（去除不可序列化的 abortController）
   */
  private toEntry(record: SessionRecord): SessionEntry {
    return {
      sessionId: record.sessionId,
      correlationId: record.correlationId,
      kind: record.kind,
      providerId: record.providerId,
      model: record.model,
      startedAt: record.startedAt,
      cancelled: record.cancelled,
    }
  }

  /**
   * 销毁注册表（仅用于测试 / 应用退出）
   *
   * 停止 GC 定时器，清空所有会话记录（不调用 abort）。
   */
  destroy(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer)
      this.gcTimer = null
    }
    this.sessions.clear()
    this.correlationIndex.clear()
  }
}

/**
 * 全局 Session Registry 单例（懒加载）
 */
let registryInstance: SessionRegistry | null = null

/**
 * 获取 Session Registry 单例
 *
 * @returns SessionRegistry 实例
 */
export function getSessionRegistry(): SessionRegistry {
  if (!registryInstance) {
    registryInstance = new SessionRegistry()
  }
  return registryInstance
}

/**
 * 重置 Session Registry 单例（仅用于测试）
 *
 * 调用 destroy() 并清空实例引用，下次 getSessionRegistry() 时重建。
 */
export function resetSessionRegistry(): void {
  if (registryInstance) {
    registryInstance.destroy()
    registryInstance = null
  }
}
