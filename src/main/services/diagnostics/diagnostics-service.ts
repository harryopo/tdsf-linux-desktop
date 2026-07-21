/**
 * DiagnosticsService - 诊断服务入口（v1.5 新增）
 *
 * 用户原话：
 *   "建立一个检测的后端，当循环工程启动时利用后端的日志进行分析"
 *
 * 核心职责：
 *   1. 接收 SidecarManager 转发的 stdout/stderr 日志
 *   2. 调用 LogAnalyzer 实时分析每条日志
 *   3. 维护环形缓冲区（保留最近 N 条日志 + N 条检测结果）
 *   4. 通过 EventEmitter 向 IPC 层推送实时检测结果
 *   5. 生成完整的诊断报告（供渲染进程查询）
 *
 * 架构：
 *   SidecarManager.stdout/stderr
 *         ↓ ingestLog()
 *   DiagnosticsService
 *         ↓ analyze()
 *   LogAnalyzer (15 条规则)
 *         ↓ emit('finding')
 *   IPC 层 (ipc/diagnostics.ts)
 *         ↓ mainWindow.webContents.send()
 *   渲染进程 (诊断面板)
 *
 * 设计参考：
 *   - VS Code OutputChannel：环形缓冲区 + 事件推送
 *   - Elastic APM Real-time Monitoring：实时分析 + 报告生成
 *   - Sentry Scope：单例 + 全局可访问
 */

import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { LogAnalyzer } from './log-analyzer'
import type {
  LogEvent,
  LogSource,
  LogLevel,
  DiagnosticFinding,
  DiagnosticReport,
  LogPushEvent,
} from './types'
import { logger } from '../../core/logger'

/** 默认缓冲区大小（保留最近 1000 条日志） */
const DEFAULT_BUFFER_SIZE = 1000

/** 默认推送节流间隔（毫秒，避免高频日志淹没渲染进程） */
const DEFAULT_PUSH_THROTTLE_MS = 100

/**
 * DiagnosticsService 单例类
 *
 * 使用方式：
 *   const svc = DiagnosticsService.getInstance()
 *   svc.setMainWindow(mainWindow)  // 主窗口就绪后注入
 *   svc.ingestLog({
 *     source: 'sre',
 *     level: 'ERROR',
 *     raw: '...',
 *     timestamp: new Date().toISOString()
 *   })
 */
class DiagnosticsService extends EventEmitter {
  private static instance: DiagnosticsService | null = null

  /** 主窗口引用（用于推送实时事件到渲染进程） */
  private mainWindow: BrowserWindow | null = null

  /** 日志缓冲区（环形） */
  private logBuffer: LogEvent[] = []

  /** 检测结果缓冲区（环形） */
  private findingsBuffer: DiagnosticFinding[] = []

  /** 缓冲区最大容量 */
  private readonly bufferSize: number

  /** LogAnalyzer 实例 */
  private readonly analyzer: LogAnalyzer

  /** 推送节流：上次推送时间 */
  private lastPushTime = 0

  /** 推送节流：待推送的事件队列 */
  private pendingPushQueue: LogPushEvent[] = []

  /** 推送节流定时器 */
  private pushTimer: NodeJS.Timeout | null = null

  /** 推送节流间隔 */
  private readonly pushThrottleMs: number

  /** 是否启用实时推送（默认 true，可通过 setEnabled 关闭） */
  private pushEnabled = true

  /** 累计统计 */
  private stats = {
    totalIngested: 0,
    totalFindings: 0,
    bySource: {} as Record<LogSource, number>,
    byLevel: {} as Record<LogLevel, number>,
  }

  private constructor(bufferSize: number = DEFAULT_BUFFER_SIZE, pushThrottleMs: number = DEFAULT_PUSH_THROTTLE_MS) {
    super()
    this.bufferSize = bufferSize
    this.pushThrottleMs = pushThrottleMs
    this.analyzer = new LogAnalyzer()

    // 初始化统计字典
    const sources: LogSource[] = ['sre', 'analytics', 'agent', 'main', 'renderer']
    const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
    for (const s of sources) this.stats.bySource[s] = 0
    for (const l of levels) this.stats.byLevel[l] = 0

    logger.info('[DiagnosticsService] 诊断服务初始化完成')
  }

  /**
   * 获取单例
   */
  static getInstance(): DiagnosticsService {
    if (!DiagnosticsService.instance) {
      DiagnosticsService.instance = new DiagnosticsService()
    }
    return DiagnosticsService.instance
  }

