/**
 * 流式消息同步层（阶段 C）— 纯函数，不依赖 React / zustand / electron
 *
 * 三件事：
 *   1. 事件分类表：把主进程推过来的每一类事件按"能不能丢、要不要认会话"归类，
 *      这张表是包内私有的，并被测试逐条钉住。以前 42 个推送点各写各的 if，
 *      没人说得清哪个能丢、哪个丢了就丢答案。
 *   2. 会话归属判定：流式事件必须属于"当前正在流的那一条"才允许落地（工具事件按轮次认领，见下）。
 *      chunk 认当前正在流的那一条；工具事件还认它自己那一轮——done 之后迟到的 result
 *      要写回已经收尾的那条（#86），但切会话后旧流在途的事件不再写进新回答。
 *   3. 增量合并 + 尾部就地更新：token 按时间窗合并成一次写入；
 *      写的时候用记住的下标直接改，不再从数组尾巴反向扫一遍。
 *
 * 为什么闸门按 correlationId 而不是序号：
 *   Electron 的 webContents.send 到同一渲染进程是保序的，同一条流的 chunk
 *   不会乱序，硬造一个 seq 字段只是给传输层加它已经保证的东西。
 *   真会出事的是"跨会话"：旧流的 chunk/step/tool 事件在新会话里落地，
 *   这个闸门拦的就是它。
 */

// ============================================================================
// 1. 事件分类表
// ============================================================================

/**
 * 主进程 → 渲染进程的推送通道名
 *
 * 这份清单不是手写的期望值，是从 preload 的 42 个监听点
 * （createListener / ipcRenderer.on）反解出来的实际推送面。
 * D1 之前的数字是 28——那时 14 个推送通道直写字面量、没进中央表，
 * 反解器看不见它们，于是"对上了"其实是漏了。中央表补齐后清单才是 42。
 * tests/unit/message-sync-table.test.ts 会再对一次，多一个少一个都红。
 */
export type StreamEventName =
  | 'agent:chunk'
  | 'agent:done'
  | 'agent:error'
  | 'agent:paor:iteration'
  | 'agent:step'
  | 'agent:tool-event'
  | 'boot:loading-stage'
  | 'diagnostics:log-batch'
  | 'file:changed'
  | 'llm:chunk'
  | 'llm:done'
  | 'llm:error'
  | 'llm:token'
  | 'llm:tool-approval'
  | 'llm:tool-progress'
  | 'local-tty:exit'
  | 'loop:blocked'
  | 'loop:decision'
  | 'loop:done'
  | 'loop:error'
  | 'loop:llm-done'
  | 'loop:llm-start'
  | 'loop:step'
  | 'mcp:state-changed'
  | 'monitor:data'
  | 'monitor:systemInfo'
  | 'paor:approval-request'
  | 'sandbox:approval-request'
  | 'scheduler:status'
  | 'sftp:progress'
  | 'ssh:host-key-prompt'
  | 'ssh:state-changed'
  | 'terminal:data'
  | 'tutorial:backfill-progress'
  | 'tutorial:crawlDone'
  | 'tutorial:crawlProgress'

/**
 * 事件类别
 *
 * - DELTA           增量，可合并；丢了就是少几个字
 * - LATEST_ONLY     只有最新值有意义，中间态可直接覆盖
 * - DISPOSABLE      刷新型旁路数据，丢了不影响正确性
 * - SNAPSHOT        全量快照，按到达顺序整体覆盖
 * - SNAPSHOT_TAIL   快照但只影响列表尾部一条
 * - RESET_BOUNDARY  会重置会话边界，之后的旧事件全部作废
 * - CRITICAL        永不丢弃，必须落盘
 * - LIFECYCLE       生命周期/提示类，不进消息列表
 */
export type StreamEventClass =
  | 'DELTA'
  | 'LATEST_ONLY'
  | 'DISPOSABLE'
  | 'SNAPSHOT'
  | 'SNAPSHOT_TAIL'
  | 'RESET_BOUNDARY'
  | 'CRITICAL'
  | 'LIFECYCLE'

