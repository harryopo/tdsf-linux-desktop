/**
 * Provider 工厂
 *
 * 职责：根据 ProviderConfig.type 创建对应的 LanguageModel 实例
 *
 * 支持的 Provider 类型：
 * - openai-compatible / deepseek / qwen / volcengine-ark / ollama → 用 @ai-sdk/openai createOpenAI（OpenAI 兼容协议）
 * - anthropic → 用 @ai-sdk/anthropic createAnthropic（Claude 原生协议）
 * - google → 用 @ai-sdk/google createGoogleGenerativeAI（Gemini 原生协议）
 *
 * 设计要点：
 * - 所有网络请求必须有日志（Hard Constraint 5）
 * - API Key 缺失时抛出明确错误（不静默降级到 mock）
 * - baseURL 为空时使用 @ai-sdk/* 各自的默认值（仅 anthropic/google 有默认）
 *
 * 方案书依据：v0.9 §3 决策 1（Mastra + AI SDK 7 组合）+ 调研文档 §8（Claude Agent SDK 集成）
 */
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { wrapLanguageModel, extractReasoningMiddleware } from 'ai'
import type { LanguageModel } from 'ai'
import type { ProviderConfig, ProviderModelInstance, ProviderType, PersistedProviderConfig } from './types'
import { logger } from '../../../services/log/logger'
import {
  createReasoningTagState,
  rewriteSseLine,
  REASONING_TAG,
} from './deepseek-reasoning-transform'

/**
 * DeepSeek thinking 开启时，把 SSE 响应流里的 reasoning_content 改写成 <think>…</think> 包裹的 content，
 * 供上层 extractReasoningMiddleware 提取回 reasoning 分片（@ai-sdk/openai 2.x 不读 reasoning_content）。
 * 按行缓冲处理跨块切分的 SSE 行。
 */
function wrapDeepseekReasoningStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const state = createReasoningTagState()
  let buffer = ''
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // 保留未完整的最后一行
      const rewritten = lines.map((l) => rewriteSseLine(l, state)).join('\n')
      controller.enqueue(encoder.encode(rewritten + '\n'))
    },
    flush(controller) {
      if (buffer) controller.enqueue(encoder.encode(rewriteSseLine(buffer, state)))
    },
  })
  return body.pipeThrough(transform)
}

/**
 * 哪些 Provider 走 OpenAI 兼容协议、可能把思维链放在非标准的 reasoning_content 字段里。
 *
 * @ai-sdk/openai 2.x 只读 delta.content，reasoning_content 会被整段丢掉 ——
 * 此前只有 deepseek+deep 档做了改写，Qwen / 豆包 / Kimi / 自部署 vLLM 这些同样发
 * reasoning_content 的端点，用户开了思考强度也看不到"深度思考"块（#90）。
 * anthropic / google 走各自 SDK，思维链本来就是标准 reasoning 分片，不需要这套。
 */
export function reasoningExtractionTag(type: ProviderType): string | null {
  const compat =
    type === 'deepseek' ||
    type === 'openai-compatible' ||
    type === 'qwen' ||
    type === 'volcengine-ark' ||
    type === 'ollama'
  return compat ? REASONING_TAG : null
}

interface CompatFetchOptions {
  /** 仅 DeepSeek：按 deep 强度注入 thinking 开关；其它端为 false（不碰请求体） */
  deepseekThinking: 'enabled' | 'disabled' | false
  /** 是否改写响应流把 reasoning_content 捞回来（只在流里真有该字段时才动） */
  surfaceReasoning: boolean
}

function createOpenAiCompatFetch(opts: CompatFetchOptions): typeof fetch {
  const deepseekThinking = opts.deepseekThinking
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
/*
 *  自定义 fetch 职责：
 *  1.【所有兼容端】developer→system 角色修正（DeepSeek/Qwen/Volcengine/Ollama 只认 system）；
 *  2.【仅 DeepSeek】按 deep 强度注入 thinking enabled/disabled（关时正文直出）；
 *  3.【兼容端】把 reasoning_content 包成罕见标签供中间件提取（#90：不再只限 deepseek+deep）。
 */
    // 仅处理带 JSON body 的 POST（chat/completions）；其余请求原样放行
    if (init?.body && typeof init.body === 'string') {
      try {
        const payload = JSON.parse(init.body) as Record<string, unknown>
        let mutated = false
        // 1. developer → system（所有兼容端）
        if (Array.isArray(payload.messages)) {
          for (const m of payload.messages as Array<Record<string, unknown>>) {
            if (m && typeof m === 'object' && m.role === 'developer') {
              m.role = 'system'
              mutated = true
            }
          }
        }
        // 2. DeepSeek 思考模式（仅 DeepSeek，未显式指定时）：
        //    v2.11 修复：按 deep 强度注入 enabled/disabled。此前无条件 disabled，
        //    导致 deep 模式的思考也被强制关掉（深度思考开关+思考展示归因）。
        if (deepseekThinking && !('thinking' in payload)) {
          if (deepseekThinking === 'enabled') {
            payload.thinking = { type: 'enabled' }
            if (!('reasoning_effort' in payload)) payload.reasoning_effort = 'high'
          } else {
            payload.thinking = { type: 'disabled' }
          }
          mutated = true
        }
        if (mutated) {
          init = { ...init, body: JSON.stringify(payload) }
        }
      } catch {
        // body 非 JSON 时不处理，原样放行
      }
    }
    const res = await fetch(input, init)
    // 改写只在流里真出现 reasoning_content 时才动内容（rewriteReasoningChunk 按字段判定），
    // 所以对所有兼容端开都是空操作级的安全；真正有代价的是下面那层中间件，见 REASONING_TAG 注释。
    if ((opts.deepseekThinking === 'enabled' || opts.surfaceReasoning) && res.body && res.ok) {
      return new Response(wrapDeepseekReasoningStream(res.body), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      })
    }
    return res
  }
}

