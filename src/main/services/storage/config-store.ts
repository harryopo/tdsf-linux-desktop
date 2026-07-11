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
}
