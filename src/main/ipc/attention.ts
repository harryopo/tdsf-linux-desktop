/**
 * Attention IPC Handlers（v0.9.5 P0 - 组 3 新增）
 *
 * 注册 v0.9.5 引入的注意力跟踪相关 IPC 通道。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - attention:current        — 返回当前 AttentionFocus
 * - attention:history        — 返回历史 AttentionFocus 列表
 * - attention:track-files    — 跟踪关注的文件
 * - attention:track-commands — 跟踪关注的命令
 * - attention:track-errors   — 跟踪关注的错误
 * - attention:track-keywords — 跟踪关注的搜索关键词
 * - attention:reset          — 重置当前 attention（归档到 history）
 *
 * 与现有 attention-tracker.ts 的关系：
 * - attention-tracker.ts 提供 AttentionTracker 单例类（getCurrent/getHistory/trackFiles/...）
 * - 本文件仅做 IPC 包装：调用 AttentionTracker 方法，返回 IPC 友好的响应
 * - 不修改 attention-tracker.ts 的现有函数签名
 *
 * 设计要点：
 * - AttentionTracker 是单例，全局唯一，跨 Subagent 共享
 * - track-* 通道接收 string[] 参数，调用对应 track 方法
 * - reset 通道将当前 attention 归档到 history
 * - AttentionFocus 接口已定义在 @shared/agent-types.ts（v0.9.4 批次 4）
 *
 * 方案书依据：v0.9.5 §UI接入接线图（5 组 P0 级缺失 IPC - 组 3：注意力跟踪）
 */

import { ipcMain } from 'electron'
import { AttentionTracker } from '../core/agent/attention-tracker'
import type { AttentionFocus } from '@shared/agent-types'
import { logger } from '../services/log/logger'

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取 AttentionTracker 单例
 *
 * AttentionTracker 使用单例模式，全局唯一，跨 Subagent 共享。
 *
 * @returns AttentionTracker 实例
 */
function getTracker(): AttentionTracker {
  return AttentionTracker.getInstance()
}

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册 Attention IPC handlers
 *
 * 注册以下通道（7 个）：
 * - attention:current        — 获取当前 attention
 * - attention:history        — 获取历史 attention 列表
 * - attention:track-files    — 跟踪关注的文件
 * - attention:track-commands — 跟踪关注的命令
 * - attention:track-errors   — 跟踪关注的错误
 * - attention:track-keywords — 跟踪关注的搜索关键词
 * - attention:reset          — 重置当前 attention（归档到 history）
 *
 * IPC 4 步同步：
 * 1. main 层 handler：本文件
 * 2. ipc/index.ts：导入并调用 registerAttentionHandlers()
 * 3. preload/index.ts：暴露 7 个方法
 * 4. electron.d.ts：声明 7 个类型
 */
