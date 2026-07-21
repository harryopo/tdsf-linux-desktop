/**
 * 日志 IPC Handlers
 *
 * 暴露给渲染进程的日志读取能力（用于 UI 展示和自动化测试）：
 * - log:read          — 按条件过滤读取内存 buffer
 * - log:stats         — 获取日志统计（总条数 / 按 level 分布 / 按 category 分布）
 * - log:clearBuffer   — 清空内存 buffer（不影响磁盘文件）
 * - log:setMinLevel   — 运行时调整日志级别
 * - log:filePath      — 获取当前日志文件路径（用于外部工具读取）
 *
 * 设计：
 * - 仅暴露**已初始化的 logger**，未初始化时返回空数组
 * - 默认仅返回最近 200 条，避免一次性传递大对象
 * - 测试可同时通过 IPC 和直接 import logger 验证
 */
import { ipcMain } from 'electron'
import { logger, type LogFilter, type LogLevel } from '../services/log/logger'

/** 默认最大返回条数（防止一次拉太多） */
const DEFAULT_LIMIT = 200

/** 注册日志相关 IPC handlers（无需 mainWindow） */
export function registerLogIpcHandlers(): void {
  /** log:read — 读取日志条目 */
  ipcMain.handle(
    'log:read',
    (_event, filter?: LogFilter & { limit?: number }) => {
      const safeFilter: LogFilter = {
        ...filter,
        limit: filter?.limit ?? DEFAULT_LIMIT,
      }
      return logger.getEntries(safeFilter)
    }
  )

  /** log:stats — 获取统计信息 */
  ipcMain.handle('log:stats', () => {
    return logger.getStats()
  })

  /** log:clearBuffer — 清空内存 buffer */
  ipcMain.handle('log:clearBuffer', () => {
    logger.clearBuffer()
    return true
  })

  /** log:setMinLevel — 调整最低日志级别 */
  ipcMain.handle('log:setMinLevel', (_event, level: LogLevel) => {
    const validLevels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
    if (!validLevels.includes(level)) {
      throw new Error(`Invalid log level: ${level}`)
    }
    logger.setMinLevel(level)
    return true
  })

  /** log:flush — 异步刷新待写入日志 */
  ipcMain.handle('log:flush', async () => {
    await logger.flush()
    return true
  })

  /** log:renderer — 接收渲染进程日志，写入主进程 logger（区分 source='renderer'） */
  ipcMain.handle(
    'log:renderer',
    (
      _event,
      payload: { level: LogLevel; category: string; message: string; meta?: Record<string, unknown>; correlationId?: string }
    ) => {
      // 防御：只接受白名单级别
      const validLevels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
      const level: LogLevel = validLevels.includes(payload?.level) ? payload.level : 'INFO'
      // 标记来源 + 透传 correlationId
      logger.log(level, payload?.category ?? 'RENDERER', payload?.message ?? '', {
        meta: { ...(payload?.meta ?? {}), _from: 'renderer' },
        correlationId: payload?.correlationId,
        source: 'renderer',
      })
      return true
    }
  )
}
