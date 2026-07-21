/**
 * Provider 工厂
 *
 * 职责：根据 ProviderConfig.type 创建对应的 LanguageModel 实例
 *
 * 支持的 Provider 类型：
 * - openai-compatible / deepseek / qwen / volcengine-ark / ollama → 用 @ai-sdk/openai createOpenAI（OpenAI 兼容协议）
 * - anthropic → 用 @ai-sdk/anthropic createAnthropic（Claude 原生协议）
 * - google → 用 @ai-sdk/google createGoogleGenerativeAI（Gemini 原生协议）
 * - claude-sdk → 不创建 LanguageModel，抛错引导改用 ClaudeSdkProvider（agent loop 模式）
 *
 * 设计要点：
 * - 所有网络请求必须有日志（Hard Constraint 5）
 * - API Key 缺失时抛出明确错误（不静默降级到 mock）
 * - baseURL 为空时使用 @ai-sdk/* 各自的默认值（仅 anthropic/google 有默认）
 * - claude-sdk 类型不通过此工厂创建（agent loop 与 LanguageModelV2 单次调用契约不兼容）
 *
 * 方案书依据：v0.9 §3 决策 1（Mastra + AI SDK 7 组合）+ 调研文档 §8（Claude Agent SDK 集成）
 */
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { ProviderConfig, ProviderModelInstance, PersistedProviderConfig } from './types'
import { logger } from '../../../services/log/logger'

/**
 * 创建 LanguageModel 实例
 *
 * 根据 ProviderConfig.type 分发到对应的 @ai-sdk/* 工厂函数。
 * 所有 OpenAI 兼容协议（deepseek/qwen/volcengine-ark/ollama/openai-compatible）
 * 统一用 createOpenAI 创建。
 *
 * 特殊处理：
 * - `claude-sdk` 类型抛错（agent loop 不适配 LanguageModelV2 单次调用契约），
 *   调用方应改用 `ClaudeSdkProvider` + `claude-sdk:generate` / `claude-sdk:stream` IPC。
 *
 * @param config Provider 配置（必须含 apiKey）
 * @returns LanguageModel 实例 + 元信息
 * @throws Error 如果 apiKey 缺失、baseURL 无效，或 type='claude-sdk'
 */
export function createLanguageModel(config: ProviderConfig): ProviderModelInstance {
  // claude-sdk 走独立路径，不通过此工厂创建 LanguageModel
  if (config.type === 'claude-sdk') {
    throw new Error(
      `Provider "${config.name}" (${config.id}) 类型为 'claude-sdk'，` +
        '不通过 createLanguageModel 创建（agent loop 与 LanguageModelV2 单次调用契约不兼容）。' +
        '请改用 ClaudeSdkProvider + claude-sdk:generate / claude-sdk:stream IPC 通道。'
    )
  }

  if (!config.apiKey && config.type !== 'ollama') {
    // Ollama 本地无需 apiKey
    throw new Error(
      `Provider "${config.name}" (${config.id}) 缺少 API Key，请在设置中配置`
    )
  }
  if (!config.baseURL && config.type !== 'anthropic' && config.type !== 'google') {
    // anthropic / google 有 SDK 默认 baseURL
    throw new Error(
      `Provider "${config.name}" (${config.id}) 缺少 baseURL，请在设置中配置`
    )
  }
  if (!config.model) {
    throw new Error(
      `Provider "${config.name}" (${config.id}) 缺少模型名，请在设置中配置`
    )
  }

  const model = buildModel(config)
  logger.info('AGENT.PROVIDER', `LanguageModel 已创建`, {
    id: config.id,
    name: config.name,
    type: config.type,
    model: config.model,
    baseURL: config.baseURL,
  })

  // 返回时脱敏（不暴露 apiKey）
  const persisted: PersistedProviderConfig = {
    id: config.id,
    name: config.name,
    type: config.type,
    baseURL: config.baseURL,
    model: config.model,
    defaultParams: config.defaultParams,
    builtin: config.builtin,
    enabled: config.enabled,
  }

  return {
    model,
    config: persisted,
    resolvedModel: config.model,
  }
}

