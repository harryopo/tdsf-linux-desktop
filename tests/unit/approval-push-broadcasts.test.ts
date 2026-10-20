/**
 * tests/unit/approval-push-broadcasts.test.ts — 审批推送要让每个窗口都收到（#3 后端审查 P1）
 *
 * 为什么钉这一条：W4 之后应用可以有第二个窗口，但审批/工具进度/主机密钥这些推送
 * 一直只发给"注册时那一个窗口"。在副窗口里点执行 → 请求发进了一个看不见的窗口 →
 * 30 秒后自动拒绝，用户完全不知道为什么被拒。
 * 更糟的一种是那个窗口已经销毁：老代码直接什么都不发，静静等满超时。
 *
 * 判据走真 waitForSandboxApproval + 两个假窗口（其中一个就是"注册时那一个"，
 * 且第二条用例里它已销毁）。改回 mainWindow.webContents.send 这两条必红。
 * 超时用假定时器推过去，不真等 30 秒。
 *
 * 载体换成沙箱审批是 2026-10-20 的事：原来这条判据挂在 Task Protocol 的
 * task-permission-approval 上，那条链路整体删除后判据不能跟着丢 ——
 * "审批必须广播"与是哪一种审批无关。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// box.wins 里放的是广播端真正读到的那两个字段。原先写成 Record<string, unknown>，
// 于是 win.isDestroyed 是 unknown、只能 as boolean，字段改名也不会红。
// （本文件另有一个 FakeWin，那是 fakeWindow() 返回给断言用的把手，别混名）
type WinLike = {
  isDestroyed: () => boolean
  webContents: { isDestroyed: () => boolean; send: (channel: string, ...args: unknown[]) => void }
}
const box = vi.hoisted(() => ({ wins: [] as Array<WinLike> }))

// 真 broadcastToWindows 从模块内的 appWindows 数组取窗口（只有真建过窗口才有内容），
// 单测里造不出窗口，所以这里按 main-window.ts 的语义镜像一份：
// 跳过已销毁的窗口，其余每个都发。本用例要判的是"调用点有没有改走广播"，
// 而不是这个 helper 自己 —— 它没有别的消费者，语义镜像错会在第 2 条用例暴露。
vi.mock('../../src/main/windows/main-window', () => ({
  broadcastToWindows: (channel: string, ...args: unknown[]): void => {
    for (const win of box.wins) {
      if (win.isDestroyed()) continue
      if (win.webContents.isDestroyed()) continue
      win.webContents.send(channel, ...args)
    }
  },
}))
vi.mock('../../src/main/services/log/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
// AST 引擎在单测里起不来，让它如实返回"算不出"，风险等级走权威正则兜底那条路
vi.mock('../../src/main/core/risk-engine-ast', () => ({
  assessWithAst: () => Promise.resolve(null),
}))

import {
  SANDBOX_APPROVAL_CHANNEL,
  SANDBOX_APPROVAL_TIMEOUT_MS,
  pendingSandboxApprovals,
  waitForSandboxApproval,
} from '../../src/main/ipc/sandbox-approval'

interface FakeWin {
  label: string
  sends: Array<{ channel: string; args: unknown[] }>
}

function fakeWindow(label: string, destroyed = false): FakeWin {
  const w: FakeWin = { label, sends: [] }
  box.wins.push({
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => destroyed,
      send: (channel: string, ...args: unknown[]) => {
        w.sends.push({ channel, args })
      },
    },
  })
  return w
}

function approvalCount(w: FakeWin): number {
  return w.sends.filter((s) => s.channel === SANDBOX_APPROVAL_CHANNEL).length
}

/** 推送发生在 await 风险评估之后，先把微任务放出来再数 */
async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('审批请求的推送面', () => {
  beforeEach(() => {
    box.wins.length = 0
    pendingSandboxApprovals.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    pendingSandboxApprovals.clear()
    vi.useRealTimers()
  })

  it('1. 两个窗口都收到审批请求，副窗口不再是盲区', async () => {
    const primary = fakeWindow('主窗口（注册时那一个）')
    const secondary = fakeWindow('副窗口')

    const pending = waitForSandboxApproval(primary as never, 'call-1', 'sbx-1', 'rm -rf /var/log')
    await flushMicrotasks()
    expect(approvalCount(primary)).toBe(1)
    expect(approvalCount(secondary), '副窗口没收到审批请求（老代码就漏在这里）').toBe(1)

    // 先挂好"应当被拒"的处理器再推进定时器：反过来写会让 reject 在两个 await
    // 之间无人认领，vitest 报 Unhandled Rejection（这条测试自己就成了噪声源）
    const settled = expect(pending).rejects.toThrow(/超时/)
    await vi.advanceTimersByTimeAsync(SANDBOX_APPROVAL_TIMEOUT_MS)
    await settled
  })

  it('2. 注册时那个窗口已销毁，仍要发给还活着的窗口（老代码一条都不发）', async () => {
    const dead = fakeWindow('已关掉的注册窗口', true)
    const alive = fakeWindow('还开着的窗口')

    const pending = waitForSandboxApproval(dead as never, 'call-2', 'sbx-2', 'rm -rf /var/log')
    const settled = expect(pending).rejects.toThrow(/超时/)
    await flushMicrotasks()
    expect(approvalCount(alive)).toBe(1)
    expect(dead.sends, '不该往已销毁的窗口里发').toHaveLength(0)

    await vi.advanceTimersByTimeAsync(SANDBOX_APPROVAL_TIMEOUT_MS)
    await settled
  })
})
