/**
 * MCP sandbox_execute 必须与 IPC sandbox:execute 走同一道人工审批
 * （2026-10-15 全维度系统审查 A8）
 *
 * 病根：审批链只装在 IPC 那侧（ipc/sandbox.ts:323），MCP 那侧（外部 agent 也能到的入口）
 * 只过 evaluateCommand 就直接执行——同一个动作两个入口、一道门。
 * 这里量的是"闸在不在执行之前"，而不是"代码里有没有这个函数"。
 *
 * 三条一起写才有牙：①没有窗口时拒（fail-closed）；②批了才真执行（正向对照，
 * 否则"永远拒绝"也能骗过 ①）；③拒绝时不执行。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getAllWindows, waitApproval, executeCommand } = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
  waitApproval: vi.fn(),
  executeCommand: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => getAllWindows() },
}))

vi.mock('@main/ipc/sandbox-approval', () => ({
  waitForSandboxApproval: (...args: unknown[]) => waitApproval(...args),
}))

import { createSandboxMcpTools } from '@main/services/mcp/tools/registry-sandbox'
import { OpenHandsClient } from '@main/services/sandbox/openhands-client'

function sandboxExecuteTool() {
  const client = Object.create(OpenHandsClient.prototype) as OpenHandsClient
  client.executeCommand = executeCommand as unknown as OpenHandsClient['executeCommand']
  const tools = createSandboxMcpTools(client)
  const tool = tools.find((t) => t.meta.name === 'sandbox_execute')
  if (!tool) throw new Error('MCP 工具清单里找不到 sandbox_execute——这道判据的前提没了')
  return tool
}

const ARGS = { sandboxId: 'sbx-1', sessionApiKey: 'k-1', command: 'rm -rf /var/log' }

beforeEach(() => {
  getAllWindows.mockReset()
  waitApproval.mockReset()
  executeCommand.mockReset()
})

describe('MCP sandbox_execute 的审批闸', () => {
  it('没有可用窗口时拒绝执行，一次都不碰沙箱（fail-closed）', async () => {
    getAllWindows.mockReturnValue([])
    const result = await sandboxExecuteTool().call(ARGS)
    const text = JSON.stringify(result)
    expect(text).toContain('APPROVAL_UNAVAILABLE')
    expect(executeCommand, '弹不出审批卡就不能执行').not.toHaveBeenCalled()
  })

  it('审批通过才真执行，且把命令与沙箱原样交给执行口（正向对照）', async () => {
    getAllWindows.mockReturnValue([{ id: 'fake-window' }])
    waitApproval.mockResolvedValue(true)
    executeCommand.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })
    const result = await sandboxExecuteTool().call(ARGS)
    expect(waitApproval, '执行前必须先过一次审批').toHaveBeenCalledTimes(1)
    expect(waitApproval.mock.calls[0][2], '审批卡要带上是哪个沙箱').toBe('sbx-1')
    expect(waitApproval.mock.calls[0][3], '审批卡要带上要执行的命令').toBe(ARGS.command)
    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).toContain('ok')
  })

  it('审批超时/被拒时不执行，并把原因回给调用方', async () => {
    getAllWindows.mockReturnValue([{ id: 'fake-window' }])
    waitApproval.mockRejectedValue(new Error('审批超时（30s）'))
    const result = await sandboxExecuteTool().call(ARGS)
    const text = JSON.stringify(result)
    expect(text).toContain('APPROVAL_DENIED')
    expect(text).toContain('审批超时')
    expect(executeCommand, '被拒绝的命令绝不能进沙箱').not.toHaveBeenCalled()
  })
})
