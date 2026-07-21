/**
 * 后端日志系统 - 主进程结构化日志器
 *
 * 设计目标：
 * 1. **结构化**：每条日志为 JSON 对象（带 ts/level/category/message/meta/correlationId）
 * 2. **可测试**：测试可读取内存 buffer，验证关键事件是否触发
 * 3. **可调试**：同时输出到 console + 文件 + 内存 buffer
 * 4. **按天切分**：每天一个日志文件（logs/app-YYYY-MM-DD.log）
 * 5. **自动轮转**：单文件 > 5MB 时切分（.1.log / .2.log）
 *
 * 使用示例：
 * ```ts
 * import { logger } from './logger'
 *
 * logger.info('IPC', '教程列表已加载', { count: 10 })
 * logger.warn('CRAWLER', 'Arch Wiki 抓取超时', { sourceId: 'arch-wiki' })
 * logger.error('DB', 'SQLite 写入失败', { error: err.message })
 *
 * // 子 logger（自动添加 category 前缀）
 * const ipcLog = logger.child('IPC')
 * ipcLog.info('连接已建立', { sessionId: 'xxx' })
 * ```
 *
 * 测试读取示例：
 * ```ts
 * const entries = logger.getEntries({ level: 'ERROR', category: 'DB' })
 * expect(entries.length).toBeGreaterThan(0)
 * ```
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

// ============================================================================
// 类型定义
// ============================================================================

/** 日志级别（从低到高） */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

/** 日志分类（业务域） */
export type LogCategory =
  | 'APP'      // 应用生命周期
  | 'IPC'      // IPC 调用
  | 'DB'       // 数据库
  | 'SSH'      // SSH 连接
  | 'LLM'      // LLM 调用
  | 'CRAWLER'  // 教程爬虫
  | 'UI'       // 渲染进程
  | 'NET'      // 网络
  | 'AUTH'     // 认证/凭据
  | 'TUTORIAL' // 教程
  | 'ERROR'    // 错误聚合
  | string     // 允许自定义

/** 单条日志条目（结构化） */
export interface LogEntry {
  /** ISO 8601 时间戳，如 2026-07-16T22:30:00.123Z */
  ts: string
  /** 日志级别 */
  level: LogLevel
  /** 业务分类 */
  category: LogCategory
  /** 日志消息（人类可读） */
  message: string
  /** 附加结构化数据 */
  meta?: Record<string, unknown>
  /** 关联 ID（用于跨调用追踪） */
  correlationId?: string
  /** 进程标识（main/renderer） */
  source: 'main' | 'renderer'
  /** 日志所属日期（YYYY-MM-DD，用于按天切分） */
  date: string
}

/** 日志过滤条件 */
export interface LogFilter {
  /** 最低级别（包含） */
  level?: LogLevel
  /** 分类精确匹配 */
  category?: LogCategory
  /** 分类前缀匹配（如 'IPC' 匹配 'IPC.ssh'） */
  categoryPrefix?: string
  /** 关键字匹配（message 子串） */
  keyword?: string
  /** 时间起点（ISO 8601） */
  since?: string
  /** 最多返回条数 */
  limit?: number
}

// ============================================================================
// 常量
// ============================================================================

/** 级别优先级映射（数字越大越严重） */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
}

/** 单个日志文件最大字节数（5MB） */
const MAX_FILE_SIZE = 5 * 1024 * 1024

/** 内存 buffer 最大条数（超出后丢弃最早的 DEBUG/INFO） */
const MAX_BUFFER_SIZE = 1000

/** 日志保留天数 */
const LOG_RETENTION_DAYS = 7

// ============================================================================
// Logger 类
// ============================================================================

/**
 * 日志器（单例）
 *
 * 集成点：
 * - main/index.ts: app.whenReady() 后调用 init()
 * - ipc/*.ts: 各 IPC handler 中调用 logger.logXxx()
 * - tests/e2e: 通过 IPC 通道 log:read 读取
 */
export class Logger {
  private logDir = ''
  private currentDate = ''
  private currentFilePath = ''
  private currentFileSize = 0
  private writeQueue: Promise<void> = Promise.resolve()
  private memoryBuffer: LogEntry[] = []
  private minLevel: LogLevel = 'INFO'
  private initialized = false

  /**
   * 初始化日志器
   *
   * @param logDir 日志目录（通常为 userData/logs）
   * @param options.minLevel 最低日志级别（默认 INFO）
   */
  init(logDir: string, options?: { minLevel?: LogLevel }): void {
    if (this.initialized) {
      console.warn('[Logger] 已经初始化过，跳过重复初始化')
      return
    }
    this.logDir = logDir
    this.minLevel = options?.minLevel ?? 'INFO'
    // 创建目录
    fs.mkdirSync(this.logDir, { recursive: true })
    // 打开当天文件
    this.rollFile()
    // 清理过期日志
    this.cleanupOldLogs()
    this.initialized = true
    this.info('APP', 'Logger 初始化完成', {
      logDir: this.logDir,
      minLevel: this.minLevel,
    })
  }

