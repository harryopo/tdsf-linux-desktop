/**
 * RunRegistry — Agent 运行的唯一生命周期真相源
 *
 * 三个病都指向同一件事：**没有一处地方对"这一轮 Run 什么时候结束"负责**。
 * 之前 supervisor.activeRequests、agent-runtime 的 paorRuns、session-registry 的
 * abortController、审批挂起表各记各的账，于是：
 *
 *   1. 终态丢失：收尾只做"往活着的窗口 send 一下"。窗口重建 / 没有窗口时事件直接消失，
 *      界面永远停在 streaming（StreamStallHint 也只会一直说"仍在等待上游"）。
 *      这里把终态**先落在 Run 上**，订阅者晚到也补发；finish 幂等，终态恰好一次。
 *   2. 首包竞态：与 Run 无关，由渲染层 agent-store 的首包缓冲负责（见 appendToken）。
 *   3. 并发无互锁：begin() 以 sshSessionId 为粒度占锁，同会话第二条 Run 直接 busy。
 *      两条 Run 同时向外下发命令的场景在入口就被挡住。
 *
 * 状态机（单向，除 awaiting_approval 可回到 running）：
 *
 *   running ─┬─> completed
 *            ├─> failed
 *            ├─> awaiting_approval ─> running
 *            └─> cancelling ─> cancelled   （requestCancel 只到 cancelling，
 *                                           必须由被中断方 confirmCancel 才落终态）
 *
 * 为什么没有第 7 态：产品里没有排队 / 调度入口，begin 是原子占锁，
 * 加一个没人会走的状态只会让状态机多一条无法被测试覆盖的路。等真要做排队时再加。
 */

export type RunKind = 'chat' | 'paor' | 'sandbox'

export type RunState =
  | 'running'
  | 'awaiting_approval'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * 失败原因（参考 pi-durable 的 runFailure，按本产品现有出口裁剪）
 *
 * 只列真实会发生的：用户取消、审批拒绝、预算超时、上游 Provider 错误、
 * 工具执行错误，以及兜底 unknown。刻意不给每种错误都造一个 reason——
 * 多出来的枚举值没人赋值，读的人会以为那几种情况有单独处理。
 */
export type RunFailureReason =
  | 'aborted_by_user'
  | 'approval_denied'
  | 'budget_timeout'
  | 'provider_error'
  | 'tool_error'
  | 'unknown'

export interface RunTerminal {
  state: 'completed' | 'failed' | 'cancelled'
  ok: boolean
  result?: unknown
  failure?: RunFailureReason
  error?: string
}

export type RunEvent =
  | { type: 'state'; state: RunState }
  | { type: 'terminal'; outcome: RunTerminal }

export interface Run {
  readonly id: string
  readonly kind: RunKind
  readonly sshSessionId?: string
  readonly startedAt: number
  /** 唯一的中止入口：supervisor 的 activeRequests、session-registry 的 abortController 都收敛到这里 */
  readonly controller: AbortController
  state: RunState
  endedAt?: number
  outcome?: RunTerminal
  /** 这轮 Run 正在等待的审批请求 id（审批挂起表的收敛点，取消时统一 settle） */
  readonly pendingApprovals: Set<string>
}

export interface BeginInput {
  id: string
  kind: RunKind
  sshSessionId?: string
}

export type BeginResult = { ok: true; run: Run } | { ok: false; reason: 'busy'; existing: Run }

export interface FinishInput {
  ok: boolean
  result?: unknown
  failure?: RunFailureReason
  error?: string
}

/** 先落盘再展示：finish 在推送任何事件之前调用它 */
export type RunPersist = (run: Run, outcome: RunTerminal) => void

export interface RunRegistryOptions {
  persist?: RunPersist
  /**
   * 取消一轮 Run 时，把这一轮还挂着的审批立刻落成"拒绝"。
   *
   * 审批请求本身不吃 AbortSignal（approval-request.ts 只认 settle 与超时），
   * 不主动结算的话 Run 会停在 cancelling 等 60 秒审批超时，期间同会话一直被 busy 拒。
   */
  onCancelApproval?: (approvalId: string) => void
}

