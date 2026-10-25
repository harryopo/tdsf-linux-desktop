// @vitest-environment jsdom
/**
 * tests/components/pages/mcp-settings-tool-call.test.tsx — 外部 MCP 工具的「试调用」接上界面（#217）
 *
 * 病根：`mcpExternalCall` 是零调用名单上最后那一个。它不是白做的通道——handler 每次调用都推审批卡、
 * 拒绝还会写进同一条拦截留痕（#173），两份 e2e 正走它验审批。缺的只是界面入口：
 * 设置 → 外部 MCP 那格"这些服务器提供的工具"只把工具列出来，看得见、点不动。
 *
 * 为什么是接上而不是删：`#173` 那条判决的落点就是"外部工具能被调用、但每次都要有人点头"。
 * 现在点头的链路只有 AI 对话那一条走得通，用户自己反而没法拿一个工具试一下——
 * 那等于把"这套审批到底拦不拦得住"变成只能相信，不能验证。
 *
 * 取数面都锁在工具行里面（`within(row)`）：这一页本来就有一个"参数（空格分隔）"是添加表单的，
 * 按名字全局找 textbox 会把两件事混成一件——第一版就是这么红的（Found multiple elements）。
 *
 * 判据各钉一件事：
 * 1. 入口在工具行里，点了才要参数；参数走 `mcpExternalCall(serverId, toolName, args)`
 * 2. 参数不是合法 JSON 就当场说清楚，一个请求都不许发出去（发出去等于把半截输入喂给第三方）
 * 3. 回 `error: 'not-approved'` 要说"没批准 · 没有执行"，不许和"调用成功"共用一张脸
 * 4. 成功要显出对面回的文本；失败（非审批）要显原因，不许显示成功
 * 5. 反过度砍：这一页原有的网关健康格与工具清单读取必须还在（#209 / #173 的落点）
 * 6. 对面回得超长：这一格截的是显示、不是数据，完整长度必须写在界面上
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ExternalMcpServer, ExternalMcpServerStatus, McpExternalTool } from '@shared/models'

import { McpSettings } from '@renderer/pages/McpSettings'

const call = vi.fn()

function installApi(tools: McpExternalTool[]) {
  const stub = {
    mcpExternalList: vi.fn(async (): Promise<ExternalMcpServer[]> => []),
    mcpExternalTools: vi.fn(async () => tools),
    mcpExternalStatus: vi.fn(async (): Promise<ExternalMcpServerStatus[]> => []),
    mcpGetState: vi.fn(async () => ({
      state: 'connected',
      consecutiveFailures: 0,
      retryAttempts: 0,
      lastFailureAt: null,
      lastFailureReason: null,
      backoffUntil: null,
      backoffRemainingSec: 0,
    })),
    mcpReset: vi.fn(async () => true),
    onMcpStateChanged: vi.fn(() => () => undefined),
    mcpExternalCall: call,
  }
  Object.defineProperty(window, 'electronAPI', { value: stub, configurable: true })
  return stub
}

const TOOLS: McpExternalTool[] = [
  { serverId: 'mcp-srv-1', serverName: '本机靶子', name: 'echo', description: '原样回一段文本' },
]

/**
 * 展开第一个工具行的试调用表单，把后续取数锁在这一行里。
 * 行数是断言的一部分：多一个少一个都不是"每个工具一个入口"那个形状。
 */
async function openTryout(): Promise<HTMLElement> {
  await screen.findByText('本机靶子 · echo')
  const rows = document.querySelectorAll<HTMLElement>('[data-dom-id="mcp-tool-row"]')
  expect(rows).toHaveLength(1)
  const row = rows[0]
  fireEvent.click(within(row).getByRole('button', { name: /试调用/ }))
  return row
}

/** 结果那一行的取数面（本仓界面锚点约定是 data-dom-id，全仓没有一处用 data-testid，不为测试引入第二套） */
async function resultLine(row: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(row.querySelector('[data-dom-id="mcp-tool-call-result"]')).not.toBeNull())
  return row.querySelector('[data-dom-id="mcp-tool-call-result"]') as HTMLElement
}

beforeEach(() => {
  call.mockReset()
  installApi(TOOLS)
})

