// @vitest-environment jsdom
/**
 * tests/components/pages/mcp-settings-gateway.test.tsx — MCP 网关状态接上界面（#209）
 *
 * 病根：`mcpGetState` / `mcpReset` / `onMcpStateChanged` 三把键在 preload 暴露了、
 * 主进程有真生产者（外部调用成败与本地 Server 启动结果都会喂状态机，见
 * tests/unit/mcp-state-producer.test.ts），但渲染层零调用——那台 5 态状态机一直在跑、
 * 一直在推，界面上一个字都没接。mcp-gateway.ts 的注释还写着
 * "唯一能结束冷却的『重置』按钮至今没有界面入口"。这几条判据把它接成真功能。
 *
 * 判据各钉一件事：
 * 1. 首屏读数来自 mcpGetState，不是写死的"连接正常"（夹具给 degraded，界面就得说受损）
 * 2. 主进程推送来了就变，不用刷新页面
 * 3. 点"重置失败计数"真的调 mcpReset 并重新读一次
 * 4. 离开这一页就取消订阅（不取消的话每进一次这页多叠一个监听，状态会被推多次）
 * 5. 读不到就报原因 + 给下一步，不许冒充健康
 * 6. 窗口没有这把键时说明白，同样不许冒充健康
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type {
  ExternalMcpServer,
  ExternalMcpServerStatus,
  McpExternalTool,
  McpStateContext,
} from '@shared/models'

import { McpSettings } from '@renderer/pages/McpSettings'

/** 一次失败的完整时刻（18:04:12），界面按本地时区原样显示 */
const FAIL_AT = new Date(2026, 9, 24, 18, 4, 12).getTime()

function ctx(over: Partial<McpStateContext> = {}): McpStateContext {
  return {
    state: 'connected',
    consecutiveFailures: 0,
    retryAttempts: 0,
    lastFailureAt: null,
    lastFailureReason: null,
    backoffUntil: null,
    backoffRemainingSec: 0,
    ...over,
  }
}

/** 主进程把状态推给谁了：收集回调，测试自己扮演状态机推一次 */
let pushes: Array<(next: McpStateContext) => void>
const unsub = vi.fn()

/**
 * 装一个最小的 electronAPI。
 * `getState` 传 null 表示这个窗口压根没有 mcpGetState 这把键（判据 6）。
 * 三把外部服务器读键给空数组 = "这台机器还没登记服务器"，与网关状态无关。
 */
function installApi(getState: (() => Promise<McpStateContext>) | null) {
  const stub = {
    mcpExternalList: vi.fn(async (): Promise<ExternalMcpServer[]> => []),
    mcpExternalTools: vi.fn(async (): Promise<McpExternalTool[]> => []),
    mcpExternalStatus: vi.fn(async (): Promise<ExternalMcpServerStatus[]> => []),
    ...(getState ? { mcpGetState: getState } : {}),
    mcpReset: vi.fn(async (): Promise<boolean> => true),
    onMcpStateChanged: vi.fn((cb: (next: McpStateContext) => void) => {
      pushes.push(cb)
      return unsub
    }),
  }
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: stub })
  return stub
}

describe('McpSettings — 网关状态那一格', () => {
  beforeEach(() => {
    pushes = []
    unsub.mockReset()
  })

  it('1. 首屏读数来自 mcpGetState：夹具说受损就写受损，且不写成按钮', async () => {
    installApi(
      async () =>
        ctx({
          state: 'degraded',
          consecutiveFailures: 1,
          lastFailureAt: FAIL_AT,
          lastFailureReason: 'stdio 子进程起不来',
        })
    )
    render(<McpSettings />)

    expect(await screen.findByText('部分能力受损')).toBeTruthy()
    expect(screen.getByText('连续失败 1 次 · 本轮重试 0 次')).toBeTruthy()
    expect(screen.getByText('最近失败 18:04:12')).toBeTruthy()
    expect(screen.getByText('原因：stdio 子进程起不来')).toBeTruthy()
    // 反向对照：界面不是硬编码一句"连接正常"
    expect(screen.queryByText('连接正常')).toBeNull()
    // DESIGN §5：只读读数不是按钮
    expect(screen.queryByRole('button', { name: /部分能力受损/ })).toBeNull()
  })

  it('2. 状态变更推送来了就变，不用刷新页面', async () => {
    installApi(async () => ctx())
    render(<McpSettings />)
    expect(await screen.findByText('连接正常')).toBeTruthy()

    await act(async () => {
      expect(pushes.length).toBe(1)
      pushes[0](
        ctx({
          state: 'failed',
          consecutiveFailures: 3,
          retryAttempts: 3,
          lastFailureAt: FAIL_AT,
          lastFailureReason: '连不上',
        })
      )
    })

    expect(screen.getByText('连接失败')).toBeTruthy()
    expect(screen.getByText('连续失败 3 次 · 本轮重试 3 次')).toBeTruthy()
    expect(screen.queryByText('连接正常')).toBeNull()
  })

  it('3. 点「重置失败计数」真的调 mcpReset 并重新读一次', async () => {
    const getState = vi
      .fn<() => Promise<McpStateContext>>()
      .mockResolvedValueOnce(
        ctx({
          state: 'backoff',
          consecutiveFailures: 4,
          retryAttempts: 3,
          lastFailureReason: '连不上',
          backoffUntil: FAIL_AT,
        })
      )
      .mockResolvedValueOnce(ctx())
    const stub = installApi(getState)
    render(<McpSettings />)

    expect(await screen.findByText('冷却中…')).toBeTruthy()
    expect(screen.getByText('冷却至 18:04:12')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /重置失败计数/ }))

    await waitFor(() => expect(stub.mcpReset).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('连接正常')).toBeTruthy()
  })

  it('4. 离开这一页就取消订阅', async () => {
    installApi(async () => ctx())
    const { unmount } = render(<McpSettings />)
    await waitFor(() => expect(pushes.length).toBe(1))

    unmount()

    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('5. 读不到时报原因和下一步，不冒充健康', async () => {
    installApi(async () => {
      throw new Error('通道没有注册')
    })
    render(<McpSettings />)

    expect(await screen.findByText(/读不到网关状态/)).toBeTruthy()
    expect(screen.getByText(/通道没有注册/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新读取网关状态/ })).toBeTruthy()
    expect(screen.queryByText('连接正常')).toBeNull()
  })

  it('6. 窗口没拿到这把键时说明白，同样不冒充健康', async () => {
    installApi(null)
    render(<McpSettings />)

    expect(await screen.findByText(/这个窗口没有拿到 MCP 网关状态接口/)).toBeTruthy()
    expect(screen.queryByText('连接正常')).toBeNull()
  })
})
