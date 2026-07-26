/**
 * Provider 注册中心
 *
 * 职责：
 * - 管理所有已注册 Provider 配置（预置模板 + 用户自定义）
 * - 持久化到 electron-store（通过 ConfigStore.set/get）
 * - API Key 单独走 SecureStore 加密存储
 * - 提供注册/查询/列表/删除/设置默认 等方法
 *
 * 持久化策略：
 * - Provider 列表（不含 apiKey）存入 electron-store 的 'agentProviders' 键
 * - 每个 Provider 的 apiKey 单独存入 SecureStore，key 格式：`provider:${providerId}`
 * - 默认 Provider ID 存入 electron-store 的 'agentDefaultProviderId' 键
 *
 * v2.3.6 修复：listProviders 返回时附带 hasApiKey 标识，方便前端 UI 区分"已配置 Key"和"未配置 Key"。
 *
 * 方案书依据：v0.9 §3 决策 1（Provider 抽象）+ §11.2（IPC 命名规范）
 */
import { ConfigStore } from '../../../services/storage/config-store'
import { SecureStore } from '../../../services/storage/secure-store'
import { logger } from '../../../services/log/logger'
import { PROVIDER_TEMPLATES } from './provider-templates'
import type { ProviderConfig, PersistedProviderConfig, ModelRole } from './types'
import { DEFAULT_PROVIDER_ID } from './types'

/** 持久化键：Provider 列表（不含 apiKey） */
const STORE_KEY_PROVIDERS = 'agentProviders'
/** 持久化键：默认 Provider ID */
const STORE_KEY_DEFAULT_PROVIDER = 'agentDefaultProviderId'
/** SecureStore key 前缀（避免与 LLM API Key 冲突） */
const SECURE_KEY_PREFIX = 'provider:'

/**
 * 初始化 Provider 列表
 *
 * 在首次启动时将预置模板写入持久化存储（仅一次）。
 * 后续启动时合并预置模板与用户自定义：
 * - 预置模板新增（新版本升级）→ 自动追加
 * - 用户自定义 → 保留
 * - 用户禁用预置模板 → 保留 enabled=false 状态
 */
function initializeProviders(): void {
  const existing = loadFromStore()
  if (existing.length === 0) {
    // 首次启动，直接写入所有预置模板
    saveToStore(PROVIDER_TEMPLATES)
    logger.info('AGENT.PROVIDER', `首次初始化 Provider 列表，已写入 ${PROVIDER_TEMPLATES.length} 个预置模板`)
    return
  }
  // 后续启动：合并预置模板（自动追加新增的）与用户配置
  const existingIds = new Set(existing.map((p) => p.id))
  const newTemplates = PROVIDER_TEMPLATES.filter((t) => !existingIds.has(t.id))
  if (newTemplates.length > 0) {
    const merged = [...existing, ...newTemplates]
    saveToStore(merged)
    logger.info('AGENT.PROVIDER', `检测到新版本追加 ${newTemplates.length} 个预置模板`, {
      newIds: newTemplates.map((t) => t.id),
    })
  }
}

/**
 * 从持久化存储加载 Provider 列表
 */
function loadFromStore(): PersistedProviderConfig[] {
  const raw = ConfigStore.get(STORE_KEY_PROVIDERS)
  if (!Array.isArray(raw)) {
    return []
  }
  // 类型校验：仅保留符合结构的条目（防止存储损坏导致运行时错误）
  return raw.filter(
    (item): item is PersistedProviderConfig =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.type === 'string' &&
      typeof item.baseURL === 'string' &&
      typeof item.model === 'string'
  )
}

/**
 * 写入 Provider 列表到持久化存储
 */
function saveToStore(providers: PersistedProviderConfig[]): void {
  ConfigStore.set(STORE_KEY_PROVIDERS, providers)
}

/**
 * Provider 配置（带 API Key 状态）—— listProviders 返回类型
 *
 * v2.3.6 新增：在 PersistedProviderConfig 基础上加 hasApiKey 标识，
 * 前端 UI 用来区分"已配置 API Key"（可直接调用）和"未配置 API Key"（需先配置）。
 *
 * Ollama 本地 Provider 不需要 API Key，hasApiKey 始终为 true（前端无需提示）。
 */
export interface PersistedProviderConfigWithKey extends PersistedProviderConfig {
  /** 是否已配置 API Key（Ollama 本地无 Key 也视为已配置） */
  hasApiKey: boolean
}

