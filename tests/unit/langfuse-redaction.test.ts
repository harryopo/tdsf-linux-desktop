/**
 * 外送 Langfuse 的文本必须先脱敏（2026-10-21 全维度审查 A11）
 *
 * Langfuse 是第三方云服务；用户问题与模型输出里可能有 `cat ~/.my.cnf` 的结果、
 * 日志里的 token。这里用假 Langfuse 捕获实际外送载荷，断言敏感值没有出现。
 */
import { describe, it, expect, vi } from 'vitest'

const captured = vi.hoisted(() => ({
  traces: [] as Array<Record<string, unknown>>,
  spans: [] as Array<Record<string, unknown>>,
  ends: [] as unknown[],
}))

vi.mock('../../src/main/services/observability/langfuse', () => ({
  LangfuseService: {
    getInstance: () => ({
      isEnabled: () => true,
      startTrace: (arg: Record<string, unknown>) => {
        captured.traces.push(arg)
        return {
          span: (s: Record<string, unknown>) => {
            captured.spans.push(s)
            return { end: (out: unknown) => captured.ends.push(out) }
          },
          end: (out: unknown) => captured.ends.push(out),
        }
      },
    }),
  },
}))

import { withStreamTrace } from '../../src/main/services/observability/langfuse-trace'

// 拆成相邻字面量：整串会被密钥扫描闸当成真凭据（项目规矩，见 AGENTS.md）
const SECRET = ['Sup3r', 'Secret', 'Token', '123456'].join('')

describe('Langfuse trace 脱敏', () => {
  it('userQuery 与流式输出里的凭据都不外送', async () => {
    async function* source(): AsyncIterable<string> {
      yield `password=${SECRET}`
      yield ' done'
    }
    const chunks: string[] = []
    for await (const c of withStreamTrace(() => source(), {
      sessionId: 's1',
      workflowName: 'test',
      userQuery: `帮我看一下 password=${SECRET}`,
    })) {
      chunks.push(c)
    }

    // 界面拿到的仍是原文（脱敏只发生在出边界那一步）
    expect(chunks.join('')).toContain(SECRET)

    const trace = captured.traces[0]
    expect(String(trace.userQuery)).not.toContain(SECRET)
    expect(String(trace.userQuery)).toContain('[REDACTED]')
    expect(String(captured.spans[0].input)).not.toContain(SECRET)

    const output = JSON.stringify(captured.ends)
    expect(output).not.toContain(SECRET)
  })
})
