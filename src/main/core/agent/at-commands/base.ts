/**
 * @命令基类与注册器
 *
 * 职责：
 * - 定义 AtCommandContext（IPC 派发上下文，含时间戳 + 来源 + 可选 userId）
 * - 定义 AtCommandHandler 接口（每类 @命令实现的统一契约）
 * - 提供 AtCommandRegistry（注册器，支持 register / resolve / list 三个操作）
 *
 * 设计原则：
 * - 单一职责：注册器只管分发，不做参数校验（由各 handler 自行校验）
 * - 开闭原则：新增 @命令类型只需 register 新 handler，无需修改本文件
 * - 类型安全：handler.type 与 handler 的 resolve 实现绑定，编译期可校验
 *
 * 方案书依据：v0.9 §4.3（@命令接口契约）
 */

import type {
  AtCommand,
  AtCommandType,
} from '@shared/at-command-types'

/**
 * @命令解析上下文（IPC 派发时附带）
 *
 * 由 IPC handler 构造，传递给 AtCommandHandler.resolve()，
 * 让 handler 在生成 injectedText / displayText 时能感知来源与时间。
 */
export interface AtCommandContext {
  /** 注入时间戳（ms，由 IPC handler 在派发时填充 Date.now()） */
  timestamp: number
  /** 来源标识（IDE / 终端 / 监控 / 历史 / chat-input / drag-drop） */
  source: import('@shared/at-command-types').AtCommandSource
  /** 用户 ID（可选，预留多用户场景使用） */
  userId?: string
}

/**
 * @命令处理器接口（统一契约）
 *
 * 每类 @命令（log/cmd/file/metric/decision/kb/skill/server）实现此接口。
 *
 * 实现要点：
 * - `type` 字段为字面量类型（如 `'log'`），用于注册器校验唯一性
 * - `resolve(args, ctx)` 必须返回 AtCommand 对象（已格式化 injectedText）
 * - 参数 args 为 `Record<string, unknown>`，由各 handler 自行校验与转换（避免联合类型 variance 问题）
 */
export interface AtCommandHandler {
  /** 命令类型（8 类之一，字面量） */
  readonly type: AtCommandType
  /** 中文展示标签（如 '日志'） */
  readonly label: string
  /** Ant Design 图标名（如 'FileTextOutlined'） */
  readonly icon: string
  /** 命令描述（用于选择器提示） */
  readonly description: string
  /**
   * 解析并构造 @命令对象
   *
   * @param args 用户输入的参数（键值对，由 handler 自行校验）
   * @param ctx IPC 派发上下文（时间戳 / 来源 / userId）
   * @returns 完整的 AtCommand 对象（含 displayText 与 injectedText）
   */
  resolve(
    args: Record<string, unknown>,
    ctx: AtCommandContext
  ): Promise<AtCommand>
}

/**
 * @命令注册器
 *
 * 单一实例（由 createDefaultRegistry() 构造），管理 8 类 @命令 handler。
 *
 * 使用方式：
 * ```ts
 * const registry = createDefaultRegistry()
 * const cmd = await registry.resolve('log', { rawText: '...' }, ctx)
 * const list = registry.list()  // 用于 UI 选择器
 * ```
 *
 * 设计：
 * - 注册时校验类型唯一性（重复注册抛错）
 * - resolve 时按 type 路由到对应 handler
 * - list 返回所有 handler 元数据（用于 UI 选择器渲染）
 */
export class AtCommandRegistry {
  /** handler 表（type → handler） */
  private readonly handlers = new Map<AtCommandType, AtCommandHandler>()

  /**
   * 注册 @命令 handler
   *
   * @param handler 实现 AtCommandHandler 接口的实例
   * @throws {Error} 当 type 已被注册时抛出（避免运行时覆盖）
   */
  register(handler: AtCommandHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(
        `@命令处理器已注册：type='${handler.type}'，禁止重复注册（避免运行时覆盖）`
      )
    }
    this.handlers.set(handler.type, handler)
  }

  /**
   * 解析并构造 @命令对象
   *
   * @param type 命令类型（8 类之一）
   * @param args 用户输入的参数（键值对）
   * @param ctx IPC 派发上下文
   * @returns 完整的 AtCommand 对象
   * @throws {Error} 当 type 未注册时抛出
   */
  async resolve(
    type: AtCommandType,
    args: Record<string, unknown>,
    ctx: AtCommandContext
  ): Promise<AtCommand> {
    const handler = this.handlers.get(type)
    if (!handler) {
      throw new Error(
        `未知的 @命令类型：'${type}'（未注册对应 handler，请检查 createDefaultRegistry 调用）`
      )
    }
    return handler.resolve(args, ctx)
  }

  /**
   * 列出所有已注册的 @命令 handler
   *
   * 用于 UI 选择器渲染（@命令选择菜单 / 帮助提示等）。
   *
   * @returns handler 列表（顺序按注册顺序，即 createDefaultRegistry 中的注册顺序）
   */
  list(): AtCommandHandler[] {
    return Array.from(this.handlers.values())
  }

  /**
   * 检查指定类型是否已注册
   *
   * @param type 命令类型
   * @returns 已注册返回 true
   */
  has(type: AtCommandType): boolean {
    return this.handlers.has(type)
  }

  /**
   * 获取指定类型的 handler（用于按类型直接调用，避免重复路由）
   *
   * @param type 命令类型
   * @returns handler 或 undefined
   */
  get(type: AtCommandType): AtCommandHandler | undefined {
    return this.handlers.get(type)
  }
}
