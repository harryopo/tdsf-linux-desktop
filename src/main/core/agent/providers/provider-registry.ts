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
import { assertSafeApiBaseUrl } from '../../../services/security/url-policy'
import { PROVIDER_TEMPLATES, SUPERSEDED_MODEL_IDS } from './provider-templates'
import { PROVIDER_CAPABILITIES, getProviderCapabilities } from './provider-capabilities'
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
 * 后续启动时按 id 双向对账：
 * - 预置模板新增（版本升级）→ 自动追加
 * - 用户自定义（builtin 非 true）→ 原样保留，绝不删
 * - 用户禁用过预置模板 → 保留 enabled=false 状态
 * - **预置模板在本版本被移除 → 一并删掉**（2026-10-10 补）
 *
 * 为什么要删而不是留着：只追加不删的话，"精简清单"对老用户永远不生效——
 * 2026-10-10 复核时确认旧实现只有一句 `filter((t) => !existingIds.has(t.id))`，
 * 删条目等于只删了"以后不再新增"。删的时候两件事必须跟着做：
 * 它的 apiKey 从 SecureStore 一起清掉（留着一把指向不存在 Provider 的密钥是纯债），
 * 默认指针若正指着它要回退（否则 getProviderWithApiKey 拿到 null，AI 直接不可用）。
 */
function initializeProviders(): void {
  const rawStored = ConfigStore.get(STORE_KEY_PROVIDERS)
  const rawIsEmpty = !Array.isArray(rawStored) || rawStored.length === 0
  const existing = loadFromStore()
  if (existing.length === 0 && rawIsEmpty) {
    // 首次启动，直接写入所有预置模板
    saveToStore(PROVIDER_TEMPLATES)
    logger.info('AGENT.PROVIDER', `首次初始化 Provider 列表，已写入 ${PROVIDER_TEMPLATES.length} 个预置模板`)
    return
  }

  const templateIds = new Set(PROVIDER_TEMPLATES.map((t) => t.id))
  const existingIds = new Set(existing.map((p) => p.id))
  const additions = PROVIDER_TEMPLATES.filter((t) => !existingIds.has(t.id))
  // 只删 builtin === true 的：字段缺失（老版本写的数据）一律当用户自建处理
  //
  // 退役**类型**的内置条目不在 `existing` 里（loadFromStore 读的时候就摘掉了），
  // 但它们的 Key 还留在 SecureStore。这里按原始存储再捞一次，只清内置的：
  // 用户自建的那些读时忽略、但不写回（兼容规则见 loadFromStore 的注释）。
  const liveTypes = new Set(Object.keys(PROVIDER_CAPABILITIES))
  const retiredTypeBuiltins: PersistedProviderConfig[] = Array.isArray(rawStored)
    ? rawStored.filter(
        (p): p is PersistedProviderConfig =>
          !!p &&
          typeof p === 'object' &&
          (p as PersistedProviderConfig).builtin === true &&
          typeof (p as PersistedProviderConfig).type === 'string' &&
          !liveTypes.has((p as PersistedProviderConfig).type),
      )
    : []

  const removed = [
    ...existing.filter((p) => p.builtin === true && !templateIds.has(p.id)),
    ...retiredTypeBuiltins,
  ]

  const templateById = new Map(PROVIDER_TEMPLATES.map((t) => [t.id, t]))
  let refreshed = 0
  const rectified = existing.map((p) => {
    if (p.builtin !== true) return p
    const tpl = templateById.get(p.id)
    if (!tpl) return p
    const next = refreshBuiltin(p, tpl)
    if (!next) return p
    if (JSON.stringify(next) === JSON.stringify(p)) return p
    refreshed += 1
    return next
  })

  if (additions.length === 0 && removed.length === 0 && refreshed === 0) {
    return
  }

  const removedIds = new Set(removed.map((p) => p.id))
  const merged = [...rectified.filter((p) => !removedIds.has(p.id)), ...additions]
  saveToStore(merged)

  for (const p of removed) {
    SecureStore.deleteApiKey(`${SECURE_KEY_PREFIX}${p.id}`)
  }

  // 默认指针悬空回退：优先回到 DEFAULT_PROVIDER_ID，它也被删了就退回列表首条
  const survivingIds = new Set(merged.map((p) => p.id))
  if (!survivingIds.has(getDefaultProviderId())) {
    const fallback = survivingIds.has(DEFAULT_PROVIDER_ID)
      ? DEFAULT_PROVIDER_ID
      : (merged[0]?.id ?? '')
    if (fallback) {
      setDefaultProviderId(fallback)
    }
  }

  if (removed.length > 0) {
    logger.info('AGENT.PROVIDER', `按本版本模板表移除 ${removed.length} 个内置 Provider`, {
      removedIds: removed.map((p) => p.id),
    })
  }
  if (additions.length > 0) {
    logger.info('AGENT.PROVIDER', `检测到新版本追加 ${additions.length} 个预置模板`, {
      newIds: additions.map((t) => t.id),
    })
  }
  if (refreshed > 0) {
    logger.info('AGENT.PROVIDER', `内置 Provider 换代 ${refreshed} 条（型号/能力按新模板对齐）`)
  }
}

