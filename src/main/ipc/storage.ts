/**
 * 存储 IPC Handlers
 *
 * 注册安全存储和配置存储相关的 IPC 通道：
 * - storage:saveApiKey / storage:getApiKey / storage:deleteApiKey
 * - config:get / config:set
 *
 * 这些通道不涉及 mainWindow 推送，全部是请求-响应模式。
 */

import { ipcMain } from 'electron'
import { SecureStore } from '../services/storage/secure-store'
import { ConfigStore } from '../services/storage/config-store'

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
  ipcMain.handle('storage:getApiKey', async (_event, provider: string) => {
    return SecureStore.getApiKey(provider)
  })

  /** storage:deleteApiKey — 删除 API Key */
  ipcMain.handle('storage:deleteApiKey', async (_event, provider: string) => {
    return SecureStore.deleteApiKey(provider)
  })

  // ------------------------------------------------------------------
  // 配置存储（JSON 配置）
  // ------------------------------------------------------------------

  /** config:get — 读取配置 */
  ipcMain.handle('config:get', async (_event, key: string) => {
    return ConfigStore.get(key)
  })

  /** config:set — 写入配置 */
  ipcMain.handle('config:set', async (_event, key: string, value: unknown) => {
    return ConfigStore.set(key, value)
  })
}
