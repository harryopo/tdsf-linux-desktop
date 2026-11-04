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
