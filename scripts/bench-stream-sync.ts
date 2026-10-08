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
import {
  acceptsStream,
  createDeltaCoalescer,
  lastIndexWhere,
  replaceAt,
  type CoalescerTimers,
} from '../src/renderer/src/lib/messageSync'

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
    // 扫描与写入都必须走产品里那两个函数：
    // 自己在本脚本里另写一遍循环，量的就是脚本自己，产品改坏了这里也不会动（2026-10-08 实测到这条）。
    // 判据也按产品口径写"角色 + 关联 ID"：只判角色的话，正向扫也能在第 2 个元素撞上，
    // 这一列就没有判别力了（实测反向=1 步、正向=2 步，看不出退化）。
    let visits = 0
    const idx = lastIndexWhere(list, (m) => {
      visits++
      return m.role === 'assistant' && m.correlationId === active
    })
    totalVisits += visits
    if (idx < 0) return
    if (!acceptsStream(active, active)) return
    const next = replaceAt(list, idx, { ...list[idx], content: list[idx].content + delta })
    if (next === null) return
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

/**
 * 每帧跨 IPC 的字节数，两条都量出来：
 *   delta 帧    现状：一帧只带这一小段增量
 *   全量快照帧  反事实基线：一帧把整份 200 条消息列表都带上
 * 要证明的是「传输层本来就只发 delta」这句结论，而不是把它当口号写在这里。
 * 注意：改前（v2.5）坏的是每 token 一次全量 setState，不是每 token 发一次全量 IPC，
 * 所以第二行是拿来对照的假设值，不是历史实测值。
 */
function frameBytes(): { delta: number; snapshot: number } {
  const list = makeSession(200)
  return {
    delta: JSON.stringify({
      correlationId: 'c-0123456789abcdef',
      delta: '字',
      kind: 'text',
    }).length,
    snapshot: JSON.stringify(list).length
  }
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
const frames = frameBytes()
const fps = w45.setStates / SECONDS
console.log('每帧跨 IPC 字节数')
console.log('  delta 帧（现状）    ' + frames.delta + ' 字节/帧')
console.log('  全量快照帧（假设）  ' + frames.snapshot + ' 字节/帧  ← 若每帧都带整份列表')
console.log(
  '  按 ' + fps + ' 帧/秒算：现状 ' +
    ((frames.delta * fps) / 1024).toFixed(1) + ' KB/s，假设 ' +
    ((frames.snapshot * fps) / 1048576).toFixed(1) + ' MB/s —— 单帧差 ' +
    Math.round(frames.snapshot / frames.delta) + ' 倍'
)
console.log('')
console.log('合并窗口        每秒 setState 次数    定位在流那条要扫几个元素（产品 lastIndexWhere）')
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
