/**
 * 终端智能补全 IPC Handlers（Phase 1）
 *
 * 桥接渲染进程与 TerminalCompletionEngine，提供零 Token 本地补全。
 *
 * 通道（与 ipc-channels.ts 对齐）：
 * - terminal-completion:complete  请求补全建议
 * - terminal-completion:accept    接受建议（提升权重）
 * - terminal-completion:import    批量导入历史命令
 */

import { ipcMain } from 'electron'
import { TERMINAL_COMPLETION } from '@shared/ipc-channels'
import { TerminalCompletionEngine } from '../services/terminal/terminal-completion-engine'
import { logger } from '../services/log/logger'

/** 补全引擎单例（按会话共享一份本地索引） */
let engine: TerminalCompletionEngine | null = null

function getEngine(): TerminalCompletionEngine {
  if (!engine) {
    engine = new TerminalCompletionEngine()
    engine.init().catch((err: unknown) => {
      logger.error('TerminalCompletion', '引擎初始化失败', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }
  return engine
}

/** 注册终端补全 IPC handlers */
export function registerTerminalCompletionIpcHandlers(): void {
  // 启动时异步初始化引擎
  void getEngine().init()

  /** terminal-completion:complete — 请求补全建议 */
  ipcMain.handle(
    TERMINAL_COMPLETION.COMPLETE,
    async (_event, input: string) => {
      try {
        const eng = getEngine()
        await eng.init()
        return eng.complete(input)
      } catch (err) {
        logger.error('TerminalCompletion', 'complete 失败', {
          input,
          error: err instanceof Error ? err.message : String(err),
        })
        return []
      }
    },
  )

  /** terminal-completion:accept — 接受建议 */
  ipcMain.handle(
    TERMINAL_COMPLETION.ACCEPT,
    async (_event, command: string) => {
      try {
        const eng = getEngine()
        await eng.init()
        eng.acceptSuggestion(command)
        return true
      } catch (err) {
        logger.error('TerminalCompletion', 'accept 失败', {
          command,
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      }
    },
  )

  /** terminal-completion:import — 批量导入历史命令 */
  ipcMain.handle(
    TERMINAL_COMPLETION.IMPORT,
    async (_event, commands: string[], directory?: string) => {
      try {
        const eng = getEngine()
        await eng.init()
        eng.importHistory(commands, directory)
        return true
      } catch (err) {
        logger.error('TerminalCompletion', 'import 失败', {
          count: commands.length,
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      }
    },
  )
}

/** 应用退出时关闭引擎 */
export function disposeTerminalCompletionEngine(): void {
  if (engine) {
    engine.close()
    engine = null
  }
}
