/** llm 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { ChatMessage, EnvironmentContext, LlmConfig, LlmTestResult, LlmValidationResult } from '@shared/models'
import type { CostStats, PersistedProviderConfig, ProviderCapabilitiesAllResponse, ProviderCapabilitiesRequest, ProviderCapabilitiesResponse, ProviderConfig, ProviderPricingAllResponse, ProviderPricingRequest, ProviderPricingResponse, TokenStats, TokenUsageRecord } from '@shared/agent-types'
import { LLM, PROVIDER, TOKEN } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import { invokeChecked } from '../ipc-util'

/**
 * LLM 相关 invoke 调用
 */
const llm = {
  /** 普通对话（流式推送 token，返回完整文本） */
  chat: (messages: ChatMessage[]): Promise<string> =>
    ipcRenderer.invoke(LLM.CHAT, messages),

  /**
   * 测试连接
   *
   * 返回 LlmTestResult 而不是 boolean：主进程 v2.3.4 起就返回
   * { ok, latency, error?, code? }（见 src/main/ipc/llm.ts 的 LLM.TEST handler），
   * 这里当时漏改，UI 读 result.ok / result.latency 全靠渲染层手写声明兜着。
   */
  test: (config: LlmConfig): Promise<LlmTestResult> =>
    ipcRenderer.invoke(LLM.TEST, config),

  /** 分析问题（内置降级，返回 JSON 字符串） */
  analyze: (problem: string, evidences: unknown[]): Promise<string> =>
    ipcRenderer.invoke(LLM.ANALYZE, problem, evidences),

  /** 校验 LLM 配置是否有效（不发起网络请求） */
  validate: (config: LlmConfig): Promise<LlmValidationResult> =>
    ipcRenderer.invoke(LLM.VALIDATE, config),

  /** 带系统环境上下文的对话 */
  chatWithContext: (messages: ChatMessage[], envCtx: EnvironmentContext): Promise<string> =>
    ipcRenderer.invoke(LLM.CHAT_WITH_CONTEXT, messages, envCtx),
}

/**
 * v0.9 Provider 管理 invoke 调用（Provider 抽象层）
 */
const provider = {
  /** 列出所有 Provider 配置（不含 apiKey） */
  list: (onlyEnabled?: boolean): Promise<PersistedProviderConfig[]> =>
    invokeChecked<PersistedProviderConfig[]>('providerList', PROVIDER.LIST, onlyEnabled),

  /** 获取指定 Provider 配置（不含 apiKey） */
  get: (id: string): Promise<PersistedProviderConfig | null> =>
    invokeChecked<PersistedProviderConfig | null>('providerGet', PROVIDER.GET, id),

  /** 保存 / 更新 Provider 配置（apiKey 自动走 SecureStore 加密） */
  save: (config: ProviderConfig): Promise<boolean> =>
    invokeChecked<boolean>('providerSave', PROVIDER.SAVE, config),

  /** 设置默认 Provider ID */
  setDefault: (id: string): Promise<boolean> =>
    invokeChecked<boolean>('providerSetDefault', PROVIDER.SET_DEFAULT, id),

  /** 获取默认 Provider ID（P0 修复：渲染层不再盲写 providers[0]） */
  getDefault: (): Promise<string> =>
    invokeChecked<string>('providerGetDefault', PROVIDER.GET_DEFAULT),
}

/**
 * v0.9 Token 统计 invoke 调用
 */
const token = {
  /** 获取 token 统计聚合（当日/当周/当月/总 + 按 Subagent/Provider 分布） */
  stats: (): Promise<TokenStats> =>
    ipcRenderer.invoke(TOKEN.STATS),

  /** 重置 token 统计（清空所有记录） */
  reset: (): Promise<boolean> =>
    ipcRenderer.invoke(TOKEN.RESET),

  /**
   * 获取 token 使用明细记录（P-5 新增）
   *
   * @param limit 返回最近 N 条记录，默认 100，上限 1000
   * @returns TokenUsageRecord[]（按时间正序，最近一条在末尾）
   */
  records: (limit?: number): Promise<TokenUsageRecord[]> =>
    ipcRenderer.invoke(TOKEN.RECORDS, limit),
}