  /**
   * 设置主窗口（用于实时推送）
   */
  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win
    if (win) {
      logger.info('[DiagnosticsService] 主窗口已注入，实时推送已启用')
    } else {
      logger.info('[DiagnosticsService] 主窗口已清空，实时推送已禁用')
    }
  }

  /**
   * 启用/禁用实时推送
   */
  setEnabled(enabled: boolean): void {
    this.pushEnabled = enabled
    logger.info(`[DiagnosticsService] 实时推送 ${enabled ? '已启用' : '已禁用'}`)
  }

  /**
   * 注入一条日志（核心入口）
   *
   * 由 SidecarManager 在 stdout/stderr 钩子中调用。
   * 流程：
   *   1. 推入 logBuffer（环形）
   *   2. 调用 analyzer.analyze() 实时分析
   *   3. 若命中规则，推入 findingsBuffer，并触发推送
   *   4. 更新统计
   */
  ingestLog(event: LogEvent): void {
    // 1. 推入环形缓冲区
    this.logBuffer.push(event)
    if (this.logBuffer.length > this.bufferSize) {
      this.logBuffer.shift()
    }

    // 2. 更新统计
    this.stats.totalIngested++
    this.stats.bySource[event.source] = (this.stats.bySource[event.source] || 0) + 1
    this.stats.byLevel[event.level] = (this.stats.byLevel[event.level] || 0) + 1

    // 3. 实时分析
    const findings = this.analyzer.analyze(event)
    if (findings.length > 0) {
      for (const f of findings) {
        this.findingsBuffer.push(f)
        if (this.findingsBuffer.length > this.bufferSize) {
          this.findingsBuffer.shift()
        }
        this.stats.totalFindings++
      }
      this.emit('finding', findings)
    }

    // 4. 触发推送（节流）
    if (this.pushEnabled) {
      this.queuePush({ event, hasFinding: findings.length > 0, finding: findings[0] })
    }

    // 5. emit 原始日志事件（供外部订阅）
    this.emit('log', event)
  }

  /**
   * 批量注入日志（用于回放历史日志）
   */
  ingestBatch(events: LogEvent[]): void {
    for (const e of events) {
      this.ingestLog(e)
    }
    logger.info(`[DiagnosticsService] 批量注入 ${events.length} 条日志`)
  }

  /**
   * 获取当前缓冲区内的所有日志
   */
  getLogs(): LogEvent[] {
    return [...this.logBuffer]
  }

  /**
   * 获取当前缓冲区内的所有检测结果
   */
  getFindings(): DiagnosticFinding[] {
    return [...this.findingsBuffer]
  }

  /**
   * 获取累计统计
   */
  getStats(): {
    totalIngested: number
    totalFindings: number
    bySource: Record<LogSource, number>
    byLevel: Record<LogLevel, number>
  } {
    return { ...this.stats }
  }

  /**
   * 生成完整诊断报告
   */
  getReport(): DiagnosticReport {
    return this.analyzer.generateReport(this.logBuffer, this.findingsBuffer)
  }

  /**
   * 清空缓冲区（保留统计）
   */
  clear(): void {
    this.logBuffer = []
    this.findingsBuffer = []
    this.pendingPushQueue = []
    logger.info('[DiagnosticsService] 缓冲区已清空')
  }

  /**
   * 销毁实例（应用退出时调用）
   */
  destroy(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
      this.pushTimer = null
    }
    this.removeAllListeners()
    this.mainWindow = null
    this.logBuffer = []
    this.findingsBuffer = []
    this.pendingPushQueue = []
    DiagnosticsService.instance = null
    logger.info('[DiagnosticsService] 已销毁')
  }

  // ────────── 内部方法 ──────────

  /**
   * 队列化推送（节流）
   *
   * 避免高频日志（如 Sidecar 启动时的 verbose 日志）淹没渲染进程。
   * 策略：
   *   - 事件先入队 pendingPushQueue
   *   - 若距上次推送时间 > pushThrottleMs，立即刷新队列
   *   - 否则设置定时器在剩余时间后刷新
   */
  private queuePush(evt: LogPushEvent): void {
    this.pendingPushQueue.push(evt)

    const now = Date.now()
    const elapsed = now - this.lastPushTime

    if (elapsed >= this.pushThrottleMs) {
      this.flushPushQueue()
    } else if (!this.pushTimer) {
      this.pushTimer = setTimeout(() => {
        this.flushPushQueue()
      }, this.pushThrottleMs - elapsed)
    }
  }

  /**
   * 刷新推送队列
   */
  private flushPushQueue(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
      this.pushTimer = null
    }

    if (this.pendingPushQueue.length === 0) return
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    // 批量推送（一条消息包含多个事件，减少 IPC 开销）
    const batch = [...this.pendingPushQueue]
    this.pendingPushQueue = []
    this.lastPushTime = Date.now()

    try {
      this.mainWindow.webContents.send('diagnostics:log-batch', batch)
    } catch (err) {
      logger.warn(`[DiagnosticsService] 推送日志批次失败: ${(err as Error).message}`)
    }
  }
}

/**
 * 导出单例获取函数
 */
export function getDiagnosticsService(): DiagnosticsService {
  return DiagnosticsService.getInstance()
}

/**
 * 导出类（用于类型引用）
 */
export { DiagnosticsService }
