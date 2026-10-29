/**
 * 高危操作的人工审批等待器（单源）
 *
 * 为什么单独一个文件：这把超时和那张 callId→resolve 表原来只住在
 * `ipc/agent-runtime.ts`。外部 MCP 工具调用（`mcp:external-call`）也要接人工审批时，
 * 在 `ipc/mcp.ts` 再造一份就是"两处各写一把 60 秒，迟早漂"——
 * 而《长期优化目标》里点名的正是这个形状（`@shared/approval-types.ts` 的 `expiresAt` 注释）。
 * 现在两条链路共用一份：谁要问用户，都从这里发。
 *
 * 超时时长可以在设置页改（决策设置 → 决策超时，键 `decision.decisionTimeout`，单位秒；
 * 主进程启动时把 `ConfigStore.get('decision.decisionTimeout')` 交进来）。
 * 这个模块不直接 import 配置存储：它保持无 Electron 依赖才能被单测直接跑住，
 * 所以取数口由主进程启动时注入（见 `setApprovalTimeoutSource`）。
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
import {
  APPROVAL_TIMEOUT_DEFAULT_SEC,
  APPROVAL_TIMEOUT_MAX_SEC,
  APPROVAL_TIMEOUT_MIN_SEC,
  type PaorApprovalRequest,
} from '@shared/approval-types'
import { logger } from '@main/services/log/logger'

/** 审批超时默认值（毫秒）——没配置、配置读不出来、或配置越界时用它 */
export const APPROVAL_TIMEOUT_MS = APPROVAL_TIMEOUT_DEFAULT_SEC * 1000

/**
 * 把界面上那个任意值夹成可用的秒数。
 * 三条姿态：越界夹到端点（不给"填 0 就永不超时"这条路）；
 * 没配过 / null / 对象 / 空串 / NaN 一律回默认；带引号的数字接受（手改 config.json 的现实形状）。
 */
export function clampApprovalTimeoutSec(raw: unknown): number {
  if (typeof raw !== 'number' && typeof raw !== 'string') return APPROVAL_TIMEOUT_DEFAULT_SEC
  if (typeof raw === 'string' && raw.trim() === '') return APPROVAL_TIMEOUT_DEFAULT_SEC
  const n = typeof raw === 'number' ? raw : Number(raw.trim())
  if (!Number.isFinite(n)) return APPROVAL_TIMEOUT_DEFAULT_SEC
  const rounded = Math.round(n)
  if (rounded < APPROVAL_TIMEOUT_MIN_SEC) return APPROVAL_TIMEOUT_MIN_SEC
  if (rounded > APPROVAL_TIMEOUT_MAX_SEC) return APPROVAL_TIMEOUT_MAX_SEC
  return rounded
}

/** 由主进程注入的配置取数口；没注入就一直用默认值（fail-closed 到一个已知时长） */
let timeoutSource: (() => unknown) | null = null

export function setApprovalTimeoutSource(source: (() => unknown) | null): void {
  timeoutSource = source
}

/** 本次审批该等多久（毫秒）。一次请求只算一次，expiresAt 与定时器必须同源 */
export function resolveApprovalTimeoutMs(): number {
  return clampApprovalTimeoutSec(timeoutSource?.()) * 1000
}

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
  const timeoutMs = resolveApprovalTimeoutMs()
  const payload: PaorApprovalRequest = { ...input, expiresAt: now + timeoutMs }
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
    }, timeoutMs)
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