/**
 * 内置条目的换代规则（2026-10-28）
 *
 * 只做 prune + 追加的话，老用户库里那条 `kimi-k3` 会一直留着——模板表改了，
 * 设置里却还显示上一代的型号。所以按存储里那份型号分三档处理：
 * - 型号已被取代（SUPERSEDED_MODEL_IDS）→ 换成模板这一代（名称/地址/型号/角色/能力）
 * - 型号与模板一致 → 只补模板侧字段（能力、角色），型号本身不动
 * - 其它（用户自己改过型号或地址）→ 原样返回，换代不许覆盖他的选择
 *
 * `enabled` 与 apiKey 始终保留：换代不是删档，用户关掉的开关也不能被顺手打开。
 */
function refreshBuiltin(
  p: PersistedProviderConfig,
  tpl: ProviderConfig,
): PersistedProviderConfig | null {
  const superseded = SUPERSEDED_MODEL_IDS.includes(p.model)
  if (!superseded && p.model !== tpl.model) return null

  const next: PersistedProviderConfig = {
    ...p,
    name: tpl.name,
    type: tpl.type,
    baseURL: tpl.baseURL,
    model: tpl.model,
    roles: tpl.roles,
  }
  // 温度这类参数只在真的换型号时跟着换；同一个型号下那是用户自己的调参，别覆盖
  if (superseded && tpl.defaultParams) next.defaultParams = tpl.defaultParams
  if (tpl.capabilities) next.capabilities = tpl.capabilities
  return next
}

/**
 * 同一批退役类型只说一次。
 *
 * loadFromStore 是读路径，一次会话里被调几十次是常态：2026-10-16 用户实测的日志里，
 * 这条告警 11 分钟刷了 151 次（占当天新增日志的三分之二），把同时段真正的
 * "chat 调用失败"埋掉了——日志吵不等于信息多，吵到看不见才是事故。
 * 过滤本身照旧每次做（不动用户存的数据，只是不让它参与本轮对话），
 * 但"请在设置里重选模型"这句话对用户只能说一次。
 */
let retiredTypeWarned = false

/**
 * 从持久化存储加载 Provider 列表
 *
 * 两道过滤，顺序不能反：
 * 1. 结构校验：字段不齐的条目丢掉（防存储损坏）。
 * 2. 类型校验：type 不在 PROVIDER_CAPABILITIES 表里的丢掉并留话。
 *    这一条是给"退役的 Provider 类型"用的：本版本撤掉了 claude-sdk（Claude Agent SDK
 *    非开源、只认 Anthropic 模型），但用户机器上可能还存着那条配置。留着它的后果是
 *    聊天时 createLanguageModel 走到 default 分支抛"不支持的 Provider 类型"，
 *    用户只看到一次失败；现在改成加载时摘掉，并在日志里说清摘了谁。
 *    摘是"读的时候不认它"，不写回存储——万一这行是新版程序写的（向后兼容），
 *    老程序不该顺手删掉用户配置。
 */
