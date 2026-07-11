/**
 * IPC 注册入口
 *
 * 统一注册所有 IPC handlers，由主进程入口 main/index.ts 调用。
 *
 * 注册顺序：SSH → 监控 → 存储 → LLM → 知识库 → 决策历史 → Agent
 * （顺序无强依赖，仅保持一致性）
 *
 * 注意：重复注册同名 handler 会抛错，所以本函数在应用生命周期内只应调用一次。
 */

import { BrowserWindow } from 'electron'
import { registerSshIpcHandlers } from './ssh'
import { registerMonitorIpcHandlers } from './monitor'
import { registerStorageIpcHandlers } from './storage'
import { registerLlmHandlers } from './llm'
import { registerKnowledgeHandlers } from './knowledge'
import { registerHistoryHandlers } from './history'
import { registerAgentHandlers } from './agent'

/**
 * 注册所有 IPC handlers
 *
 * 在 app.whenReady() 后、创建主窗口后调用。
 *
 * @param mainWindow 主窗口实例，用于向渲染进程推送事件（Shell 数据、监控数据等）
 */
export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  registerSshIpcHandlers(mainWindow)
  registerMonitorIpcHandlers(mainWindow)
  registerStorageIpcHandlers()
  registerLlmHandlers(mainWindow)
  registerKnowledgeHandlers(mainWindow)
  registerHistoryHandlers(mainWindow)
  registerAgentHandlers(mainWindow)
}
