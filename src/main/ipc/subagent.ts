/**
 * Subagent IPC Handlers（v0.9.5 P0 - 组 4 新增）
 *
 * 注册 v0.9.5 引入的自定义 Agent 加载器相关 IPC 通道。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - subagent:list   — 加载并返回所有自定义 agent 配置（从默认目录 .tdsf/agent/）
 * - subagent:reload — 重新加载指定 agent（参数 filePath）或全部重载（无参数）
 *
 * 与现有 agent-loader.ts 的关系：
 * - agent-loader.ts 提供 loadCustomAgents(agentsDir) / loadCustomAgent(filePath) 函数
 * - 本文件仅做 IPC 包装：调用 agent-loader 函数，返回 IPC 友好的响应
 * - 不修改 agent-loader.ts 的现有函数签名
 *
 * 默认目录：`<项目根>/.tdsf/agent/`
 * 项目根路径：通过 `app.getAppPath()` 获取（开发环境为项目根，生产环境为 app.asar 解压目录）
 *
 * 设计要点：
 * - subagent:list 不接收参数（始终从默认目录加载），简化 UI 调用
 * - subagent:reload 入参 filePath 可选（不传则全部重载）
 * - CustomAgentConfig 接口已迁移到 @shared/agent-types.ts（SSOT）
 *
 * 方案书依据：v0.9.5 §UI接入接线图（5 组 P0 级缺失 IPC - 组 4：自定义 Agent 加载器）
 */

import { ipcMain, app } from 'electron'
import * as path from 'node:path'
import { loadCustomAgents, loadCustomAgent } from '../core/agent/subagents/agent-loader'
import type {
  CustomAgentConfig,
  SubagentReloadRequest,
  SubagentReloadResponse,
} from '@shared/agent-types'
import { logger } from '../services/log/logger'

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取默认 agent 目录路径
 *
 * 默认目录：`<项目根>/.tdsf/agent/`
 * 项目根路径通过 `app.getAppPath()` 获取。
 *
 * 注意：app.getAppPath() 在开发环境返回项目根目录，
 * 在生产环境（打包后）返回 app.asar 解压目录。
 * 自定义 agent 是用户数据，应该在用户数据目录而非 app.asar 中，
 * 但为了与 v0.9.4 的 agent-loader 设计保持一致，仍使用 app.getAppPath()。
 *
 * @returns 默认 agent 目录绝对路径
 */
function getDefaultAgentsDir(): string {
  return path.join(app.getAppPath(), '.tdsf', 'agent')
}

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册 Subagent IPC handlers
 *
 * 注册以下通道（2 个）：
 * - subagent:list   — 加载所有自定义 agent 配置
 * - subagent:reload — 重新加载指定 agent 或全部重载
 *
 * IPC 4 步同步：
 * 1. main 层 handler：本文件
 * 2. ipc/index.ts：导入并调用 registerSubagentHandlers()
 * 3. preload/index.ts：暴露 subagentList / subagentReload 方法
 * 4. electron.d.ts：声明 2 个类型
 */