// ============================================================================
// v0.9.5 P0 新增：5 组缺失 IPC 通道（成本透明 / 模式切换 / 注意力 / Subagent / Provider 信息）
//
// 设计原则：
// - 与现有 token / provider / agentRuntime 等模块保持一致的代码风格
// - 每个对象封装对应 IPC 通道，方法名与通道名一一对应（去除前缀后驼峰化）
// - 仅做 IPC 包装：调用 ipcRenderer.invoke，不做业务逻辑
// - 通道命名规范：kebab-case（如 token:cost-stats / mode:list / attention:track-files）
// ============================================================================

/**
 * v0.9.5 P0 - 组 1：Token 成本透明 invoke 调用
 *
 * 通道与主进程 ipc/token-stats.ts 一一对应：
 * - token:cost-stats → costStats（按时间维度 + Subagent 维度 + Provider 维度聚合 USD 成本）
 *
 * 使用场景：
 * - Token 监控面板展示累计成本（USD）
 * - 让用户对消费有直观感知（今日 $X.XX / 本月 $X.XX）
 *
 * 与现有 token.stats（token 数量）的区别：
 * - token.stats 返回 TokenStats（token 数）
 * - tokenCostStats 返回 CostStats（USD 成本，由 main 进程按 Provider 定价回退计算）
 */
const tokenCostStats = {
  /**
   * 获取累计成本统计（USD）
   *
   * @returns CostStats（含 todayCost/weekCost/monthCost/totalCost + bySubagent/byProvider）
   */
  costStats: (): Promise<CostStats> =>
    ipcRenderer.invoke(TOKEN.COST_STATS),
}

/**
 * v0.9.5 P0 - 组 5：Provider Info 能力 + 定价透明 invoke 调用
 *
 * 通道与主进程 ipc/provider-info.ts 一一对应：
 * - provider:capabilities      → capabilities（指定 provider 的能力声明）
 * - provider:capabilities-all  → capabilitiesAll（所有 provider 类型的能力声明默认表）
 * - provider:pricing           → pricing（指定 provider 的定价表）
 * - provider:pricing-all       → pricingAll（所有 provider 类型的定价表默认表）
 *
 * 与现有 provider.list / provider.get / provider.save / provider.setDefault 的区别：
 * - provider.* 通道用于 Provider 配置 CRUD
 * - providerInfo.* 通道用于查询 Provider 的能力 + 定价（只读，不含敏感信息）
 *
 * 使用场景：
 * - UI 显示能力图标（如 🔄 streaming / 🔧 toolCall / 👁 vision / 📏 contextWindow）
 * - UI 显示 Provider 累计成本（如本月已消费 $X.XX）+ 成本告警
 * - Provider 配置页显示默认能力 + 定价说明表格
 */
const providerInfo = {
  /**
   * 查询指定 provider 的能力声明
   *
   * @param request { providerId: string }
   * @returns ProviderCapabilities | null（Provider 不存在时返回 null）
   */
  capabilities: (request: ProviderCapabilitiesRequest): Promise<ProviderCapabilitiesResponse> =>
    ipcRenderer.invoke(PROVIDER.CAPABILITIES, request),

  /**
   * 查询所有 provider 类型的能力声明默认表
   *
   * @returns Record<string, ProviderCapabilities>（按 ProviderType 索引）
   */
  capabilitiesAll: (): Promise<ProviderCapabilitiesAllResponse> =>
    ipcRenderer.invoke(PROVIDER.CAPABILITIES_ALL),

  /**
   * 查询指定 provider 的定价表
   *
   * @param request { providerId: string }
   * @returns ModelPricing | null（Provider 不存在时返回 null）
   */
  pricing: (request: ProviderPricingRequest): Promise<ProviderPricingResponse> =>
    ipcRenderer.invoke(PROVIDER.PRICING, request),

  /**
   * 查询所有 provider 类型的定价表默认表
   *
   * @returns Record<string, ModelPricing>（按 ProviderType 索引）
   */
  pricingAll: (): Promise<ProviderPricingAllResponse> =>
    ipcRenderer.invoke(PROVIDER.PRICING_ALL),
}

export { llm, provider, token, tokenCostStats, providerInfo }
