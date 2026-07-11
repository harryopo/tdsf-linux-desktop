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

/** electron-store 实例（专门用于存储加密后的密钥） */
const store = new Store<{ apiKeys?: Record<string, string> }>({
  name: 'secure-storage',
  defaults: {
    apiKeys: {},
  },
  // electron-store 配置文件位于 userData 目录下
})

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
   * 保存 API Key（加密后存储）
   *
   * 流程：
   * 1. 检查 safeStorage 是否可用
   * 2. 用 safeStorage.encryptString 加密明文 → Buffer
   * 3. 把 Buffer 转 base64 字符串
   * 4. 写入 electron-store
   *
   * @param provider 服务商标识（如 'openai'、'anthropic'、'deepseek'）
   * @param key API Key 明文
   * @returns 是否成功（加密不可用时返回 false）
   */
  public static saveApiKey(provider: string, key: string): boolean {
    if (!this.isEncryptionAvailable()) {
      return false
    }
    try {
      // 加密 API Key
      const encrypted = safeStorage.encryptString(key)
      // Buffer 转 base64 字符串存储
      const base64 = encrypted.toString('base64')
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
   * 流程：
   * 1. 从 electron-store 读取 base64 密文
   * 2. 转 Buffer
   * 3. 用 safeStorage.decryptString 解密
   *
   * @param provider 服务商标识
   * @returns API Key 明文，不存在或解密失败返回 null
   */
  public static getApiKey(provider: string): string | null {
    if (!this.isEncryptionAvailable()) {
      return null
    }
    try {
      const apiKeys = store.get('apiKeys', {}) as Record<string, string>
      const base64 = apiKeys[provider]
      if (!base64) {
        return null
      }
      // base64 → Buffer → 解密
      const buffer = Buffer.from(base64, 'base64')
      const plain = safeStorage.decryptString(buffer)
      return plain
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
}
