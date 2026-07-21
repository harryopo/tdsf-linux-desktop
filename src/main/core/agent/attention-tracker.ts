/**
 * 注意力跟踪器（v0.9.4 批次 4 - 任务 4）
 *
 * 借鉴 Kilo Code 的 attention 字段机制：
 *   d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §6.1
 *
 * 维护当前会话的 AttentionFocus，跨 Subagent 共享：
 * - Subagent 执行时调用 trackFiles/trackCommands/trackErrors 更新
 * - UI 通过 IPC 查询当前 attention，高亮显示关注的文件 / 命令
 * - 新会话开始时调用 reset() 清空
 *
 * 设计要点：
 * - 单例模式（getInstance），全局唯一，跨 Subagent 共享
 * - current 字段始终非 null（reset 后变为空 AttentionFocus）
 * - history 数组记录历史 attention 快照（最多 100 条，超出 FIFO 丢弃）
 * - 所有方法都是同步的（无 IO 操作），可在任意上下文调用
 *
 * 方案书依据：v0.9.4 §11 第 7 类（其他 3 项 - 任务 4）
 */
import type { AttentionFocus } from '@shared/agent-types'
import { logger } from '../../services/log/logger'

/**
 * 历史记录最大条数（超出后 FIFO 丢弃最早的）
 */
const MAX_HISTORY_SIZE = 100

/**
 * 注意力跟踪器（单例）
 *
 * 维护当前会话的 AttentionFocus，跨 Subagent 共享。
 *
 * 使用场景：
 * ```ts
 * const tracker = AttentionTracker.getInstance()
 *
 * // Subagent 执行时跟踪
 * tracker.trackFiles(['/etc/nginx/nginx.conf'])
 * tracker.trackCommands(['systemctl status nginx'])
 * tracker.trackErrors(['nginx: config test failed'])
 *
 * // UI 查询当前关注
 * const current = tracker.getCurrent()
 * if (current?.files?.length) {
 *   // 高亮显示关注的文件
 * }
 *
 * // 新会话开始时重置
 * tracker.reset()
 * ```
 */
export class AttentionTracker {
  /** 单例实例 */
  private static instance: AttentionTracker

  /** 当前 attention（始终非 null） */
  private current: AttentionFocus

  /** 历史 attention 快照（reset 时存档，最多 100 条） */
  private history: AttentionFocus[]

  /** 子日志器 */
  private readonly log = logger.child('AGENT.ATTENTION')

  /**
   * 私有构造函数（单例模式）
   */
  private constructor() {
    this.current = { since: Date.now() }
    this.history = []
  }

  /**
   * 获取单例实例
   *
   * @returns AttentionTracker 全局唯一实例
   */
  static getInstance(): AttentionTracker {
    if (!AttentionTracker.instance) {
      AttentionTracker.instance = new AttentionTracker()
    }
    return AttentionTracker.instance
  }

  /**
   * 跟踪关注的文件
   *
   * 将文件添加到 current.files，去重后保留。
   *
   * @param files 文件路径列表
   */
  trackFiles(files: string[]): void {
    if (!files || files.length === 0) return
    const existing = this.current.files ?? []
    const merged = [...new Set([...existing, ...files])]
    this.current.files = merged
    this.log.debug('跟踪文件', { added: files.length, total: merged.length })
  }

  /**
   * 跟踪关注的命令
   *
   * @param commands 命令列表
   */
  trackCommands(commands: string[]): void {
    if (!commands || commands.length === 0) return
    const existing = this.current.commands ?? []
    const merged = [...new Set([...existing, ...commands])]
    this.current.commands = merged
    this.log.debug('跟踪命令', { added: commands.length, total: merged.length })
  }

  /**
   * 跟踪关注的错误
   *
   * @param errors 错误信息列表
   */
  trackErrors(errors: string[]): void {
    if (!errors || errors.length === 0) return
    const existing = this.current.errors ?? []
    const merged = [...new Set([...existing, ...errors])]
    this.current.errors = merged
    this.log.debug('跟踪错误', { added: errors.length, total: merged.length })
  }

  /**
   * 跟踪关注的搜索关键词
   *
   * @param keywords 关键词列表
   */
  trackKeywords(keywords: string[]): void {
    if (!keywords || keywords.length === 0) return
    const existing = this.current.keywords ?? []
    const merged = [...new Set([...existing, ...keywords])]
    this.current.keywords = merged
    this.log.debug('跟踪关键词', { added: keywords.length, total: merged.length })
  }

