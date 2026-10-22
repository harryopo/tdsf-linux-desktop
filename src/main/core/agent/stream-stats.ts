/**
 * 读一次流式调用的统计账（用量 / 完成原因 / 逐步明细）
 *
 * 三项各自独立 await。以前它们在调用方共用一个 try：ai-sdk 在流里见过错时会把
 * `result.usage` / `result.finishReason` / `result.steps` 一起 reject，
 * 于是一项失败就把另外两项也丢了——而用量恰恰是失败那一轮最需要留下的东西
 * （没有它，设置页只剩估算镜像可看）。
 *
 * 这里不抛异常：拿账失败只把原因带回来。调用方自己决定"这次调用算不算失败"，
 * 那是业务判定，不该由一件读数的工具替它做。
 */

export interface StreamStatsSource<U, F, S> {
  /** SDK 给的是 PromiseLike（`result.usage` 就是），不许把签名收紧成 Promise */
  usage: PromiseLike<U>
  finishReason: PromiseLike<F>
  steps: PromiseLike<S>
}

export interface StreamStats<U, F, S> {
  usage: U | undefined
  finishReason: F | undefined
  steps: S | undefined
  /** 哪几项没拿到（顺序固定：usage、finishReason、steps） */
  readErrors: unknown[]
}

async function one<T>(p: PromiseLike<T>): Promise<{ value: T | undefined; error: unknown }> {
  try {
    return { value: await p, error: undefined }
  } catch (err) {
    return { value: undefined, error: err }
  }
}

export async function readStreamStats<U, F, S>(
  result: StreamStatsSource<U, F, S>
): Promise<StreamStats<U, F, S>> {
  const [u, f, s] = await Promise.all([one(result.usage), one(result.finishReason), one(result.steps)])
  return {
    usage: u.value,
    finishReason: f.value,
    steps: s.value,
    readErrors: [u.error, f.error, s.error].filter((e) => e !== undefined),
  }
}

// ============================================================================
// 流内用量累积
// ============================================================================

/** 一项 token 计数（形状与 SDK 的 LanguageModelUsage 对齐，字段名不猜） */
export interface UsageNumbers {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface StreamUsageAccumulator {
  /**
   * 这一轮累计烧掉多少。多步工具链里它是**各步之和**（同一份上下文被重发 N 次），
   * 所以只用来计费；"窗口还剩多少"要看 lastStep。
   */
  total: UsageNumbers | undefined
  /** 末步的 prompt + completion：徽章口径 */
  lastStep: UsageNumbers | undefined
  /** 已完成的步数 */
  steps: number
  /** 流是被中止结束的（用户点了"停止"） */
  aborted: boolean
}

export function createUsageAccumulator(): StreamUsageAccumulator {
  return { total: undefined, lastStep: undefined, steps: 0, aborted: false }
}

function asUsage(value: unknown): UsageNumbers | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  const input = typeof v.inputTokens === 'number' ? v.inputTokens : undefined
  const output = typeof v.outputTokens === 'number' ? v.outputTokens : undefined
  if (input === undefined || output === undefined) return undefined
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: typeof v.totalTokens === 'number' ? v.totalTokens : input + output,
  }
}

/**
 * 喂一个流事件进累加器，返回新累加器（无关事件原样返回同一个对象）。
 *
 * 为什么要在循环里攒而不是只等 `result.usage`：中止时 `for await` 干净收尾（实测不抛），
 * 但 `result.usage` / `finishReason` / `steps` 三个 promise 全部 reject
 * （判据见 tests/unit/ai-sdk-abort-shape.test.ts），循环后那段拿账代码一条也拿不到。
 * 而 SDK 在流里已经把每步用量报过一次（`finish-step.usage` / `finish.totalUsage`，
 * 见 node_modules/ai/dist/index.d.ts:3035-3050），攒下来才能在
 * "第 N 步失败/停止"这种形状里保住前 N-1 步的账。
 */
export function observeStreamPart(
  part: unknown,
  acc: StreamUsageAccumulator
): StreamUsageAccumulator {
  const type = (part as { type?: unknown }).type
  if (type === 'finish-step') {
    const usage = asUsage((part as { usage?: unknown }).usage)
    if (!usage) return acc
    const total = acc.total
      ? {
          inputTokens: acc.total.inputTokens + usage.inputTokens,
          outputTokens: acc.total.outputTokens + usage.outputTokens,
          totalTokens: acc.total.totalTokens + usage.totalTokens,
        }
      : usage
    return { ...acc, total, lastStep: usage, steps: acc.steps + 1 }
  }
  if (type === 'finish') {
    const totalUsage = asUsage((part as { totalUsage?: unknown }).totalUsage)
    return totalUsage ? { ...acc, total: totalUsage } : acc
  }
  if (type === 'abort') {
    return { ...acc, aborted: true }
  }
  return acc
}

/**
 * 这一轮到底该不该入账，以及按哪个数入。
 *
 * 三条规则，缺一不可：
 * 1. SDK 回来的用量是正本（各步之和），有就用它；
 * 2. 拿不到正本就用流里攒到的（第 N 步失败/停止时，前 N-1 步是真烧了 token 的）；
 * 3. 两边都没有 → null。**这时候记 0 是写假账**：0 宣称"这一轮一个 token 没烧"，
 *    而真值是"没拿到账"。中止那一轮绝大多数落在这一条——实测 abort 之前不会有任何
 *    finish-step，所以取消的代价只能是"不入账 + 界面说不拿到账"，不是"照常入账"。
 */
export function planUsageRecord(input: {
  /** SDK 的 usage（`LanguageModelUsage`，各项都可能是 undefined），原样递进来，由这里归一 */
  sdkUsage?: unknown
  accumulated: StreamUsageAccumulator
}): UsageNumbers | null {
  const sdk = asUsage(input.sdkUsage)
  if (sdk && sdk.totalTokens > 0) return sdk
  if (input.accumulated.total) return input.accumulated.total
  return null
}
