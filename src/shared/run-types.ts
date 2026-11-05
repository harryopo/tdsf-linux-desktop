/**
 * Run 生命周期跨进程类型（v1 · 2026-11-04）
 *
 * 为什么单独一份：RunRegistry 在主进程，渲染层只能通过 preload 拿快照。
 * 快照类型若留在 `src/main/**`，preload 就得反向依赖主进程；放进 `agent-types.ts`
 * 又会把一份生命周期形状塞进已经过大的对话类型表。这里是唯一单源。
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
 * 失败原因（与 run-registry 的出口一一对应，不预造没人赋值的枚举值）
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
  /**
   * 谁让这轮走到终态的。
   *
   * 只有用户主动停止会落 `cancelled`（`requestCancel` 的唯一调用者就是停止按钮那条 IPC），
   * 所以 `cancelled` 终态恒带 `'user'`；其余终态没有这个字段——没有取消，就没有"谁取消"。
   * 不做 `'system'` 这种空枚举：现在没有第二个来源，先别写进去。
   */
  resolvedBy?: 'user'
  /**
   * 收尾时被主进程强制结算成"未批准"的挂起审批条数。
   *
   * 有值（>0）说明这轮结束时桌上还压着审批卡：它们全部按未批准处理，界面必须说清
   * "是停止带走了它们"，而不是让用户以为点过同意。0 不写，避免多一个恒零字段。
   */
  settledApprovals?: number
}

/** 可跨 IPC 序列化的 Run 快照（AbortController 等不可序列化成员不进快照） */
export interface RunSnapshot {
  id: string
  kind: RunKind
  state: RunState
  sshSessionId?: string
  startedAt: number
  endedAt?: number
  /** 仅在已终态时存在 */
  terminal?: RunTerminal
}
