/**
 * 配置存储管理器
 *
 * 使用 electron-store 存储 JSON 格式的配置数据（非敏感）：
 * - SSH 服务器列表（不含密码/私钥，凭据走 SecureStore 或运行时输入）
 * - LLM 配置（baseUrl/model/temperature 等，API Key 单独存 SecureStore）
 * - UI 设置（主题、语言、布局等）
 * - 知识库路径
 *
 * 所有配置以扁平 key-value 形式存储在 electron-store 中，
 * key 为业务命名空间（如 'sshServers'、'llmConfig'、'uiSettings'）。
 *
 * 注意：electron-store 必须在 app.ready 之后才能使用。
 */

import Store from 'electron-store'
import { randomUUID } from 'crypto'
import type { SshConfig, LlmConfig } from '@shared/models'
import { SecureStore } from './secure-store'

/** 配置存储的 schema 定义 */
interface ConfigSchema {
  /** SSH 服务器列表（密码/私钥已脱敏） */
  sshServers?: SshConfig[]
  /** LLM 配置（不含 API Key） */
  llmConfig?: LlmConfig | null
  /** UI 设置（主题、语言等） */
  uiSettings?: Record<string, unknown>
  /** 知识库存储路径 */
  knowledgeBasePath?: string
  /** 其他自定义配置（允许任意 key-value） */
  [key: string]: unknown
}

/**
 * 创建 electron-store 实例
 *
 * 配置文件名 config.json，存储在 userData 目录下。
 */
const store = new Store<ConfigSchema>({
  name: 'config',
  defaults: {
    sshServers: [],
    llmConfig: null,
    uiSettings: {},
    knowledgeBasePath: '',
  },
})

/**
 * 配置存储管理器（静态方法）
 *
 * 提供：
 * - get(key): 读取任意配置
 * - set(key, value): 写入任意配置
 * - getSshServers(): 获取 SSH 服务器列表
 * - saveSshServers(servers): 保存 SSH 服务器列表
 * - getLlmConfig(): 获取 LLM 配置
 * - saveLlmConfig(config): 保存 LLM 配置
 */
export class ConfigStore {
  /**
   * 读取配置
   * @param key 配置键
   * @returns 配置值（不存在返回 undefined）
   */
  public static get(key: string): unknown {
    return store.get(key)
  }

  /**
   * 写入配置
   * @param key 配置键
   * @param value 配置值（会被 JSON 序列化）
   * @returns 是否成功
   */
  public static set(key: string, value: unknown): boolean {
    try {
      store.set(key, value)
      return true
    } catch {
      return false
    }
  }

  /**
   * 删除配置项
   * @param key 配置键
   * @returns 是否成功
   */
  public static delete(key: string): boolean {
    try {
      store.delete(key)
      return true
    } catch {
      return false
    }
  }

  // ------------------------------------------------------------------
  // 业务封装方法
  // ------------------------------------------------------------------

  /**
   * 获取 SSH 服务器列表
   *
   * 列表中的 SshConfig 不应包含明文密码/私钥。
   * 真正连接时由调用方从 SecureStore 或运行时输入获取凭据。
   *
   * @returns SSH 服务器列表
   */
  public static getSshServers(): SshConfig[] {
    const servers = store.get('sshServers', []) as SshConfig[]
    return Array.isArray(servers) ? servers : []
  }