export function registerSubagentHandlers(): void {
  // ------------------------------------------------------------------
  // subagent:list — 加载所有自定义 agent 配置
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：CustomAgentConfig[]（从默认目录 .tdsf/agent/ 加载）
  // 用途：UI 自定义 agent 列表展示（如下拉框 / 卡片列表）
  //
  // 注意：
  // - 目录不存在 → 返回空数组（不抛错）
  // - 单个文件解析失败 → 跳过，不影响其他文件
  ipcMain.handle(
    'subagent:list',
    async (): Promise<CustomAgentConfig[]> => {
      try {
        const agentsDir = getDefaultAgentsDir()
        const configs = await loadCustomAgents(agentsDir)
        logger.info('IPC.SUBAGENT', `subagent:list`, {
          agentsDir,
          count: configs.length,
          names: configs.map((c) => c.name),
        })
        return configs
      } catch (err) {
        const msg = (err as Error)?.message ?? '加载自定义 agent 列表失败'
        logger.error('IPC.SUBAGENT', `subagent:list 失败: ${msg}`)
        throw new Error(`加载自定义 agent 列表失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // subagent:reload — 重新加载指定 agent 或全部重载
  // ------------------------------------------------------------------
  // 参数：(request?: SubagentReloadRequest) — { filePath?: string }
  //   - filePath 指定：重载该文件
  //   - filePath 不指定：重载整个 .tdsf/agent/ 目录
  // 返回：SubagentReloadResponse — { success, reloaded, failed }
  // 用途：用户编辑 .tdsf/agent/*.md 后调用，热重载 agent 配置
  //
  // 重载逻辑：
  // 1. request.filePath 指定 → 调用 loadCustomAgent(filePath) 单文件重载
  // 2. request.filePath 不指定 → 调用 loadCustomAgents(agentsDir) 全部重载
  // 3. 返回 reloaded 成功列表 + failed 失败列表（含错误信息）
  ipcMain.handle(
    'subagent:reload',
    async (_event, request?: SubagentReloadRequest): Promise<SubagentReloadResponse> => {
      try {
        const reloaded: string[] = []
        const failed: Array<{ filePath: string; error: string }> = []

        if (request && typeof request.filePath === 'string' && request.filePath.length > 0) {
          // 单文件重载
          const filePath = request.filePath
          logger.info('IPC.SUBAGENT', `subagent:reload 单文件`, { filePath })

          try {
            const config = await loadCustomAgent(filePath)
            if (config) {
              reloaded.push(filePath)
            } else {
              // loadCustomAgent 返回 null 表示解析失败（缺字段 / 格式错误等）
              failed.push({ filePath, error: '解析失败（缺字段 / 格式错误 / 文件不存在）' })
            }
          } catch (err) {
            const msg = (err as Error)?.message ?? '未知错误'
            failed.push({ filePath, error: msg })
          }
        } else {
          // 全部重载
          const agentsDir = getDefaultAgentsDir()
          logger.info('IPC.SUBAGENT', `subagent:reload 全部`, { agentsDir })

          // 读取目录下所有 .md 文件，逐个加载
          const fs = await import('node:fs/promises')
          let entries: import('node:fs').Dirent[]
          try {
            entries = await fs.readdir(agentsDir, { withFileTypes: true })
          } catch (err) {
            // 目录不存在 → 返回 success=false + 空列表
            const msg = (err as Error)?.message ?? '目录不存在或无法访问'
            logger.warn('IPC.SUBAGENT', `subagent:reload 目录访问失败`, {
              agentsDir,
              error: msg,
            })
            return {
              success: false,
              reloaded: [],
              failed: [],
            }
          }

          const mdFiles = entries.filter(
            (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md')
          )

          // 逐个加载（顺序执行，便于收集失败项）
          for (const entry of mdFiles) {
            const filePath = path.join(agentsDir, entry.name)
            try {
              const config = await loadCustomAgent(filePath)
              if (config) {
                reloaded.push(filePath)
              } else {
                failed.push({ filePath, error: '解析失败（缺字段 / 格式错误）' })
              }
            } catch (err) {
              const msg = (err as Error)?.message ?? '未知错误'
              failed.push({ filePath, error: msg })
            }
          }
        }

        const response: SubagentReloadResponse = {
          success: true, // 即使部分失败也返回 true，只要重载流程完成
          reloaded,
          failed,
        }

        logger.info('IPC.SUBAGENT', `subagent:reload 完成`, {
          reloadedCount: reloaded.length,
          failedCount: failed.length,
        })

        return response
      } catch (err) {
        const msg = (err as Error)?.message ?? '重载自定义 agent 失败'
        logger.error('IPC.SUBAGENT', `subagent:reload 失败: ${msg}`)
        throw new Error(`重载自定义 agent 失败: ${msg}`)
      }
    }
  )

  logger.info('IPC.SUBAGENT', `Subagent IPC handlers 已注册`, {
    channels: ['subagent:list', 'subagent:reload'],
  })
}
