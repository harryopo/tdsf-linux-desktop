/**
 * 会话操作串行队列
 *
 * 换掉 connection-manager 里那把坏锁。旧写法是：
 *   entry.pendingOp = next.then(() => { entry.pendingOp = null }, ...)
 * 而 `next` 是"前一个 wrapper 完成后才跑我这个"的链——于是前一个操作收尾时，
 * 会把**别人**刚登记的 pendingOp 置回 null，第三个操作立刻并发跑上去。
 * 实测同一路径最大并发是 2，串行化根本没发生（连接、重连、用户手点的断开交叠时就是这个样子）。
 *
 * 这里的做法：每个 key 只有一条"队尾"，队尾永远指向**自己这一个**操作结束的信号，
 * 谁都不许替别人清零；另外每个操作带预算（callWithTimeout），
 * 一个卡死的操作（SSH 半开连接最常见）不会把这个 key 永久钉住——它会超时让位，
 * 迟到结果被丢弃，队列继续走。
 */

import { callWithTimeout } from '../../core/with-timeout'

export interface QueueSnapshot {
  /** 正在执行的操作数（本队列保证 ≤1） */
  inflight: number
  /** 排队等前面的操作结束**开始执行**过多少个（含已结束的，用于测并发时序） */
  started: number
  /** 历史上同时执行过的最大数量——串行化有没有生效就看它，恒为 1 才算对 */
  maxConcurrent: number
  /** 正常完成的操作数 */
  done: number
  /** 因预算用尽而被丢弃的操作数 */
  timedOut: number
  /** 当前还有多少操作在排队 */
  waiting: number
}

export interface QueueOptions {
  /** 单个操作预算（毫秒）；超时后让位给下一个 */
  opTimeoutMs?: number
  /** 超时/失败时的日志出口（不传就静默） */
  onEvent?: (key: string, message: string) => void
}

const DEFAULT_OP_TIMEOUT_MS = 30_000

interface QueueState extends QueueSnapshot {
  tail: Promise<void>
}

export class SessionQueue {
  private readonly states = new Map<string, QueueState>()
  private readonly opTimeoutMs: number

  constructor(private readonly opts: QueueOptions = {}) {
    this.opTimeoutMs = opts.opTimeoutMs ?? DEFAULT_OP_TIMEOUT_MS
  }

  /**
   * 排队执行。同一个 key 的操作严格一个一个来；不同 key 互不影响。
   *
   * @returns 操作自己的返回值；超时抛错（让调用方知道"这次没做成"，而不是假装成功）
   */
  async run<T>(key: string, fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    const st = this.stateOf(key)
    const prevTail = st.tail
    let release!: () => void
    const mine = new Promise<void>((resolve) => {
      release = resolve
    })
    // 关键：队尾指向"我这个操作结束"，不是"前一个 wrapper 结束"
    st.tail = prevTail.then(() => mine)
    st.waiting++

    await prevTail
    st.waiting--

    st.started++
    st.inflight++
    if (st.inflight > st.maxConcurrent) st.maxConcurrent = st.inflight

    try {
      const outcome = await callWithTimeout(fn, timeoutMs ?? this.opTimeoutMs)
      if (outcome.ok) {
        st.done++
        return outcome.value as T
      }
      if (outcome.timedOut) st.timedOut++
      const why = outcome.timedOut ? '超时' : '失败'
      const detail = `操作${why}（预算 ${timeoutMs ?? this.opTimeoutMs}ms）：${outcome.error ?? '未知原因'}`
      this.opts.onEvent?.(key, detail)
      // 抛出去的必须带"超时/失败"这个结论：只把 callWithTimeout 那句"超过 Nms 未完成"
      // 原样扔给调用方，落到日志里没人知道是谁超时了
      throw new Error(detail)
    } finally {
      st.inflight--
      release()
      // 这个 key 排空了就回收条目：会话会不断新建，Map 不能只增不减
      if (st.inflight === 0 && st.waiting === 0 && this.states.get(key) === st) {
        this.states.delete(key)
      }
    }
  }

  /** 观测口：并发时序与计数（判据要用 maxConcurrent，不是"没报错"） */
  snapshot(key: string): QueueSnapshot | null {
    const st = this.states.get(key)
    if (!st) return null
    const {
      tail: _tail,
      ...rest
    } = st
    return { ...rest }
  }

  /** 会话没了就把它的队列丢掉，避免遗留等待者把内存钉住 */
  forget(key: string): void {
    const st = this.states.get(key)
    if (!st) return
    // 让仍在排队的等待者能走下去（它们会因为找不到会话自己报错），不留悬挂
    st.tail = Promise.resolve()
    this.states.delete(key)
  }

  /** 当前有活动的 key 数（测试与诊断用） */
  size(): number {
    return this.states.size
  }

  private stateOf(key: string): QueueState {
    const existing = this.states.get(key)
    if (existing) return existing
    const fresh: QueueState = {
      tail: Promise.resolve(),
      inflight: 0,
      started: 0,
      maxConcurrent: 0,
      done: 0,
      timedOut: 0,
      waiting: 0,
    }
    this.states.set(key, fresh)
    return fresh
  }
}
