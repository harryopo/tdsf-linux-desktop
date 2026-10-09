/**
 * 带预算的调用（退出清理与调度器共用的一份）
 *
 * 为什么要有这一份：`await` 一个可能永远不返回的操作，在两个地方都出过事——
 * 退出流程里一个卡死的步骤会把整个应用钉在关闭界面；调度器里一个卡死的 handler
 * 会把 `entry.running` 永远留在 true，此后这个任务被 `if (running) continue` 静默跳过，
 * 连一条 task-error 日志都没有。两处原本各写各的（调度器干脆没写），这里是唯一一份。
 *
 * 语义要点：
 * - 超时**不取消**底层操作（JS 没法取消一个不响应取消的 Promise），只是让调用方拿回控制权；
 *   所以调用方必须能容忍"迟到的那个自己仍在跑"——这也正是退出清理宁可截预算也要继续往下走的原因。
 * - 定时器一定在 finally 里清掉，否则残留的 setTimeout 会钉住事件循环，
 *   应用关不掉（quit-cleanup 早期就踩过这个）。
 */

export interface TimeoutOutcome<T> {
  /** 操作在预算内正常完成（返回值未必成功，看 error/value） */
  ok: boolean
  /** 耗时（毫秒） */
  ms: number
  /** 是否因为预算用尽而返回 */
  timedOut: boolean
  /** 操作抛出的错误信息（若有） */
  error?: string
  /** 操作的返回值（超时或抛错时为 undefined） */
  value?: T
}

/**
 * @param fn 要执行的操作（同步抛错也会被捕获成 error，不会冒泡）
 * @param timeoutMs 预算（毫秒）；<=0 视为不设预算的调用请直接用 await
 */
export async function callWithTimeout<T>(
  fn: () => T | Promise<T>,
  timeoutMs: number,
): Promise<TimeoutOutcome<T>> {
  const t0 = Date.now()
  let timer: NodeJS.Timeout | undefined
  const budget = new Promise<'超时'>((resolve) => {
    timer = setTimeout(() => resolve('超时'), Math.max(1, timeoutMs))
  })
  // 超时那一边仍在跑，它的迟到失败必须有落点，否则变成 unhandled rejection
  const work = Promise.resolve()
    .then(() => fn())
    .then((value) => ({ done: true as const, value }))
  work.catch(() => undefined)
  try {
    const raced = await Promise.race([work, budget.then(() => ({ done: false as const }))])
    const ms = Date.now() - t0
    if (raced.done) {
      return { ok: true, ms, timedOut: false, value: raced.value as T }
    }
    return { ok: false, ms, timedOut: true, error: `超过 ${timeoutMs}ms 未完成` }
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - t0,
      timedOut: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
