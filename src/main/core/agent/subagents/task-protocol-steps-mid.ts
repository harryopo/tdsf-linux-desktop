/**
 * Subagent 调度 14 步协议 - 步骤 6-10（D.2 + D.3 头）
 *
 * 从 task-protocol-steps.ts 拆分而来（避免单文件超 500 行硬约束）。
 *
 * 包含：
 * - step 6: select-provider（D.2，解析 providerId → getProviderWithApiKey → createLanguageModel）
 * - step 7: select-mode（D.2，解析 mode → getCurrentMode → MODE_CONFIGS[mode]）
 * - step 8: build-prompt（D.2，systemPrompt + attentionContext + compactIfNeeded）
 * - step 9: invoke-subagent（D.3，streamText 消费 textStream）
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
import { redactSecrets } from '../providers/redact'
import { MODE_CONFIGS, isValidMode, getCurrentMode } from '../modes/mode-registry'
import { compactIfNeeded } from '../context'
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
 * 4. 调用 createLanguageModel 创建 modelInstance
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

    // 4. 创建 LanguageModel（所有类型同一条路径）
    const providerType: ProviderType = config.type
    let modelInstance: ProviderModelInstance
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
    //    chat 那条路逐条过 redactSecrets（HC-6），Task/subagent 这条路以前直接把
    //    用户输入和终端上下文原文发给 Provider —— 用户在终端里敲过的口令会跟着走。
    //    这里脱敏的只是"发给模型看的内容"，执行用的参数由模型的 tool 调用另出。
    const messages: ModelMessage[] = [
      { role: 'system', content: redactSecrets(systemPrompt) },
      { role: 'user', content: redactSecrets(userPrompt) },
    ]

    // 5. compaction（阈值按这台 Provider 的生效窗口收，小窗口模型不再一路不压缩直到 400）
    const compaction = compactIfNeeded(messages, ctx.providerConfig?.capabilities?.contextWindow)
    // step 9 要把这个等级如实写进 ChatResult.compactionLevel。
    // 之前 step 9 硬编码 'none'：子代理这一路永远不告诉 UI/日志压过没压，
    // 而 chat 那条路（supervisor）报的是真值——同一个字段两条路口径不同，
    // 看板上"从未压缩"就是假的。
    ctx.compactionLevel = compaction.level

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
 *    用 streamText + 消费 textStream
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

    // 3. 调用模型（全仓唯一一条 @ai-sdk 路径）
    const chatResult: ChatResult = await invokeWithStreamText(ctx, abortController, start)

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
 * streamText 调用路径
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
  //
  // 取消（用户点停止 / step 13 释放 AbortController）时，SDK 会让 textStream 迭代器
  // 直接抛错，而 result.usage / result.finishReason 也可能 reject。原实现把这三处
  // 都摊给上层 catch：于是"取消"在日志与步骤结果里长得跟"模型调用失败"一模一样，
  // 已经吐出来的那半段字也一起丢了。这里分三步如实收口：
  //   1. 迭代器抛错且信号已 abort ⇒ 记下中断，保留已收到的 fullText
  //   2. usage / finishReason 用 settle() 兜住 reject 与"永不落定"（2s 上限）
  //   3. 结论写 finishReason='cancelled'，让 step 10/12 走"部分输出"而不是报错
  let fullText = ''
  for await (const chunk of settleStream(result.textStream, abortController.signal)) {
    // 先判停止再收字：abort 之后才到达的分片用户从没看到过，计进去等于把
    // "停在第 30 字"报成"停在第 45 字"。旧顺序是 append→check，正好多收一片。
    if (abortController.signal.aborted) break
    if (chunk) fullText += chunk
  }

  const aborted = abortController.signal.aborted
  const usage = await settle(
    (async () => result.usage)(),
    'usage'
  )
  const rawFinish = await settle((async () => result.finishReason)(), 'finishReason')
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0

  return {
    text: fullText,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    finishReason: aborted ? 'cancelled' : (rawFinish ?? 'unknown'),
    providerId: ctx.providerConfig.id,
    model: ctx.modelInstance.resolvedModel,
    strength,
    durationMs: Date.now() - startTime,
    compactionLevel: ctx.compactionLevel ?? 'none',
  }
}

/**
 * 消费 textStream，遇 abort 干净收尾；非取消的抛错照常往上抛（由 step 9 记为失败）。
 *
 * 做成 async generator 是为了让"边收边判 abort"这段逻辑只有一份。
 */
async function* settleStream(
  stream: AsyncIterable<string>,
  signal: AbortSignal
): AsyncGenerator<string> {
  try {
    for await (const chunk of stream) {
      yield chunk
      if (signal.aborted) return
    }
  } catch (err) {
    if (!signal.aborted) throw err
    log.debug('streamText 流在取消时抛错，按已取消处理', { message: String(err) })
  }
}

/**
 * 兜住"会 reject 或永不落定"的 SDK Promise。
 *
 * 上限 2s：AI SDK 在 abort 之后不保证 usage/finishReason 一定 settle，
 * 没有这个上限就是取消一次、子代理永久挂在 step 9。
 */
async function settle<T>(p: Promise<T>, what: string): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      p.catch((err: unknown) => {
        log.debug(`streamText ${what} 未取到（按已取消/未知处理）`, { message: String(err) })
        return undefined
      }),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 2_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
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
