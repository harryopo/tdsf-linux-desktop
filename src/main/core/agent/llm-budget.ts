/**
 * 一次模型调用的时间预算（唯一来源）
 *
 * 2026-10-15 全维度审查 D1 + 现场取证：主链路 streamText 既没传 timeout 也没传 maxRetries，
 * 唯一的 90 秒空闲看门狗又在"工具执行期"整体暂停（因为审批等待也算工具期）。
 * 结果是同一产品里两种极端并存——LlmClient 那条能算清（4×30s+7s=127s），
 * 而真正天天用的主对话最坏无界：12 步 × 审批 60s + 12 步 × 命令超时（可配到 600 秒）
 * ≈ 两小时，期间点"停止"还无效。用户看到的就是"AI 面板转圈，不起不动"。
 *
 * 所以这里把散在 14 处的秒数收成一张表，并且区分两种预算：
 *   - 停滞预算（chunkMs / stepMs）：只要模型还在吐字就不消耗，专治"每 89 秒滴一个字"；
 *   - 总预算（totalMs）：绝对上限，专治"每步都合规但加起来无穷"。
 * 两者都由 SDK 计时（timeout 选项），不再依赖我们自己在回调里重置看门狗——
 * 自己写的看门狗一旦在某个分支 return（工具期暂停），防线就出现洞。
 *
 * 审批等待的三档时长（60s / 30s / 300s）**保持原值**，只是从散落字面量改成表里的具名条目：
 * 缩短等待会把"用户还在想"变成"自动拒绝"，那是行为变更，不属于稳定性修复的顺手范围。
 */

/** 用户在设置页配的「单次请求超时」兜底与夹取范围（毫秒） */
const SETTING_TIMEOUT_DEFAULT_MS = 30_000
const SETTING_TIMEOUT_MIN_MS = 10_000
const SETTING_TIMEOUT_MAX_MS = 300_000

/** 模型连续多少毫秒不吐字节就算停滞（原 90 秒看门狗的一半：它曾在大模型思考长链上误杀，也曾在慢速提供方上完全不生效） */
const CHUNK_STALL_MS = 45_000
/** 单次工具调用的余量：审批之外还要给命令本身与网络往返 */
const TOOL_MARGIN_MS = 30_000
/** 总预算夹取范围：下限保证一次正常的多步任务不被腰斩，上限是"界面最坏转圈多久" */
const TOTAL_MIN_MS = 90_000
const TOTAL_MAX_MS = 15 * 60_000

/** 脏值一律回默认，绝不产生 NaN（setTimeout(NaN) 会立刻触发，等于所有请求一发出就超时） */
function clampMs(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export interface LlmTimeoutConfig {
  totalMs: number
  stepMs: number
  chunkMs: number
  /** 未单独指名的工具用这个；按工具名单覆写在 tools 里 */
  toolMs?: number
  /** 键是 `<工具名>Ms`，这是 AI SDK v7 的按工具超时约定 */
  tools?: Record<string, number>
}

export interface LlmBudget {
  timeout: LlmTimeoutConfig
  /**
   * SDK 层的重试次数。
   * 定 1 而不是默认 2：maxRetries 只管"调用建立阶段"的失败（还没开始出字），
   * 出字之后的中断由调用方自己判——已经推给界面的字绝不能靠重发补，那会重复输出。
   * 留 1 次是给瞬时网络抖动的，不再叠第二层栈。
   */
  maxRetries: number
  /** 多步工具循环的步数上限（stopWhen） */
  stepCount: number
  approvalMs: number
}

/**
 * 主对话 / 子代理 / 工具调用的预算输入。
 * @param settingTimeoutMs 设置页那一格（LlmConfig.timeout），单位毫秒
 * @param execTimeoutMs 远端命令超时（terminal.cmdTimeout），单位毫秒
 * @param stepCount 允许的工具循环步数
 * @param approvalMs 单次审批等待
 */
export function resolveLlmBudget(input: {
  settingTimeoutMs?: unknown
  execTimeoutMs?: unknown
  approvalMs?: unknown
  stepCount?: number
  /** 有没有挂工具：没工具时不给 toolMs，避免把"无工具"的调用也算上工具预算 */
  hasTools?: boolean
}): LlmBudget {
  const stepMs = clampMs(input.settingTimeoutMs, SETTING_TIMEOUT_MIN_MS, SETTING_TIMEOUT_MAX_MS, SETTING_TIMEOUT_DEFAULT_MS)
  const stepCount = Number.isFinite(input.stepCount) && (input.stepCount as number) > 0 ? (input.stepCount as number) : 1
  const approvalMs = clampMs(input.approvalMs, 5_000, 10 * 60_000, 60_000)
  const execMs = clampMs(input.execTimeoutMs, 10_000, 600_000, 30_000)
  const hasTools = input.hasTools !== false

  const toolMs = hasTools ? approvalMs + execMs + TOOL_MARGIN_MS : undefined
  // 总预算 = 每步模型时间 + 每步可能的一次工具往返，再留一次余量；最后夹到 [90s, 15min]
  const rawTotal = stepMs * (stepCount + 1) + (toolMs ? toolMs * stepCount : 0)

  return {
    timeout: {
      totalMs: Math.min(TOTAL_MAX_MS, Math.max(TOTAL_MIN_MS, rawTotal)),
      stepMs,
      chunkMs: Math.min(stepMs, CHUNK_STALL_MS),
      ...(toolMs !== undefined ? { toolMs } : {}),
    },
    maxRetries: 1,
    stepCount,
    approvalMs,
  }
}

/**
 * 判断一次失败是不是"预算到了"。
 *
 * AI SDK v7 的 timeout 是靠一个内部 AbortSignal 实现的，到期时它用
 * `DOMException('<label> timeout of Nms exceeded', 'TimeoutError')` 去 abort。
 * 所以"超时"和"用户点停止"在结果上都是 abort，唯一可靠的区分是这个名字/文案。
 *
 * 用途：主链路要据此决定报"AI 响应超时，请重试"还是"已取消"——两者给用户的下一步完全不同。
 * 自己写的空闲看门狗之所以要拆掉，就是因为这两件事在它那里区分不出来（它在工具期还会整体暂停）。
 */
export function isLlmTimeout(err: unknown, signal?: AbortSignal): boolean {
  const reasons: unknown[] = [err]
  if (signal?.aborted) reasons.push(signal.reason)
  return reasons.some((r) => {
    if (!r) return false
    const e = r as { name?: string; message?: string }
    if (e.name === 'TimeoutError') return true
    const msg = typeof e.message === 'string' ? e.message : String(r)
    return /timeout of \d+ms exceeded/i.test(msg)
  })
}

/**
 * 审批等待时长（历史上是 30/60/300 秒散在六处）。
 * 数值原样保留，集中登记的目的是让"为什么这里更长"有个能读的地方。
 */
export const APPROVAL_BUDGET_MS = {
  /** 主对话写命令 / PAOR 步骤审批：与"用户在看着屏幕"的场景匹配 */
  chatWrite: 60_000,
  /** llm:tool-approval 与 sandbox 高危：这两处历史上都是 30 秒 */
  toolCall: 30_000,
  sandboxCommand: 30_000,
  /** 子代理调度：整批任务的审批窗口，历史上比单点长一个量级（自动拒绝会打断长任务） */
  subagentBatch: 300_000,
} as const
