/**
 * Provider 能力声明（v0.9.4 批次 2 - 任务 4）
 *
 * 职责：
 * - 为每个 ProviderType 提供默认能力声明（streaming / toolCall / vision / contextWindow）
 * - 提供 getProviderCapabilities(config) 函数：优先用 config.capabilities（用户自定义），
 *   否则用 PROVIDER_CAPABILITIES[config.type]（默认）
 *
 * 借鉴：ContinueDev BaseLLM.capabilities 4 能力声明
 * - 源码分析：`idea-to-dev-output/30-源码分析-ContinueDev-多模型调度与代码库索引.md`
 *
 * 设计要点：
 * - 不修改 IPC 通道（capability 查询是 main 内部工具函数）
 * - 默认能力表基于公开文档（2024-2025）
 * - 用户可通过 ProviderConfig.capabilities 显式覆盖
 *
 * 方案书依据：v0.9.3 §11 第 2 类（Provider 工厂增强）第 2.4 项
 */
import type { ProviderCapabilities, ProviderType, PersistedProviderConfig } from './types'

/**
 * 默认 Provider 能力表（按 ProviderType 给默认值）
 *
 * 数据来源（公开文档 2024-2025）：
 * - anthropic：Claude Sonnet/Opus 支持 streaming/toolCall/vision，上下文 200K
 * - google：Gemini Pro 支持 streaming/toolCall/vision，上下文 1M
 * - openai-compatible：通用 OpenAI 兼容协议，假设支持 streaming/toolCall，无 vision，上下文 8K（保守默认）
 * - deepseek：支持 streaming/toolCall，无 vision（DeepSeek-VL 已停用），上下文 64K
 * - qwen：通义千问 Max 支持 streaming/toolCall/vision（qwen-vl），上下文 256K
 * - volcengine-ark：火山方舟豆包支持 streaming/toolCall，无 vision，上下文 32K
 * - ollama：本地推理支持 streaming，toolCall 视模型而定（保守默认 false），无 vision，上下文 8K
 * - claude-sdk：Claude Agent SDK 等同 anthropic，支持 streaming/toolCall/vision，上下文 200K
 *
 * 注意：contextWindow=0 表示未知，调用方应做防御性处理。
 */
export const PROVIDER_CAPABILITIES: Record<ProviderType, ProviderCapabilities> = {
  anthropic: {
    streaming: true,
    toolCall: true,
    vision: true,
    contextWindow: 200_000,
  },
  google: {
    streaming: true,
    toolCall: true,
    vision: true,
    contextWindow: 1_000_000,
  },
  'openai-compatible': {
    streaming: true,
    toolCall: true,
    vision: false,
    contextWindow: 8_000,
  },
  deepseek: {
    streaming: true,
    toolCall: true,
    vision: false,
    contextWindow: 64_000,
  },
  qwen: {
    streaming: true,
    toolCall: true,
    vision: true,
    contextWindow: 256_000,
  },
  'volcengine-ark': {
    streaming: true,
    toolCall: true,
    vision: false,
    contextWindow: 32_000,
  },
  ollama: {
    streaming: true,
    toolCall: false,
    vision: false,
    contextWindow: 8_000,
  },
  'claude-sdk': {
    streaming: true,
    toolCall: true,
    vision: true,
    contextWindow: 200_000,
  },
}

/**
 * 获取 Provider 的能力声明
 *
 * 优先级：
 * 1. config.capabilities（用户自定义）→ 直接返回（深拷贝避免污染原对象）
 * 2. PROVIDER_CAPABILITIES[config.type]（默认表）→ 返回默认值
 *
 * 使用场景：
 * - UI 显示能力图标（如 🔄 streaming / 🔧 toolCall / 👁 vision / 📏 contextWindow）
 * - 调用方按能力选择 Provider（如 autocomplete 需 streaming，edit 需 toolCall）
 * - 上下文压缩前检查 contextWindow，决定是否触发 compaction
 *
 * @param config Provider 配置（PersistedProviderConfig 或 ProviderConfig 均可）
 * @returns Provider 能力声明（始终非空）
 *
 * @example
 * ```ts
 * const caps = getProviderCapabilities(provider)
 * if (!caps.streaming) {
 *   throw new Error('该 Provider 不支持流式输出')
 * }
 * if (tokens > caps.contextWindow) {
 *   // 触发上下文压缩
 * }
 * ```
 */
export function getProviderCapabilities(
  config: PersistedProviderConfig
): ProviderCapabilities {
  // 优先用用户自定义 capabilities
  if (config.capabilities) {
    return { ...config.capabilities }
  }
  // 否则用默认表
  const defaults = PROVIDER_CAPABILITIES[config.type]
  return { ...defaults }
}
