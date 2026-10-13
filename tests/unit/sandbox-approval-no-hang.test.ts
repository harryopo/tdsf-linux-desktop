/**
 * 沙箱审批等待的"必须能落定"判据
 *
 * 缺陷形状（修前）：waitForSandboxApproval 写成 `new Promise(async (resolve, reject) => …)`，
 * 执行体里先 `await assessCommandRisk()` 再装 30 秒超时器。async 执行体抛错时抛的是它
 * 自己那个内层 Promise，构造出来的外层 Promise 既不 resolve 也不 reject，超时器又还没装上
 * ——于是"风险评估/回滚推导任何一步抛错"都表现为审批框永远不出现、AI 请求原地挂死，
 * 而不是按 HC-6 的 fail-closed 语义拒绝执行。
 *
 * 判据（两条互相咬合）：
 *   1. 前置计算抛错 ⇒ 有界时间内 reject（不许挂）；
 *   2. 正向对照：正常路径确实会推审批请求并等批复，resolve 得回来。
 *      没有这条，第 1 条可以被"整个函数直接抛"这种实现蒙过去。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'

const mockBroadcast = vi.hoisted(() => vi.fn())
const mockAssessWithAst = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/windows/main-window', () => ({
  broadcastToWindows: (...args: unknown[]) => mockBroadcast(...args),
}))
vi.mock('../../src/main/services/log/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/main/core/risk-engine-ast', () => ({
  assessWithAst: (...args: unknown[]) => mockAssessWithAst(...args),
}))

import {
  pendingSandboxApprovals,
  waitForSandboxApproval,
} from '../../src/main/ipc/sandbox-approval'

const FAKE_WINDOW = {} as unknown as BrowserWindow

/** 有界等待：把"永挂"变成一条能读懂的红，而不是 5 秒后的 test timeout */
async function settleWithin<T>(p: Promise<T>, ms = 1_000): Promise<'pending' | { ok: T } | { err: unknown }> {
  let timer: NodeJS.Timeout | undefined
  const sentinel = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => resolve('pending'), ms)
  })
  try {
    const raced = await Promise.race([
      p.then((v) => ({ ok: v }) as { ok: T }, (e: unknown) => ({ err: e }) as { err: unknown }),
      sentinel,
    ])
    return raced
  } finally {
    if (timer) clearTimeout(timer)
  }
}

describe('waitForSandboxApproval —— 审批等待不许挂死', () => {
  beforeEach(() => {
    mockBroadcast.mockClear()
    mockAssessWithAst.mockReset()
    pendingSandboxApprovals.clear()
  })
  afterEach(() => {
    pendingSandboxApprovals.clear()
  })

  it('前置风险计算抛错 ⇒ 有界时间内 reject（旧写法在这里永挂）', async () => {
    mockAssessWithAst.mockRejectedValue(new Error('AST 引擎未就绪'))

    const settled = await settleWithin(waitForSandboxApproval(FAKE_WINDOW, 'call-1', 'sbx-1', 'rm -rf /'))

    expect(settled, '审批请求没落定 = 用户看不到弹窗，AI 请求原地挂死').not.toBe('pending')
    expect((settled as { err: unknown }).err).toBeInstanceOf(Error)
    expect((settled as { err: Error }).err.message).toContain('AST 引擎未就绪')
    // 挂死时也不该留下半截登记
    expect(pendingSandboxApprovals.has('call-1')).toBe(false)
  })

  it('正向对照：算得出风险时确实推审批请求，并等来批复', async () => {
    mockAssessWithAst.mockResolvedValue({ risk: 'high', reasons: ['rm -rf 根目录'] })

    const pending = waitForSandboxApproval(FAKE_WINDOW, 'call-2', 'sbx-2', 'rm -rf /', 'sess-9')
    // 请求已推给所有窗口，且登记着等待中的批复
    await vi.waitFor(() => expect(mockBroadcast).toHaveBeenCalledTimes(1))
    const [, request] = mockBroadcast.mock.calls[0] as [string, { callId: string; risk: string; sessionId?: string }]
    expect(request.callId).toBe('call-2')
    expect(request.risk).toBe('high')
    expect(request.sessionId).toBe('sess-9')
    expect(pendingSandboxApprovals.has('call-2')).toBe(true)

    // 模拟渲染进程点"执行"（sandbox:approve 的处理器负责 delete，这里只喂 resolve）
    pendingSandboxApprovals.get('call-2')!.resolve(true)
    await expect(pending).resolves.toBe(true)
  })

  it('量具自证：永不落定的 Promise 必须被判成 pending', async () => {
    // 没有这条，第 1 条的"not pending"断言等于空转——挂死的实现也能让它通过。
    const r = await settleWithin(new Promise<never>(() => undefined), 50)
    expect(r).toBe('pending')
  })
})
