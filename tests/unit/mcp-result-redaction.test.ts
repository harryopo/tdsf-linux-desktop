/**
 * MCP 出口的文本也要脱敏（#179，与 54790dc 同一族）
 *
 * 工具结果离开进程有三条路：模型上下文（主对话在组装点套 withToolResultRedaction）、
 * 渲染进程事件（本轮已补）、MCP 通道。前两条按出口枚举补到第三条时才发现 MCP 这边
 * `toMcpResult` / `toMcpTextResult` 把 `JSON.stringify(原样 data)` 直接返回，
 * 而 `services/llm/tools/*` 内部一条脱敏都没有——ssh-exec 的 stdout 就是远端命令原样输出。
 *
 * 今天不外泄（MCP server 走 stdio、父进程是应用自己、没有客户端接它），
 * 所以这条不是"正在漏"，是"接出去就会漏"。判据先立着，等真接客户端时它必须已经绿。
 */
import { describe, it, expect } from 'vitest'
import {
  toMcpResult,
  toMcpTextResult,
  toMcpErrorResult,
  toMcpToolFailure,
} from '@main/services/mcp/tools/registry'
import type { ToolCallResult } from '@shared/llm-tool-types'

// 相邻字面量拼：完整形状的假凭据会被 GitHub 密钥扫描当真并发邮件给仓库所有者（本仓记过账）
const PASSWORD_SAMPLE = 'rootp' + 'ass12345'
const SK_SAMPLE = 'sk-' + 'abcdefghijklmnopqrstuvwxyz012345'

function mcpText(r: ReturnType<typeof toMcpResult> | ReturnType<typeof toMcpTextResult>): string {
  return (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n')
}

describe('MCP 文本出口脱敏', () => {
  it('toMcpResult：data.stdout 里的凭据被打码，普通输出不被糊', () => {
    const leaked = toMcpResult({
      toolId: 'ssh_exec',
      success: true,
      durationMs: 5,
      timestamp: 1_700_000_000_000,
      data: { stdout: `my.cnf 里 password=${PASSWORD_SAMPLE}`, stderr: '', exitCode: 0 },
    } as ToolCallResult)
    const text = mcpText(leaked)
    expect(text).not.toContain(PASSWORD_SAMPLE)
    expect(text).toContain('[REDACTED')
    // 结构本身要留着，否则外部客户端拿到的是糊成一团的东西
    expect(text).toContain('my.cnf 里')
    expect(text).toContain('"exitCode": 0')

    const clean = toMcpResult({
      toolId: 'ssh_exec',
      success: true,
      durationMs: 5,
      timestamp: 1_700_000_000_000,
      data: { stdout: '/dev/sda1 38G 21G 15G 59% /', stderr: '', exitCode: 0 },
    } as ToolCallResult)
    expect(mcpText(clean)).toContain('/dev/sda1 38G 21G 15G 59% /')
  })

  it('toMcpResult 失败那一支的 error 文本同样收口', () => {
    const out = toMcpResult({
      toolId: 'ssh_exec',
      success: false,
      error: `上游拒绝：Authorization: Bearer ${'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'}`,
      durationMs: 1,
      timestamp: 1_700_000_000_000,
    } as ToolCallResult)
    const text = mcpText(out)
    expect(text).not.toContain('aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789')
    expect(out.isError, '失败必须还是失败，不能因为打码就转成成功').toBe(true)
  })

  it('toMcpTextResult：字符串、对象、Error 三种形状都要过（三个调用方各给一种）', () => {
    expect(mcpText(toMcpTextResult(`key ${SK_SAMPLE}`))).not.toContain(SK_SAMPLE)
    expect(
      mcpText(toMcpTextResult({ rows: [{ dsn: `postgres://admin:${PASSWORD_SAMPLE}@10.0.0.5/db` }] }))
    ).not.toContain(PASSWORD_SAMPLE)
    const err = mcpText(toMcpTextResult(new Error(`连接失败 api-key=${SK_SAMPLE}`)))
    expect(err).not.toContain(SK_SAMPLE)
    expect(err).toContain('错误:')
  })

  it('toMcpErrorResult：调用方传进来的原文也要打码（参数错误信息里会带上用户输入）', () => {
    expect(mcpText(toMcpErrorResult(`参数错误 password=${PASSWORD_SAMPLE}`))).not.toContain(PASSWORD_SAMPLE)
  })

  it('工具抛异常的出口（server.ts 那条 catch）同样要打码（#237）', () => {
    const out = toMcpToolFailure(`ssh 连接失败：postgres://admin:${PASSWORD_SAMPLE}@10.0.0.5/db`)
    const text = mcpText(out)
    expect(text).not.toContain(PASSWORD_SAMPLE)
    expect(text).toContain('[REDACTED')
    expect(text).toContain('工具调用失败:')
    expect(out.isError).toBe(true)
  })
})
