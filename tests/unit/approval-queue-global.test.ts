// @vitest-environment jsdom
/**
 * 审批队列住在"全局"这一判据（#170 / 调研报告 P0-1）
 *
 * 缺陷形状：审批请求的订阅写在 `AIPanel` 的 useEffect 里，而 AI 面板是
 * `WorkbenchPage.tsx` 按 `aiPanelVisible` **条件渲染**的。面板一收起，订阅就解绑，
 * 主进程照样把"要不要执行这条命令"推过来——没人接，60 秒后自动拒绝。
 * 用户回来看到的是"命令被拦下了"，真实情况是"问了，没告诉任何人"。
 *
 * 修法是把队列搬到 `stores/approval-store`，订阅搬到 `agent-stream-subscription`
 * （那正是流式事件当年治同一个病灶的地方）。本文件因此要断的不是"卡片好不好看"，
 * 而是这条：**没有任何组件挂载时，请求仍然进得来、留得住、到点会自己标过期。**
 *
 * 本文件的承重断言是那条最朴素的：**没有任何组件挂载时，请求仍然进得来、留得住、
 * 到点会自己标过期**。修之前它一定红——订阅在面板里，而这里从没挂载过任何组件，
 * `captured` 永远是 null。这条比"把源码那行掐掉再跑一遍"更强，因为它不需要动产品文件
 * （全量并行时往 src 写一行会污染同时在读这份文件的其它判据）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PaorApprovalRequest } from '@shared/approval-types'

const ROOT = path.resolve(__dirname, '..', '..')

/** 只带着这条测试需要的三把键；其余按需可选（订阅里都是 ?. 或显式调用） */
interface FakeApi {
  onAgentChunk: (cb: (p: unknown) => void) => () => void
  onAgentDone: (cb: (p: unknown) => void) => () => void
  onAgentError: (cb: (p: unknown) => void) => () => void
  onPaorApprovalRequest?: (cb: (r: PaorApprovalRequest) => void) => () => void
}

/** 每个键都要还一把"解绑"函数，返回值形状照 preload 的订阅 API */
const unsubscribe = (): (() => void) => () => undefined

let captured: ((r: PaorApprovalRequest) => void) | null = null

function installFakeApi(): void {
  captured = null
  const api: FakeApi = {
    onAgentChunk: () => unsubscribe(),
    onAgentDone: () => unsubscribe(),
    onAgentError: () => unsubscribe(),
    onPaorApprovalRequest: (cb) => {
      captured = cb
      return () => {
        captured = null
      }
    },
  }
  window.electronAPI = api as unknown as typeof window.electronAPI
}

const req = (over: Partial<PaorApprovalRequest> = {}): PaorApprovalRequest => ({
  callId: 'call-1',
  command: 'rm -rf /var/log',
  riskLevel: 'CRITICAL',
  riskDescription: '递归删除系统日志目录',
  origin: 'chat',
  timestamp: Date.now(),
  expiresAt: Date.now() + 60_000,
  ...over,
})

/** 每个用例都要重新拿模块实例：订阅模块里有模块级的"只订阅一次"守卫 */
async function loadFresh(): Promise<{
  useApprovalStore: typeof import('@/stores/approval-store')['useApprovalStore']
  countAwaiting: typeof import('@/stores/approval-store')['countAwaiting']
  init: () => void
}> {
  vi.resetModules()
  const store = await import('@/stores/approval-store')
  const sub = await import('@/stores/agent-stream-subscription')
  return {
    useApprovalStore: store.useApprovalStore,
    countAwaiting: store.countAwaiting,
    init: () => sub.initAgentStreamSubscription(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  installFakeApi()
})

afterEach(() => {
  vi.useRealTimers()
  window.electronAPI = undefined as unknown as typeof window.electronAPI
})

describe('审批队列 · 全局可达（#170）', () => {
  it('订阅确实挂上了：init 之后主进程推的 request 能进队列', async () => {
    const { useApprovalStore, init } = await loadFresh()
    expect(captured).toBeNull() // 还没 init 之前不该有人接
    init()
    expect(captured).toBeTypeOf('function')
    captured?.(req())
    expect(useApprovalStore.getState().entries).toHaveLength(1)
  })

  it('没有 PermissionBar、没有任何组件挂载时，请求照样留得住（这就是修好的本身）', async () => {
    const { useApprovalStore, countAwaiting, init } = await loadFresh()
    init()
    captured?.(req({ callId: 'a' }))
    captured?.(req({ callId: 'b', command: 'reboot' }))
    // 本文件全程没 render 过任何 React 组件——队列里有两条就是证据
    const entries = useApprovalStore.getState().entries
    expect(entries.map((e) => e.request.callId)).toEqual(['a', 'b'])
    expect(countAwaiting(entries)).toBe(2)
  })

  it('同一 callId 重复推送不叠加（重连/重推不能变成两张卡）', async () => {
    const { useApprovalStore, init } = await loadFresh()
    init()
    captured?.(req({ callId: 'x' }))
    captured?.(req({ callId: 'x' }))
    expect(useApprovalStore.getState().entries).toHaveLength(1)
  })

  it('用户答完就出队；到点没答则标成过期而不是悄悄消失', async () => {
    const { useApprovalStore, countAwaiting, init } = await loadFresh()
    init()
    captured?.(req({ callId: 'answered' }))
    captured?.(req({ callId: 'ignored', expiresAt: Date.now() + 5_000 }))

    useApprovalStore.getState().settle('answered')
    expect(useApprovalStore.getState().entries.map((e) => e.request.callId)).toEqual(['ignored'])

    vi.advanceTimersByTime(6_000) // 5s 死线 + 400ms 宽限之后
    const left = useApprovalStore.getState().entries
    expect(left).toHaveLength(1)
    expect(left[0]?.expired).toBe(true)
    // 过期不再算"等人回答"——徽章数用的是这个口径
    expect(countAwaiting(left)).toBe(0)
  })

  it('死线之前不许提前把卡判成过期（用户的响应窗口不能被界面偷走）', async () => {
    const { useApprovalStore, init } = await loadFresh()
    init()
    captured?.(req({ callId: 'later', expiresAt: Date.now() + 60_000 }))
    vi.advanceTimersByTime(59_000)
    expect(useApprovalStore.getState().entries[0]?.expired).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(useApprovalStore.getState().entries[0]?.expired).toBe(true)
  })

  // ===== 反证：病灶不能回到组件里 =====

  it('AIPanel 不再自带审批订阅（订阅只在 agent-stream-subscription）', () => {
    const panel = fs.readFileSync(
      path.join(ROOT, 'src/renderer/src/components/workbench/AIPanel.tsx'),
      'utf8'
    )
    expect(panel).not.toContain('onPaorApprovalRequest')
    const sub = fs.readFileSync(
      path.join(ROOT, 'src/renderer/src/stores/agent-stream-subscription.ts'),
      'utf8'
    )
    expect(sub).toContain('onPaorApprovalRequest')
  })
})