/** 单条事件的处置规则 */
export interface StreamEventRule {
  class: StreamEventClass
  /**
   * 是否要求事件属于当前流式会话。
   * true  = 闸门不认就直接丢
   * false = 与会话无关（监控推送、启动进度等）
   */
  ownership: boolean
  /** 该事件能否在合并窗口里被后续事件覆盖掉 */
  coalescable: boolean
  /** 归类依据，一句话 */
  note: string
}

/**
 * 事件分类表
 *
 * 改这张表等于改流式语义，所以它被 tests/unit/message-sync-table.test.ts
 * 逐条钉住：通道清单与 preload 实际监听点对一次、CRITICAL 一律不认合并、
 * ownership=true 的必须真是"某一条回答"的事件。
 */
export const STREAM_EVENT_RULES: Readonly<Record<StreamEventName, StreamEventRule>> = {
  'agent:chunk': {
    class: 'DELTA',
    ownership: true,
    coalescable: true,
    note: 'Supervisor 正文/思考链 token，按时间窗合并后一次写入',
  },
  'agent:done': {
    class: 'CRITICAL',
    ownership: true,
    coalescable: false,
    note: '收尾事件，丢了消息会永远停在 streaming',
  },
  'agent:error': {
    class: 'CRITICAL',
    ownership: true,
    coalescable: false,
    note: '错误必须让用户看到，不丢',
  },
  'agent:step': {
    class: 'LATEST_ONLY',
    ownership: false,
    coalescable: true,
    note: '工作流步骤状态，只有最新一份有意义；payload 不带 correlationId，' +
      '目前只能靠"有没有在流的消息"来定位，按会话精确归属等 D1 类型化契约补上',
  },
  'boot:loading-stage': {
    class: 'LIFECYCLE',
    ownership: false,
    coalescable: true,
    note: '启动进度条阶段，不进消息列表',
  },
  'diagnostics:log-batch': {
    class: 'DISPOSABLE',
    ownership: false,
    coalescable: true,
    note: '日志批量推送，积压时可丢最旧的，不影响正确性',
  },
  'file:changed': {
    class: 'SNAPSHOT',
    ownership: false,
    coalescable: false,
    note: '远程文件变更通知，每条都是独立事实',
  },
  'llm:chunk': {
    class: 'DELTA',
    ownership: false,
    coalescable: true,
    note: '直连 LLM 通道的正文增量；preload 挂了监听但渲染层当前无人订阅',
  },
  'llm:done': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '直连 LLM 收尾；渲染层当前未订阅',
  },
  'llm:error': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '直连 LLM 失败原因；渲染层当前未订阅',
  },
  'llm:token': {
    class: 'DISPOSABLE',
    ownership: false,
    coalescable: true,
    note: '逐 token 计数刷新；渲染层当前未订阅',
  },
  'llm:tool-approval': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '工具审批请求，丢了等于用户永远等不到弹窗，绝不合并；渲染层当前未订阅',
  },
  'llm:tool-progress': {
    class: 'SNAPSHOT_TAIL',
    ownership: false,
    coalescable: false,
    note: '工具调用三段进度；渲染层走的是 agent:tool-event 那条，此通道未订阅',
  },
  'local-tty:exit': {
    class: 'LIFECYCLE',
    ownership: false,
    coalescable: false,
    note: '本机终端进程退出：一条=一条通道，合并会把另一条终端的关闭事件吞掉',
  },
  'loop:blocked': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '被高危命令闸拦下的提示，安全相关不丢',
  },
  'loop:decision': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '决策卡片产出，丢了 UI 上没有可审计结果',
  },
  'loop:done': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '循环工程收尾',
  },
  'loop:error': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '循环工程失败原因',
  },
  'loop:llm-done': {
    class: 'LIFECYCLE',
    ownership: false,
    coalescable: false,
    note: '循环内单次 LLM 调用结束标记',
  },
  'loop:llm-start': {
    class: 'LIFECYCLE',
    ownership: false,
    coalescable: false,
    note: '循环内单次 LLM 调用开始标记',
  },
  'loop:step': {
    class: 'LATEST_ONLY',
    ownership: false,
    coalescable: true,
    note: 'HITL 七步进度，只关心当前步',
  },
  'monitor:data': {
    class: 'SNAPSHOT',
    ownership: false,
    coalescable: false,
    note: '监控采样点，每条都要留，丢一个图上就少一根',
  },
  'monitor:systemInfo': {
    class: 'LATEST_ONLY',
    ownership: false,
    coalescable: true,
    note: '静态系统信息，只关心最新',
  },
  'scheduler:status': {
    class: 'LATEST_ONLY',
    ownership: false,
    coalescable: true,
    note: '调度器状态，只关心最新',
  },
  'sftp:progress': {
    class: 'LATEST_ONLY',
    ownership: false,
    coalescable: true,
    note: '传输进度条，中间百分比本来就可以跳',
  },
  'ssh:host-key-prompt': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: 'TOFU 主机密钥弹窗，丢了就连不上',
  },
  'ssh:state-changed': {
    class: 'LATEST_ONLY',
    ownership: false,
    coalescable: true,
    note: '连接状态机，中间态可覆盖',
  },
  'terminal:data': {
    class: 'DELTA',
    ownership: false,
    coalescable: false,
    note: '终端原始字节流：是增量但顺序即内容，绝不能合并或重排',
  },
  'tutorial:backfill-progress': {
    class: 'LATEST_ONLY',
    ownership: false,
    coalescable: true,
    note: '回填进度条',
  },
  // ── 以下 14 条来自 D1：这些通道的名字此前只写在 preload 的字面量里、没进中央表，
  //    所以阶段 C 那次"对表"根本没扫到它们。中央表补齐后对表才露出缺口。
  'agent:tool-event': {
    class: 'SNAPSHOT',
    ownership: true,
    coalescable: false,
    note: '一次工具调用的阶段事件（call/output/result 靠 toolCallId 配对），合并会丢阶段；' +
      '#86 起按 correlationId 归属到"它自己那一轮"的回答（done 之后迟到的 result 也要落，' +
      '没人认领才丢），落地前先冲刷在途 chunk，锚点才对得上正文',
  },
  'agent:paor:iteration': {
    class: 'SNAPSHOT',
    ownership: false,
    coalescable: false,
    note: '同一通道既推迭代轮次也推任务拆解计划，后者是整块内容，覆盖式合并会丢计划卡',
  },
  'mcp:state-changed': {
    class: 'LATEST_ONLY',
    ownership: false,
    coalescable: true,
    note: 'MCP 生命周期状态机快照，只有最新状态有意义',
  },
  'paor:approval-request': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '审批卡，丢了用户无从批准，主进程只能等到超时拒绝',
  },
  'sandbox:approval-request': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '沙箱命令审批卡，同上，丢了命令永远挂着',
  },
  'tutorial:crawlProgress': {
    class: 'LATEST_ONLY',
    ownership: false,
    coalescable: true,
    note: '爬取进度百分比，只有最新值有意义',
  },
  'tutorial:crawlDone': {
    class: 'CRITICAL',
    ownership: false,
    coalescable: false,
    note: '爬取收尾事件，丢了 UI 停在爬取中',
  },
} as const