export function registerAttentionHandlers(): void {
  // ------------------------------------------------------------------
  // attention:current — 获取当前 attention
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：AttentionFocus（始终非 null，since 字段必有）
  // 用途：UI 高亮显示当前关注的文件 / 命令 / 错误 / 关键词
  ipcMain.handle(
    'attention:current',
    async (): Promise<AttentionFocus> => {
      try {
        const current = getTracker().getCurrent()
        logger.debug('IPC.ATTENTION', `attention:current`, {
          filesCount: current.files?.length ?? 0,
          commandsCount: current.commands?.length ?? 0,
          errorsCount: current.errors?.length ?? 0,
          keywordsCount: current.keywords?.length ?? 0,
        })
        return current
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取当前 attention 失败'
        logger.error('IPC.ATTENTION', `attention:current 失败: ${msg}`)
        throw new Error(`获取当前 attention 失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // attention:history — 获取历史 attention 列表
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：AttentionFocus[]（按时间顺序，最早在前）
  // 用途：UI 展示历史 attention 快照（如时间轴 / 历史列表）
  ipcMain.handle(
    'attention:history',
    async (): Promise<AttentionFocus[]> => {
      try {
        const history = getTracker().getHistory()
        logger.debug('IPC.ATTENTION', `attention:history`, {
          count: history.length,
        })
        return history
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取 attention 历史失败'
        logger.error('IPC.ATTENTION', `attention:history 失败: ${msg}`)
        throw new Error(`获取 attention 历史失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // attention:track-files — 跟踪关注的文件
  // ------------------------------------------------------------------
  // 参数：(files: string[]) — 文件路径列表
  // 返回：boolean（true 表示跟踪成功）
  // 用途：Subagent 执行时调用，标记当前关注的文件
  ipcMain.handle(
    'attention:track-files',
    async (_event, files: string[]): Promise<boolean> => {
      try {
        if (!Array.isArray(files)) {
          logger.warn('IPC.ATTENTION', `attention:track-files 入参非法`, { files })
          return false
        }
        getTracker().trackFiles(files)
        logger.debug('IPC.ATTENTION', `attention:track-files`, {
          added: files.length,
        })
        return true
      } catch (err) {
        const msg = (err as Error)?.message ?? '跟踪文件失败'
        logger.error('IPC.ATTENTION', `attention:track-files 失败: ${msg}`)
        throw new Error(`跟踪文件失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // attention:track-commands — 跟踪关注的命令
  // ------------------------------------------------------------------
  // 参数：(commands: string[]) — 命令列表
  // 返回：boolean（true 表示跟踪成功）
  // 用途：Subagent 执行 shell 命令时调用，标记当前关注的命令
  ipcMain.handle(
    'attention:track-commands',
    async (_event, commands: string[]): Promise<boolean> => {
      try {
        if (!Array.isArray(commands)) {
          logger.warn('IPC.ATTENTION', `attention:track-commands 入参非法`, { commands })
          return false
        }
        getTracker().trackCommands(commands)
        logger.debug('IPC.ATTENTION', `attention:track-commands`, {
          added: commands.length,
        })
        return true
      } catch (err) {
        const msg = (err as Error)?.message ?? '跟踪命令失败'
        logger.error('IPC.ATTENTION', `attention:track-commands 失败: ${msg}`)
        throw new Error(`跟踪命令失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // attention:track-errors — 跟踪关注的错误
  // ------------------------------------------------------------------
  // 参数：(errors: string[]) — 错误信息列表
  // 返回：boolean（true 表示跟踪成功）
  // 用途：Subagent 遇到错误时调用，标记当前关注的错误
  ipcMain.handle(
    'attention:track-errors',
    async (_event, errors: string[]): Promise<boolean> => {
      try {
        if (!Array.isArray(errors)) {
          logger.warn('IPC.ATTENTION', `attention:track-errors 入参非法`, { errors })
          return false
        }
        getTracker().trackErrors(errors)
        logger.debug('IPC.ATTENTION', `attention:track-errors`, {
          added: errors.length,
        })
        return true
      } catch (err) {
        const msg = (err as Error)?.message ?? '跟踪错误失败'
        logger.error('IPC.ATTENTION', `attention:track-errors 失败: ${msg}`)
        throw new Error(`跟踪错误失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // attention:track-keywords — 跟踪关注的搜索关键词
  // ------------------------------------------------------------------
  // 参数：(keywords: string[]) — 关键词列表
  // 返回：boolean（true 表示跟踪成功）
  // 用途：Subagent 执行搜索时调用，标记当前关注的搜索关键词
  ipcMain.handle(
    'attention:track-keywords',
    async (_event, keywords: string[]): Promise<boolean> => {
      try {
        if (!Array.isArray(keywords)) {
          logger.warn('IPC.ATTENTION', `attention:track-keywords 入参非法`, { keywords })
          return false
        }
        getTracker().trackKeywords(keywords)
        logger.debug('IPC.ATTENTION', `attention:track-keywords`, {
          added: keywords.length,
        })
        return true
      } catch (err) {
        const msg = (err as Error)?.message ?? '跟踪关键词失败'
        logger.error('IPC.ATTENTION', `attention:track-keywords 失败: ${msg}`)
        throw new Error(`跟踪关键词失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // attention:reset — 重置当前 attention（归档到 history）
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：boolean（true 表示重置成功）
  // 用途：新会话开始时调用，归档当前 attention 到 history
  //
  // 重置逻辑（由 AttentionTracker.reset() 实现）：
  // 1. 当前 attention 非空 → 归档到 history（最多 100 条，超出 FIFO 丢弃）
  // 2. 创建新的空 attention（since = Date.now()）
  ipcMain.handle(
    'attention:reset',
    async (): Promise<boolean> => {
      try {
        getTracker().reset()
        logger.info('IPC.ATTENTION', `attention:reset`)
        return true
      } catch (err) {
        const msg = (err as Error)?.message ?? '重置 attention 失败'
        logger.error('IPC.ATTENTION', `attention:reset 失败: ${msg}`)
        throw new Error(`重置 attention 失败: ${msg}`)
      }
    }
  )

  logger.info('IPC.ATTENTION', `Attention IPC handlers 已注册`, {
    channels: [
      'attention:current',
      'attention:history',
      'attention:track-files',
      'attention:track-commands',
      'attention:track-errors',
      'attention:track-keywords',
      'attention:reset',
    ],
  })
}
