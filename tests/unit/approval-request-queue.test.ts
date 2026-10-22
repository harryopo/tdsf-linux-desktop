/**
 * 审批等待器抽成单源之后的判据（#173 前置 / 调研 P0-4）
 *
 * 为什么要抽：`PAOR_APPROVAL_TIMEOUT_MS = 60_000` 与那张 pending 表原来住在
 * `ipc/agent-runtime.ts` 里。外部 MCP 工具调用要接同一套人工审批时，
 * 若在 `ipc/mcp.ts` 再造一份，就是"两处各写一把 60 秒，迟早漂"——
 * 而《长期优化目标》里点名的正是这个形状。
 *
 * 这里判的是四件会咬人的事：
 * 死线随载荷给出（界面不许自己算）、批准位只认调用方交来的严格布尔、
 * 超时自动拒绝并把表清掉、窗口没了就当场拒绝而不是把请求挂死。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  requestApproval,
  settleApproval,
  pendingApprovalCount,
  APPROVAL_TIMEOUT_MS,
  type ApprovalTransport,
} from '@main/core/security/approval-request'
import type { PaorApprovalRequest } from '@shared/approval-types'

const sent: PaorApprovalRequest[] = []

/**
 * 发送面是个接口而不是 BrowserWindow：审批要**广播给所有窗口**（副窗口只发主窗口的话
 * 就收不到卡），而这条要求属于 Electron 层；等待器本身要保持无 Electron、能直接单测。
 */
function makeTransport(alive = true): ApprovalTransport {
  return {
    hasTarget: () => alive,
    send: (channel: string, payload: PaorApprovalRequest) => {
      expect(channel).toBe('paor:approval-request')
      sent.push(payload)
    },
  }
}

const base = (callId: string): Omit<PaorApprovalRequest, 'expiresAt'> => ({
  callId,
  command: 'rm -rf /var/log',
  riskLevel: 'HIGH',
  riskDescription: '测试用',
  origin: 'mcp',
  timestamp: Date.now(),
})

beforeEach(() => {
  sent.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('审批等待器', () => {
  it('死线随载荷给出，界面不用再自己算 60 秒', async () => {
    const p = requestApproval(makeTransport(), base('q-1'))
    expect(sent).toHaveLength(1)
    expect(sent[0].expiresAt - sent[0].timestamp).toBe(APPROVAL_TIMEOUT_MS)
    settleApproval('q-1', true)
    await expect(p).resolves.toBe(true)
  })

  it('批准位：只有调用方交来的严格 true 才放行', async () => {
    const p = requestApproval(makeTransport(), base('q-2'))
    expect(settleApproval('q-2', false)).toBe(true)
    await expect(p).resolves.toBe(false)
  })

  it('同一个 callId 不应被答复两次（第二次返回 false，不重复 resolve）', async () => {
    const p = requestApproval(makeTransport(), base('q-3'))
    expect(settleApproval('q-3', true)).toBe(true)
    expect(settleApproval('q-3', false)).toBe(false)
    await expect(p).resolves.toBe(true)
  })

  it('没人回答 → 到点自动拒绝，并且表里不挂东西', async () => {
    const p = requestApproval(makeTransport(), base('q-4'))
    expect(pendingApprovalCount()).toBe(1)
    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS + 10)
    await expect(p).resolves.toBe(false)
    expect(pendingApprovalCount()).toBe(0)
  })

  it('一个窗口都没有就当场拒绝（不许把请求挂到超时）', async () => {
    const p = requestApproval(makeTransport(false), base('q-5'))
    await expect(p).resolves.toBe(false)
    expect(sent, '没有能收卡的窗口还推什么').toHaveLength(0)
    expect(pendingApprovalCount()).toBe(0)
  })

  it('未知 callId 的应答返回 false（不能悄悄吞掉，也不能放行）', () => {
    expect(settleApproval('never-asked', true)).toBe(false)
  })
})