/** 终态 Run 的保留上限：迟到订阅者只在窗口重建的那几秒里需要它，不该无界增长 */
const MAX_TERMINAL_RUNS = 512

function isTerminal(state: RunState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

export class RunRegistry {
  private readonly runs = new Map<string, Run>()
  private readonly activeBySession = new Map<string, string>()
  private readonly listeners = new Map<string, Set<(evt: RunEvent) => void>>()
  private readonly terminalOrder: string[] = []
  private readonly persist?: RunPersist
  private readonly onCancelApproval?: (approvalId: string) => void

  constructor(opts: RunRegistryOptions = {}) {
    this.persist = opts.persist
    this.onCancelApproval = opts.onCancelApproval
  }

  /**
   * 占位并返回 Run。同会话已有活跃 Run 时返回 busy，调用方必须放弃这条新 Run
   * （而不是"先跑起来再说"——那样两条流会同时向外下发命令）。
   */
  begin(input: BeginInput): BeginResult {
    const sameId = this.runs.get(input.id)
    if (sameId && !isTerminal(sameId.state)) {
      return { ok: false, reason: 'busy', existing: sameId }
    }

    if (input.sshSessionId) {
      const holderId = this.activeBySession.get(input.sshSessionId)
      if (holderId) {
        const holder = this.runs.get(holderId)
        if (holder && !isTerminal(holder.state)) {
          return { ok: false, reason: 'busy', existing: holder }
        }
        this.activeBySession.delete(input.sshSessionId)
      }
    }

    const run: Run = {
      id: input.id,
      kind: input.kind,
      startedAt: Date.now(),
      controller: new AbortController(),
      state: 'running',
      pendingApprovals: new Set<string>(),
      ...(input.sshSessionId ? { sshSessionId: input.sshSessionId } : {}),
    }
    this.runs.set(run.id, run)
    if (run.sshSessionId) this.activeBySession.set(run.sshSessionId, run.id)
    return { ok: true, run }
  }

  /**
   * 收尾。幂等：第一次返回 true 并落终态，第二次起返回 false（不会重复推送）。
   *
   * 顺序是刻意的：先 persist 落盘、再改 Run 状态、最后通知订阅者。
   * 推送失败（窗口重建 / 没有窗口）不影响当时写入的终态，迟到订阅者还能拿到。
   */
  finish(id: string, input: FinishInput): boolean {
    const run = this.runs.get(id)
    if (!run || isTerminal(run.state)) return false

    const outcome: RunTerminal = input.ok
      ? { state: 'completed', ok: true, ...(input.result !== undefined ? { result: input.result } : {}) }
      : {
          state: input.failure === 'aborted_by_user' ? 'cancelled' : 'failed',
          ok: false,
          failure: input.failure ?? 'unknown',
          ...(input.error !== undefined ? { error: input.error } : {}),
        }

    this.persist?.(run, outcome)
    this.settleTerminal(run, outcome)
    return true
  }

  /**
   * 请求取消：只迁移到 cancelling 并 abort，**不落终态**。
   *
   * 被中断方（supervisor / PAOR）在真正停下来之后调 confirmCancel 确认，
   * 这样 cancel 之后还能收到"它到底停没停"，而不是界面先显示已取消、后台还在发命令。
   */
  requestCancel(id: string): boolean {
    const run = this.runs.get(id)
    if (!run || isTerminal(run.state) || run.state === 'cancelling') return false
    run.state = 'cancelling'
    this.emit(run, { type: 'state', state: 'cancelling' })
    // 先把挂着的审批结算掉（等待方立刻返回 false），再 abort——否则 Run 要等审批超时才收尾
    for (const approvalId of [...run.pendingApprovals]) {
      this.onCancelApproval?.(approvalId)
    }
    run.pendingApprovals.clear()
    run.controller.abort()
    return true
  }

  /** 被中断方确认停止：cancelling → cancelled 的唯一入口 */
  confirmCancel(id: string): boolean {
    const run = this.runs.get(id)
    if (!run || run.state !== 'cancelling') return false
    return this.finish(id, { ok: false, failure: 'aborted_by_user' })
  }

  /** 进入审批等待（审批挂起表登记到 Run 上，取消时能一起 settle） */
  awaitApproval(id: string, approvalId: string): boolean {
    const run = this.runs.get(id)
    if (!run || isTerminal(run.state) || run.state === 'cancelling') return false
    run.pendingApprovals.add(approvalId)
    if (run.state === 'running') {
      run.state = 'awaiting_approval'
      this.emit(run, { type: 'state', state: 'awaiting_approval' })
    }
    return true
  }

  /** 审批落定：最后一个挂起审批结束时回到 running */
  settleApproval(id: string, approvalId: string): boolean {
    const run = this.runs.get(id)
    if (!run) return false
    const had = run.pendingApprovals.delete(approvalId)
    if (had && run.pendingApprovals.size === 0 && run.state === 'awaiting_approval') {
      run.state = 'running'
      this.emit(run, { type: 'state', state: 'running' })
    }
    return had
  }

  /**
   * 订阅一轮 Run 的事件。已终态时**立刻补发终态**并返回空退订函数——
   * 这正是窗口重建后迟到订阅者的救命路径。
   */
  subscribe(id: string, cb: (evt: RunEvent) => void): () => void {
    const run = this.runs.get(id)
    if (!run) return () => {}
    if (isTerminal(run.state) && run.outcome) {
      cb({ type: 'terminal', outcome: run.outcome })
      return () => {}
    }
    let set = this.listeners.get(id)
    if (!set) {
      set = new Set()
      this.listeners.set(id, set)
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) this.listeners.delete(id)
    }
  }

  get(id: string): Run | undefined {
    return this.runs.get(id)
  }

  /** 某个 SSH 会话当前占着锁的 Run（没有则 undefined） */
  activeForSession(sshSessionId: string): Run | undefined {
    const holderId = this.activeBySession.get(sshSessionId)
    return holderId ? this.runs.get(holderId) : undefined
  }

  /** 全部活跃 Run（cancelAll 的收敛入口） */
  activeRuns(): Run[] {
    const out: Run[] = []
    for (const run of this.runs.values()) {
      if (!isTerminal(run.state)) out.push(run)
    }
    return out
  }

  private settleTerminal(run: Run, outcome: RunTerminal): void {
    run.state = outcome.state
    run.outcome = outcome
    run.endedAt = Date.now()
    if (run.sshSessionId && this.activeBySession.get(run.sshSessionId) === run.id) {
      this.activeBySession.delete(run.sshSessionId)
    }
    run.pendingApprovals.clear()
    this.terminalOrder.push(run.id)
    this.trimTerminalRuns()
    this.emit(run, { type: 'terminal', outcome })
    // 终态只推一次：之后不再向这轮 Run 广播任何东西。
    this.listeners.delete(run.id)
  }

  private trimTerminalRuns(): void {
    while (this.terminalOrder.length > MAX_TERMINAL_RUNS) {
      const id = this.terminalOrder.shift()
      if (id !== undefined) this.runs.delete(id)
    }
  }

  private emit(run: Run, evt: RunEvent): void {
    const set = this.listeners.get(run.id)
    if (!set) return
    for (const cb of [...set]) {
      try {
        cb(evt)
      } catch {
        // 一个订阅者出错不能连累另一个窗口收不到终态；这里不记录 error 对象（红线：catch 脱敏）。
        console.error('[run-registry] 订阅者处理事件时抛错，已继续通知其余订阅者')
      }
    }
  }
}