  /**
   * 设置最低日志级别（运行时可调整）
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level
  }

  /**
   * 记录 DEBUG 级别日志
   */
  debug(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log('DEBUG', category, message, meta)
  }

  /**
   * 记录 INFO 级别日志
   */
  info(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log('INFO', category, message, meta)
  }

  /**
   * 记录 WARN 级别日志
   */
  warn(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log('WARN', category, message, meta)
  }

  /**
   * 记录 ERROR 级别日志
   */
  error(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log('ERROR', category, message, meta)
  }

  /**
   * 记录 FATAL 级别日志（通常用于不可恢复错误）
   */
  fatal(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log('FATAL', category, message, meta)
  }

  /**
   * 通用日志记录接口
   */
  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    metaOrEntry?: Record<string, unknown> | { meta?: Record<string, unknown>; correlationId?: string; source?: 'main' | 'renderer' }
  ): void {
    if (!this.shouldLog(level)) return
    // 兼容两种调用方式：
    // 1. log(level, cat, msg, meta)
    // 2. log(level, cat, msg, { meta, correlationId, source })
    const isObjectArg = metaOrEntry && typeof metaOrEntry === 'object' && (
      'meta' in metaOrEntry || 'correlationId' in metaOrEntry || 'source' in metaOrEntry
    )
    const meta = isObjectArg ? (metaOrEntry as { meta?: Record<string, unknown> }).meta : (metaOrEntry as Record<string, unknown> | undefined)
    const correlationId = isObjectArg ? (metaOrEntry as { correlationId?: string }).correlationId : undefined
    const source = isObjectArg ? (metaOrEntry as { source?: 'main' | 'renderer' }).source : 'main'
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      category,
      message,
      meta,
      correlationId,
      source: source ?? 'main',
      date: this.todayLocal(),
    }
    this.appendToBuffer(entry)
    this.writeToFile(entry)
    this.writeToConsole(entry)
  }

  /**
   * 创建子 logger（自动注入 category 前缀）
   *
   * @param subCategory 子分类
   * @returns 绑定 category 的子 logger
   */
  child(subCategory: string): ChildLogger {
    return new ChildLogger(this, subCategory)
  }

  /**
   * 记录 IPC 调用（高频路径，直接用专用方法避免重复代码）
   */
  logIpc(
    channel: string,
    direction: 'invoke' | 'event',
    meta?: Record<string, unknown>
  ): void {
    this.debug(
      'IPC',
      `${direction === 'invoke' ? '→' : '←'} ${channel}`,
      meta
    )
  }

  /**
   * 获取内存 buffer 中的日志条目（测试与 IPC 通道共享）
   */
  getEntries(filter?: LogFilter): LogEntry[] {
    let entries = [...this.memoryBuffer]
    if (!filter) return entries

    if (filter.level) {
      const minPriority = LEVEL_PRIORITY[filter.level]
      entries = entries.filter((e) => LEVEL_PRIORITY[e.level] >= minPriority)
    }
    if (filter.category) {
      entries = entries.filter((e) => e.category === filter.category)
    }
    if (filter.categoryPrefix) {
      entries = entries.filter((e) => e.category.startsWith(filter.categoryPrefix!))
    }
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      entries = entries.filter((e) => e.message.toLowerCase().includes(kw))
    }
    if (filter.since) {
      entries = entries.filter((e) => e.ts >= filter.since!)
    }
    if (filter.limit && filter.limit > 0) {
      entries = entries.slice(-filter.limit)
    }
    return entries
  }

  /**
   * 获取日志统计信息
   */
  getStats(): {
    total: number
    byLevel: Record<LogLevel, number>
    byCategory: Record<string, number>
    oldestTs: string | null
    newestTs: string | null
  } {
    const byLevel: Record<LogLevel, number> = {
      DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, FATAL: 0,
    }
    const byCategory: Record<string, number> = {}
    for (const e of this.memoryBuffer) {
      byLevel[e.level]++
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1
    }
    return {
      total: this.memoryBuffer.length,
      byLevel,
      byCategory,
      oldestTs: this.memoryBuffer[0]?.ts ?? null,
      newestTs: this.memoryBuffer[this.memoryBuffer.length - 1]?.ts ?? null,
    }
  }

  /**
   * 清空内存 buffer（不影响磁盘文件）
   */
  clearBuffer(): void {
    this.memoryBuffer = []
  }

  /**
   * 异步刷新所有待写入的日志
   */
  async flush(): Promise<void> {
    await this.writeQueue
  }

  // ----------------------------------------------------------------
  // 私有方法
  // ----------------------------------------------------------------

  /** 判断是否应记录 */
  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel]
  }

  /** 添加到内存 buffer（FIFO，超限丢早期 DEBUG/INFO） */
  private appendToBuffer(entry: LogEntry): void {
    this.memoryBuffer.push(entry)
    if (this.memoryBuffer.length > MAX_BUFFER_SIZE) {
      // 从头开始丢弃 DEBUG/INFO，保留 WARN/ERROR/FATAL
      const overflow = this.memoryBuffer.length - MAX_BUFFER_SIZE
      let dropped = 0
      while (dropped < overflow && this.memoryBuffer.length > 0) {
        const head = this.memoryBuffer[0]
        if (head.level === 'DEBUG' || head.level === 'INFO') {
          this.memoryBuffer.shift()
          dropped++
        } else {
          // 不能丢严重日志，整体截断
          this.memoryBuffer = this.memoryBuffer.slice(-MAX_BUFFER_SIZE)
          break
        }
      }
    }
  }

  /** 写入文件（带滚动） */
  private writeToFile(entry: LogEntry): void {
    if (!this.initialized) return
    // 检查是否跨天
    if (entry.date !== this.currentDate) {
      this.rollFile()
    }
    // 检查单文件大小
    const line = JSON.stringify(entry) + '\n'
    const lineSize = Buffer.byteLength(line, 'utf8')
    if (this.currentFileSize + lineSize > MAX_FILE_SIZE) {
      this.rotateFile()
    }
    // 串行写入（避免并发竞态）
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.promises.appendFile(this.currentFilePath, line, 'utf8')
        this.currentFileSize += lineSize
      } catch (err) {
        // 文件写入失败不应阻塞主流程
        console.error('[Logger] 写入日志文件失败:', err)
      }
    })
  }

  /** 输出到 console（带 ANSI 颜色，仅 DEBUG/INFO/WARN/ERROR） */
  private writeToConsole(entry: LogEntry): void {
    const color = this.getConsoleColor(entry.level)
    const reset = '\x1b[0m'
    const dim = '\x1b[2m'
    const line = `${dim}[${entry.ts}]${reset} ${color}${entry.level}${reset} ${dim}[${entry.category}]${reset} ${entry.message}`
    if (entry.meta) {
      const metaStr = JSON.stringify(entry.meta)
      console.log(`${line} ${dim}${metaStr}${reset}`)
    } else {
      console.log(line)
    }
  }

  /** console ANSI 颜色 */
  private getConsoleColor(level: LogLevel): string {
    switch (level) {
      case 'DEBUG': return '\x1b[90m' // 灰
      case 'INFO':  return '\x1b[36m' // 青
      case 'WARN':  return '\x1b[33m' // 黄
      case 'ERROR': return '\x1b[31m' // 红
      case 'FATAL': return '\x1b[35m' // 紫
    }
  }

  /** 按天滚动（关闭旧文件，打开新文件） */
  private rollFile(): void {
    this.currentDate = this.todayLocal()
    this.currentFilePath = path.join(this.logDir, `app-${this.currentDate}.log`)
    try {
      const stat = fs.statSync(this.currentFilePath)
      this.currentFileSize = stat.size
    } catch {
      this.currentFileSize = 0
    }
  }

  /** 单文件过大时滚动（重命名为 .1.log） */
  private rotateFile(): void {
    const rotated = this.currentFilePath.replace(/\.log$/, '.1.log')
    try {
      fs.renameSync(this.currentFilePath, rotated)
    } catch {
      // 重命名失败时继续写入（会覆盖）
    }
    this.currentFileSize = 0
  }

  /** 清理过期日志（> LOG_RETENTION_DAYS 天的文件） */
  private cleanupOldLogs(): void {
    if (!this.logDir) return
    try {
      const now = Date.now()
      const files = fs.readdirSync(this.logDir)
      for (const file of files) {
        if (!file.startsWith('app-') || !file.endsWith('.log')) continue
        const filePath = path.join(this.logDir, file)
        const stat = fs.statSync(filePath)
        const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24)
        if (ageDays > LOG_RETENTION_DAYS) {
          fs.unlinkSync(filePath)
        }
      }
    } catch {
      // 清理失败不影响启动
    }
  }

  /** 本地日期 YYYY-MM-DD（避免时区导致跨天错位） */
  private todayLocal(): string {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
}

// ============================================================================
// 子 Logger（绑定 category 前缀）
// ============================================================================

/**
 * 子 logger，自动在 category 上叠加前缀
 */
class ChildLogger {
  constructor(
    private readonly parent: Logger,
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

/** 全局 logger 单例（直接使用） */
export const logger = new Logger()

/**
 * 便捷初始化（用于 app.whenReady 时调用）
 *
 * @param userDataDir Electron userData 目录
 */
export function initLogger(userDataDir: string): void {
  const logDir = path.join(userDataDir, 'logs')
  // 开发模式下用 DEBUG，生产环境用 INFO
  const isDev = process.env.NODE_ENV === 'development'
  logger.init(logDir, { minLevel: isDev ? 'DEBUG' : 'INFO' })
}
