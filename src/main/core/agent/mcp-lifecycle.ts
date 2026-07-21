/**
 * MCP 网关状态机（借鉴 instructkr/claw-code §3.3 McpLifecycleHardened）
 *
 * 5 个状态：
 * - connected   ：MCP Server 健康，可正常调用
 * - degraded    ：MCP Server 部分能力受损（部分工具不可用），降级使用
 * - recovering  ：正在尝试重连/恢复
 * - failed      ：重连失败，连续 N 次失败后进入
 * - backoff     ：冷却期，等待 backoff 时间后重试
 *
 * 状态转换：
 * - connected   → degraded    (单次调用失败但未达阈值)
 * - degraded    → connected   (恢复成功)
 * - degraded    → recovering  (连续 2 次失败)
 * - recovering  → connected   (重试成功)
 * - recovering  → failed      (重试超过 3 次)
 * - failed      → backoff     (进入冷却)
 * - backoff     → recovering  (冷却到期，自动恢复尝试)
 *
 * 阈值：
 * - 2 次连续失败：从 degraded 升级到 recovering
 * - 3 次重试失败：从 recovering 升级到 failed
 * - backoff 冷却：默认 30s（指数退避：30s, 60s, 120s）
 *
 * UI 可见性：
 * - 通过 mcp-gateway.ts 的 getLifecycleState() 暴露状态
 * - 通过 IPC 'mcp:state' 推送给渲染层
 * - 状态条显示在 ChatPanel 顶部（可折叠）
 *
 * 参考来源：idea-to-dev-output/33-源码分析-claw-code.md §四 (B3 借鉴点)
 */

import { logger } from '../../services/log/logger'

/** MCP 5 阶段状态枚举 */
export type McpLifecycleState =
  | 'connected'
  | 'degraded'
  | 'recovering'
  | 'failed'
  | 'backoff'

/** 状态 → 用户可读描述 */
export const MCP_STATE_DESCRIPTION: Record<McpLifecycleState, string> = {
  connected: 'MCP Server 健康，所有工具可用',
  degraded: '部分工具不可用，降级运行',
  recovering: '正在尝试恢复连接',
  failed: '连接失败，已暂停调用',
  backoff: '冷却期，倒计时结束后重试',
}

/** 状态 → 严重等级（颜色） */
export const MCP_STATE_SEVERITY: Record<McpLifecycleState, 'success' | 'warning' | 'error' | 'info'> = {
  connected: 'success',
  degraded: 'warning',
  recovering: 'info',
  failed: 'error',
  backoff: 'warning',
}

/** 状态变更监听器 */
export type McpStateListener = (state: McpLifecycleState, context: McpStateContext) => void

/** 状态上下文（变更时附带） */
export interface McpStateContext {
  /** 当前状态 */
  state: McpLifecycleState
  /** 连续失败次数 */
  consecutiveFailures: number
  /** 已重试次数（recovering 阶段内） */
  retryAttempts: number
  /** 上次失败时间戳 */
  lastFailureAt: number | null
  /** 上次失败原因 */
  lastFailureReason: string | null
  /** 进入 backoff 时间戳（如果当前在 backoff） */
  backoffUntil: number | null
  /** 当前 backoff 剩余秒数（如果当前在 backoff） */
  backoffRemainingSec: number
}

/** 默认配置 */
const DEFAULTS = {
  /** 升级到 recovering 的连续失败阈值 */
  DEGRADED_TO_RECOVERING_THRESHOLD: 2,
  /** 升级到 failed 的重试次数 */
  RECOVERING_TO_FAILED_THRESHOLD: 3,
  /** backoff 冷却期（秒），按次数指数退避 */
  BACKOFF_SCHEDULE: [30, 60, 120, 300],
}

/**
 * MCP 生命周期状态机（单例）
 *
 * 状态转换全部经过这里，外部模块只读不写。
 */
export class McpLifecycleManager {
  private static instance: McpLifecycleManager | null = null

  private state: McpLifecycleState = 'connected'
  private consecutiveFailures = 0
  private retryAttempts = 0
  private lastFailureAt: number | null = null
  private lastFailureReason: string | null = null
  private backoffUntil: number | null = null
  private backoffAttemptIndex = 0

  /** 状态变更监听器 */
  private listeners: Set<McpStateListener> = new Set()

  private constructor() {
    // 启动时检查 backoff 是否到期
    setInterval(() => this.checkBackoffExpiry(), 1000)
  }

  static getInstance(): McpLifecycleManager {
    if (!this.instance) {
      this.instance = new McpLifecycleManager()
    }
    return this.instance
  }