/**
 * 检查某个 Provider 是否已配置 API Key
 *
 * Ollama 本地无需 API Key（视为已配置）。其他 Provider 通过 SecureStore 查询。
 *
 * @param id Provider ID
 * @returns 是否已配置 API Key
 */
export function hasProviderApiKey(id: string): boolean {
  // Ollama 本地 Provider 不需要 API Key
  const base = getProvider(id)
  if (base?.type === 'ollama') {
    return true
  }
  const apiKey = SecureStore.getApiKey(`${SECURE_KEY_PREFIX}${id}`)
  return typeof apiKey === 'string' && apiKey.length > 0
}

/**
 * 列出所有 Provider 配置（含用户自定义 + 预置模板，不含 apiKey）
 *
 * v2.3.6 增强：每条返回 PersistedProviderConfigWithKey（含 hasApiKey 标识）。
 * 前端 UI 用 hasApiKey 区分"已配置"与"未配置"（已配置可点选，未配置需先到设置页配置）。
 *
 * @param onlyEnabled 是否仅返回 enabled=true 的 Provider（UI 选择器用）
 */
export function listProviders(onlyEnabled = false): PersistedProviderConfigWithKey[] {
  const providers = loadFromStore()
  if (providers.length === 0) {
    // 兜底：如果存储为空（未初始化），返回预置模板
    initializeProviders()
    return listProviders(onlyEnabled)
  }
  const baseList = onlyEnabled ? providers.filter((p) => p.enabled !== false) : providers
  // 附加 hasApiKey 标识
  return baseList.map((p) => ({ ...p, hasApiKey: hasProviderApiKey(p.id) }))
}

/**
 * 获取指定 Provider 配置（不含 apiKey）
 *
 * @param id Provider ID
 * @returns Provider 配置，未找到返回 null
 */
export function getProvider(id: string): PersistedProviderConfig | null {
  const providers = loadFromStore()
  const found = providers.find((p) => p.id === id)
  return found ?? null
}

/**
 * 获取指定 Provider 的完整配置（含 apiKey，运行时使用）
 *
 * apiKey 从 SecureStore 解密后回填到 config.apiKey。
 *
 * @param id Provider ID
 * @returns 完整 Provider 配置（含 apiKey），未找到返回 null
 */
export function getProviderWithApiKey(id: string): ProviderConfig | null {
  const base = getProvider(id)
  if (!base) {
    return null
  }
  const apiKey = SecureStore.getApiKey(`${SECURE_KEY_PREFIX}${id}`) ?? ''
  return {
    ...base,
    apiKey,
  }
}

/**
 * 注册 / 更新 Provider 配置
 *
 * 如果 config.apiKey 非空，会自动保存到 SecureStore 并清空持久化中的 apiKey 字段。
 *
 * @param config 完整 Provider 配置（含可选 apiKey）
 * @returns 是否成功
 */
export function saveProvider(config: ProviderConfig): boolean {
  try {
    const providers = loadFromStore()
    const idx = providers.findIndex((p) => p.id === config.id)

    // 处理 apiKey：非空时单独存 SecureStore
    const { apiKey, ...persisted } = config
    if (apiKey) {
      SecureStore.saveApiKey(`${SECURE_KEY_PREFIX}${config.id}`, apiKey)
    }
    // void 占位避免未使用警告
    void apiKey

    if (idx >= 0) {
      providers[idx] = persisted
    } else {
      providers.push(persisted)
    }
    saveToStore(providers)
    logger.info('AGENT.PROVIDER', `Provider 已保存`, {
      id: config.id,
      name: config.name,
      type: config.type,
      model: config.model,
    })
    return true
  } catch (err) {
    logger.error('AGENT.PROVIDER', `保存 Provider 失败`, {
      id: config.id,
      error: (err as Error).message,
    })
    return false
  }
}

/**
 * 删除 Provider（仅允许删除用户自定义，预置模板 builtin=true 不可删）
 *
 * @param id Provider ID
 * @returns 是否成功（builtin 模板返回 false）
 */
export function deleteProvider(id: string): boolean {
  const providers = loadFromStore()
  const target = providers.find((p) => p.id === id)
  if (!target) {
    return false
  }
  if (target.builtin) {
    logger.warn('AGENT.PROVIDER', `内置模板不可删除`, { id })
    return false
  }
  const filtered = providers.filter((p) => p.id !== id)
  saveToStore(filtered)
  // 同时清理 SecureStore 中的 apiKey
  SecureStore.deleteApiKey(`${SECURE_KEY_PREFIX}${id}`)
  // 如果删除的是默认 Provider，回退到 DEFAULT_PROVIDER_ID
  if (getDefaultProviderId() === id) {
    setDefaultProviderId(DEFAULT_PROVIDER_ID)
  }
  logger.info('AGENT.PROVIDER', `Provider 已删除`, { id })
  return true
}