/** 查表；表里没有的事件名一律按最严格处置（要认会话、不许丢） */
export function ruleOf(event: StreamEventName | string): StreamEventRule {
  return (
    STREAM_EVENT_RULES[event as StreamEventName] ?? {
      class: 'CRITICAL',
      ownership: true,
      coalescable: false,
      note: '未归类事件，按最严格处置',
    }
  )
}

// ============================================================================
// 2. 会话闸门
// ============================================================================

/**
 * 事件是否落在"当前正在流的那一条"上
 *
 * active 取 store.currentCorrelationId（null = 没有流在跑）。
 * 不另建一份闸门状态：再存一个 correlationId 就等于制造第二个真相源。
 *
 * incoming 为 undefined/null 表示这条事件没带标识（旧数据、旁路推送），放行；
 * 带了就必须对上 —— 切会话后旧流在途的 chunk/step/tool 就是这么被挡掉的。
 */
export function acceptsStream(active: string | null, incoming?: string | null): boolean {
  if (active === null) return false
  if (incoming === undefined || incoming === null) return true
  return incoming === active
}

/**
 * 一条消息是否属于这条流
 *
 * 与 acceptsStream 的方向相反：那个问"这个事件是不是当前这条流的"，
 * 这个问"这条消息是不是这条流生出来的"。done/error 靠它认领自己的消息，
 * 从而不会去关别人的消息。
 *
 * 任一侧没记 correlationId（旧数据、不带 id 的本地消息）都算属于，保持兼容。
 */
