/**
 * 高危审批的全局队列（Zustand）— #170
 *
 * 为什么要有这个 store：审批请求的订阅以前写在 AIPanel 的 useEffect 里，
 * 而 AI 面板是 `WorkbenchPage.tsx` 按 `aiPanelVisible` 条件渲染的。
 * 面板一收起，订阅就解绑——主进程照样把"要不要执行这条 rm"推过来，只是屏上没有任何地方接，
 * 60 秒后主进程自动拒绝。用户回来看到的是"AI 说这条命令被拦了"，
 * 而真实情况是**它问了，没人答**。流式事件当年是同一个病灶，已经由
 * `agent-stream-subscription.ts` 提升到全局修好；审批那半条今天跟着修。
 *
 * 三条设计约束：
 * 1. 队列活在 store 里，不活在组件里——组件卸载不丢请求，重新挂载还能看见。
 * 2. 过期时刻只信主进程发来的 `expiresAt`（那是它自己起定时器的那一刻）。
 *    这里不写"60 秒"这个数，两处各自算迟早漂。
 * 3. 过期不等于消失。卡片留在队列里标成"已超时自动拒绝"，
 *    让用户知道"AI 那一步为什么停在这里"，而不是无声无息少了一张卡。
 */
import { create } from 'zustand'
import type { PaorApprovalRequest } from '@shared/approval-types'

/** 一条审批在界面上的生命周期 */
export interface ApprovalEntry {
  request: PaorApprovalRequest
  /** 主进程那侧已经不再等这个回答了（超时，或用户点了但 callId 已不存在） */
  expired: boolean
}

interface ApprovalState {
  /** 队首就是 PermissionBar 正在展示的那一条 */
  entries: ApprovalEntry[]

  /** 主进程推来一条新请求；同一 callId 重复推送不叠加（幂等） */
  receive: (request: PaorApprovalRequest) => void
  /** 用户已应答并被主进程接受 → 从队列移除 */
  settle: (callId: string) => void
  /** 这条已经过期（超时，或 paor:approve 回了 false） */
  markExpired: (callId: string) => void
}

/** 过期定时器：callId → timer。条目一出队就撤销，不让定时器追着已移除的东西跑 */
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 到点之后再宽限一点，避免与主进程那把定时器抢同一毫秒而把"还差 0.1 秒"显示成已超时 */
const EXPIRY_GRACE_MS = 400

function scheduleExpiry(callId: string, expiresAt: number): void {
  if (expiryTimers.has(callId)) return
  const delay = Math.max(0, expiresAt - Date.now()) + EXPIRY_GRACE_MS
  const timer = setTimeout(() => {
    expiryTimers.delete(callId)
    useApprovalStore.getState().markExpired(callId)
  }, delay)
  expiryTimers.set(callId, timer)
}

function cancelExpiry(callId: string): void {
  const timer = expiryTimers.get(callId)
  if (timer) {
    clearTimeout(timer)
    expiryTimers.delete(callId)
  }
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  entries: [],

  receive: (request) => {
    if (get().entries.some((e) => e.request.callId === request.callId)) return
    set((s) => ({ entries: [...s.entries, { request, expired: false }] }))
    scheduleExpiry(request.callId, request.expiresAt)
  },

  settle: (callId) => {
    cancelExpiry(callId)
    set((s) => ({ entries: s.entries.filter((e) => e.request.callId !== callId) }))
  },

  markExpired: (callId) => {
    cancelExpiry(callId)
    set((s) => ({
      entries: s.entries.map((e) =>
        e.request.callId === callId ? { ...e, expired: true } : e
      ),
    }))
  },
}))

/** 还在等用户回答的条数（界面上的徽章用它，别用 entries.length） */
export function countAwaiting(entries: readonly ApprovalEntry[]): number {
  return entries.filter((e) => !e.expired).length
}