  /**
   * 保存 SSH 服务器列表
   *
   * 保存前应脱敏（移除 password/privateKey 字段），
   * 仅保留连接基本信息（host/port/username/authType 等）。
   *
   * @param servers SSH 服务器列表
   * @returns 是否成功
   */
  public static saveSshServers(servers: SshConfig[]): boolean {
    try {
      // 脱敏：移除明文密码和私钥内容（仅保留路径）
      const sanitized = servers.map((s) => {
        const { password, privateKey, ...rest } = s
        // 故意不保存 password 和 privateKey，避免明文落盘
        void password
        void privateKey
        return rest
      })
      store.set('sshServers', sanitized)
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取 LLM 配置
   *
   * 注意：返回的 LlmConfig.apiKey 字段会被清空（API Key 单独存 SecureStore）。
   * 调用方需要从 SecureStore.getApiKey() 获取真实 API Key 后回填。
   *
   * @returns LLM 配置（无 API Key），未配置返回 null
   */
  public static getLlmConfig(): LlmConfig | null {
    const config = store.get('llmConfig', null) as LlmConfig | null
    if (!config) {
      return null
    }
    // 不返回存储的 apiKey 字段（如果有的话），强制走 SecureStore
    return {
      ...config,
      apiKey: '',
    }
  }

  /**
   * 保存 LLM 配置
   *
   * 如果 config.apiKey 非空，会自动保存到 SecureStore，并清空配置中的 apiKey。
   *
   * @param config LLM 配置
   * @returns 是否成功
   */
  public static saveLlmConfig(config: LlmConfig): boolean {
    try {
      // API Key 单独存 SecureStore
      if (config.apiKey) {
        SecureStore.saveApiKey('llm', config.apiKey)
      }
      // 配置中清空 apiKey，仅保存非敏感字段
      const { apiKey, ...rest } = config
      void apiKey
      store.set('llmConfig', rest)
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取 UI 设置
   * @returns UI 设置对象
   */
  public static getUiSettings(): Record<string, unknown> {
    const settings = store.get('uiSettings', {}) as Record<string, unknown>
    return settings ?? {}
  }

  /**
   * 保存 UI 设置（整体覆盖）
   * @param settings UI 设置对象
   */
  public static saveUiSettings(settings: Record<string, unknown>): boolean {
    try {
      store.set('uiSettings', settings)
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取知识库路径
   * @returns 知识库存储路径
   */
  public static getKnowledgeBasePath(): string {
    return (store.get('knowledgeBasePath', '') as string) ?? ''
  }

  /**
   * 保存知识库路径
   * @param path 知识库存储路径
   */
  public static saveKnowledgeBasePath(path: string): boolean {
    try {
      store.set('knowledgeBasePath', path)
      return true
    } catch {
      return false
    }
  }

  // ------------------------------------------------------------------
  // 服务器列表管理（敏感信息加密存储）
  // ------------------------------------------------------------------

  /**
   * 保存服务器列表
   *
   * 分离存储策略：
   * - 非敏感信息（host/port/username/name/authType/privateKeyPath/keepAlive）
   *   存入 electron-store（明文 JSON）
   * - 敏感信息（password/privateKey/passphrase）存入 SecureStore（safeStorage 加密）
   *
   * @param servers SSH 服务器列表（可能包含明文敏感信息）
   * @returns 是否成功
   */
  public static saveServerList(servers: SshConfig[]): boolean {
    try {
      // 非敏感信息存入 electron-store
      const sanitized = servers.map((s) => {
        const {
          password,
          privateKey,
          passphrase,
          ...rest
        } = s
        void password
        void privateKey
        void passphrase
        return rest
      })
      store.set('sshServers', sanitized)

      // 敏感信息存入 SecureStore 加密
      for (const s of servers) {
        const cred = {
          password: s.password,
          privateKey: s.privateKey,
          passphrase: s.passphrase,
        }
        // 仅在存在敏感信息时保存（避免写入空凭证）
        if (cred.password || cred.privateKey || cred.passphrase) {
          SecureStore.saveServerCredential(s.id, cred)
        }
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * 加载服务器列表
   *
   * 从 electron-store 读取非敏感信息，从 SecureStore 解密敏感信息，合并返回。
   *
   * @returns 完整的 SSH 服务器列表（含解密后的敏感信息）
   */
  public static loadServerList(): SshConfig[] {
    try {
      const servers = store.get('sshServers', []) as SshConfig[]
      if (!Array.isArray(servers)) {
        return []
      }
      // 从 SecureStore 解密敏感信息并合并
      return servers.map((s) => {
        const cred = SecureStore.loadServerCredential(s.id)
        if (cred) {
          return {
            ...s,
            password: cred.password,
            privateKey: cred.privateKey,
            passphrase: cred.passphrase,
          }
        }
        return s
      })
    } catch {
      return []
    }
  }

  /**
   * 导出服务器列表为 JSON 字符串（脱敏）
   *
   * 导出时移除所有敏感信息（password/privateKey/passphrase），
   * 只导出非敏感字段（id/name/host/port/username/authType/privateKeyPath/keepAlive）。
   * 导出文件可安全分享。
   *
   * @returns 脱敏后的 JSON 字符串
   */
  public static exportServerList(): string {
    const servers = store.get('sshServers', []) as SshConfig[]
    const list = (Array.isArray(servers) ? servers : []).map((s) => {
      const {
        password,
        privateKey,
        passphrase,
        ...rest
      } = s
      void password
      void privateKey
      void passphrase
      return rest
    })
    return JSON.stringify(list, null, 2)
  }

  /**
   * 导入服务器列表
   *
   * 校验 JSON 格式，为每个服务器生成新的 serverId（避免与现有冲突），
   * 敏感信息留空（需要用户重新输入）。
   *
   * @param json JSON 字符串
   * @returns 导入后的服务器列表（含新 ID，敏感信息为空）
   */
  public static importServerList(json: string): SshConfig[] {
    // 校验 JSON 格式
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      throw new Error('JSON 格式无效')
    }
    if (!Array.isArray(parsed)) {
      throw new Error('JSON 内容不是数组')
    }

    // 转换并生成新 ID
    const existing = this.loadServerList()
    const existingIds = new Set(existing.map((s) => s.id))
    const imported: SshConfig[] = []
    for (const item of parsed) {
      const s = item as Partial<SshConfig>
      // 基本字段校验
      if (!s.host || !s.username) {
        continue // 跳过无效条目
      }
      // 生成唯一 ID
      let newId = randomUUID()
      while (existingIds.has(newId)) {
        newId = randomUUID()
      }
      existingIds.add(newId)
      imported.push({
        id: newId,
        name: s.name ?? `${s.host}:${s.port ?? 22}`,
        host: s.host,
        port: s.port ?? 22,
        username: s.username,
        authType: s.authType ?? 'password',
        privateKeyPath: s.privateKeyPath,
        keepAlive: s.keepAlive,
        // 敏感信息留空，需要用户重新输入
        password: undefined,
        privateKey: undefined,
        passphrase: undefined,
      })
    }

    // 合并到现有列表并保存
    const merged = [...existing, ...imported]
    this.saveServerList(merged)
    return imported
  }
}
