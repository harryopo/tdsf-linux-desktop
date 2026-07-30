/**
 * DeepSeek 推理流改写（v2.11 修复"深度思考看不到"）
 *
 * 背景：DeepSeek V4/R1 思考模式把推理放在 chat 流的 `delta.reasoning_content`，
 * 但 @ai-sdk/openai 2.x 只读 `delta.content`，完全忽略 reasoning_content → 思考被丢弃。
 *
 * 方案：在 fetch 层拦截 SSE 流，把 reasoning_content 增量改写成 `<think>…</think>` 包裹的
 * content 增量；上层再用 `extractReasoningMiddleware({ tagName: 'think' })` 把 <think> 段
 * 提取回标准 reasoning 分片，供 UI 折叠展示。
 *
 * 本文件是纯逻辑（无 I/O），便于单测锁死；TransformStream 装配在 provider-factory。
 */

/** think 标签开合状态（单次请求内可变，随流推进） */
export interface ReasoningTagState {
  /** <think> 已开启、尚未闭合 */
  open: boolean
  /** </think> 已闭合（一次请求只闭合一次） */
  closed: boolean
}

/** 新建初始状态 */
export function createReasoningTagState(): ReasoningTagState {
  return { open: false, closed: false }
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
    const prefix = state.open || state.closed ? '' : '<think>'
    state.open = !state.closed
    const existing = typeof delta.content === 'string' ? delta.content : ''
    delta.content = `${prefix}${rc}${existing}`
    delete delta.reasoning_content
    return obj
  }

  // 推理已开启：首个正文/结束帧前置 </think> 闭合
  if (state.open && !state.closed) {
    const c = typeof delta.content === 'string' ? delta.content : ''
    delta.content = `</think>${c}`
    state.open = false
    state.closed = true
  }
  return obj
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