export function ownsStream(
  messageCorrelationId: string | undefined,
  streamCorrelationId: string | undefined | null
): boolean {
  if (!messageCorrelationId || !streamCorrelationId) return true
  return messageCorrelationId === streamCorrelationId
}

// ============================================================================
// 3. 增量合并
// ============================================================================

/** 合并窗口：人眼对 ~20fps 的文本流已感知为连续，故取 45ms 而非 16ms */
export const DEFAULT_COALESCE_WINDOW_MS = 45

/** 定时器注入点（测试用假时钟） */
export interface CoalescerTimers {
  schedule: (cb: () => void, ms: number) => unknown
  cancel: (handle: unknown) => void
}

/**
 * 按 key 缓冲增量，到点一次性吐给 sink
 *
 * flush() 幂等：没有缓冲时什么都不做，done/error 前必须先 flush，
 * 否则尾部 token 会被定时器留在空气里。
 */
export interface DeltaCoalescer {
  push: (key: string, delta: string) => void
  flush: () => void
  /** 缓冲区是否还有未吐出的内容 */
  pending: () => boolean
}

export function createDeltaCoalescer(
  sink: (entries: ReadonlyArray<readonly [string, string]>) => void,
  opts: { windowMs?: number; timers?: CoalescerTimers } = {}
): DeltaCoalescer {
  const windowMs = opts.windowMs ?? DEFAULT_COALESCE_WINDOW_MS
  const timers = opts.timers
  const buffer = new Map<string, string>()
  let handle: unknown = null

  const flush = (): void => {
    if (handle !== null) {
      if (timers) timers.cancel(handle)
      else clearTimeout(handle as ReturnType<typeof setTimeout>)
      handle = null
    }
    if (buffer.size === 0) return
    const entries = [...buffer.entries()]
    buffer.clear()
    sink(entries)
  }

  const arm = (): void => {
    if (handle !== null) return
    handle = timers
      ? timers.schedule(flush, windowMs)
      : setTimeout(flush, windowMs)
  }

  return {
    push: (key, delta) => {
      if (delta.length === 0) return
      buffer.set(key, (buffer.get(key) ?? '') + delta)
      arm()
    },
    flush,
    pending: () => buffer.size > 0,
  }
}

// ============================================================================
// 4. 列表写入
// ============================================================================

/**
 * 按下标就地替换一条，返回新数组；下标越界返回 null 让调用方决定回退路径。
 *
 * 存在意义：流式写入只动最后一条，记住下标就不必每次从尾巴反向扫全表。
 */
export function replaceAt<T>(list: readonly T[], index: number, next: T): T[] | null {
  if (index < 0 || index >= list.length) return null
  if (list[index] === next) return null // 内容没变，省掉一次 setState
  const out = list.slice()
  out[index] = next
  return out
}

/** 找最后一条满足条件的下标；找不到返回 -1 */
export function lastIndexWhere<T>(list: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) {
    if (predicate(list[i])) return i
  }
  return -1
}

/** 按 id 找下标；找不到返回 -1 */
export function indexOfId<T extends { id: string }>(list: readonly T[], id: string): number {
  return list.findIndex((item) => item.id === id)
}
