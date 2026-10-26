/**
 * MCP 日志域工具真的把 `--` 带到了 exec（#242）
 *
 * 为什么不只测构造器：`buildLogTailCommand` 单测只证明函数自己是对的，
 * 不证明工具在调它。这条走的是生产链路——MCP 客户端传进来的 `filePath`/`pattern`
 * 经过参数校验、构造、直到 `SshConnectionManager.exec` 那一句字符串。
 * filePath 不是绝对路径时没有任何一道闸拦它，所以 `-f`、`-f/etc/passwd` 这类值
 * 是外部客户端可以直接递到远端 shell 的。
 *
 * 判据只认落到 exec 上的那条命令，不看返回值文案；
 * 另外留一条正向对照（log_search 真把匹配行解析出来），证明工具体确实跑到了。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const execCalls: string[] = []

vi.mock('../../src/main/services/ssh/connection-manager', () => ({
  SshConnectionManager: {
    getInstance: () => ({
      exec: async (_sessionId: string, cmd: string) => {
        execCalls.push(cmd)
        return {
          exitCode: 0,
          stdout: '/var/log/app.log:12:-f found here\n',
          stderr: '',
          duration: 1,
        }
      },
    }),
  },
}))

import { createLogMcpTools } from '../../src/main/services/mcp/tools/registry-log'

const tools = new Map(createLogMcpTools().map((t) => [t.meta.name, t]))

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = tools.get(name)
  if (!tool) throw new Error(`工具 ${name} 没注册`)
  const result = await tool.call(args)
  return result.content.map((c) => c.text ?? '').join('\n')
}

describe('MCP 日志域工具的远端命令形状', () => {
  beforeEach(() => {
    execCalls.length = 0
  })

  it('1. log_tail：filePath 给 -f 时，exec 收到的必须是 tail -n 100 -- \'-f\'', async () => {
    await call('log_tail', { sessionId: 's1', filePath: '-f' })
    expect(execCalls).toHaveLength(1)
    expect(execCalls[0]).toBe("tail -n 100 -- '-f'")
  })

  it('2. log_tail：正常绝对路径也带 --（不是只为坏值补丁）', async () => {
    await call('log_tail', { sessionId: 's1', filePath: '/var/log/syslog', lines: 20 })
    expect(execCalls[0]).toBe("tail -n 20 -- '/var/log/syslog'")
  })

  it('3. log_analyze：拉日志用的还是同一条带 -- 的 tail', async () => {
    await call('log_analyze', { sessionId: 's1', filePath: '--pid=1', lines: 5 })
    expect(execCalls[0]).toBe("tail -n 5 -- '--pid=1'")
  })

  it('4. log_search：模式与路径都在 -- 之后（-f/etc/passwd 不许当模式文件读）', async () => {
    await call('log_search', {
      sessionId: 's1',
      pattern: '-f/etc/passwd',
      path: '-r',
      maxMatches: 30,
    })
    expect(execCalls[0]).toBe(
      "grep -r -n -E -- '-f/etc/passwd' '-r' 2>/dev/null | head -n 30"
    )
  })

  it('5. 正向对照：log_search 真的跑完并解析出匹配行（证明上面几条不是空转）', async () => {
    const text = await call('log_search', { sessionId: 's1', pattern: 'err' })
    expect(text).toContain('-f found here')
    expect(text).toContain('"file": "/var/log/app.log"')
  })
})
