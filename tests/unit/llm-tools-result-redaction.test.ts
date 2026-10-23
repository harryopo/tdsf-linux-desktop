/**
 * llm:chat-with-tools 的工具结果也是出口，必须脱敏（两套 LLM 栈里被漏掉的那一条）
 *
 * 主对话那条早就收口了：`supervisor.ts` 组装工具时统一套 `withToolResultRedaction`，
 * MCP 那条也在 `registry-sandbox.ts` 里对 stdout/stderr 做了 `redactSecrets`。
 * 但 `ipc/llm-tools.ts` 走的是第三家：它自己 `new ToolRegistry()`、自己 `await t.execute(args)`，
 * 然后把**原样的 result** 既推给渲染进程（llm:tool-progress）又回喂给模型。
 * `services/llm/tools/*` 内部一条脱敏都没有（ssh-exec 的 stdout 是远端命令的原样输出，
 * `cat /etc/my.cnf`、`env`、日志里的 token 都在里面）。
 * 同一条文本能从多个出口离开边界，只装住其中两个等于没装。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../src/main/windows/main-window', () => ({ broadcastToWindows: vi.fn() }))
vi.mock('../../src/main/services/llm/client', () => ({ LlmClient: class {} }))
vi.mock('../../src/main/services/llm/llm-config-resolver', () => ({ resolveLlmConfig: () => ({}) }))
vi.mock('../../src/main/services/llm/tools/registry', () => ({ ToolRegistry: class {} }))
vi.mock('../../src/main/core/security/approval', () => ({ readApproval: vi.fn() }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn(), isStepCount: vi.fn() }))

import { redactToolCallResult } from '@main/ipc/llm-tools'
import type { ToolCallResult } from '@shared/llm-tool-types'

function result(overrides: Partial<ToolCallResult> = {}): ToolCallResult {
  return {
    toolId: 'ssh_exec',
    success: true,
    durationMs: 12,
    timestamp: 1_700_000_000_000,
    data: { stdout: '', stderr: '', exitCode: 0 },
    ...overrides,
  } as ToolCallResult
}

describe('工具结果出口脱敏', () => {
  it('stdout 里的密码赋值被打码（这条现在就是漏的那个口）', () => {
    const out = redactToolCallResult(
      result({ data: { stdout: 'my.cnf: password=Sup3rS3cret123 user=root', stderr: '', exitCode: 0 } })
    )
    const text = JSON.stringify(out)
    expect(text).not.toContain('Sup3rS3cret123')
    expect(text, '打码要留下痕迹，不能悄悄改成别的字').toContain('[REDACTED')
  })

  it('error 字段与嵌套数组同样收口（失败时把远端原文整段回喂也是出口）', () => {
    // 样例按相邻字面量拼：完整形状的假凭据会被 GitHub 密钥扫描当真并给仓库所有者发邮件，
    // 事后删掉字面量警报也不会自动关（本仓记过这笔账）。运行时仍是那条完整字符串。
    const skSample = 'sk-' + 'abcdefghijklmnopqrstuvwxyz012345'
    const bearerSample = 'Bearer ' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'
    const out = redactToolCallResult(
      result({
        success: false,
        error: `连接失败：token ${skSample} 泄露在报错里`,
        data: { lines: [bearerSample], exitCode: 1 },
      })
    )
    const text = JSON.stringify(out)
    expect(text).not.toContain(skSample)
    expect(text).not.toContain('aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789')
  })

  it('正向对照：普通输出原样保留（不是把整块内容糊掉）', () => {
    const out = redactToolCallResult(
      result({ data: { stdout: '/dev/sda1  38G  21G  15G  59% /', stderr: '', exitCode: 0 } })
    )
    expect((out.data as { stdout: string }).stdout).toBe('/dev/sda1  38G  21G  15G  59% /')
    expect(out.success).toBe(true)
    expect(out.durationMs).toBe(12)
  })

  it('非字符串字段不动形状（exitCode 是数字，不能被转成字符串）', () => {
    const out = redactToolCallResult(result({ data: { stdout: 'ok', stderr: '', exitCode: 0 } }))
    expect((out.data as { exitCode: unknown }).exitCode).toBe(0)
  })
})
