/**
 * Vercel AI SDK 4 包装层
 *
 * 职责：
 * - 提供统一的 LLM 调用接口，支持 OpenAI 兼容 API + 火山方舟
 * - 支持 Tool Calling（让 LLM 能调用 SSH 命令等工具）
 * - 支持流式输出（generateTextStream）
 * - 自动降级：API Key 为空时返回 mock
 *
 * 调研依据：07-开源项目调研-AIAgent生态.md Top1（9.5分）
 * 优势：TS 原生 Agent 框架，Vercel 维护活跃，3.0+ 支持 Function Calling
 *
 * v0.5.0 变更：移除本地 ToolDefinition 重复定义，统一从 @shared/llm-tool-types 引入
 * v0.5.0 变更：移除 sshExecTool/knowledgeQueryTool/riskCheckTool 三个 Tool 常量（重复定义且未被使用）
 */
import { generateText, streamText, tool, type ModelMessage, type ToolSet, type Tool } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import type { LlmConfig } from '@shared/models'
import { LlmClient } from './client'

// 内部工具参数类型（VercelAiService.generate 入参用，等价于 @shared/llm-tool-types.ToolDefinition）
type InternalToolDef = {
  name: string
  description: string
  parameters: z.ZodTypeAny
  execute: (args: unknown) => Promise<unknown>
}

/** AI 调用结果 */
export interface AiCallResult {
  /** 文本输出 */
  text: string
  /** 工具调用结果列表 */
  toolResults: Array<{ toolName: string; result: unknown }>
  /** Token 使用 */
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** 完成原因 */
  finishReason: string
}

/** Vercel AI SDK 包装 */
export class VercelAiService {
  private readonly config: LlmConfig
  private readonly fallbackClient: LlmClient

  constructor(config: LlmConfig) {
    this.config = config
    this.fallbackClient = new LlmClient(config)
  }

  /**
   * 非流式生成（带 Tool Calling 支持）
   *
   * @param messages - 对话历史
   * @param tools - 可用工具列表
   * @returns AI 输出 + 工具调用结果
   */
  async generate(
    messages: ModelMessage[],
    tools: InternalToolDef[] = []
  ): Promise<AiCallResult> {
    // API Key 为空时降级到现有 LlmClient
    if (!this.config.apiKey || !this.config.baseUrl || !this.config.model) {
      return this.fallbackToLlmClient(messages)
    }

    try {
      const openai = createOpenAI({
        baseURL: this.config.baseUrl,
        apiKey: this.config.apiKey
      })

      // 转换 Tool 格式（v7：parameters → inputSchema）
      const toolMap = tools.reduce<ToolSet>((acc, t) => {
        acc[t.name] = tool({
          description: t.description,
          inputSchema: t.parameters,
          execute: t.execute
        }) as Tool
        return acc
      }, {})

      const result = await generateText({
        model: openai(this.config.model),
        messages,
        tools: toolMap,
        temperature: this.config.temperature ?? 0.7,
        maxOutputTokens: this.config.maxTokens ?? 2048
      })

      // 工具调用结果提取（v7: result.toolResults 字段保留，但结构可能变化）
      const toolResults: Array<{ toolName: string; result: unknown }> = []
      if (result.toolResults && Array.isArray(result.toolResults)) {
        for (const r of result.toolResults) {
          // r 是 unknown 类型，安全访问属性
          const rec = r as { toolName?: string; result?: unknown }
          toolResults.push({
            toolName: rec.toolName ?? 'unknown',
            result: rec.result
          })
        }
      }

      return {
        text: result.text,
        toolResults,
        usage: {
          promptTokens: result.usage?.inputTokens ?? 0,
          completionTokens: result.usage?.outputTokens ?? 0,
          totalTokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0)
        },
        finishReason: result.finishReason ?? 'unknown'
      }
    } catch (err) {
      console.error('[VercelAiService] generate 失败，降级到 LlmClient:', err)
      return this.fallbackToLlmClient(messages)
    }
  }

  /**
   * 流式生成
   *
   * @param messages - 对话历史
   * @param onToken - token 回调
   * @returns 完整文本
   */
  async stream(
    messages: ModelMessage[],
    onToken: (token: string) => void
  ): Promise<string> {
    if (!this.config.apiKey || !this.config.baseUrl || !this.config.model) {
      // 降级：调用现有 LlmClient 的 chatStream
      const chatMessages = this.toChatMessages(messages)
      return this.fallbackClient.chatStream(chatMessages, onToken)
    }

    try {
      const openai = createOpenAI({
        baseURL: this.config.baseUrl,
        apiKey: this.config.apiKey
      })

      const result = streamText({
        model: openai(this.config.model),
        messages,
        temperature: this.config.temperature ?? 0.7,
        maxOutputTokens: this.config.maxTokens ?? 2048
      })

      let fullText = ''
      for await (const chunk of result.textStream) {
        if (chunk) {
          fullText += chunk
          onToken(chunk)
        }
      }
      return fullText
    } catch (err) {
      console.error('[VercelAiService] stream 失败，降级到 LlmClient:', err)
      const chatMessages = this.toChatMessages(messages)
      return this.fallbackClient.chatStream(chatMessages, onToken)
    }
  }

  /**
   * 降级到现有 LlmClient
   */
  private async fallbackToLlmClient(messages: ModelMessage[]): Promise<AiCallResult> {
    const chatMessages = this.toChatMessages(messages)
    const text = await this.fallbackClient.chat(chatMessages)
    return {
      text,
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'fallback'
    }
  }

  /**
   * 转换 Vercel AI 消息格式 → 现有 LlmClient 格式
   */
  private toChatMessages(messages: ModelMessage[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    return messages
      .filter((m) => m.role === 'system' || m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }))
  }
}

/** SSH 命令 Tool 定义（用于 Agent 工作流 reason 步骤） */
// v0.5.0 移除：改由 services/llm/tools/ssh-exec.ts 统一管理