/**
 * 创建 LanguageModel 实例
 *
 * 根据 ProviderConfig.type 分发到对应的 @ai-sdk/* 工厂函数。
 * 所有 OpenAI 兼容协议（deepseek/qwen/volcengine-ark/ollama/openai-compatible）
 * 统一用 createOpenAI 创建。
 *
 * 特殊处理：
 *
 * @param config Provider 配置（必须含 apiKey）
 * @returns LanguageModel 实例 + 元信息
 * @throws Error 如果 apiKey 缺失或 baseURL 无效
 */
export function createLanguageModel(
  config: ProviderConfig,
  opts?: { deepThinking?: boolean },
): ProviderModelInstance {
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

  const model = buildModel(config, opts?.deepThinking === true)
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
 * 注意：所有 ProviderType 都在这里创建 LanguageModel，没有旁路。
 * 不会进入此 switch。default 分支的类型穷尽性检查仍会覆盖它。
 *
 * @param config Provider 配置
 * @returns LanguageModel 实例
 */
function buildModel(config: ProviderConfig, deepThinking = false): LanguageModel {
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
    case 'qwen':
    case 'volcengine-ark':
    case 'ollama': {
      // 全部走 OpenAI 兼容协议（绝大多数国产模型都兼容）
      const openai = createOpenAI({
        apiKey: config.apiKey || 'ollama', // Ollama 默认无需 key，但 SDK 要求非空
        baseURL: config.baseURL,
        // developer→system 角色修正（不注入 deepseek thinking）
        fetch: createOpenAiCompatFetch({ deepseekThinking: false, surfaceReasoning: true }),
      })
      // 必须用 .chat()：@ai-sdk/openai v2 的 openai(model) 默认走 Responses API（/responses），
      // 而国产兼容端只实现了 /chat/completions，走 Responses 会导致端点不存在/空输出。
      const compatModel = openai.chat(config.model)
      // #90：这些端的思维链在非标准的 reasoning_content 字段里，fetch 层已把它包成
      // REASONING_TAG；这里必须套提取中间件，否则标签会以字面文本留在答案里（比不显示更糟）。
      const compatTag = reasoningExtractionTag(config.type)
      return compatTag
        ? wrapLanguageModel({
            model: compatModel,
            middleware: extractReasoningMiddleware({ tagName: compatTag }),
          })
        : compatModel
    }
    case 'deepseek': {
      // DeepSeek V4 Flash/Pro 默认开启思考模式，正文在 content、思维链在 reasoning_content。
      // 三层修复（均在 fetch 层 + .chat()）：
      //   1. 用 .chat() 强制走 /chat/completions（默认 openai(model) 走 Responses API，DeepSeek 不支持）
      //   2. fetch 把 developer 角色改回 system（@ai-sdk/openai 把 system 转成 developer，DeepSeek 拒收）
      //   3. fetch 注入 { thinking: { type: 'disabled' } } 关闭思考，确保正文直出 delta.content
      const openai = createOpenAI({
        apiKey: config.apiKey!,
        baseURL: config.baseURL,
        // v2.11：deep 强度 → 开启思考（thinking enabled + reasoning_effort high）；
        // 其余强度 → 关闭思考（正文直出）。此前恒为 disabled 导致 deep 失效。
        fetch: createOpenAiCompatFetch({
          deepseekThinking: deepThinking ? 'enabled' : 'disabled',
          surfaceReasoning: true,
        }),
      })
      const deepseekModel = openai.chat(config.model)
      // v2.11 deep 档：用 extractReasoningMiddleware 把 fetch 层包的 <think> 段提取回 reasoning 分片
      //（@ai-sdk/openai 不读 DeepSeek 的 reasoning_content，故先包 <think> 再提取）。standard/fast 不包裹、不包中间件。
      const deepTag = reasoningExtractionTag(config.type)
      return deepThinking && deepTag
        ? wrapLanguageModel({
            model: deepseekModel,
            middleware: extractReasoningMiddleware({ tagName: deepTag }),
          })
        : deepseekModel
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