  /**
   * 报告调用成功
   *
   * 任何成功调用都重置失败计数，并按规则转换状态。
   */
  reportSuccess(): void {
    this.consecutiveFailures = 0
    this.retryAttempts = 0
    this.lastFailureAt = null
    this.lastFailureReason = null
    this.backoffUntil = null
    this.backoffAttemptIndex = 0
    this.transition('connected', '调用成功')
  }

  /**
   * 报告调用失败
   *
   * 状态机按阈值自动转换。
   *
   * @param reason 失败原因（异常 message）
   */
  reportFailure(reason: string): void {
    this.consecutiveFailures += 1
    this.lastFailureAt = Date.now()
    this.lastFailureReason = reason

    logger.warn('MCP.LIFECYCLE', `MCP 调用失败`, {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      reason,
    })

    // 状态机决策
    if (this.state === 'connected') {
      // 第一次失败 → degraded
      this.transition('degraded', `首次失败：${reason}`)
    } else if (this.state === 'degraded') {
      // 连续失败达到 recovering 阈值
      if (this.consecutiveFailures >= DEFAULTS.DEGRADED_TO_RECOVERING_THRESHOLD) {
        this.retryAttempts = 0
        this.transition('recovering', `连续 ${this.consecutiveFailures} 次失败，尝试恢复`)
      }
    } else if (this.state === 'recovering') {
      this.retryAttempts += 1
      // 重试超过阈值 → failed → backoff
      if (this.retryAttempts >= DEFAULTS.RECOVERING_TO_FAILED_THRESHOLD) {
        this.transition('failed', `重试 ${this.retryAttempts} 次仍失败`)
        this.enterBackoff()
      }
    } else if (this.state === 'backoff') {
      // 在 backoff 期间调用本来就该被拦截，这里理论上不会触发
      logger.warn('MCP.LIFECYCLE', `backoff 期间收到失败上报，忽略`)
    }
    // failed 状态：不再接受新的失败上报（避免计数污染）
  }

  /**
   * 主动重置状态机
   *
   * 供用户/管理员在 UI 上点"重置"时调用。
   */
  reset(): void {
    this.consecutiveFailures = 0
    this.retryAttempts = 0
    this.lastFailureAt = null
    this.lastFailureReason = null
    this.backoffUntil = null
    this.backoffAttemptIndex = 0
    this.transition('connected', '用户重置')
  }

  /**
   * 获取当前状态（只读快照）
   */
  getState(): McpStateContext {
    const backoffRemainingSec = this.backoffUntil
      ? Math.max(0, Math.ceil((this.backoffUntil - Date.now()) / 1000))
      : 0

    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      retryAttempts: this.retryAttempts,
      lastFailureAt: this.lastFailureAt,
      lastFailureReason: this.lastFailureReason,
      backoffUntil: this.backoffUntil,
      backoffRemainingSec,
    }
  }

  /**
   * 订阅状态变更
   *
   * @returns 取消订阅函数
   */
  subscribe(listener: McpStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ========== 私有方法 ==========

  /**
   * 状态转换
   */
  private transition(next: McpLifecycleState, reason: string): void {
    if (this.state === next) return

    const prev = this.state
    this.state = next

    logger.info('MCP.LIFECYCLE', `状态转换：${prev} → ${next}`, { reason })

    const context = this.getState()
    this.listeners.forEach((l) => l(next, context))
  }

  /**
   * 进入 backoff 冷却
   */
  private enterBackoff(): void {
    const idx = Math.min(this.backoffAttemptIndex, DEFAULTS.BACKOFF_SCHEDULE.length - 1)
    const seconds = DEFAULTS.BACKOFF_SCHEDULE[idx]
    this.backoffAttemptIndex += 1
    this.backoffUntil = Date.now() + seconds * 1000

    logger.info('MCP.LIFECYCLE', `进入 backoff 冷却`, {
      seconds,
      until: new Date(this.backoffUntil).toISOString(),
    })

    this.transition('backoff', `冷却 ${seconds}s`)
  }

  /**
   * 定时检查 backoff 是否到期
   */
  private checkBackoffExpiry(): void {
    if (this.state !== 'backoff') return
    if (!this.backoffUntil) return

    if (Date.now() >= this.backoffUntil) {
      // 冷却到期 → 重新尝试
      this.backoffUntil = null
      this.consecutiveFailures = 0
      this.retryAttempts = 0
      this.transition('recovering', '冷却到期，自动重试')
    }
  }
}
