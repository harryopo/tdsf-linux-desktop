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
import type { SshConfig, LlmConfig, ExternalMcpServer, ServerListItem } from '@shared/models'
import { SecureStore } from './secure-store'
import { salvageCorruptStoreFile } from './store-recovery'
import { logger } from '../log/logger'

/** Langfuse 配置 */
export interface LangfuseConfig {
  secretKey: string
  publicKey: string
  host?: string
}

/** MCP Server 配置 */
export interface McpConfig {
  enabled: boolean
  port: number
  /** 外部 MCP Server 列表（Agent 作为 Client 连接） */
  externalServers?: ExternalMcpServer[]
}

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
  /** Langfuse 配置（不含 secretKey，敏感信息走 SecureStore） */
  langfuseConfig?: { publicKey: string; host?: string } | null
  /** MCP Server 配置 */
  mcpConfig?: McpConfig | null
  /** 其他自定义配置（允许任意 key-value） */
  [key: string]: unknown
}

/** 内部 MCP Server 的默认端口（没配过 mcpConfig 时用；改这里就等于改正本） */
export const MCP_DEFAULT_PORT = 3107

/**
 * 创建 electron-store 实例
 *
 * 配置文件名 config.json，存储在 userData 目录下。
 *
 * 构造前先把"解析不了的旧文件"改名留档：默认 `clearInvalidConfig: false` 时，
 * 一个半截写入的 config.json 会让主进程在启动前就抛错（#258）。
 * `clearInvalidConfig` 同时打开，兜住检查与读取之间被写坏的窗口。
 */
salvageCorruptStoreFile('config')

