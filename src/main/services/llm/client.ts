/**
 * LLM 客户端模块
 *
 * 封装 OpenAI SDK v4，支持 OpenAI 兼容 API（火山方舟/任意兼容服务）。
 *
 * 核心能力：chat / chatStream（重试+超时+清理）/ chatWithRetry /
 *          chatWithContext / analyze / validateConfig / testConnection
 *
 * 增强项：
 *   - 网络错误自动重试（指数退避：1s/2s/4s，最多 3 次）
 *   - 超时处理（AbortController，默认 60s）
 *   - 流中断后的清理逻辑
 *   - 请求日志（调用时长/token 数）
 *   - 降级机制（API Key 为空 / 调用失败时返回规则引擎结果）
 *
 * 降级机制（参考 TDSF 框架的"可信降级"原则）：API Key 为空、网络异常、
 * API 错误、超时等情况下自动降级到 rule-engine，保证核心功能可用。
 *
 * 参考：_legacy-python/src/tdsf_desktop/core/llm_client.py
 */

import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type {
  ChatMessage,
  Evidence,
  LlmConfig,
  LlmValidationResult,
  EnvironmentContext,
} from '@shared/models'
import { analyzeByRules } from '@main/core/rule-engine'
import { SYSTEM_PROMPT, buildAnalysisPrompt, buildEnvironmentContextPrompt } from './prompt-templates'

/** analyze() 方法的返回类型 */
export interface AnalysisResult {
  /** 根因假设 */
  hypothesis: string
  /** 修复命令 */
  fixCommand: string
  /** 置信度 [0, 1] */
  confidence: number
}

/** 最大重试次数 */
const MAX_RETRIES = 3
/** 默认流式超时（毫秒） */
const DEFAULT_STREAM_TIMEOUT = 60_000
/** 指数退避基数（毫秒），重试延迟：1s → 2s → 4s */
const RETRY_BASE_DELAY = 1_000

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
 * // 降级场景：API Key 为空时 analyze() 自动使用规则引擎
 */
export class LlmClient {
  private readonly client: OpenAI | null
  private readonly config: LlmConfig

