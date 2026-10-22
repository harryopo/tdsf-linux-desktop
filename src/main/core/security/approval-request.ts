/**
 * 高危操作的人工审批等待器（单源）
 *
 * 为什么单独一个文件：`60_000` 这把超时和那张 callId→resolve 表原来只住在
 * `ipc/agent-runtime.ts`。外部 MCP 工具调用（`mcp:external-call`）也要接人工审批时，
 * 在 `ipc/mcp.ts` 再造一份就是"两处各写一把 60 秒，迟早漂"——
 * 而《长期优化目标》里点名的正是这个形状（`@shared/approval-types.ts` 的 `expiresAt` 注释）。
 * 现在两条链路共用一份：谁要问用户，都从这里发。
 *
 * 三条不可放宽的姿态：
 * 1. 死线随载荷给出，界面按 `expiresAt` 下卡；界面自己 now()+60s 会提前偷走响应窗口。
 * 2. 到点没人回答 = 拒绝，并把表清掉（不留一条挂死的 Promise）。
 * 3. 连一个能收卡的窗口都没有 = 当场拒绝，而不是挂到超时再说"问过你了"。
 *    ——这正是 #170 治过的那类谎：问了、但没告诉任何人。
 *
 * 这里**不**读 `readApproval`：批准位的严格性由 IPC 入口负责（那条判据
 * `tests/unit/approval-entry-surface.test.ts` 盯的是注册文件里出现 `readApproval(`）。
 */
import { PAOR } from '@shared/ipc-channels'
import type { PaorApprovalRequest } from '@shared/approval-types'
import { logger } from '@main/services/log/logger'

/** 审批超时（毫秒）——全仓只有这一把 */
export const APPROVAL_TIMEOUT_MS = 60_000

/** 推送通道（渲染层按这条订阅，见 stores/agent-stream-subscription.ts） */
export const APPROVAL_REQUEST_CHANNEL = PAOR.APPROVAL_REQUEST

/**
 * 发送面：接口而不是 BrowserWindow。
 * 审批要广播给**所有**窗口（只发主窗口的话，副窗口里发的对话永远收不到卡），
 * 那件事属于 Electron 层；等待器保持无 Electron，才能直接被单测跑住。
 */
export interface ApprovalTransport {
  /** 现在还有没有能收到卡片的窗口 */
  hasTarget(): boolean
  send(channel: string, payload: PaorApprovalRequest): void
}

interface Pending {
  resolve: (approved: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Pending>()

/** 当前挂起的审批数（超时/应答后必须回到 0，测试与内存都盯着它） */
export function pendingApprovalCount(): number {
  return pending.size
}

/**
 * 推一张审批卡并挂起等待用户响应。
 * 返回的 Promise **只会被 resolve(true/false) 一次**：到点自动拒、用户点后 resolve。
 */
export function requestApproval(
  transport: ApprovalTransport,
  input: Omit<PaorApprovalRequest, 'expiresAt'>
): Promise<boolean> {
  const now = Date.now()
  if (!transport.hasTarget()) {
    logger.warn('SECURITY.APPROVAL', '没有可推送审批卡的窗口，按未批准处理', {
      callId: input.callId,
      origin: input.origin,
    })
    return Promise.resolve(false)
  }
  const payload: PaorApprovalRequest = { ...input, expiresAt: now + APPROVAL_TIMEOUT_MS }
  logger.info('SECURITY.APPROVAL', '推送审批请求', {
    callId: payload.callId,
    origin: payload.origin,
    level: payload.riskLevel,
  })
  transport.send(APPROVAL_REQUEST_CHANNEL, payload)

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pending.delete(payload.callId)
      logger.warn('SECURITY.APPROVAL', '审批超时，自动拒绝', {
        callId: payload.callId,
        origin: payload.origin,
      })
      resolve(false)
    }, APPROVAL_TIMEOUT_MS)
    pending.set(payload.callId, { resolve, timeout })
  })
}

/**
 * 用户应答。批准位必须由调用方过 `readApproval` 筛成严格布尔再进来。
 * 返回 false 表示这个 callId 不在表里（已超时或从来没见过）——不静默吞掉。
 */
export function settleApproval(callId: string, approved: boolean): boolean {
  const item = pending.get(callId)
  if (!item) return false
  clearTimeout(item.timeout)
  pending.delete(callId)
  item.resolve(approved)
  logger.info('SECURITY.APPROVAL', approved ? '用户批准' : '用户拒绝', { callId })
  return true
}
