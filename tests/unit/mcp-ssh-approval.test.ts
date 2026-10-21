/**
 * MCP 的 ssh_execute 不能再绕过人工审批（2026-10-21 全维度审查 A9）
 *
 * 工具描述写着「high 风险命令需用户审批」，实际 call 只过 executeSshExec，
 * 而它只拒 block；rm/systemctl/改权限这类 high 在外部 MCP 客户端上直接执行。
 * MCP 没有审批窗口，所以这里采用 fail-closed：high 返回 APPROVAL_REQUIRED，不执行。
 */
import { describe, it, expect } from 'vitest'
import { createSshMcpTools } from '../../src/main/services/mcp/tools/registry-ssh'

const tools = createSshMcpTools()
const sshExecute = tools.find((t) => t.meta.name === 'ssh_execute')

describe('MCP ssh_execute 的风险闸', () => {
  it('block 级命令直接拒绝', async () => {
    expect(sshExecute).toBeDefined()
    const result = await sshExecute!.call({ sessionId: 's1', command: 'rm -rf /' })
    expect(JSON.stringify(result)).toContain('高危命令被安全闸拒绝')
  })

  it('high 级命令返回 APPROVAL_REQUIRED，且不尝试执行', async () => {
    const result = await sshExecute!.call({ sessionId: 's1', command: 'rm /tmp/x' })
    const text = JSON.stringify(result)
    expect(text).toContain('APPROVAL_REQUIRED')
    expect(text).toContain('没有人工审批窗口')
    // 若放行到 executeSshExec，会先报「SSH session 不可用」而不是审批拒绝
    expect(text).not.toContain('SSH session 不可用')
  })

  it('低风险命令才允许继续走执行路径（未连接时报会话不可用，证明闸没误伤）', async () => {
    const result = await sshExecute!.call({ sessionId: 's1', command: 'df -h' })
    expect(JSON.stringify(result)).toContain('SSH session 不可用')
  })

  it('工具描述与实际行为一致：写明 high 在 MCP 通道会被拒', () => {
    expect(sshExecute!.meta.description).toContain('APPROVAL_REQUIRED')
  })
})
