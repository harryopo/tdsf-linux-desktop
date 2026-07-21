/**
 * 存储 IPC Handlers
 *
 * 注册安全存储和配置存储相关的 IPC 通道：
 * - storage:saveApiKey / storage:getApiKey / storage:deleteApiKey
 * - config:get / config:set
 * - server:list / server:save / server:export / server:import / server:delete-cred
 *
 * 这些通道不涉及 mainWindow 推送，全部是请求-响应模式。
 */

import { ipcMain } from 'electron'
import { STORAGE, CONFIG, SERVER } from '@shared/ipc-channels'
import { SecureStore } from '../services/storage/secure-store'
import { ConfigStore } from '../services/storage/config-store'
import type { SshConfig } from '@shared/models'

/**
 * 注册存储相关 IPC handlers
 *
 * 此模块不需要 mainWindow 参数（所有操作都是同步请求-响应），
 * 但为保持注册函数签名一致，仍接收 mainWindow 参数（未使用）。
 */
export function registerStorageIpcHandlers(): void {
  // ------------------------------------------------------------------
  // 安全存储（API Key 加密）
  // ------------------------------------------------------------------

  /** storage:saveApiKey — 加密保存 API Key */
  ipcMain.handle(
    'storage:saveApiKey',
    async (_event, provider: string, key: string) => {
      return SecureStore.saveApiKey(provider, key)
    }
  )

  /** storage:getApiKey — 读取并解密 API Key */
  ipcMain.handle(STORAGE.GET_API_KEY, async (_event, provider: string) => {
    return SecureStore.getApiKey(provider)
  })

  /** storage:deleteApiKey — 删除 API Key */
  ipcMain.handle(STORAGE.DELETE_API_KEY, async (_event, provider: string) => {
    return SecureStore.deleteApiKey(provider)
  })

  // ------------------------------------------------------------------
  // 配置存储（JSON 配置）
  // ------------------------------------------------------------------

  /** config:get — 读取配置 */
  ipcMain.handle(CONFIG.GET, async (_event, key: string) => {
    return ConfigStore.get(key)
  })

  /** config:set — 写入配置 */
  ipcMain.handle(CONFIG.SET, async (_event, key: string, value: unknown) => {
    return ConfigStore.set(key, value)
  })

  // ------------------------------------------------------------------
  // 服务器列表管理（敏感信息加密存储）
  // ------------------------------------------------------------------

  /** server:list — 加载服务器列表（敏感信息从 safeStorage 解密） */
  ipcMain.handle(SERVER.LIST, async () => {
    return ConfigStore.loadServerList()
  })

  /** server:save — 保存服务器列表（敏感信息加密存储） */
  ipcMain.handle(SERVER.SAVE, async (_event, servers: SshConfig[]) => {
    return ConfigStore.saveServerList(servers)
  })

  /** server:export — 导出服务器列表为 JSON（脱敏，不含密码/私钥） */
  ipcMain.handle(SERVER.EXPORT, async () => {
    return ConfigStore.exportServerList()
  })

  /** server:import — 导入服务器列表（生成新 ID，敏感信息留空） */
  ipcMain.handle(SERVER.IMPORT, async (_event, json: string) => {
    try {
      return ConfigStore.importServerList(json)
    } catch (err) {
      // 抛出用户可读的错误信息（不泄露 stack trace）
      throw new Error((err as Error).message)
    }
  })

  /** server:delete-cred — 删除服务器凭证 */
  ipcMain.handle(SERVER.DELETE_CRED, async (_event, serverId: string) => {
    return SecureStore.deleteServerCredential(serverId)
  })
}

