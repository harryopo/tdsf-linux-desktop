/**
 * Subagent 调度 14 步协议 - 步骤 6-10（D.2 + D.3 头）
 *
 * 从 task-protocol-steps.ts 拆分而来（避免单文件超 500 行硬约束）。
 *
 * 包含：
 * - step 6: select-provider（D.2，解析 providerId → getProviderWithApiKey → createLanguageModel）
 * - step 7: select-mode（D.2，解析 mode → getCurrentMode → MODE_CONFIGS[mode]）
 * - step 8: build-prompt（D.2，systemPrompt + attentionContext + compactIfNeeded）
 * - step 9: invoke-subagent（D.3，claude-sdk 走 ClaudeSdkProvider.generate，其他走 streamText）
 * - step 10: stream-output（D.3，提取 chatResult.text 到 ctx.output）
 */
import { streamText, type ModelMessage } from 'ai'
import type {
  TaskProtocolContext,
  StepResult,
  ProviderModelInstance,
} from './task-protocol-types'
import type { AgentMode, ModeConfig, ProviderType, ChatResult } from '@shared/agent-types'
import {
  getProviderWithApiKey,
  getDefaultProviderId,
  ensureProvidersInitialized,
} from '../providers/provider-registry'
import { createLanguageModel, getDefaultParams } from '../providers/provider-factory'
import { MODE_CONFIGS, isValidMode, getCurrentMode } from '../modes/mode-registry'
import { compactIfNeeded } from '../context'
import { ClaudeSdkProvider } from '../claude-sdk/claude-sdk-provider'
import { log, extractStringField, readInputField } from './task-protocol-helpers'

// ============================================================================
// D.2：step 6-8（select-provider / select-mode / build-prompt）
// ============================================================================

/**
 * 步骤 6：选择 Provider
 *
 * 借鉴 Kilo Code：KiloTask.resolveModel({ name, agent, config, parent, variant, provider })
 * - subagent 可继承父 model 或自定义
 *
 * 真实逻辑：
 * 1. 优先从 ctx.input 解析 providerId（如果 input 是对象且有 providerId）
 * 2. 否则用 getDefaultProviderId()
 * 3. 调用 getProviderWithApiKey(id) 获取配置
 * 4. 如果 type !== 'claude-sdk'，调用 createLanguageModel 创建 modelInstance
 * 5. 写入 ctx.providerConfig / ctx.providerType / ctx.modelInstance
 */
