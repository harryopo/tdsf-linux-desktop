/**
 * 模型能力 → 可用思考档位（纯函数，可单测）
 *
 * 为什么不是读 `ProviderCapabilities`：那张表（src/main/core/agent/providers/
 * provider-capabilities.ts）只声明 streaming / toolCall / vision / contextWindow /
 * logprobs，**没有 reasoning/thinking 字段**，拿它猜"能不能思考"就是编。
 *
 * 真实依据在 provider-factory：请求体里的 `thinking: { type: enabled|disabled }`
 * 只对 `config.type === 'deepseek'` 注入，且 DeepSeek V4/R1 系列默认开思考。
 * 其它厂商的思维链走各自 SDK，主进程没有给它们做三档开关，所以这里按
 * "Provider 类型 + 模型名白名单"判定，宁可少给档位，也不给一个拨了没用的选择器。
 *
 * 取值映射到主进程已有的 `RequestedThinkingStrength`：
 * - standard = 关闭思考（请求体注入 thinking.disabled）
 * - auto     = 由 thinking-router 按问题复杂度自动决定
 * - deep     = 开启思考（thinking.enabled + reasoning_effort: high）
 * 'fast' 是"缩短输出"的档，不是思考档位，不出现在这里。
 */
import type { ProviderType, RequestedThinkingStrength } from '@shared/agent-types'

export interface ThinkingOption {
  value: RequestedThinkingStrength
  label: string
  /** 一行中文说明：这个档位对用户意味着什么 */
  desc: string
}

export interface ThinkingCapability {
  /** 该模型是否真的有可配的思考档位 */
  supported: boolean
  /** 支持的档位；不支持时为空数组 */
  options: ThinkingOption[]
  /** 不支持时给界面的那一句（支持时为空串） */
  notice: string
}

/** 不支持思考的模型统一用这一句，界面不要另写一版 */
export const THINKING_UNSUPPORTED_NOTICE = '该模型不支持思考强度设置'

/**
 * 运行时真会注入 thinking 开关的模型白名单（按模型名前缀）。
 *
 * 覆盖现役与历史别名：deepseek-flash / deepseek-v4-pro / deepseek-v4 /
 * deepseek-reasoner / deepseek-r1 / deepseek-chat / deepseek-coder。
 * 不在此列的模型（含自定义端点上的未知模型名）一律不给档位——
 * 未知就当不支持，避免"选了深度思考但请求体根本没带 thinking"。
 */
const THINKING_MODEL_PATTERN = /^deepseek-(v\d|r\d|flash|chat|reasoner|coder)/i

/** 三档：关闭 / 自动 / 开启。每档一句中文说明，界面按行渲染 */
const THINKING_OPTIONS: readonly ThinkingOption[] = [
  {
    value: 'standard',
    label: '标准',
    desc: '不开启思考链，直接给出答案，更快也更省 Token',
  },
  {
    value: 'auto',
    label: '自动',
    desc: '按问题复杂度自动决定是否深度思考，日常问答用这一档',
  },
  {
    value: 'deep',
    label: '深度',
    desc: '强制开启思考链，适合故障排查与方案设计，更慢也更贵',
  },
]

/**
 * 判定某模型的思考能力。
 *
 * @param input.providerType Provider 类型（来自主进程 provider:list，不是本地猜的）
 * @param input.model        模型 ID（用户当前配置的那个）
 */
export function resolveThinkingCapability(input: {
  providerType?: ProviderType | null
  model?: string | null
}): ThinkingCapability {
  const model = (input.model ?? '').trim()
  const supported =
    input.providerType === 'deepseek' && THINKING_MODEL_PATTERN.test(model)

  if (!supported) {
    return { supported: false, options: [], notice: THINKING_UNSUPPORTED_NOTICE }
  }
  return {
    supported: true,
    options: THINKING_OPTIONS.map((o) => ({ ...o })),
    notice: '',
  }
}
