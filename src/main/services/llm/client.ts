/**
 * LLM 客户端模块
 *
 * 封装 OpenAI SDK v4，支持 OpenAI 兼容 API（火山方舟/任意兼容服务）。
 *
 * 核心能力：
 *   - chat()          普通对话（一次性返回完整结果）
 *   - chatStream()    流式对话（逐 token 回调）
 *   - analyze()       分析问题生成修复建议（结构化 JSON 输出）
 *   - testConnection()测试连接
 *   - isAvailable()   检查是否可用
 *
 * 降级机制（参考 TDSF 框架的"可信降级"原则）：
 *   当 API Key 为空、网络异常、API 错误、请求超时等情况下，
 *   自动降级到 rule-engine（基于关键词的规则匹配），
 *   保证核心运维分析功能始终可用。
 *
 * 参考：_legacy-python/src/tdsf_desktop/core/llm_client.py
 */

import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { ChatMessage, Evidence, LlmConfig } from '@shared/models'
import { analyzeByRules } from '@main/core/rule-engine'
import { SYSTEM_PROMPT, buildAnalysisPrompt } from './prompt-templates'

/** analyze() 方法的返回类型 */
export interface AnalysisResult {
  /** 根因假设 */
  hypothesis: string
  /** 修复命令 */
  fixCommand: string
  /** 置信度 [0, 1] */
  confidence: number
}

/**
 * LLM 客户端
 *
 * 每个实例绑定一份 LlmConfig，配置变更时需要重新构造实例。
 *
 * @example
 * const client = new LlmClient(config)
 * if (client.isAvailable()) {
 *   const answer = await client.chat([{ role: 'user', content: '如何查看磁盘使用情况' }])
 * }
 *
 * // 降级场景：API Key 为空时自动使用规则引擎
 * const client2 = new LlmClient({ ...config, apiKey: '' })
 * const result = await client2.analyze('OOM', evidences)
 * // result 来自 rule-engine
 */
export class LlmClient {
  /** OpenAI SDK 客户端实例（API Key 为空时为 null） */
  private readonly client: OpenAI | null
  /** LLM 配置 */
  private readonly config: LlmConfig