export async function stepSelectProvider(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 1. 解析 providerId：优先用 input 中的，否则用默认
    const inputProviderId = extractStringField(ctx.input, 'providerId')
    const providerId = inputProviderId ?? getDefaultProviderId()

    // 2. 确保 Provider 列表已初始化（首次启动时）
    try {
      ensureProvidersInitialized()
    } catch (err) {
      log.warn('ensureProvidersInitialized 抛错（可能 electron-store 未就绪）', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 3. 获取 Provider 配置（含 apiKey）
    const config = getProviderWithApiKey(providerId)
    if (!config) {
      return {
        step: 'select-provider',
        success: false,
        error: `Provider "${providerId}" 不存在，请在设置中配置`,
        durationMs: Date.now() - start,
      }
    }

    // 4. 根据 type 分支：claude-sdk 不创建 LanguageModel（用 ClaudeSdkProvider）
    const providerType: ProviderType = config.type
    let modelInstance: ProviderModelInstance | undefined
    if (providerType !== 'claude-sdk') {
      try {
        modelInstance = createLanguageModel(config)
      } catch (err) {
        return {
          step: 'select-provider',
          success: false,
          error: `创建 LanguageModel 失败：${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - start,
        }
      }
    }

    // 5. 写入 ctx
    ctx.providerConfig = config
    ctx.providerType = providerType
    ctx.modelInstance = modelInstance

    log.info('step 6/14 select-provider 通过', {
      taskId: ctx.taskId,
      providerId: config.id,
      providerName: config.name,
      providerType,
      model: config.model,
      hasModelInstance: modelInstance !== undefined,
    })
    return {
      step: 'select-provider',
      success: true,
      output: {
        providerId: config.id,
        providerName: config.name,
        providerType,
        model: config.model,
        source: inputProviderId ? 'input' : 'default',
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'select-provider',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 7：选择 Mode
 *
 * 借鉴 Kilo Code：mode 即 primary agent，subagent 用 ask/chat 只读模式
 * - Explore Subagent 默认用 chat 模式（只读）
 *
 * 真实逻辑：
 * 1. 优先从 ctx.input 解析 mode（如果 input 是对象且有 mode）
 * 2. 否则用 getCurrentMode()
 * 3. 加载 MODE_CONFIGS[mode]
 * 4. 写入 ctx.mode / ctx.modeConfig
 */
export async function stepSelectMode(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 1. 解析 mode：优先用 input 中的
    const inputMode = readInputField(ctx.input, 'mode')
    let mode: AgentMode
    if (typeof inputMode === 'string' && isValidMode(inputMode)) {
      mode = inputMode
    } else {
      mode = getCurrentMode()
    }

    // 2. 加载 mode 配置
    const modeConfig: ModeConfig = MODE_CONFIGS[mode]

    // 3. 写入 ctx
    ctx.mode = mode
    ctx.modeConfig = modeConfig

    log.debug('step 7/14 select-mode 通过', {
      taskId: ctx.taskId,
      mode,
      displayName: modeConfig.displayName,
      allowedToolsCount: modeConfig.allowedTools.length,
      canWriteFiles: modeConfig.canWriteFiles,
      canExecuteCommands: modeConfig.canExecuteCommands,
    })
    return {
      step: 'select-mode',
      success: true,
      output: {
        mode,
        displayName: modeConfig.displayName,
        canWriteFiles: modeConfig.canWriteFiles,
        canExecuteCommands: modeConfig.canExecuteCommands,
        source: typeof inputMode === 'string' ? 'input' : 'current',
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'select-mode',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 8：构建 prompt
 *
 * 真实逻辑：
 * 1. 构建 systemPrompt = modeConfig.systemPrompt + attentionContext（如果有）
 * 2. 从 ctx.input 解析 userPrompt（string 直接用，对象用 input.prompt / input.description）
 * 3. 构建 messages: [{role:'system'}, {role:'user'}]
 * 4. 调用 compactIfNeeded 对 messages 进行 compaction
 * 5. 写入 ctx.systemPrompt / ctx.userPrompt / ctx.messages
 */
export async function stepBuildPrompt(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 1. 校验前置步骤产出
    if (!ctx.modeConfig) {
      return {
        step: 'build-prompt',
        success: false,
        error: '缺少 modeConfig（select-mode 步骤未产出）',
        durationMs: Date.now() - start,
      }
    }

    // 2. 构建 systemPrompt（modeConfig.systemPrompt + attentionContext）
    let systemPrompt = ctx.modeConfig.systemPrompt
    if (ctx.attentionContext && ctx.attentionContext.length > 0) {
      systemPrompt = `${systemPrompt}\n\n[当前注意力上下文]\n${ctx.attentionContext}`
    }

    // 3. 解析 userPrompt
    let userPrompt: string
    if (typeof ctx.input === 'string') {
      userPrompt = ctx.input
    } else if (ctx.input && typeof ctx.input === 'object') {
      const promptField = extractStringField(ctx.input, 'prompt')
      const descriptionField = extractStringField(ctx.input, 'description')
      userPrompt = promptField ?? descriptionField ?? JSON.stringify(ctx.input)
    } else {
      userPrompt = String(ctx.input ?? '')
    }

    // 4. 构建 messages
    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    // 5. compaction（5 层阈值，避免超长 context）
    const compaction = compactIfNeeded(messages)

    // 6. 写入 ctx
    ctx.systemPrompt = systemPrompt
    ctx.userPrompt = userPrompt
    ctx.messages = compaction.messages

    log.debug('step 8/14 build-prompt 通过', {
      taskId: ctx.taskId,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      messageCount: compaction.messages.length,
      compactionLevel: compaction.level,
      beforeTokens: compaction.beforeTokens,
      afterTokens: compaction.afterTokens,
    })
    return {
      step: 'build-prompt',
      success: true,
      output: {
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        messageCount: compaction.messages.length,
        compactionLevel: compaction.level,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'build-prompt',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

// ============================================================================
// D.3 头：step 9-10（invoke-subagent / stream-output）
// ============================================================================

/**
 * 步骤 9：调用 Subagent
 *
 * 借鉴 Kilo Code：ops.prompt({ sessionID, tools: { question: false, interactive_terminal: false } })
 * - 在子 session 中执行，subagent 不能 question、不能 interactive_terminal
 *
 * 真实逻辑：
 * 1. 校验前置步骤产出（providerConfig / messages）
 * 2. 创建 AbortController
 * 3. 根据 providerType 分支：
 *    - claude-sdk: 用 ClaudeSdkProvider.generate()
 *    - 其他: 用 streamText + 消费 textStream
 * 4. 写入 ctx.chatResult / ctx.abortController
 */
export async function stepInvokeSubagent(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 1. 校验前置步骤产出
    if (!ctx.providerConfig || !ctx.providerType) {
      return {
        step: 'invoke-subagent',
        success: false,
        error: '缺少 Provider 配置（select-provider 步骤未产出）',
        durationMs: Date.now() - start,
      }
    }
    if (!ctx.messages || ctx.messages.length === 0) {
      return {
        step: 'invoke-subagent',
        success: false,
        error: '缺少 messages（build-prompt 步骤未产出）',
        durationMs: Date.now() - start,
      }
    }

    // 2. 创建 AbortController
    const abortController = new AbortController()
    ctx.abortController = abortController
    const correlationId = ctx.correlationId ?? `task_${ctx.taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    ctx.correlationId = correlationId

    // 3. 根据 ProviderType 分支调用
    let chatResult: ChatResult
    if (ctx.providerType === 'claude-sdk') {
      // Claude SDK 路径：用 ClaudeSdkProvider.generate()
      chatResult = await invokeWithClaudeSdk(ctx, correlationId)
    } else {
      // 普通路径：用 streamText 消费 textStream
      chatResult = await invokeWithStreamText(ctx, abortController, start)
    }

    ctx.chatResult = chatResult

    log.info('step 9/14 invoke-subagent 通过', {
      taskId: ctx.taskId,
      providerId: ctx.providerConfig.id,
      model: chatResult.model,
      finishReason: chatResult.finishReason,
      textLength: chatResult.text.length,
      inputTokens: chatResult.usage.inputTokens,
      outputTokens: chatResult.usage.outputTokens,
      durationMs: Date.now() - start,
    })
    return {
      step: 'invoke-subagent',
      success: true,
      output: {
        invoked: true,
        providerId: ctx.providerConfig.id,
        model: chatResult.model,
        finishReason: chatResult.finishReason,
        textLength: chatResult.text.length,
        inputTokens: chatResult.usage.inputTokens,
        outputTokens: chatResult.usage.outputTokens,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'invoke-subagent',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * Claude SDK 调用路径（claude-sdk 类型 Provider）
 *
 * ClaudeSdkProvider 封装 @anthropic-ai/claude-agent-sdk 的 agent loop，
 * 接收单个 prompt 字符串，返回 ChatResult。
 */
async function invokeWithClaudeSdk(ctx: TaskProtocolContext, correlationId: string): Promise<ChatResult> {
  if (!ctx.providerConfig) {
    throw new Error('providerConfig 缺失')
  }
  const provider = new ClaudeSdkProvider(ctx.providerConfig)
  // Claude SDK 接收单个 prompt 字符串，从 messages 提取 user 内容
  const userPrompt = ctx.messages
    ?.filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n') ?? ''

  return await provider.generate({
    prompt: userPrompt,
    systemPrompt: ctx.systemPrompt,
    strength: ctx.strength ?? 'standard',
    correlationId,
  })
}

/**
 * streamText 调用路径（非 claude-sdk 类型 Provider）
 *
 * 使用 Vercel AI SDK v7 的 streamText + 消费 textStream，
 * 等待 result.usage / result.finishReason Promise 完成。
 */
async function invokeWithStreamText(
  ctx: TaskProtocolContext,
  abortController: AbortController,
  startTime: number
): Promise<ChatResult> {
  if (!ctx.modelInstance || !ctx.providerConfig || !ctx.messages) {
    throw new Error('modelInstance / providerConfig / messages 缺失')
  }

  const { temperature, maxTokens } = getDefaultParams(ctx.modelInstance.config)
  // 思考强度影响 maxTokens：deep 翻倍，fast 减半
  const strength = ctx.strength ?? 'standard'
  const effectiveMaxTokens =
    strength === 'deep' ? maxTokens * 2 : strength === 'fast' ? Math.floor(maxTokens / 2) : maxTokens

  const result = streamText({
    model: ctx.modelInstance.model,
    messages: ctx.messages,
    temperature,
    maxOutputTokens: effectiveMaxTokens,
    abortSignal: abortController.signal,
  })

  // 等待流完成
  let fullText = ''
  for await (const chunk of result.textStream) {
    if (chunk) {
      fullText += chunk
    }
    if (abortController.signal.aborted) {
      break
    }
  }

  const usage = await result.usage
  const finishReason = await result.finishReason
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0

  return {
    text: fullText,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    finishReason: finishReason ?? 'unknown',
    providerId: ctx.providerConfig.id,
    model: ctx.modelInstance.resolvedModel,
    strength,
    durationMs: Date.now() - startTime,
    compactionLevel: 'none',
  }
}

/**
 * 步骤 10：流式输出
 *
 * 借鉴 Kilo Code：foreground 等待结果，返回给父 agent
 *
 * 真实逻辑：
 * 1. 从 ctx.chatResult.text 提取输出
 * 2. 写入 ctx.output
 * 3. 如果 ctx.cancelled 或 finishReason='cancelled'，标记部分输出
 */
export async function stepStreamOutput(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    if (!ctx.chatResult) {
      return {
        step: 'stream-output',
        success: false,
        error: '缺少 chatResult（invoke-subagent 步骤未产出）',
        durationMs: Date.now() - start,
      }
    }

    // 1. 提取输出文本
    const output = ctx.chatResult.text
    const isCancelled = ctx.cancelled || ctx.chatResult.finishReason === 'cancelled'

    // 2. 写入 ctx
    ctx.output = output

    log.info('step 10/14 stream-output 通过', {
      taskId: ctx.taskId,
      outputLength: output.length,
      isCancelled,
      finishReason: ctx.chatResult.finishReason,
    })
    return {
      step: 'stream-output',
      success: true,
      output: {
        chunksCount: 1, // 同步聚合模式：1 个完整 chunk
        totalLength: output.length,
        isCancelled,
        finishReason: ctx.chatResult.finishReason,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'stream-output',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}
