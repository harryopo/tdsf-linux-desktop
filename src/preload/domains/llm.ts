/** llm 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { LlmConfig, LlmTestResult } from '@shared/models'
import type { CostStats, PersistedProviderConfig, ProviderConfig, TokenStats, TokenUsageRecord } from '@shared/agent-types'
import { LLM, PROVIDER, TOKEN } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import { invokeChecked } from '../ipc-util'

/**
 * LLM 相关 invoke 调用（只剩"测试连接"：主对话走 agent:chat，
 * 裸 llm:chat / llm:analyze / llm:validate / llm:chat-with-context 四条随 ipc/llm.ts 一起删）
 */
const llm = {
  /**
   * 测试连接
   *
   * 返回 LlmTestResult 而不是 boolean：主进程 v2.3.4 起就返回
   * { ok, latency, error?, code? }（见 src/main/ipc/llm.ts 的 LLM.TEST handler），
   * 这里当时漏改，UI 读 result.ok / result.latency 全靠渲染层手写声明兜着。
   */
  test: (config: LlmConfig): Promise<LlmTestResult> =>
    ipcRenderer.invoke(LLM.TEST, config),
}

/**
 * v0.9 Provider 管理 invoke 调用（Provider 抽象层）
 */
const provider = {
  /** 列出所有 Provider 配置（不含 apiKey） */
  list: (onlyEnabled?: boolean): Promise<PersistedProviderConfig[]> =>
    invokeChecked<PersistedProviderConfig[]>('providerList', PROVIDER.LIST, onlyEnabled),

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
// - 通道命名规范：kebab-case（如 token:cost-stats / mode:list / agent:chat）
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
 * Provider Info 那一族查询口已于 2026-10-24 整删（#210）。
 *
 * 判据是"那件事本来就由谁做"：能力已经随 provider:list 带出（界面读的那一份由
 * provider-registry 里的 getProviderCapabilities 解析），成本由主进程按同一张
 * PROVIDER_PRICING 算好、经 token:cost-stats 回一个数。这四把键（capabilities /
 * capabilities-all / pricing / pricing-all）渲染层一次都没调，留着等于给同一份
 * 知识开第二个出口——将来谁改了 provider:list 的形状，这里会静默给出旧答案。
 * 判据：tests/unit/provider-ipc-surface.test.ts
 */

export { llm, provider, token, tokenCostStats }