  /**
   * 获取当前 attention
   *
   * 返回当前会话的 AttentionFocus 快照（深拷贝，避免外部修改污染内部状态）。
   *
   * @returns 当前 attention（始终非 null）
   */
  getCurrent(): AttentionFocus {
    return {
      files: this.current.files ? [...this.current.files] : undefined,
      commands: this.current.commands ? [...this.current.commands] : undefined,
      errors: this.current.errors ? [...this.current.errors] : undefined,
      keywords: this.current.keywords ? [...this.current.keywords] : undefined,
      since: this.current.since,
    }
  }

  /**
   * 获取历史 attention 列表
   *
   * 返回所有已归档的 attention 快照（深拷贝）。
   *
   * @returns 历史 attention 列表（按时间顺序，最早在前）
   */
  getHistory(): AttentionFocus[] {
    return this.history.map((a) => ({
      files: a.files ? [...a.files] : undefined,
      commands: a.commands ? [...a.commands] : undefined,
      errors: a.errors ? [...a.errors] : undefined,
      keywords: a.keywords ? [...a.keywords] : undefined,
      since: a.since,
    }))
  }

  /**
   * 重置当前 attention（归档到 history）
   *
   * 新会话开始时调用：
   * 1. 将当前 attention 归档到 history（如果非空）
   * 2. 创建新的空 attention（since = Date.now()）
   * 3. history 超出 MAX_HISTORY_SIZE 时 FIFO 丢弃
   */
  reset(): void {
    // 仅当归档的 attention 非空时才存入 history
    const hasData =
      (this.current.files && this.current.files.length > 0) ||
      (this.current.commands && this.current.commands.length > 0) ||
      (this.current.errors && this.current.errors.length > 0) ||
      (this.current.keywords && this.current.keywords.length > 0)

    if (hasData) {
      this.history.push({ ...this.current })
      // FIFO 丢弃最早的
      if (this.history.length > MAX_HISTORY_SIZE) {
        this.history.splice(0, this.history.length - MAX_HISTORY_SIZE)
      }
    }

    this.current = { since: Date.now() }
    this.log.info('attention 已重置', {
      archived: hasData,
      historySize: this.history.length,
    })
  }

  /**
   * 清空所有状态（包括 history）
   *
   * 与 reset() 的区别：
   * - reset()：归档当前到 history，开始新 attention
   * - clear()：清空所有数据（current + history），用于测试或完全重置
   */
  clear(): void {
    this.current = { since: Date.now() }
    this.history = []
    this.log.info('attention 已完全清空')
  }

  /**
   * 设置完整的 attention（覆盖当前）
   *
   * 用于从持久化存储恢复 attention 状态，或外部系统注入 attention。
   *
   * @param attention 完整的 attention 对象
   */
  setAttention(attention: AttentionFocus): void {
    this.current = {
      files: attention.files ? [...attention.files] : undefined,
      commands: attention.commands ? [...attention.commands] : undefined,
      errors: attention.errors ? [...attention.errors] : undefined,
      keywords: attention.keywords ? [...attention.keywords] : undefined,
      since: attention.since,
    }
    this.log.debug('attention 已设置', {
      filesCount: this.current.files?.length ?? 0,
      commandsCount: this.current.commands?.length ?? 0,
      errorsCount: this.current.errors?.length ?? 0,
      keywordsCount: this.current.keywords?.length ?? 0,
    })
  }

  /**
   * 检查当前 attention 是否为空
   *
   * @returns true 表示当前 attention 无任何跟踪字段
   */
  isEmpty(): boolean {
    return (
      (!this.current.files || this.current.files.length === 0) &&
      (!this.current.commands || this.current.commands.length === 0) &&
      (!this.current.errors || this.current.errors.length === 0) &&
      (!this.current.keywords || this.current.keywords.length === 0)
    )
  }

  /**
   * 重置单例实例（仅用于测试）
   *
   * 单例模式会跨测试用例共享状态，需要在 beforeEach 中调用此方法重置。
   * 设为 public static 以便测试代码访问（生产代码不应调用）。
   */
  static resetInstance(): void {
    AttentionTracker.instance = new AttentionTracker()
  }
}

/**
 * 重置单例（仅用于测试）
 *
 * 单例模式会跨测试用例共享状态，需要在 beforeEach 中调用此函数重置。
 * 内部委托给 AttentionTracker.resetInstance 静态方法（保持私有访问合法）。
 */
export function resetAttentionTrackerInstance(): void {
  AttentionTracker.resetInstance()
}
