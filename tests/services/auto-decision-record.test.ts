/**
 * 命令执行的自动决策记录（真库）
 *
 * 用户实测："记录决策还得手动记录，很大毛病"——历史决策页当时 0 行，
 * 因为唯一生产者是渲染层那个按钮。这里锁死新的自动路径：
 *   - 真跑过的命令进库、状态按退出码
 *   - 证据是真实输出且 verified
 *   - 同一条命令短时间内不重复记账
 *   - block 级命令（没有真的执行）不记
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseManager } from '../../src/main/services/db/database'
import { DecisionRepository } from '../../src/main/services/db/decision-repo'
import {
  recordAutoDecision,
  resetAutoDecisionDedupe,
} from '../../src/main/services/decisions/auto-record'

let dbm: DatabaseManager
let repo: DecisionRepository

beforeEach(() => {
  DatabaseManager.resetInstance()
  dbm = DatabaseManager.getInstance(':memory:')
  repo = new DecisionRepository(dbm)
  resetAutoDecisionDedupe()
})

afterEach(() => {
  DatabaseManager.resetInstance()
})

describe('自动决策记录', () => {
  it('执行成功的只读命令落库，状态 executed，证据是真实输出', () => {
    const id = recordAutoDecision({
      command: 'df -h',
      exitCode: 0,
      output: 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 40G 12G 26G 32% /',
      problem: '看一下磁盘',
      source: 'chat_readonly',
      sessionId: 's1',
      serverId: 'server-1',
      durationMs: 120,
    })

    expect(id).toBeTruthy()
    const card = repo.getById(id!)
    expect(card).not.toBeNull()
    expect(card!.status).toBe('executed')
    expect(card!.fixCommand).toBe('df -h')
    expect(card!.problem).toBe('看一下磁盘')
    expect(card!.serverId).toBe('server-1')
    expect(card!.durationMs).toBe(120)
    expect(card!.evidences).toHaveLength(1)
    expect(card!.evidences[0].verified).toBe(true)
    expect(card!.evidences[0].content).toContain('Filesystem Size')
  })

  it('非 0 退出码记为 failed', () => {
    const id = recordAutoDecision({
      command: 'systemctl status nginx',
      exitCode: 3,
      output: 'inactive',
      source: 'chat_readonly',
      sessionId: 's1',
    })
    expect(id).toBeTruthy()
    expect(repo.getById(id!)!.status).toBe('failed')
  })

  it('同一会话同一命令 60 秒内只记一条', () => {
    const input = { command: 'free -m', exitCode: 0 as number | null, output: 'ok', source: 'chat_readonly' as const, sessionId: 's1' }
    expect(recordAutoDecision(input)).toBeTruthy()
    expect(recordAutoDecision(input)).toBeNull()
    expect(repo.list(1, 10)).toHaveLength(1)
  })

  it('block 级命令不记（没执行过的东西不进决策账）', () => {
    const id = recordAutoDecision({
      command: 'rm -rf /',
      exitCode: 0,
      output: '',
      source: 'chat_write',
      sessionId: 's1',
    })
    expect(id).toBeNull()
    expect(repo.list(1, 10)).toHaveLength(0)
  })

  it('证据正文超长会被截断，不把几十 KB 输出塞进决策卡', () => {
    const id = recordAutoDecision({
      command: 'journalctl -n 5000 --no-pager',
      exitCode: 0,
      output: 'x'.repeat(5000),
      source: 'chat_readonly',
      sessionId: 's1',
    })
    const content = repo.getById(id!)!.evidences[0].content
    expect(content.length).toBeLessThan(2500)
    expect(content).toContain('已截断')
  })
})
