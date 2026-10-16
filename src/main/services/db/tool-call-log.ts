/**
 * 工具调用留痕（tool_call_log 表的唯一写入口）
 *
 * 为什么单独一个模块、而不是继续放在 `ipc/model-stats.ts` 里：
 * 设置页「功能调用统计」的数据源就是这张表，谁调用谁记一笔。以前只有 IPC 入口能记，
 * 于是出现两件荒唐事——
 *   1. 知识库页每次打开都用空查询 `kbSearch('')` 列一遍条目，被记成一次"知识库检索"
 *      （用户 2026-10-16 实测："知识库调用记录是假的"，214 次里绝大多数是翻页）；
 *   2. AI 真的检索知识库走的是仓储层（supervisor 的 kb_search 工具、各 subagent、
 *      MCP 工具），一条都没记。
 * 记数的正确位置是**所有检索都要经过的那一层**，不是某个入口。仓储层要记数又不该
 * 反向依赖 IPC，所以把写入口挪到这里：IPC 层和数据层都从这儿记，方向是 服务层 → 服务层。
 */
import type { DatabaseManager } from './database'
import { logger } from '../log/logger'

/**
 * 记录一次工具调用
 *
 * @param db 数据库管理器（不可用则静默跳过：统计是旁路，绝不能把主流程带崩）
 * @param toolName 工具名称，必须与设置页展示口径一致（如「终端命令执行」「知识库检索」）
 */
export function recordToolCall(db: DatabaseManager, toolName: string): void {
  try {
    if (!db.isAvailable()) return
    db.prepare('INSERT INTO tool_call_log (toolName, timestamp) VALUES (?, ?)').run(
      toolName,
      Date.now()
    )
  } catch (err) {
    logger.warn('DB.TOOL_CALL_LOG', `recordToolCall 失败: ${(err as Error).message}`)
  }
}