/**
 * 内部分发：根据 type 调用对应的 @ai-sdk/* 工厂
 *
 * 注意：`claude-sdk` 类型已在 createLanguageModel 入口处提前抛错拦截，
 * 不会进入此 switch。default 分支的类型穷尽性检查仍会覆盖它。
 *
 * @param config Provider 配置
 * @returns LanguageModel 实例
 */
function buildModel(config: ProviderConfig): LanguageModel {
  switch (config.type) {
    case 'anthropic': {
      // Claude 直连（含 AWS Bedrock 兜底场景）
      const anthropic = createAnthropic({
        apiKey: config.apiKey!,
        baseURL: config.baseURL || undefined, // SDK 默认指向 https://api.anthropic.com
      })
      return anthropic(config.model)
    }
    case 'google': {
      // Google Gemini 直连
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey!,
        baseURL: config.baseURL || undefined, // SDK 默认指向 https://generativelanguage.googleapis.com
      })
      return google(config.model)
    }
    case 'openai-compatible':
    case 'deepseek':
    case 'qwen':
    case 'volcengine-ark':
    case 'ollama': {
      // 全部走 OpenAI 兼容协议（绝大多数国产模型都兼容）
      const openai = createOpenAI({
        apiKey: config.apiKey || 'ollama', // Ollama 默认无需 key，但 SDK 要求非空
        baseURL: config.baseURL,
      })
      return openai(config.model)
    }
    case 'claude-sdk': {
      // 已在 createLanguageModel 入口处拦截，理论不会到达；防御性抛错
      throw new Error(
        `Provider "${config.name}" (${config.id}) 类型为 'claude-sdk'，` +
          '请改用 ClaudeSdkProvider + claude-sdk:generate / claude-sdk:stream IPC 通道。'
      )
    }
    default: {
      // 类型穷尽性检查（编译器保证所有 case 已处理）
      const _exhaustive: never = config.type
      void _exhaustive
      throw new Error(`不支持的 Provider 类型: ${config.type}`)
    }
  }
}

/**
 * 获取 Provider 的默认参数（temperature / maxTokens）
 *
 * 用于 streamText 调用时的参数回填。
 *
 * @param config Provider 配置
 * @returns 默认参数（始终非空，缺失时回退到 0.7 / 2048）
 */
export function getDefaultParams(config: PersistedProviderConfig): {
  temperature: number
  maxTokens: number
} {
  const params = config.defaultParams ?? {}
  return {
    temperature: params.temperature ?? 0.7,
    maxTokens: params.maxTokens ?? 2048,
  }
}

// ============================================================================
// v0.9.4 批次 2 - 任务 2：selectedModels fallback
//
// 借鉴 ContinueDev selectedModels 字段，支持 fallback 链：
// 当主 Provider 调用失败（网络/超时/限流/模型不可用），自动尝试 fallback 链
// 中的下一个模型，提高系统容错性。
//
// 设计要点：
// - 不修改 createLanguageModel 函数签名（保持向后兼容）
// - fallback 链目前只在 main 进程内部使用，不暴露 IPC 通道
// - 全部失败时抛出聚合错误（包含失败链路详情），便于诊断
// ============================================================================

/**
 * 单次 fallback 尝试的失败信息（用于聚合错误）
 */
interface FallbackFailure {
  /** 尝试的模型名 */
  model: string
  /** 失败原因 */
  error: string
}

