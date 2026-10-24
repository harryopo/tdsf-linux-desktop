/**
 * 全局实时事件订阅（P0 修复：组件条件挂载丢事件）
 *
 * 问题背景（同一类病灶，多处复现）：
 * - Agent 流式：agent:chunk/done/error 订阅曾写在 useAgentChat useEffect，
 *   随 AIPanel 挂载/卸载绑定解绑 → 面板收起时流式事件永久丢失。
 * - 监控数据：monitor:data/systemInfo 订阅曾写在 MonitorPage useEffect，
 *   用户在工作台连接服务器后数据已开始推送，但未进监控页前无人接收，
 *   切到监控页时历史推送已丢，表现为"已连接但监控页暂无数据"。
 *
 * 修复方案：
 * - 所有实时事件订阅提升到应用入口（main.tsx）调用一次，模块级幂等守卫。
 * - 事件回调直接写 store，与组件生命周期完全解耦；页面/面板无论是否挂载，
 *   数据都完整落入 store，进页即可看到全量内容。
 */
import { useAgentStore } from './agent-store'
import { useMonitorStore } from './monitor-store'
import { useApprovalStore } from './approval-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import {
  DEFAULT_COALESCE_WINDOW_MS,
  createDeltaCoalescer,
  ruleOf,
  type StreamEventName,
} from '@/lib/messageSync'
import type { PaorApprovalRequest } from '@shared/approval-types'

/** 幂等守卫：整个渲染进程生命周期只绑定一次 */
let subscribed = false

/**
 * 这个通道要不要进合并窗口 —— 判据取自分类表，不在这里各写各的
 *
 * 只有 DELTA 且表里允许合并的才缓冲：LATEST_ONLY 的 payload 是"整份最新值"，
 * 拼起来会得到一份缝合过的假数据；SNAPSHOT/CRITICAL 同理。
 */
function shouldCoalesce(channel: StreamEventName): boolean {
  const rule = ruleOf(channel)
  return rule.class === 'DELTA' && rule.coalescable
}

/** 关键/重置边界事件到达前，必须先把待合并的缓冲吐干净，否则尾部丢在半路 */
function mustFlushBefore(channel: StreamEventName): boolean {
  const cls = ruleOf(channel).class
  return cls === 'CRITICAL' || cls === 'RESET_BOUNDARY'
}

// ============================================================================
// 流式 chunk 合并写入
//
// 病因：每个 agent:chunk 都同步写一次 zustand store → 每 token 重渲染整个
// 消息列表 + 重跑 Markdown 解析，高频 token 下主线程被打满，视觉抽搐。
// 修复：按 kind:correlationId 缓冲 delta，到窗口点合并写入一次；
// done/error 到达时先强制冲刷，保证尾部内容不丢。
//
// v2.5 手写的那份缓冲已搬进 lib/messageSync 的 createDeltaCoalescer，
// 这样合并语义（同 key 累加、窗口内只排一个定时器、flush 幂等）能被单测钉住。
// ============================================================================

/** 待写入缓冲：正文与思考链分开累积，到点一次性吐给 store */
const chunkCoalescer = createDeltaCoalescer(
  (entries) => {
    const { appendToken } = useAgentStore.getState()
    for (const [key, delta] of entries) {
      const sep = key.indexOf(':')
      const kind = key.slice(0, sep) as 'text' | 'reasoning'
      const correlationId = key.slice(sep + 1)
      appendToken({ correlationId, delta, kind })
    }
  },
  { windowMs: DEFAULT_COALESCE_WINDOW_MS }
)

/** 立即把缓冲区写入 store（done/error 前必调，否则尾部 token 丢在半路） */
function flushPendingChunks(): void {
  chunkCoalescer.flush()
}

/**
 * 初始化全局实时事件订阅（Agent 流式 + 监控数据）。
 * 在 main.tsx 应用入口调用；非 Electron 环境（浏览器 dev）静默跳过。
 */
export function initAgentStreamSubscription(): void {
  if (subscribed) return
  if (!isElectronAPIAvailable()) return
  subscribed = true

  /** done/error 后刷新 Token / 成本统计（原 useAgentChat 内逻辑迁移至此） */
  const refreshStats = (): void => {
    void window.electronAPI.tokenStats?.()
      .then((stats) => useAgentStore.getState().setTokenStats(stats))
      .catch(() => {})
    void window.electronAPI.tokenCostStats?.()
      .then((stats) => useAgentStore.getState().setCostStats(stats))
      .catch(() => {})
  }

  window.electronAPI.onAgentChunk((payload) => {
    // 走不走合并窗口由分类表决定（会话归属由 appendToken 那侧把关）
    if (shouldCoalesce('agent:chunk')) {
      chunkCoalescer.push(
        `${payload.kind === 'reasoning' ? 'reasoning' : 'text'}:${payload.correlationId}`,
        payload.delta
      )
      return
    }
    useAgentStore.getState().appendToken(payload)
  })

  window.electronAPI.onAgentDone((payload) => {
    if (mustFlushBefore('agent:done')) flushPendingChunks() // 先落盘尾部 token，再 finalize
    useAgentStore.getState().finalizeMessage(payload)
    refreshStats()
  })

  window.electronAPI.onAgentError((payload) => {
    if (mustFlushBefore('agent:error')) flushPendingChunks()
    useAgentStore.getState().markError(payload)
    refreshStats()
  })

  // v2.4：Agent 工具调用事件（真实执行可视化）—— 写入它所属那条 assistant 消息
  window.electronAPI.onAgentToolEvent?.((payload) => {
    // 工具卡按 anchorOffset 插进正文，锚点量的是"此刻已写入的正文长度"。
    // 合并窗口里还压着上一个 45ms 的 token 时锚点会偏短，卡片就抢到已经生成的文字前面
    // （界面上表现为"运行"比"思考/正文"先冒出来）。先把在途 chunk 冲干净再落卡。
    flushPendingChunks()
    useAgentStore.getState().appendToolEvent({
      // 透传 correlationId：done 之后才到的 result 靠它认领自己那条，否则终态被丢、卡片永远"运行中"
      correlationId: payload.correlationId,
      toolCallId: payload.toolCallId,
      phase: payload.phase,
      toolName: payload.toolName,
      input: payload.input,
      ok: payload.ok,
      count: payload.count,
      output: payload.output,
    })
  })

  // 监控数据全局订阅（P0 修复：监控页未挂载时也不丢推送）
  // 用户在工作台连接服务器后 monitor:data 即开始推送，无论是否已切到监控页，
  // 数据都直接落入 monitor-store，监控页挂载时直接读取历史。
  window.electronAPI.onMonitorData?.((sessionId, data) => {
    useMonitorStore.getState().addMonitorData(sessionId, data)
  })
  window.electronAPI.onMonitorSystemInfo?.((sessionId, info) => {
    useMonitorStore.getState().setSystemInfo(sessionId, info)
  })

  // #170：高危审批全局订阅（同一病灶——订阅曾写在条件渲染的 AIPanel 里）
  // 面板收起时主进程照样推 paor:approval-request，没人接就 60 秒自动拒绝。
  // 落到全局 store 之后，请求不随组件卸载丢失，界面回来还能看见并回答。
  window.electronAPI.onPaorApprovalRequest?.((request: PaorApprovalRequest) => {
    useApprovalStore.getState().receive(request)
  })
}
