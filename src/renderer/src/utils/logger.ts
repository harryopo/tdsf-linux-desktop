/**
 * 渲染进程日志器（v0.7.0）
 *
 * 设计与主进程 logger 对齐：
 * - 结构化日志：level/category/message/meta/correlationId
 * - 通过 IPC 转发到主进程 logger（统一落盘 + 内存 buffer + 测试可读）
 * - 失败降级：IPC 不可用时仅输出到 console
 *
 * 使用示例：
 * ```ts
 * import { logger } from '@/utils/logger'
 * logger.info('App', '从主进程加载完成', { count: 3 })
 * const uiLog = logger.child('ChatPanel')
 * uiLog.warn('输入框为空')
 * ```
 */
import { isElectronAPIAvailable } from './electron-api'

/** 日志级别（与主进程对齐） */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

/** 日志分类（业务域） */
export type LogCategory =
  | 'App'         // 应用启动
  | 'UI'          // 通用 UI
  | 'Server'      // 服务器管理
  | 'Chat'        // AI 对话
  | 'ChatPanel'   // AI 对话面板
  | 'Tutorial'    // 教程
  | 'Settings'    // 设置
  | 'Knowledge'   // 知识库
  | 'Monitor'     // 监控
  | 'Profiler'    // 系统架构感知
  | 'Deploy'      // Web 部署
  | 'Crawler'     // 教程爬虫
  | string        // 允许自定义

/** 日志条目基础结构 */
export interface RendererLogPayload {
  level: LogLevel
  category: string
  message: string
  meta?: Record<string, unknown>
  correlationId?: string
}

/** 生成 correlationId（用于跨进程追踪） */
let _corrIdCounter = 0
export function newCorrelationId(prefix = 'ui'): string {
  _corrIdCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${_corrIdCounter}`
}

// ============================================================================
// Renderer Logger
// ============================================================================

/**
 * 渲染进程 Logger（单例）
 *
 * 每次调用 log() 会：
 * 1. 立刻输出到 console（带颜色，便于开发调试）
 * 2. 异步通过 IPC 上报到主进程 logger（统一落盘 + 测试可读）
 */
class RendererLogger {
  private minLevel: LogLevel = 'INFO'
  /** 失败的 IPC 上报计数（用于自检） */
  private failedUploads = 0

  /** 设置最低日志级别（仅影响前端 console 输出，主进程由独立配置控制） */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level
  }

  /** 记录 DEBUG */
  debug(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log({ level: 'DEBUG', category, message, meta })
  }

  /** 记录 INFO */
  info(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log({ level: 'INFO', category, message, meta })
  }

  /** 记录 WARN */
  warn(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log({ level: 'WARN', category, message, meta })
  }

  /** 记录 ERROR */
  error(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log({ level: 'ERROR', category, message, meta })
  }

  /** 记录 FATAL */
  fatal(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log({ level: 'FATAL', category, message, meta })
  }

  /** 创建子 logger（自动添加 category 前缀） */
  child(subCategory: string): ChildRendererLogger {
    return new ChildRendererLogger(this, subCategory)
  }

  /** 内部：通用日志接口 */
  log(payload: RendererLogPayload): void {
    // 1. console 输出（带 ANSI 颜色）
    if (this.shouldLog(payload.level)) {
      this.writeToConsole(payload)
    }
    // 2. 异步上报到主进程（不阻塞 UI）
    this.uploadToMain(payload).catch(() => {
      // 静默失败：避免日志系统本身影响业务
      this.failedUploads += 1
    })
  }

  /** 获取失败上报次数（自检用） */
  getFailedUploadCount(): number {
    return this.failedUploads
  }

  // ----------------------------------------------------------------
  // 私有方法
  // ----------------------------------------------------------------

  /** 是否输出到 console（主进程由 minLevel 独立控制） */
  private shouldLog(level: LogLevel): boolean {
    const priority: Record<LogLevel, number> = {
      DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, FATAL: 50,
    }
    return priority[level] >= priority[this.minLevel]
  }

  /** 输出到 console */
  private writeToConsole(payload: RendererLogPayload): void {
    const color = this.getConsoleColor(payload.level)
    const reset = '\x1b[0m'
    const dim = '\x1b[2m'
    const line = `${dim}[ui]${reset} ${color}${payload.level}${reset} ${dim}[${payload.category}]${reset} ${payload.message}`
    const metaStr = payload.meta ? ` ${dim}${JSON.stringify(payload.meta)}${reset}` : ''
    const corrStr = payload.correlationId ? ` ${dim}#${payload.correlationId}${reset}` : ''
    const finalLine = `${line}${metaStr}${corrStr}`
    if (payload.level === 'ERROR' || payload.level === 'FATAL') {
      console.error(finalLine)
    } else if (payload.level === 'WARN') {
      console.warn(finalLine)
    } else {
      console.log(finalLine)
    }
  }

  /** ANSI 颜色 */
  private getConsoleColor(level: LogLevel): string {
    switch (level) {
      case 'DEBUG': return '\x1b[90m'
      case 'INFO':  return '\x1b[36m'
      case 'WARN':  return '\x1b[33m'
      case 'ERROR': return '\x1b[31m'
      case 'FATAL': return '\x1b[35m'
    }
  }

  /** 异步上报到主进程 */
  private async uploadToMain(payload: RendererLogPayload): Promise<void> {
    if (!isElectronAPIAvailable()) return
    try {
      await window.electronAPI.logRenderer(payload)
    } catch {
      // 已在外层 catch
      throw new Error('log upload failed')
    }
  }
}

/** 子 logger（绑定 category 前缀） */
class ChildRendererLogger {
  constructor(
    private readonly parent: RendererLogger,
    private readonly subCategory: string
  ) {}

  private fullCategory(childCategory?: string): string {
    return childCategory
      ? `${this.subCategory}.${childCategory}`
      : this.subCategory
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.parent.debug(this.fullCategory(), message, meta)
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.parent.info(this.fullCategory(), message, meta)
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.parent.warn(this.fullCategory(), message, meta)
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.parent.error(this.fullCategory(), message, meta)
  }
  fatal(message: string, meta?: Record<string, unknown>): void {
    this.parent.fatal(this.fullCategory(), message, meta)
  }
}

// ============================================================================
// 全局单例
// ============================================================================

/** 全局 renderer logger 单例 */
export const logger = new RendererLogger()
