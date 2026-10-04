/**
 * 安全存储管理器
 *
 * 使用 Electron 的 safeStorage API 对 API Key 等敏感信息进行加密，
 * 加密后的密文（base64）存储到 electron-store 中。
 *
 * safeStorage 在不同平台使用不同的后端：
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: libsecret（需 libsecret-1-dev 运行时支持）
 *
 * 即使 electron-store 的配置文件被泄露，没有当前系统用户的上下文
 * 也无法解密 API Key。
 *
 * 注意：safeStorage 必须在 app.ready 之后才能使用。
 */

import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { ServerCredential } from '@shared/models'

/**
 * electron-store 实例（专门用于存储加密后的敏感数据）
 *
 * 存储两类数据：
 * - apiKeys: LLM 服务商的 API Key（base64 密文）
 * - serverCreds: SSH 服务器凭证（整个 credential 对象序列化为 JSON 后加密为 base64）
 */
const store = new Store<{
  apiKeys?: Record<string, string>
  serverCreds?: Record<string, string>
}>({
  name: 'secure-storage',
  defaults: {
    apiKeys: {},
    serverCreds: {},
  },
})

/**
 * 加密不可用即拒绝写入（fail-closed）
 *
 * 旧行为是 console.warn 一次后继续把凭据写成明文 base64——等于把
 * SSH 密码/私钥/API Key 明文落盘还不告诉用户。现在改为抛错，
 * 由 saveApiKey / saveServerCredential 捕获后返回 false，调用方据实提示。
 */
function ensureStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      '系统加密后端不可用（safeStorage），已拒绝存储凭据。' +
      '请启用 Windows 凭据管理器 / macOS Keychain / Linux libsecret 后重试'
    )
  }
}

/**
 * 加密字符串（加密不可用时抛错，不再降级为明文 base64）
 * @param plain 明文
 * @returns base64 密文
 */
function encryptString(plain: string): string {
  ensureStorageAvailable()
  return safeStorage.encryptString(plain).toString('base64')
}

/**
 * 解密字符串（safeStorage 不可用时降级为明文 base64 解码）
 * @param base64 base64 字符串
 * @returns 明文
 */
function decryptString(base64: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(base64, 'base64')
    return safeStorage.decryptString(buffer)
  }
  // 降级：base64 解码
  return Buffer.from(base64, 'base64').toString('utf-8')
}

/**
 * 安全存储管理器（单例风格，所有方法为静态方法）
 *
 * 用于加密存储 LLM 服务商的 API Key：
 * - saveApiKey(provider, key): 加密并保存
 * - getApiKey(provider): 读取并解密
 * - deleteApiKey(provider): 删除
 * - isEncryptionAvailable(): 检查加密是否可用
 */
export class SecureStore {
  /**
   * 检查 safeStorage 加密是否可用
   *
   * 在 Linux 上若 libsecret 未安装会返回 false，
   * 此时建议回退到普通存储或提示用户安装依赖。
   *
   * @returns 是否可用
   */
  public static isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /**
   * 保存 API Key（safeStorage 加密后存储；加密后端不可用时拒绝写入并返回 false）
   *
   * @param provider 服务商标识（如 'openai'、'anthropic'、'deepseek'）
   * @param key API Key 明文
   * @returns 是否成功
   */
  public static saveApiKey(provider: string, key: string): boolean {
    try {

      const base64 = encryptString(key)
      const apiKeys = store.get('apiKeys', {}) as Record<string, string>
      apiKeys[provider] = base64
      store.set('apiKeys', apiKeys)
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取 API Key（解密后返回）
   *
   * @param provider 服务商标识
   * @returns API Key 明文，不存在或解密失败返回 null
   */
  public static getApiKey(provider: string): string | null {
    try {
      const apiKeys = store.get('apiKeys', {}) as Record<string, string>
      const base64 = apiKeys[provider]
      if (!base64) {
        return null
      }
      return decryptString(base64)
    } catch {
      return null
    }
  }

  /**
   * 删除 API Key
   * @param provider 服务商标识
   * @returns 是否成功（不存在也返回 true）
   */
  public static deleteApiKey(provider: string): boolean {
    try {
      const apiKeys = store.get('apiKeys', {}) as Record<string, string>
      if (!(provider in apiKeys)) {
        return true
      }
      delete apiKeys[provider]
      store.set('apiKeys', apiKeys)
      return true
    } catch {
      return false
    }
  }

  /**
   * 列出所有已存储的 API Key 的服务商标识
   * @returns 服务商标识数组
   */
  public static listProviders(): string[] {
    try {
      const apiKeys = store.get('apiKeys', {}) as Record<string, string>
      return Object.keys(apiKeys)
    } catch {
      return []
    }
  }

  // ------------------------------------------------------------------
  // 服务器凭证（SSH 密码/私钥/口令）加密存储
  // ------------------------------------------------------------------

  /**
   * 保存服务器凭证（加密后存储）
   *
   * 将 ServerCredential 序列化为 JSON，再用 safeStorage 加密。
   * key 格式：`server-cred-{serverId}`
   *
   * @param serverId 服务器唯一标识
   * @param credential 服务器凭证（password/privateKey/passphrase）
   * @returns 是否成功
   */
  public static saveServerCredential(serverId: string, credential: ServerCredential): boolean {
    try {

      const json = JSON.stringify(credential)
      const base64 = encryptString(json)
      const creds = store.get('serverCreds', {}) as Record<string, string>
      creds[serverId] = base64
      store.set('serverCreds', creds)
      return true
    } catch {
      return false
    }
  }

  /**
   * 加载服务器凭证（解密后返回）
   *
   * @param serverId 服务器唯一标识
   * @returns 服务器凭证，不存在或解密失败返回 null
   */
  public static loadServerCredential(serverId: string): ServerCredential | null {
    try {
      const creds = store.get('serverCreds', {}) as Record<string, string>
      const base64 = creds[serverId]
      if (!base64) {
        return null
      }
      const json = decryptString(base64)
      const obj = JSON.parse(json) as ServerCredential
      return obj
    } catch {
      return null
    }
  }

  /**
   * 删除服务器凭证
   * @param serverId 服务器唯一标识
   * @returns 是否成功（不存在也返回 true）
   */
  public static deleteServerCredential(serverId: string): boolean {
    try {
      const creds = store.get('serverCreds', {}) as Record<string, string>
      if (!(serverId in creds)) {
        return true
      }
      delete creds[serverId]
      store.set('serverCreds', creds)
      return true
    } catch {
      return false
    }
  }
}