const store = new Store<ConfigSchema>({
  name: 'config',
  clearInvalidConfig: true,
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
 * - getLlmConfig(): 获取 LLM 配置
 * - saveLlmConfig(config): 保存 LLM 配置
 */
/**
 * 剥掉一台服务器配置里的凭据（**含跳板机那一层**）
 *
 * 实现挪到 server-credentials.ts（纯函数、可在无 Electron 环境里直接测），
 * 这里只留一个转发，避免同一件事有两份。
 */
import {
  carriesCredential,
  connectionIdentityChanged,
  stripServerCredentials,
  stripServerSecurityOverrides,
  toServerListItem,
} from './server-credentials'
import { normalizeImportedServer } from './server-import'

/** 只接受"普通对象"：null、数组、字符串、数字都不算（数组的 typeof 也是 object） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 形状不对的配置只提示一次：同一处读取每轮都刷日志，会把真正的新问题淹掉 */
const shapeWarned = new Set<string>()

/**
 * 读配置时先验形状
 *
 * 以前这些读取口是裸 `as T`：`llmConfig` 写成字符串会被展开成 `{0:'o',1:'o'…}`，
 * `knowledgeBasePath` 写成数字会被当成路径去拼。合法 JSON 但类型错的配置
 * 不会让应用崩（实测），只会悄悄把垃圾值传给调用方——所以在边界上换成默认值，
 * 并留一条能查的日志。
 */
function warnShapeOnce(key: string, value: unknown): void {
  if (shapeWarned.has(key)) return
  shapeWarned.add(key)
  let preview = ''
  try {
    preview = JSON.stringify(value)?.slice(0, 80) ?? String(value)
  } catch {
    preview = typeof value
  }
  logger.warn('APP', `配置项形状不对，已按默认值处理：${key} = ${preview}`)
}

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
   * 获取 LLM 配置
   *
   * 注意：返回的 LlmConfig.apiKey 字段会被清空（API Key 单独存 SecureStore）。
   * 调用方需要从 SecureStore.getApiKey() 获取真实 API Key 后回填。
   *
   * @returns LLM 配置（无 API Key），未配置返回 null
   */
  public static getLlmConfig(): LlmConfig | null {
    const raw = store.get('llmConfig', null)
    if (raw == null) return null
    if (!isPlainObject(raw)) {
      warnShapeOnce('llmConfig', raw)
      return null
    }
    const config = raw as unknown as LlmConfig
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
      // API Key 单独存 SecureStore。saveApiKey 加密后端不可用时返回 false 而不是抛错；
      // 以前这里无视返回值，界面会报"已保存"而下次开机 Key 不在。
      if (config.apiKey && !SecureStore.saveApiKey('llm', config.apiKey)) {
        return false
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
    const raw = store.get('uiSettings', {})
    if (raw == null) return {}
    if (!isPlainObject(raw)) {
      warnShapeOnce('uiSettings', raw)
      return {}
    }
    return raw
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
    const raw = store.get('knowledgeBasePath', '')
    if (raw == null) return ''
    if (typeof raw !== 'string') {
      // 数字/对象被当成路径去 path.join 会直接抛 TypeError
      warnShapeOnce('knowledgeBasePath', raw)
      return ''
    }
    return raw
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
  // Langfuse 配置
  // ------------------------------------------------------------------

  /**
   * 获取 Langfuse 配置
   *
   * secretKey 单独存 SecureStore，publicKey + host 存 electron-store。
   * 返回时合并 secretKey，未配置时返回 null。
   */
  public static getLangfuseConfig(): LangfuseConfig | null {
    const cfg = store.get('langfuseConfig', null) as { publicKey?: string; host?: string } | null
    if (!cfg || !cfg.publicKey) {
      return null
    }
    const secretKey = SecureStore.getApiKey('langfuse') ?? ''
    if (!secretKey) {
      return null
    }
    return {
      secretKey,
      publicKey: cfg.publicKey,
      host: cfg.host
    }
  }

  /**
   * 保存 Langfuse 配置
   *
   * secretKey 走 SecureStore，publicKey + host 存 electron-store。
   */
  public static saveLangfuseConfig(config: LangfuseConfig): boolean {
    try {
      if (config.secretKey && !SecureStore.saveApiKey('langfuse', config.secretKey)) {
        return false
      }
      store.set('langfuseConfig', {
        publicKey: config.publicKey,
        host: config.host
      })
      return true
    } catch {
      return false
    }
  }

  // ------------------------------------------------------------------
  // MCP Server 配置
  // ------------------------------------------------------------------

  /**
   * 获取 MCP Server 配置
   * @returns MCP 配置，未配置返回 null
   */
  public static getMcpConfig(): McpConfig | null {
    const raw = store.get('mcpConfig', null)
    if (raw == null) return null
    if (!isPlainObject(raw)) {
      warnShapeOnce('mcpConfig', raw)
      return null
    }
    return raw as unknown as McpConfig
  }

  /**
   * 取 MCP 配置，没配过时给一份"内部服务器按环境变量决定、端口 3107、外部列表为空"的默认。
   *
   * 默认值只写在这一个地方：以前只有 main/index.ts 内联一份，现在写入口也要一份，
   * 抄两份迟早和正本分叉（谁都不想让"没配过"和"配过但关着"长成同一种读数）。
   */
  public static getMcpConfigOrDefault(): McpConfig {
    const raw = store.get('mcpConfig', null)
    if (raw != null && !isPlainObject(raw)) warnShapeOnce('mcpConfig', raw)
    return (isPlainObject(raw) ? (raw as unknown as McpConfig) : null) ?? {
      enabled: process.env.MCP_SERVER_ENABLED === 'true',
      port: MCP_DEFAULT_PORT,
    }
  }

  /**
   * 保存 MCP Server 配置
   */
  public static saveMcpConfig(config: McpConfig): boolean {
    try {
      store.set('mcpConfig', config)
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
      /*
       * 换机就作废旧凭据（2026-10-26 深度审查 #237）：
       * 凭据按 id 存在 SecureStore 里，渲染层拿不到值却能改 host。允许"改 host 沿用旧口令"
       * 就等于给出了一条"把已存凭据发到别处"的现成路径；跳板机被换同理（凭据会经过它）。
       * 判定用落库前的非敏感旧值，不等 loadServerList（那条会把凭据一起解出来）。
       */
      const previousRaw = store.get('sshServers', [])
      const previousById = new Map<string, SshConfig>(
        (Array.isArray(previousRaw) ? (previousRaw as SshConfig[]) : []).map((s) => [s.id, s])
      )
      // 非敏感信息存入 electron-store（含跳板机那一层，见 stripServerCredentials）。
      // 安全开关只认设置页的全局默认值，服务器条目里带的一律剥掉。
      const sanitized = servers.map((s) => stripServerSecurityOverrides(stripServerCredentials(s)))
      store.set('sshServers', sanitized)

      // 敏感信息存入 SecureStore 加密
      const failed: string[] = []
      for (const s of servers) {
        const cred = {
          password: s.password,
          privateKey: s.privateKey,
          passphrase: s.passphrase,
        }
        const hasNewCredential = Boolean(cred.password || cred.privateKey || cred.passphrase)
        const before = previousById.get(s.id)
        if (before && !hasNewCredential && connectionIdentityChanged(before, s)) {
          // 删除失败要回 false（同下面口令没存进去的口径）：这次保存的语义是
          // "改了哪台机 + 旧凭据必须失效"，只做到一半不能对界面报成功
          if (!SecureStore.deleteServerCredential(s.id)) failed.push(s.name || s.host || s.id)
        }
        // 仅在存在敏感信息时保存（避免写入空凭证）
        if (hasNewCredential) {
          // saveServerCredential 会返回成败（safeStorage 不可用时是 false）。
          // 以前这里不接返回值：口令没存进去照样回"保存成功"，
          // 用户下次连接被要求重输，还以为是应用忘了。
          if (!SecureStore.saveServerCredential(s.id, cred)) {
            failed.push(s.name || s.host || s.id)
          }
        }
      }
      if (failed.length > 0) {
        // 调用方（server:save → server-store）拿到的就是 false：
        // 非敏感列表已经落库了，但口令没落进加密存储，界面上不能报"保存成功"。
        return false
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
  /**
   * 加载服务器列表 —— **给渲染层的安全形状**
   *
   * 与 loadServerList() 的唯一区别：不带凭据，只带 hasCredential。
   * 渲染层需要连接时走 ssh:connectById，由主进程自己取用凭据。
   */
  public static loadServerListPublic(): ServerListItem[] {
    return ConfigStore.loadServerList().map((s) => toServerListItem(s, carriesCredential(s)))
  }

  public static loadServerList(): SshConfig[] {
    try {
      const servers = store.get('sshServers', []) as SshConfig[]
      if (!Array.isArray(servers)) {
        // 读到了但形状不对：这是损坏，不是"没有服务器"。返回 [] 会让渲染层拿
        // localStorage 缓存反写，把一个可恢复的读错误变成数据覆盖。
        throw new Error('配置文件里的服务器列表不是数组')
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
    } catch (err) {
      // 读失败必须抛：返回 [] 会被当成"用户没有任何服务器"，渲染层随即拿缓存反写，
      // 于是一次瞬时读取失败变成永久数据覆盖（2026-10-21 审查 C2）。
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`读取服务器列表失败：${msg}`)
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
    const list = (Array.isArray(servers) ? servers : []).map(stripServerCredentials)
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
      let newId = randomUUID()
      while (existingIds.has(newId)) {
        newId = randomUUID()
      }
      const normalized = normalizeImportedServer(item, newId)
      if (!normalized) continue
      existingIds.add(newId)
      imported.push(normalized)
    }

    // 合并到现有列表并保存；写盘失败要让界面知道，不能回"导入成功"
    const merged = [...existing, ...imported]
    if (!this.saveServerList(merged)) {
      throw new Error('导入内容已解析，但写入服务器列表失败')
    }
    return imported
  }
}
