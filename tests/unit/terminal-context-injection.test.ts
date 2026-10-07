/**
 * 终端命令块 → AI 上下文（阶段 F 判据里"供 AI 上下文消费"的那半截）
 *
 * 这块链路此前是断的：块收集器产出的 toAiContext() 只进过状态栏的悬浮提示，
 * 模型一个字都没收到。用户刚跑完 df -h 再问"磁盘为什么满"，AI 只能猜。
 *
 * 测试分两层：纯函数（注入块的格式、预算、脱敏）+ 源码级接线（四个进程边界各一处，
 * 防止"函数写了但没人调用"这种只坏一半的回归——本仓库已有同型判据见 terminal-block-model.test.ts）。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildTerminalContextBlock, TERMINAL_CONTEXT_CAP } from '@main/core/agent/terminal-context'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('buildTerminalContextBlock（纯函数）', () => {
  it('没有命令块就什么都不注入', () => {
    expect(buildTerminalContextBlock()).toBe('')
    expect(buildTerminalContextBlock('')).toBe('')
    expect(buildTerminalContextBlock('   \n ')).toBe('')
  })

  it('命令与退出码进块，并写清这是终端来的、输出正文没附', () => {
    const block = buildTerminalContextBlock('$ df -h [ok] 行 12-20\n$ systemctl status nginx [exit=3]')
    expect(block).toContain('df -h')
    expect(block).toContain('exit=3')
    expect(block).toContain('终端最近命令')
    expect(block).toContain('输出正文未附')
  })

  it('超预算就截断并留标记，不许无限挤占 prompt', () => {
    const long = Array.from({ length: 300 }, (_, i) => `$ echo ${i}`).join('\n')
    expect(long.length).toBeGreaterThan(TERMINAL_CONTEXT_CAP)
    const block = buildTerminalContextBlock(long)
    expect(block).toContain('命令块已截断')
    expect(block.length).toBeLessThan(TERMINAL_CONTEXT_CAP + 200)
  })

  it('命令原文里的口令被脱敏（命令块同样要过 redactSecrets）', () => {
    const block = buildTerminalContextBlock('$ mysql -u root password=SuperSecret123 [ok]')
    expect(block).not.toContain('SuperSecret123')
    expect(block).toContain('[REDACTED]')
    expect(block).toContain('mysql -u root')
  })

  it('阳性对照：不带口令的正常命令不被误伤', () => {
    const block = buildTerminalContextBlock('$ cat /var/log/nginx/access.log [ok]')
    expect(block).toContain('cat /var/log/nginx/access.log')
    expect(block).not.toContain('[REDACTED]')
  })
})

describe('跨进程接线（源码级，防止写了函数没人调）', () => {
  it('渲染进程把 commandBlocks.context 随请求带出去', () => {
    const src = read('src/renderer/src/components/workbench/useAgentChat.ts')
    expect(src).toContain('useTerminalStore.getState().commandBlocks?.context')
    expect(src).toContain('terminalContext || undefined')
  })

  it('preload 把它作为第 6 个实参转发到 agent:chat', () => {
    const src = read('src/preload/index.ts')
    expect(src).toMatch(
      /invoke\(AGENT\.CHAT, messages, providerId, strength, undefined, sshSessionId, terminalContext\)/
    )
  })

  it('主进程 handler 收下并转给 Supervisor', () => {
    const src = read('src/main/ipc/agent-runtime.ts')
    expect(src).toContain('terminalContext?: string')
    expect(src).toContain('terminalContext,')
    expect(src).toContain('terminalBlockChars')
  })

  it('Supervisor 把注入块拼进 system prompt（不是算了就丢）', () => {
    const src = read('src/main/core/agent/supervisor.ts')
    expect(src).toContain("import { buildTerminalContextBlock } from './terminal-context'")
    expect(src).toContain('const terminalInjection = buildTerminalContextBlock(terminalContext)')
    expect(src).toMatch(/\+\s*terminalInjection\b/)
  })
})