function loadFromStore(): PersistedProviderConfig[] {
  const raw = ConfigStore.get(STORE_KEY_PROVIDERS)
  if (!Array.isArray(raw)) {
    return []
  }
  const shaped = raw.filter(
    (item): item is PersistedProviderConfig =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.type === 'string' &&
      typeof item.baseURL === 'string' &&
      typeof item.model === 'string',
  )
  const liveTypes = new Set(Object.keys(PROVIDER_CAPABILITIES))
  const retired = shaped.filter((p) => !liveTypes.has(p.type))
  if (retired.length > 0 && !retiredTypeWarned) {
    retiredTypeWarned = true
    logger.warn(
      'AGENT.PROVIDER',
      `本次会话忽略 ${retired.length} 条已退役的 Provider 类型，请在设置里重选模型`,
      { retired: retired.map((p) => ({ id: p.id, type: p.type })) },
    )
  }
  return shaped.filter((p) => liveTypes.has(p.type))
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
 */
export interface PersistedProviderConfigWithKey extends PersistedProviderConfig {
  /** 是否已配置 API Key */
  hasApiKey: boolean
}

/**
 * 检查某个 Provider 是否已配置 API Key
 *
 * 所有内置 Provider 都是云服务，一律通过 SecureStore 查询。
 *
 * @param id Provider ID
 * @returns 是否已配置 API Key
 */
export function hasProviderApiKey(id: string): boolean {
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
  // 附加 hasApiKey 标识 + 解析后的能力声明
  // #89：capabilities 在这里按单源表补全带出去，渲染层的上下文徽章才有真实窗口分母，
  // 不必把 PROVIDER_CAPABILITIES 手抄一份到渲染层（手抄迟早和默认表分叉）。
  return baseList.map((p) => ({
    ...p,
    hasApiKey: hasProviderApiKey(p.id),
    capabilities: getProviderCapabilities(p),
  }))
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
    // 运行时这份也要带能力表：supervisor 拿 config.capabilities?.contextWindow 决定何时压缩，
    // 不补的话 8K 模型仍按 150K 绝对尺，请求先被上游拒成 400，而徽章显示的是真窗口。
    capabilities: getProviderCapabilities(base),
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
/**
 * 运行时派生字段不许进存储（#89）
 *
 * provider:list 现在恒带两样算出来的东西：hasApiKey（查 SecureStore）与
 * capabilities（按类型查能力表）。而 ModelSettings 的"同步到默认 Provider"是
 * providerSave({...target, ...}) 整条回写，不剥掉就会把默认表冻进存储 ——
 * 以后能力表更新（比如把某模型窗口从 64K 提到 128K）对老用户永久失效，
 * 界面上那个上下文徽章也跟着一直按旧分母算。
 * 只保留用户真写过的覆盖。
 */
function stripDerivedFields(p: PersistedProviderConfig): PersistedProviderConfig {
  const { hasApiKey: _hasApiKey, capabilities, ...rest } = p as PersistedProviderConfig & {
    hasApiKey?: boolean
  }
  const def = PROVIDER_CAPABILITIES[p.type]
  const isOverride =
    !!capabilities &&
    !!def &&
    (capabilities.streaming !== def.streaming ||
      capabilities.toolCall !== def.toolCall ||
      capabilities.vision !== def.vision ||
      capabilities.contextWindow !== def.contextWindow ||
      capabilities.logprobs !== def.logprobs)
  return isOverride ? { ...rest, capabilities } : rest
}

export function saveProvider(config: ProviderConfig): boolean {
  try {
    // baseURL 是"真 API Key 要发到哪里"的那个值，而渲染层能写它。
    // 老只在这条路的其中一边（config:saveLlm）做策略，provider:save 直接落库，
    // resolveLlmConfig 又会把 SecureStore 里的真 key 拼回来 —— 等于改一次 baseURL
    // 就把用户的 live key 寄到任意主机。策略收在写入口，两条路共用一道闸。
    if (config.baseURL) {
      const policy = assertSafeApiBaseUrl(config.baseURL)
      if (!policy.ok) {
        logger.warn('AGENT.PROVIDER', 'Provider baseURL 被策略拒绝，整条不写', {
          id: config.id,
          reason: policy.reason,
        })
        return false
      }
    }

    const providers = loadFromStore()
    const idx = providers.findIndex((p) => p.id === config.id)

    // 处理 apiKey：非空时单独存 SecureStore；派生字段（hasApiKey / 与默认表相同的能力声明）不落存储
    const { apiKey, ...rest } = config
    const persisted = stripDerivedFields(rest) as PersistedProviderConfig
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
 * - autocomplete 子代理：getProviderByRole('autocomplete') → 优先用 GLM 5.3 Flash
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
