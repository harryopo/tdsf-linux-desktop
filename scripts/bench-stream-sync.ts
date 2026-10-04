/**
 * 流式写入基准（阶段 C 判据）
 *
 * 跑法：npx tsx scripts/bench-stream-sync.ts
 *
 * 场景：200 条消息的长会话，最后一条正在流；100 token/s 打 10 秒 = 1000 个 token。
 * 假时钟手动推进，不测真实延迟，只测"次数"和"字节数"这两类可复现的量。
 *
 * 三档对比：
 *   无合并        v2.5 之前的行为：一个 token 一次 setState
 *   合并 45ms     现状
 *   合并 16ms     计划原案写的数，这里量它到底买了什么
 */
import { acceptsStream, createDeltaCoalescer, type CoalescerTimers } from '../src/renderer/src/lib/messageSync'

type Msg = {
  id: string
  role: 'user' | 'assistant'
  content: string
  correlationId?: string
  isStreaming?: boolean
}

/** 造一个 200 条消息的长会话，最后一条正在流 */
function makeSession(n = 200): Msg[] {
  const list: Msg[] = []
  for (let i = 0; i < n; i++) {
    list.push({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `第 ${i} 轮回答。`.repeat(20),
      correlationId: `c-${Math.floor(i / 2)}`,
      isStreaming: i === n - 1,
    })
  }
  return list
}

/** 手动推进的假时钟 */
function fakeClock(): CoalescerTimers & { advance: (ms: number) => void } {
  let now = 0
  let nextId = 1
  const jobs = new Map<number, { at: number; cb: () => void }>()
  return {
    schedule: (cb, ms) => {
      const id = nextId++
      jobs.set(id, { at: now + ms, cb })
      return id
    },
    cancel: (handle) => {
      jobs.delete(handle as number)
    },
    advance: (ms) => {
      now += ms
      for (const [id, job] of [...jobs]) {
        if (job.at <= now) {
          jobs.delete(id)
          job.cb()
        }
      }
    },
  }
}

/**
 * 跑一轮 token 流
 *
 * @param windowMs 合并窗口；0 表示不合并（每个 token 直接 setState）
 * @returns setState 次数、每次写入反向扫描遍历的元素数
 */
function runTokenStream(windowMs: number): { setStates: number; visitsPerWrite: number } {
  const tokens = 1000
  const intervalMs = 10 // 100 token/s
  const active = makeSession(200).at(-1)!.correlationId!
  let list = makeSession(200)
  let setStates = 0
  let totalVisits = 0

  const writeOne = (delta: string): void => {
    let idx = -1
    let visits = 0
    for (let i = list.length - 1; i >= 0; i--) {
      visits++
      if (list[i].role === 'assistant') {
        idx = i
        break
      }
    }
    totalVisits += visits
    if (idx < 0) return
    if (!acceptsStream(active, active)) return
    const next = list.slice()
    next[idx] = { ...next[idx], content: next[idx].content + delta }
    list = next
    setStates++
  }

  const sink = (entries: ReadonlyArray<readonly [string, string]>): void => {
    for (const [, delta] of entries) writeOne(delta)
  }

  if (windowMs === 0) {
    for (let i = 0; i < tokens; i++) writeOne('字')
  } else {
    const clock = fakeClock()
    const coalescer = createDeltaCoalescer(sink, { windowMs, timers: clock })
    for (let i = 0; i < tokens; i++) {
      coalescer.push(`text:${active}`, '字')
      clock.advance(intervalMs)
    }
    coalescer.flush()
  }
  return { setStates, visitsPerWrite: totalVisits / Math.max(1, setStates) }
}

/** 切会话后，旧流在途的 50 个 chunk 有多少真的落进了列表 */
function runStaleLeak(mode: 'before' | 'after'): number {
  let list = makeSession(200)
  const stale = 'c-0' // 早已结束的那条流
  const active = list.at(-1)!.correlationId!
  let leaks = 0
  for (let i = 0; i < 50; i++) {
    if (mode === 'before') {
      // 改前没有闸门：反向扫描会一路退到 c-0 那条已完成的 assistant 上写进去
      const before = list.map((m) => m.content).join('|')
      const next = [...list]
      for (let j = next.length - 1; j >= 0; j--) {
        if (next[j].role !== 'assistant') continue
        if (stale && next[j].correlationId && next[j].correlationId !== stale) continue
        next[j] = { ...next[j], content: next[j].content + 'X' }
        break
      }
      list = next
      if (list.map((m) => m.content).join('|') !== before) leaks++
    } else {
      if (acceptsStream(active, stale)) leaks++
    }
  }
  return leaks
}

/** 一个 chunk 载荷跨 IPC 的字节数 */
function chunkFrameBytes(): number {
  return JSON.stringify({
    correlationId: 'c-0123456789abcdef',
    delta: '字',
    kind: 'text',
  }).length
}

const SECONDS = 10
const noCoalesce = runTokenStream(0)
const w45 = runTokenStream(45)
const w16 = runTokenStream(16)

console.log(
  '=== 流式写入基准：200 条消息长会话，100 token/s × %d 秒 = 1000 token ===',
  SECONDS
)
console.log('')
console.log('每帧跨 IPC 字节数 = %d 字节（三档相同：传输层本来就只发 delta，不是全量快照）', chunkFrameBytes())
console.log('')
console.log('合并窗口        每秒 setState 次数    每次写入反向扫描元素数')
for (const [label, r] of [
  ['无合并（v2.5 前）', noCoalesce],
  ['45ms（现状）', w45],
  ['16ms（计划原案）', w16],
] as const) {
  console.log(
    label.padEnd(18),
    (r.setStates / SECONDS).toFixed(1).padStart(10),
    '        ',
    r.visitsPerWrite.toFixed(0).padStart(6)
  )
}
console.log('')
console.log(
  '切会话后旧流在途 chunk 落进列表的条数：改前 %d / 改后 %d  ← 这次真正修掉的东西',
  runStaleLeak('before'),
  runStaleLeak('after')
)