describe('外部 MCP 工具的试调用入口（#217）', () => {
  it('1. 工具行上有「试调用」，填了参数才发请求，参数按 serverId/toolName/args 三项送出', async () => {
    call.mockResolvedValue({ success: true, content: [{ type: 'text', text: 'pong' }] })
    render(<McpSettings />)
    const row = await openTryout()
    fireEvent.change(within(row).getByRole('textbox', { name: /参数/ }), {
      target: { value: '{"msg":"pong"}' },
    })
    fireEvent.click(within(row).getByRole('button', { name: /^执行$/ }))
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1))
    expect(call.mock.calls[0]).toEqual(['mcp-srv-1', 'echo', { msg: 'pong' }])
  })

  it('2. 参数不是合法 JSON：当场说清楚，一个请求都不许发出去', async () => {
    render(<McpSettings />)
    const row = await openTryout()
    fireEvent.change(within(row).getByRole('textbox', { name: /参数/ }), {
      target: { value: '{"msg":' },
    })
    fireEvent.click(within(row).getByRole('button', { name: /^执行$/ }))
    expect(await within(row).findByText(/不是合法 JSON/)).toBeInTheDocument()
    expect(call).not.toHaveBeenCalled()
  })

  it('3. 没批准要说"没有执行"，不许和成功共用一张脸', async () => {
    call.mockResolvedValue({
      success: false,
      content: [{ type: 'text', text: '这次外部 MCP 调用没有被批准（拒绝或超时）。' }],
      error: 'not-approved',
    })
    render(<McpSettings />)
    const row = await openTryout()
    fireEvent.change(within(row).getByRole('textbox', { name: /参数/ }), { target: { value: '{}' } })
    fireEvent.click(within(row).getByRole('button', { name: /^执行$/ }))
    const line = await resultLine(row)
    expect(line.textContent).toContain('没有执行')
    expect(line.textContent).not.toMatch(/成功|已调用/)
  })

  it('4. 成功显出对面回的文本；失败显原因，两种结果不许同形', async () => {
    call.mockResolvedValue({ success: true, content: [{ type: 'text', text: 'pong-结果' }] })
    const { unmount } = render(<McpSettings />)
    const okRow = await openTryout()
    fireEvent.change(within(okRow).getByRole('textbox', { name: /参数/ }), { target: { value: '{}' } })
    fireEvent.click(within(okRow).getByRole('button', { name: /^执行$/ }))
    expect(await resultLine(okRow)).toHaveTextContent('pong-结果')
    unmount()

    call.mockResolvedValue({ success: false, content: [{ type: 'text', text: '对面报：连接断了' }], error: 'boom' })
    render(<McpSettings />)
    const badRow = await openTryout()
    fireEvent.change(within(badRow).getByRole('textbox', { name: /参数/ }), { target: { value: '{}' } })
    fireEvent.click(within(badRow).getByRole('button', { name: /^执行$/ }))
    const fail = await resultLine(badRow)
    expect(fail.textContent).toContain('连接断了')
    expect(fail.textContent).not.toMatch(/成功|已调用/)
  })

  it('5. 反过度砍：这一页原有的健康格与工具清单读取都还在', async () => {
    const api = installApi(TOOLS)
    render(<McpSettings />)
    await screen.findByText('本机靶子 · echo')
    expect(api.mcpGetState).toHaveBeenCalled()
    expect(await screen.findByText(/本机 MCP 网关/)).toBeInTheDocument()
  })

  it('6. 对面回得很长：这一格只截显示，并把完整长度如实写出来', async () => {
    call.mockResolvedValue({
      success: true,
      content: [{ type: 'text', text: 'A'.repeat(2500) }],
    })
    render(<McpSettings />)
    const row = await openTryout()
    fireEvent.change(within(row).getByRole('textbox', { name: /参数/ }), { target: { value: '{}' } })
    fireEvent.click(within(row).getByRole('button', { name: /^执行$/ }))
    const line = await resultLine(row)
    expect(line.textContent).not.toContain('A'.repeat(2001))
    expect(line.textContent).toContain('对面一共回了 2500 字')
  })
})