/**
 * 获取默认 Provider ID
 *
 * 未设置时回退到 DEFAULT_PROVIDER_ID（deepseek-v4）
 */
export function getDefaultProviderId(): string {
  const id = ConfigStore.get(STORE_KEY_DEFAULT_PROVIDER)
  if (typeof id === 'string' && id) {
    return id
  }
  return DEFAULT_PROVIDER_ID
}

/**
 * 设置默认 Provider ID
 *
 * @param id Provider ID（必须已注册）
 * @returns 是否成功
 */
export function setDefaultProviderId(id: string): boolean {
  const providers = loadFromStore()
  if (!providers.find((p) => p.id === id)) {
    logger.warn('AGENT.PROVIDER', `设置默认 Provider 失败：ID 不存在`, { id })
    return false
  }
  ConfigStore.set(STORE_KEY_DEFAULT_PROVIDER, id)
  logger.info('AGENT.PROVIDER', `默认 Provider 已设置`, { id })
  return true
}

/**
 * 初始化模块（在 app.whenReady 后由 IPC handler 首次调用时触发）
 *
 * 使用 lazy 初始化避免在模块加载时访问 electron-store（需 app.ready 后才能用）
 */
let initialized = false
export function ensureProvidersInitialized(): void {
  if (initialized) {
    return
  }
  initializeProviders()
  initialized = true
}

// ============================================================================
// v0.9.4 批次 2 - 任务 3：按角色查找 Provider
//
// 借鉴 ContinueDev ModelRole 枚举，8 类角色：chat / edit / autocomplete / embedding
// / rerank / preview / apply / summarize。不同任务用不同模型，提升整体效果。
//
// 设计要点：
// - 角色查找是 main 内部工具函数，不暴露 IPC 通道
// - 查找顺序：roles 数组包含该角色的第一个 enabled Provider → 默认 Provider
// - 未找到时返回 null（调用方自行处理）
// ============================================================================

/**
 * 按角色查找 Provider
 *
 * 查找顺序：
 * 1. 遍历 listProviders(true)（仅 enabled），找到第一个 `roles` 数组包含 `role` 的 Provider
 * 2. 未找到匹配角色 → fallback 到默认 Provider（getDefaultProviderId）
 * 3. 默认 Provider 也不存在 → 返回 null
 *
 * 使用场景：
 * - autocomplete 子代理：getProviderByRole('autocomplete') → 优先用本地 Ollama
 * - edit 子代理：getProviderByRole('edit') → 优先用 DeepSeek Coder
 * - 主对话：getProviderByRole('chat') → 优先用 DeepSeek V4
 *
 * @param role 模型角色（chat / edit / autocomplete / embedding / rerank / preview / apply / summarize）
 * @returns 匹配的 Provider 配置，未找到返回 null
 *
 * @example
 * ```ts
 * const editProvider = getProviderByRole('edit')
 * if (editProvider) {
 *   const config = getProviderWithApiKey(editProvider.id)
 *   // 使用 editProvider 生成代码 diff
 * }
 * ```
 */
export function getProviderByRole(role: ModelRole): PersistedProviderConfig | null {
  // 步骤 1：遍历 enabled Provider，查找 roles 包含该角色的第一个
  const providers = listProviders(true)
  for (const p of providers) {
    if (Array.isArray(p.roles) && p.roles.includes(role)) {
      logger.debug(
        'AGENT.PROVIDER',
        '按角色匹配 Provider',
        {
          role,
          providerId: p.id,
          providerName: p.name,
        }
      )
      return p
    }
  }

  // 步骤 2：fallback 到默认 Provider
  const defaultId = getDefaultProviderId()
  const defaultProvider = providers.find((p) => p.id === defaultId) ?? null
  if (defaultProvider) {
    logger.debug(
      'AGENT.PROVIDER',
      '角色匹配 fallback 到默认 Provider',
      {
        role,
        defaultProviderId: defaultId,
      }
    )
  } else {
    logger.warn(
      'AGENT.PROVIDER',
      '角色匹配失败（无匹配角色且默认 Provider 不存在）',
      { role, defaultProviderId: defaultId }
    )
  }
  return defaultProvider
}
