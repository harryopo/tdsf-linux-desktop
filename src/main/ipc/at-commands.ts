/**
 * @命令 IPC Handlers（v0.9 新增）
 *
 * 注册 @命令（8 类：log/cmd/file/metric/decision/kb/skill/server）相关的 IPC 通道，
 * 桥接渲染进程与 @命令解析器（AtCommandParser）。
 *
 * 通道清单（与 preload/index.ts 中的 atCommands 命名空间对应）：
 * - at:list    — 列出所有可用 @命令（返回 AtCommandInfo[]）
 * - at:resolve — 解析单个 @命令（返回 AtCommand 对象）
 * - at:parse   — 解析文本中所有 @命令（返回 AtCommandParseResult）
 *
 * 设计风格与现有 agent-runtime.ts / credibility.ts / sandbox.ts 一致：
 * - 错误对象统一抛出（由 IPC 框架序列化到渲染进程）
 * - 成功对象直接返回业务数据
 * - 所有调用通过 logger 记录（便于审计）
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令完整实现）+ §11.2（IPC 命名规范）
 */

import { ipcMain } from 'electron'
import { AT_COMMANDS } from '@shared/ipc-channels'
import type {
  AtCommand,
  AtCommandParseResult,
  AtCommandSource,
  AtCommandType,
} from '@shared/at-command-types'
import {
  createDefaultRegistry,
  AtCommandParser,
  type AtCommandContext,
  type AtCommandHandler,
} from '../core/agent/at-commands'
import { logger } from '../services/log/logger'

// ============================================================================
// 类型别名
// ============================================================================

/** @命令元信息（at:list 通道返回的单项） */
interface AtCommandInfo {
  type: AtCommandType
  label: string
  icon: string
  description: string
}

// ============================================================================
// 模块级单例（注册器 + 解析器，避免每次 IPC 调用重建）
// ============================================================================

let cachedRegistry: ReturnType<typeof createDefaultRegistry> | null = null
let cachedParser: AtCommandParser | null = null

/**
 * 获取（惰性初始化）@命令注册器单例
 *
 * 注册器持有 8 类 handler 的实例，单例化避免每次 IPC 调用都重建。
 */
function getRegistry(): ReturnType<typeof createDefaultRegistry> {
  if (!cachedRegistry) {
    cachedRegistry = createDefaultRegistry()
    logger.info('IPC.AT_COMMANDS', '已创建 @命令注册器（8 类 handler 已注册）')
  }
  return cachedRegistry
}

/**
 * 获取（惰性初始化）@命令解析器单例
 *
 * 解析器依赖注册器，因此也在惰性初始化时构造。
 */
function getParser(): AtCommandParser {
  if (!cachedParser) {
    cachedParser = new AtCommandParser(getRegistry())
  }
  return cachedParser
}

/**
 * 构造 IPC 派发上下文
 *
 * @param source 来源标识（由调用方传入，标识 @命令来自哪个 UI 入口）
 * @param userId 用户 ID（可选，预留多用户场景）
 */
function buildContext(
  source: AtCommandSource,
  userId?: string
): AtCommandContext {
  return {
    timestamp: Date.now(),
    source,
    userId,
  }
}

/**
 * 统一错误转字符串
 */
function toErrorString(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册 @命令 IPC handlers
 *
 * 由 registerAllIpcHandlers 调用，在 app.whenReady 后注册一次。
 */
export function registerAtCommandHandlers(): void {
  // ------------------------------------------------------------------
  // at:list — 列出所有可用 @命令
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：AtCommandInfo[]（含 type / label / icon / description）
  ipcMain.handle(AT_COMMANDS.LIST, async (): Promise<AtCommandInfo[]> => {
    logger.debug('IPC.AT_COMMANDS', 'at:list 调用')
    try {
      const registry = getRegistry()
      const handlers: AtCommandHandler[] = registry.list()
      return handlers.map((h) => ({
        type: h.type,
        label: h.label,
        icon: h.icon,
        description: h.description,
      }))
    } catch (err) {
      logger.error('IPC.AT_COMMANDS', `at:list 失败: ${toErrorString(err)}`)
      throw new Error(`列出 @命令失败: ${toErrorString(err)}`)
    }
  })

  // ------------------------------------------------------------------
  // at:resolve — 解析单个 @命令
  // ------------------------------------------------------------------
  // 参数：(type: AtCommandType, args: Record<string, unknown>, source: AtCommandSource, userId?: string)
  // 返回：AtCommand 对象
  ipcMain.handle(
    'at:resolve',
    async (
      _event,
      type: AtCommandType,
      args: Record<string, unknown>,
      source: AtCommandSource = 'chat-input',
      userId?: string
    ): Promise<AtCommand> => {
      logger.info('IPC.AT_COMMANDS', 'at:resolve 调用', {
        type,
        source,
        argKeys: Object.keys(args ?? {}),
      })
      try {
        if (!type) {
          throw new Error('参数缺失：type（命令类型）为必填')
        }
        if (!args || typeof args !== 'object') {
          throw new Error('参数错误：args 必须为对象')
        }
        const registry = getRegistry()
        const ctx = buildContext(source, userId)
        return await registry.resolve(type, args, ctx)
      } catch (err) {
        logger.error('IPC.AT_COMMANDS', `at:resolve 失败: ${toErrorString(err)}`, {
          type,
        })
        throw new Error(`解析 @命令失败（type='${type}'）: ${toErrorString(err)}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // at:parse — 解析文本中所有 @命令
  // ------------------------------------------------------------------
  // 参数：(text: string, source: AtCommandSource, userId?: string)
  // 返回：AtCommandParseResult（含 text 与 commands 数组）
  ipcMain.handle(
    'at:parse',
    async (
      _event,
      text: string,
      source: AtCommandSource = 'chat-input',
      userId?: string
    ): Promise<AtCommandParseResult> => {
      logger.info('IPC.AT_COMMANDS', 'at:parse 调用', {
        textLength: text?.length ?? 0,
        source,
      })
      try {
        if (typeof text !== 'string') {
          throw new Error('参数错误：text 必须为字符串')
        }
        const parser = getParser()
        const ctx = buildContext(source, userId)
        const result = await parser.parse(text, ctx)
        logger.info('IPC.AT_COMMANDS', 'at:parse 完成', {
          commandCount: result.commands.length,
          cleanedLength: result.text.length,
        })
        return result
      } catch (err) {
        logger.error('IPC.AT_COMMANDS', `at:parse 失败: ${toErrorString(err)}`)
        throw new Error(`解析文本 @命令失败: ${toErrorString(err)}`)
      }
    }
  )

  logger.info('IPC.AT_COMMANDS', '@命令 IPC handlers 已注册', {
    channels: ['at:list', 'at:resolve', 'at:parse'],
  })
}
