/**
 * Provider 抽象层 - 类型定义
 *
 * 职责：
 * - 定义统一的 ProviderConfig 接口（所有模型后端共用）
 * - 定义 ProviderType 枚举（区分不同厂商的创建逻辑）
 * - 定义思考强度三档（fast / standard / deep）
 * - 定义 Token 统计接口
 *
 * 设计原则：
 * - 所有模型后端实现统一接口，可热切换（Provider 抽象）
 * - API Key 单独走 SecureStore 加密存储（不进 ProviderConfig 明文）
 * - baseURL/model 等可由用户覆盖（预置模板 + 自定义）
 *
 * 共享类型（ProviderConfig / ProviderType / ThinkingStrength /
 * TokenUsageRecord / TokenStats / DEFAULT_PROVIDER_ID）已迁移到 @shared/agent-types.ts，
 * 供 preload 和 renderer 共享导入。本文件 re-export 保持 main 内部 import 路径不变。
 *
 * 方案书依据：v0.9 §3 决策 3（模型后端策略）+ §6（思考强度）
 */
import type { LanguageModel } from 'ai'

// Re-export 共享类型（保持 main 内部 `from './types'` / `from '../providers/types'` 路径不变）
//
// v2.3.7 修复：移除 `PersistedProviderConfigWithKey` 的 re-export —— 该类型实际在
// `provider-registry.ts` 中本地定义（仅 main 进程使用），并未迁移到 @shared。
// 错误地 re-export 会导致 main 端 tsc 编译失败（"no exported member"）。
export type {
  ProviderType,
  ThinkingStrength,
  ProviderConfig,
  PersistedProviderConfig,
  TokenUsageRecord,
  TokenStats,
  // v0.9.4 批次 2 新增类型（任务 2-5）
  ModelRole,
  ModelRoleMapping,
  ProviderCapabilities,
  ModelPricing,
} from '@shared/agent-types'

// Re-export 共享常量（DEFAULT_PROVIDER_ID 是值导出，需要 export ... from 语法）
export { DEFAULT_PROVIDER_ID } from '@shared/agent-types'

// 便捷类型别名（main 内部使用，避免每次都写 import type）
import type { PersistedProviderConfig } from '@shared/agent-types'

/**
 * Provider 工厂创建结果
 *
 * 包含 LanguageModel 实例 + 元信息（用于日志和统计）。
 * LanguageModel 是 'ai' SDK 的运行时类型，仅 main 进程使用，不放入 @shared。
 */
export interface ProviderModelInstance {
  /** LanguageModel 实例（@ai-sdk/* 创建） */
  model: LanguageModel
  /** 来源 Provider 配置（脱敏后，不含 apiKey） */
  config: PersistedProviderConfig
  /** 实际使用的模型名（可能被用户覆盖） */
  resolvedModel: string
}
