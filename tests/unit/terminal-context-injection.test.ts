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
import {
  buildTerminalContextBlock,
  recordTerminalContextAudit,
  TERMINAL_CONTEXT_CAP,
} from '@main/core/agent/terminal-context'
import { AuditRepo } from '../../src/main/services/db/audit-repo'
import { DatabaseManager } from '../../src/main/services/db/database'
import { contractFor } from '@shared/ipc-contract'
import { preloadWiring } from './preload-sources'

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

  it('preload 转发给 agent:chat 的实参逐位等于契约声明（terminalContext 在最后一位）', () => {
    // 域拆分后 agentChat 在 preload/domains/agent.ts，读整棵 preload 树才对齐这条链路。
    // 这一条原先把"6 个实参、第 4 位是占位 undefined"写死在正则里，而契约声明的是 5 位 ——
    // 于是它把线上真实形状钉成了一份和契约表不一致的"标准答案"（P1-3 装主进程入参闸时撞红）。
    // 现在改成拿契约当基准：实参名逐位对得上才算接线对。
    const src = preloadWiring(ROOT)
    const m = /invoke\(\s*AGENT\.CHAT,\s*([^)]*?)\s*,?\s*\)/.exec(src)
    expect(m, 'preload 里没有向 agent:chat 转发实参的调用').toBeTruthy()
    const forwarded = (m?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const c = contractFor('agentChat')
    if (c?.kind !== 'invoke') throw new Error('契约表里 agentChat 不是 invoke，这条判据失去基准')
    expect(forwarded, '转发顺序或位数与契约声明不一致').toEqual(c.args.map((a) => a.name))
    expect(forwarded[forwarded.length - 1]).toBe('terminalContext')
  })

  it('主进程 handler 收下并转给 Supervisor', () => {
    const src = read('src/main/ipc/agent-runtime.ts')
    expect(src).toContain('terminalContext?: string')
    expect(src).toContain('terminalContext,')
    expect(src).toContain('terminalBlockChars')
  })

  it('Supervisor 把注入块拼进 system prompt（不是算了就丢）', () => {
    const src = read('src/main/core/agent/supervisor.ts')
    expect(src).toContain("from './terminal-context'")
    expect(src).toContain('const terminalInjection = buildTerminalContextBlock(terminalContext)')
    expect(src).toMatch(/\+\s*terminalInjection\b/)
  })

  it('Supervisor 同时把这条塞给审计（计划要求的是"AI 上下文与审计"两头）', () => {
    const src = read('src/main/core/agent/supervisor.ts')
    expect(src).toContain('recordTerminalContextAudit(new AuditRepo(db)')
  })
})

describe('recordTerminalContextAudit（审计消费端）', () => {
  function freshRepo(): AuditRepo {
    DatabaseManager.resetInstance()
    return new AuditRepo(DatabaseManager.getInstance(':memory:'))
  }

  it('带命令块时落一条审计，记条数但不记命令原文', () => {
    const repo = freshRepo()
    const r = recordTerminalContextAudit(repo, {
      raw: '$ systemctl status nginx [exit=3]\n$ journalctl -u nginx [ok]\n$ mysql -u root password=SuperSecret123 [ok]',
      correlationId: 'chat_test_1',
      sessionId: 'ssh-1',
    })
    expect(r.blocks).toBe(3)
    expect(r.written, '库可用且开关默认开，应落库').toBe(true)

    const rows = repo.list(10)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('ai_decision:AI 对话附带终端命令块')
    expect(rows[0].command, '命令原文不进审计表').toBeNull()
    const details = JSON.parse(rows[0].details ?? '{}') as { blocks: number; correlationId: string }
    expect(details.blocks).toBe(3)
    expect(rows[0].details).not.toContain('SuperSecret123')
    expect(details.correlationId).toBe('chat_test_1')
  })

  it('没有命令块就什么都不记（别在审计表里刷空行）', () => {
    const repo = freshRepo()
    expect(recordTerminalContextAudit(repo, { raw: '', correlationId: 'chat_test_2' })).toEqual({
      blocks: 0,
      written: false,
    })
    expect(recordTerminalContextAudit(repo, { correlationId: 'chat_test_3' })).toEqual({
      blocks: 0,
      written: false,
    })
    expect(repo.list(10)).toHaveLength(0)
  })
})