  constructor(config: LlmConfig) {
    this.config = config
    // API Key 为空时不创建 OpenAI 客户端，后续调用走降级路径
    if (config.apiKey && config.apiKey.trim()) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: config.timeout,
        maxRetries: 0, // SDK 层不重试（由本模块 chatWithRetry 自行重试）
        dangerouslyAllowBrowser: false
      })
    } else {
      this.client = null
    }
  }

  /** 检查 LLM 是否可用（仅检查 API Key 非空，不发起网络请求） */
  isAvailable(): boolean {
    return this.client !== null
  }

  /**
   * 校验 LLM 配置是否有效（不发起网络请求，仅做字段级校验）
   * @returns 校验结果
   */
  validateConfig(): LlmValidationResult {
    const errors: string[] = []
    if (!this.config.apiKey || !this.config.apiKey.trim()) {
      errors.push('API Key 不能为空')
    }
    if (!this.config.baseUrl || !this.config.baseUrl.trim()) {
      errors.push('Base URL 不能为空')
    } else {
      try {
         
        new URL(this.config.baseUrl)
      } catch {
        errors.push('Base URL 格式无效')
      }
    }
    if (!this.config.model || !this.config.model.trim()) {
      errors.push('模型名称不能为空')
    }
    if (this.config.temperature < 0 || this.config.temperature > 2) {
      errors.push('temperature 必须在 0 到 2 之间')
    }
    if (this.config.maxTokens <= 0) {
      errors.push('maxTokens 必须大于 0')
    }
    if (this.config.timeout <= 0) {
      errors.push('timeout 必须大于 0')
    }
    return { valid: errors.length === 0, errors }
  }

  /**
   * 测试连接（发送极简请求验证 API Key/baseURL，超时 10s）
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
   * 普通对话（自动注入系统提示词）
   *
   * 降级策略：API Key 为空抛出 Error；网络/API/超时错误抛出 Error
   *
   * @param messages 对话消息列表
   * @returns LLM 回复文本
   */
  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.client) {
      throw new Error('LLM 不可用：API Key 未配置')
    }
    const fullMessages = this.injectSystemPrompt(messages)
    const startTime = Date.now()
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
        const content = response.choices[0]?.message?.content ?? ''
        this.logRequest('chat', startTime, response.usage?.total_tokens)
        return content
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      throw new Error(`LLM 调用失败: ${(err as Error).message}`)
    }
  }

  /**
   * 流式对话（增强版）
   *
   * 增强能力：网络错误自动重试（最多 3 次，指数退避 1s/2s/4s）、
   * 超时处理（AbortController，默认 60s）、流中断后清理。
   *
   * @param messages 对话消息列表
   * @param onToken  token 回调
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
    const startTime = Date.now()

    return this.chatWithRetry(async () => {
      const controller = new AbortController()
      const timeout = this.config.timeout > 0 ? this.config.timeout : DEFAULT_STREAM_TIMEOUT
      const timer = setTimeout(() => controller.abort(), timeout)
      let fullText = ''
      try {
        const stream = await this.client!.chat.completions.create(
          {
            model: this.config.model,
            messages: fullMessages,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            stream: true
          },
          { signal: controller.signal }
        )
        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content ?? ''
          if (token) {
            fullText += token
            onToken(token)
          }
        }
        this.logRequest('chatStream', startTime, undefined)
        return fullText
      } catch (err) {
        // 流中断：若已收到部分文本且可重试，抛出让上层重试
        if (fullText && this.isRetryableError(err)) {
          throw err
        }
        throw new Error(`LLM 流式调用失败: ${(err as Error).message}`)
      } finally {
        clearTimeout(timer)
        // 确保 abort 信号被清理
        if (!controller.signal.aborted) {
          controller.abort()
        }
      }
    })
  }

  /**
   * 带系统环境上下文的对话（将 EnvironmentContext 注入为 system message）
   * 用于 llm:chat-with-context 通道。
   *
   * @param messages 对话消息列表
   * @param envCtx 系统环境上下文
   * @returns LLM 回复文本
   */
  async chatWithContext(
    messages: ChatMessage[],
    envCtx: EnvironmentContext
  ): Promise<string> {
    if (!this.client) {
      throw new Error('LLM 不可用：API Key 未配置')
    }
    const envPrompt = buildEnvironmentContextPrompt(envCtx)
    const messagesWithCtx: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${envPrompt}` },
      ...messages.filter((m) => m.role !== 'system')
    ]
    return this.chat(messagesWithCtx)
  }

  /**
   * 分析问题生成修复建议（输入：问题+证据 → 输出：根因+修复命令+置信度）
   *
   * 降级策略：
   *   1. API Key 为空 → 直接使用 rule-engine
   *   2. LLM 调用失败 → 降级到 rule-engine，并在 hypothesis 中标注失败原因
   *   3. LLM 返回无法解析 → 降级到 rule-engine
   *   4. rule-engine 也无匹配 → 返回默认低置信度结果
   */
  async analyze(problem: string, evidences: Evidence[]): Promise<AnalysisResult> {
    // 降级路径 1：API Key 为空 → 返回规则引擎结果
    if (!this.client) {
      return this.fallbackToRules(problem, evidences)
    }

    try {
      const prompt = buildAnalysisPrompt(problem, evidences)
      const response = await this.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ])
      const parsed = this.parseAnalysisResponse(response)
      if (parsed) {
        return parsed
      }
      // 解析失败 → 降级
      return this.fallbackToRules(problem, evidences)
    } catch (err) {
      // 调用失败 → 降级到规则引擎，并在假设中标注错误信息
      const ruleResult = this.fallbackToRules(problem, evidences)
      return {
        ...ruleResult,
        hypothesis: `${ruleResult.hypothesis}（注：LLM 调用失败，已降级到规则引擎。错误: ${(err as Error).message}）`,
        confidence: Math.min(ruleResult.confidence, 0.3)
      }
    }
  }

  // ────────── 内部方法 ──────────

  /**
   * 封装重试逻辑（指数退避 1s→2s→4s，最多 3 次，仅对可重试错误重试）
   */
  private async chatWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err as Error
        // 最后一次尝试或不可重试的错误 → 直接抛出
        if (attempt === MAX_RETRIES || !this.isRetryableError(err)) {
          throw lastError
        }
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt)
        console.log(
          `[LLM] 第 ${attempt + 1} 次重试，${delay}ms 后重试...`,
          `错误: ${(err as Error).message}`
        )
        await this.sleep(delay)
      }
    }
    throw lastError ?? new Error('LLM 调用失败：未知错误')
  }

  /**
   * 判断错误是否可重试
   * 可重试：网络错误/超时/5xx/429限流；不可重试：401/400/404
   */
  private isRetryableError(err: unknown): boolean {
    const msg = (err as Error).message?.toLowerCase() ?? ''
    // 网络错误
    if (msg.includes('network') || msg.includes('fetch failed') ||
        msg.includes('econnreset') || msg.includes('etimedout') ||
        msg.includes('socket hang up')) {
      return true
    }
    // 超时 / 中断
    if (msg.includes('timeout') || msg.includes('aborted') ||
        msg.includes('abort')) {
      return true
    }
    // 5xx 服务端错误
    if (/\b5\d{2}\b/.test(msg) || msg.includes('server error') ||
        msg.includes('internal error') || msg.includes('bad gateway')) {
      return true
    }
    // 429 限流
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return true
    }
    // OpenAI SDK 的 APIError 通过 status 属性判断
    const status = (err as { status?: number }).status
    if (status !== undefined && (status === 429 || status >= 500)) {
      return true
    }
    return false
  }

  /** 延迟工具函数 */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** 请求日志（方法名/耗时/token数，输出到 console.log） */
  private logRequest(method: string, startTime: number, totalTokens?: number): void {
    const duration = Date.now() - startTime
    const tokenInfo = totalTokens !== undefined ? `, tokens=${totalTokens}` : ''
    console.log(`[LLM] ${method} 耗时=${duration}ms${tokenInfo} model=${this.config.model}`)
  }

  /**
   * 注入系统提示词并转换为 OpenAI SDK 兼容格式
   * 若首条非 system 角色，则在最前面插入 SYSTEM_PROMPT
   */
  private injectSystemPrompt(messages: ChatMessage[]): ChatCompletionMessageParam[] {
    const converted = messages.map((m) => {
      if (m.role === 'system') {
        return { role: 'system' as const, content: m.content }
      }
      if (m.role === 'user') {
        return { role: 'user' as const, content: m.content }
      }
      if (m.role === 'assistant') {
        return { role: 'assistant' as const, content: m.content }
      }
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
   * 解析 LLM 的分析响应（JSON: {hypothesis, fixCommand, confidence}）
   * 容错：去除 Markdown 代码块标记、提取 JSON 片段
   */
  private parseAnalysisResponse(response: string): AnalysisResult | null {
    try {
      const cleaned = response
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim()
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
      if (
        typeof obj.hypothesis !== 'string' ||
        typeof obj.fixCommand !== 'string' ||
        typeof obj.confidence !== 'number'
      ) {
        return null
      }
      const confidence = Math.min(1, Math.max(0, obj.confidence))
      return { hypothesis: obj.hypothesis, fixCommand: obj.fixCommand, confidence }
    } catch {
      return null
    }
  }

  /**
   * 降级到规则引擎（将证据合并为日志文本进行关键词匹配）
   * 规则引擎也无匹配时返回默认低置信度结果
   *
   * 关键修复（P1-1）：
   *   - 原返回 `echo "需要人工诊断"` 是无意义命令，用户执行后看不到任何诊断输出
   *   - 改为综合健康检查脚本，与 agent-workflow.ts 的 deriveFixCommand 保持一致
   *   - 确保即使降级到最低级别，用户也能看到实际系统状态
   *
   * Phase D 对齐（polish-tdsf-p1-issues）：
   *   - 兜底命令统一为 `echo "LLM_UNAVAILABLE"`，便于上游识别 LLM 不可用场景
   *   - confidence 对齐为 0.3，与 spec 要求一致
   *   - 字段格式（hypothesis/fixCommand/confidence）与 rule-engine.ts 保持一致
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
    return {
      hypothesis: 'LLM 不可用且无匹配故障规则，已降级到兜底命令',
      fixCommand: 'echo "LLM_UNAVAILABLE"',
      confidence: 0.3
    }
  }
}