/**
 * 按顺序尝试创建 LanguageModel，失败则降级到下一个 selectedModel
 *
 * 尝试顺序：
 * 1. 先尝试主 `config.model`
 * 2. 失败则遍历 `config.selectedModels[]`，依次尝试
 * 3. 每次失败记录 `logger.warn('AGENT.PROVIDER', 'Model fallback', { triedModel, error })`
 * 4. 全部失败时抛出聚合错误：`所有模型均不可用：[tried1, tried2, ...]`
 *
 * 注意事项：
 * - claude-sdk 类型不通过此函数创建（由入口处的 createLanguageModel 抛错拦截）
 * - 主模型和 selectedModels 中的模型共用同一 Provider（同 baseURL/apiKey）
 *   仅模型名不同，因此 fallback 不切换 Provider，只切换模型
 * - 失败原因通常是：模型不存在 / 模型暂时不可用 / 限流
 *
 * @param config Provider 配置（必须含 apiKey + model，可选 selectedModels）
 * @returns 第一个成功创建的 ProviderModelInstance
 * @throws Error 所有 selectedModels 都失败时抛错（包含失败链路详情）
 *
 * @example
 * ```ts
 * const config: ProviderConfig = {
 *   id: 'deepseek-v4',
 *   model: 'deepseek-chat',
 *   selectedModels: ['deepseek-coder', 'deepseek-reasoner'],
 *   // ... 其他字段
 * }
 * try {
 *   const instance = await createLanguageModelWithFallback(config)
 *   // 使用 instance.model 进行 LLM 调用
 * } catch (err) {
 *   console.error(err.message) // "所有模型均不可用：[deepseek-chat, deepseek-coder, deepseek-reasoner]"
 * }
 * ```
 */
export async function createLanguageModelWithFallback(
  config: ProviderConfig
): Promise<ProviderModelInstance> {
  // 构建尝试顺序：主模型 + selectedModels[]（去重，避免重复尝试同一模型）
  const tried = new Set<string>()
  const tryOrder: string[] = []

  if (config.model && !tried.has(config.model)) {
    tried.add(config.model)
    tryOrder.push(config.model)
  }

  if (Array.isArray(config.selectedModels)) {
    for (const m of config.selectedModels) {
      // trim 后判断 length > 0，过滤空字符串和纯空格字符串
      const trimmed = typeof m === 'string' ? m.trim() : ''
      if (trimmed.length > 0 && !tried.has(trimmed)) {
        tried.add(trimmed)
        tryOrder.push(trimmed)
      }
    }
  }

  // 兜底：如果没有可尝试的模型，直接抛错
  if (tryOrder.length === 0) {
    throw new Error(
      `Provider "${config.name}" (${config.id}) 未配置任何可用模型（model 和 selectedModels 均为空）`
    )
  }

  const failures: FallbackFailure[] = []

  for (const modelName of tryOrder) {
    try {
      // 用当前模型名覆盖 config.model，调用同步版 createLanguageModel
      // createLanguageModel 内部会校验 apiKey / baseURL 等字段
      const instance = createLanguageModel({ ...config, model: modelName })
      // 成功：如果有 fallback 历史，记录恢复日志
      if (failures.length > 0) {
        logger.info(
          'AGENT.PROVIDER',
          'Model fallback 恢复',
          {
            providerId: config.id,
            finalModel: modelName,
            failedChain: failures.map((f) => f.model),
          }
        )
      }
      return instance
    } catch (err) {
      const errObj = err as Error
      const errorMsg = errObj?.message ?? String(err)
      failures.push({ model: modelName, error: errorMsg })
      logger.warn(
        'AGENT.PROVIDER',
        'Model fallback',
        {
          providerId: config.id,
          triedModel: modelName,
          error: errorMsg,
          remaining: tryOrder.length - failures.length,
        }
      )
    }
  }

  // 全部失败：抛出聚合错误
  const failedChain = failures.map((f) => f.model).join(', ')
  const detailLines = failures
    .map((f) => `  - ${f.model}: ${f.error}`)
    .join('\n')
  throw new Error(
    `所有模型均不可用：[${failedChain}]\n` +
      `Provider: ${config.name} (${config.id})\n` +
      `失败详情:\n${detailLines}`
  )
}
