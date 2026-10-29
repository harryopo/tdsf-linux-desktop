/**
 * DeepSeek 推理流改写（v2.11 修复"深度思考看不到"）
 *
 * 背景：DeepSeek V4/R1 思考模式把推理放在 chat 流的 `delta.reasoning_content`，
 * 但 @ai-sdk/openai 2.x 只读 `delta.content`，完全忽略 reasoning_content → 思考被丢弃。
 *
 * 方案：在 fetch 层拦截 SSE 流，把 reasoning_content 增量改写成 `<REASONING_TAG>…</REASONING_TAG>`
 * 包裹的 content 增量；上层再用 `extractReasoningMiddleware({ tagName: REASONING_TAG })`
 * 提取回标准 reasoning 分片，供 UI 折叠展示。标签名是本文件导出的单源，两边都引它。
 *
 * 本文件是纯逻辑（无 I/O），便于单测锁死；TransformStream 装配在 provider-factory。
 */

/**
 * 承载推理增量的标签名。
 *
 * 不用 <think> 这种"看起来自然"的标签：模型在正文里真写出 <think>（讲 DeepSeek 协议、
 * 写 XML 示例、贴代码）时，那一整段会被 extractReasoningMiddleware 从答案里搬进
 * 折叠的思考块。标签越罕见越不会撞车，改这一处两边同时生效（fetch 层与中间件）。
 */
export const REASONING_TAG = 'tdsreason'

/** 推理标签开合状态（单次请求内可变，随流推进） */
export interface ReasoningTagState {
  /** <think> 已开启、尚未闭合 */
  open: boolean
  /** </think> 已闭合（一次请求只闭合一次） */
  closed: boolean
  /** 本次响应里累计的推理原文（用于下一轮把 reasoning_content 原样带回） */
  reasoning: string
}

/** 新建初始状态 */
export function createReasoningTagState(): ReasoningTagState {
  return { open: false, closed: false, reasoning: '' }
}

interface ChatChunkLike {
  choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>
}

/**
 * 改写单个 chat.completion.chunk 对象（就地修改并返回）：
 * - delta.reasoning_content 非空 → 移入 delta.content，首个推理增量前置 `<think>`
 * - 推理结束后首个正文 content（或结束帧）→ 前置 `</think>` 闭合
 *
 * @param obj 解析后的 chunk 对象
 * @param state think 标签状态（跨增量保持）
 */
export function rewriteReasoningChunk(obj: unknown, state: ReasoningTagState): unknown {
  const chunk = obj as ChatChunkLike
  const delta = chunk?.choices?.[0]?.delta
  if (!delta || typeof delta !== 'object') return obj

  const rc = delta.reasoning_content
  if (typeof rc === 'string' && rc.length > 0) {
    // 推理增量：包进 content，首段前置 <think>
    const prefix = state.open || state.closed ? '' : `<${REASONING_TAG}>`
    state.open = !state.closed
    state.reasoning += rc
    const existing = typeof delta.content === 'string' ? delta.content : ''
    delta.content = `${prefix}${rc}${existing}`
    delete delta.reasoning_content
    return obj
  }

  // 推理已开启：首个正文/结束帧前置 </think> 闭合
  if (state.open && !state.closed) {
    const c = typeof delta.content === 'string' ? delta.content : ''
    delta.content = `</${REASONING_TAG}>${c}`
    state.open = false
    state.closed = true
  }
  return obj
}

/**
 * 把捕获到的推理原文补回 assistant(tool_calls) 的 reasoning_content
 *
 * DeepSeek 思考模式 + 工具调用时，带 tool_calls 的 assistant 消息在下一轮必须把
 * reasoning_content 原样带回去，否则 400（"The reasoning_content in the thinking
 * mode must be passed back to the API"）。@ai-sdk/openai 转消息时会把 reasoning
 * 分片整个丢掉，所以只能在 fetch 层补。
 *
 * 按顺序对齐：payload 里第 k 条"带 tool_calls 的 assistant" ↔ 本模型实例第 k 段
 * 捕获到的推理。已经带 reasoning_content 的消息不动。
 *
 * @param payload 请求体（就地修改）
 * @param captured 按响应顺序捕获的推理原文
 * @returns 是否改动了 payload
 */
export function injectReasoningContent(
  payload: Record<string, unknown>,
  captured: readonly string[],
): boolean {
  if (captured.length === 0) return false
  const messages = payload.messages
  if (!Array.isArray(messages)) return false
  let changed = false
  let k = 0
  for (const m of messages as Array<Record<string, unknown>>) {
    if (!m || typeof m !== 'object' || m.role !== 'assistant') continue
    const toolCalls = m.tool_calls
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) continue
    if (typeof m.reasoning_content !== 'string') {
      const reasoning = captured[k]
      if (reasoning !== undefined) {
        m.reasoning_content = reasoning
        changed = true
      }
    }
    k++
  }
  return changed
}

/**
 * 改写单行 SSE 文本（`data: {json}`）；非数据行/[DONE]/非 JSON 原样返回。
 *
 * @param line 单行 SSE 文本（不含结尾换行）
 * @param state think 标签状态
 */
export function rewriteSseLine(line: string, state: ReasoningTagState): string {
  const trimmed = line.trimStart()
  if (!trimmed.startsWith('data:')) return line
  const payload = trimmed.slice(5).trim()
  if (payload === '' || payload === '[DONE]') return line
  try {
    const obj = JSON.parse(payload)
    rewriteReasoningChunk(obj, state)
    return `data: ${JSON.stringify(obj)}`
  } catch {
    // 非 JSON 数据行原样透传
    return line
  }
}