  /**
   * @param config LLM 配置（baseUrl/apiKey/model/temperature/maxTokens/timeout）
   */
  constructor(config: LlmConfig) {
    this.config = config
    // API Key 为空时不创建 OpenAI 客户端，后续调用走降级路径
    if (config.apiKey && config.apiKey.trim()) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: config.timeout,
        maxRetries: 0, // 失败后立即降级，不做 SDK 层重试
        dangerouslyAllowBrowser: false
      })
    } else {
      this.client = null
    }
  }

  /**
   * 检查 LLM 是否可用
   *
   * 仅检查 API Key 是否非空，不发起网络请求。
   * 真正连接状态请用 testConnection()。
   *
   * @returns true 表示配置了 API Key
   */
  isAvailable(): boolean {
    return this.client !== null
  }

  /**
   * 测试连接
   *
   * 发送一个极简的请求验证 API Key 和 baseURL 是否可用。
   * 超时时间限制为 10 秒，避免长时间阻塞。
   *
   * @returns true 表示连接正常
   */
  async testConnection(): Promise<boolean> {
    if (!this.client) {
      return false
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      try {
        await this.client.chat.completions.create(
          {
            model: this.config.model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 8,
            temperature: 0
          },
          { signal: controller.signal }
        )
        return true
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return false
    }
  }

  /**
   * 普通对话
   *
   * 将用户消息发送给 LLM，返回完整的回复文本。
   * 自动注入系统提示词（运维专家角色）。
   *
   * 降级策略：
   *   - API Key 为空 → 抛出 Error（调用方应先检查 isAvailable）
   *   - 网络/API/超时错误 → 抛出 Error（调用方可降级到规则引擎）
   *
   * @param messages 对话消息列表
   * @returns LLM 回复文本
   */
  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.client) {
      throw new Error('LLM 不可用：API Key 未配置')
    }
    const fullMessages = this.injectSystemPrompt(messages)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.timeout)
      try {
        const response = await this.client.chat.completions.create(
          {
            model: this.config.model,
            messages: fullMessages,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens
          },
          { signal: controller.signal }
        )
        return response.choices[0]?.message?.content ?? ''
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      throw new Error(`LLM 调用失败: ${(err as Error).message}`)
    }
  }

  /**
   * 流式对话
   *
   * 逐 token 通过 onToken 回调推送，最终返回完整文本。
   * 适用于实时输出场景（如聊天界面）。
   *
   * 降级策略同 chat()。
   *
   * @param messages 对话消息列表
   * @param onToken  token 回调（每收到一个 token 调用一次）
   * @returns 完整回复文本
   */
  async chatStream(
    messages: ChatMessage[],
    onToken: (token: string) => void
  ): Promise<string> {
    if (!this.client) {
      throw new Error('LLM 不可用：API Key 未配置')
    }
    const fullMessages = this.injectSystemPrompt(messages)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.timeout)
      try {
        const stream = await this.client.chat.completions.create(
          {
            model: this.config.model,
            messages: fullMessages,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            stream: true
          },
          { signal: controller.signal }
        )
        let fullText = ''
        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content ?? ''
          if (token) {
            fullText += token
            onToken(token)
          }
        }
        return fullText
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      throw new Error(`LLM 流式调用失败: ${(err as Error).message}`)
    }
  }

  /**
   * 分析问题生成修复建议
   *
   * 输入：问题描述 + 证据列表
   * 输出：根因假设 + 修复命令 + 置信度
   *
   * 降级策略（核心）：
   *   1. API Key 为空 → 直接使用 rule-engine
   *   2. LLM 调用失败 → 降级到 rule-engine
   *   3. LLM 返回内容无法解析 → 降级到 rule-engine
   *   4. rule-engine 也无匹配 → 返回默认的低置信度结果
   *
   * @param problem 问题描述
   * @param evidences 证据列表
   * @returns 分析结果
   */
  async analyze(problem: string, evidences: Evidence[]): Promise<AnalysisResult> {
    // 降级路径 1：API Key 为空
    if (!this.client) {
      return this.fallbackToRules(problem, evidences)
    }

    try {
      const prompt = buildAnalysisPrompt(problem, evidences)
      const response = await this.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ])
      // 尝试解析 LLM 返回的 JSON
      const parsed = this.parseAnalysisResponse(response)
      if (parsed) {
        return parsed
      }
      // 解析失败 → 降级
      return this.fallbackToRules(problem, evidences)
    } catch {
      // 调用失败 → 降级
      return this.fallbackToRules(problem, evidences)
    }
  }

  // ────────── 内部方法 ──────────

  /**
   * 注入系统提示词并转换为 OpenAI SDK 兼容格式
   *
   * 如果消息列表首条不是 system 角色，则在最前面插入 SYSTEM_PROMPT。
   * 同时将 ChatMessage 转换为 OpenAI SDK 的 ChatCompletionMessageParam 格式。
   *
   * @param messages 原始消息列表
   * @returns 注入系统提示词后的消息列表（OpenAI SDK 兼容）
   */
  private injectSystemPrompt(messages: ChatMessage[]): ChatCompletionMessageParam[] {
    const converted = messages.map((m) => {
      // 根据 role 构造对应的 ChatCompletionMessageParam
      // ChatMessage 的可选字段（name/toolCallId）仅在对应角色时传入
      if (m.role === 'system') {
        return { role: 'system' as const, content: m.content }
      }
      if (m.role === 'user') {
        return { role: 'user' as const, content: m.content }
      }
      if (m.role === 'assistant') {
        return { role: 'assistant' as const, content: m.content }
      }
      // tool 角色
      return {
        role: 'tool' as const,
        content: m.content,
        tool_call_id: m.toolCallId ?? ''
      }
    })
    if (converted.length > 0 && converted[0].role === 'system') {
      return converted
    }
    return [{ role: 'system', content: SYSTEM_PROMPT }, ...converted]
  }

  /**
   * 解析 LLM 的分析响应
   *
   * LLM 应返回 JSON 格式：{ hypothesis, fixCommand, confidence }
   * 容错处理：去除 Markdown 代码块标记、提取 JSON 片段。
   *
   * @param response LLM 响应文本
   * @returns 解析成功返回 AnalysisResult，失败返回 null
   */
  private parseAnalysisResponse(response: string): AnalysisResult | null {
    try {
      // 去除 Markdown 代码块标记（容错）
      const cleaned = response
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim()
      // 尝试提取第一个 JSON 对象
      const jsonStart = cleaned.indexOf('{')
      const jsonEnd = cleaned.lastIndexOf('}')
      if (jsonStart === -1 || jsonEnd === -1) {
        return null
      }
      const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1)
      const obj = JSON.parse(jsonStr) as {
        hypothesis?: unknown
        fixCommand?: unknown
        confidence?: unknown
      }
      // 字段类型校验
      if (
        typeof obj.hypothesis !== 'string' ||
        typeof obj.fixCommand !== 'string' ||
        typeof obj.confidence !== 'number'
      ) {
        return null
      }
      // 置信度范围限制
      const confidence = Math.min(1, Math.max(0, obj.confidence))
      return {
        hypothesis: obj.hypothesis,
        fixCommand: obj.fixCommand,
        confidence
      }
    } catch {
      return null
    }
  }

  /**
   * 降级到规则引擎
   *
   * 将证据内容合并为"日志文本"，调用 rule-engine 进行关键词匹配。
   * 若规则引擎也无匹配，返回默认的低置信度结果。
   *
   * @param problem 问题描述
   * @param evidences 证据列表
   * @returns 分析结果（来自规则引擎或默认值）
   */
  private fallbackToRules(problem: string, evidences: Evidence[]): AnalysisResult {
    const logs = evidences.map((e) => e.content).join('\n')
    const ruleResult = analyzeByRules(problem, logs)
    if (ruleResult) {
      return {
        hypothesis: ruleResult.hypothesis,
        fixCommand: ruleResult.fixCommand,
        confidence: ruleResult.confidence
      }
    }
    // 规则引擎也无匹配 → 返回默认低置信度结果
    return {
      hypothesis: '暂无匹配的故障规则，建议人工排查',
      fixCommand: 'echo "需要人工诊断"',
      confidence: 0.1
    }
  }
}
