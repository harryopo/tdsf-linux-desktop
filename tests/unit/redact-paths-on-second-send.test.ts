/**
 * tests/unit/redact-paths-on-second-send.test.ts — 拦下来的凭据不能被再从第二条路发出去（#3 后端审查）
 *
 * 三条路都是"第一道闸装了、第二道没装"：
 * 1. chat 发模型前逐条 redactSecrets，但对话结束后的自动记忆提取拿的是原 messages；
 *    Task/subagent 那条 14 步路径则整条都没过 redact。
 * 2. 记忆写入前用 SECRET_RE 拦住带凭据的条目，却把原文（含凭据前 60 字）抄进
 *    memory_audit.detail —— 那张表是永久行，还会被 auditLog() 原样回给界面。
 *    等于"拦住了写进 memories，另存了一份到另一张表"。
 * 3. 正对照：普通内容不许被改动，否则这几条测试只是在证明"全都被涂黑"。
 *
 * 调研依据：2026-10-13 后端审查（supervisor.ts:1305 / task-protocol-steps-mid.ts:226 / memory-repo.ts:132）
 */
import { describe, it, expect } from 'vitest'
import { stepBuildPrompt } from '../../src/main/core/agent/subagents/task-protocol-steps-mid'
import { MemoryRepository, validateMemoryText } from '../../src/main/services/db/memory-repo'

/** 拼出来而不是写成字面量：测试夹具里不留完整凭据形状 */
const SECRET_VALUE = ['Sup3r', 'SecretValue'].join('')
const SECRET_LINE = `ssh root@10.0.0.1，password=${SECRET_VALUE} 记得先备份`

describe('Task/subagent 的 build-prompt 现在过脱敏', () => {
  function ctx(): Record<string, unknown> {
    return {
      taskId: 't-1',
      input: SECRET_LINE,
      modeConfig: { systemPrompt: '你是运维助手', mode: 'standard' },
    }
  }

  it('1. 发给模型的 user 消息里没有原口令', async () => {
    const c = ctx()
    const r = await stepBuildPrompt(c as never)
    expect(r.success, JSON.stringify(r.error)).toBe(true)

    const messages = (c.messages ?? []) as Array<{ role: string; content: string }>
    const user = messages.find((m) => m.role === 'user')
    expect(user, 'build-prompt 没产出 user 消息').toBeTruthy()
    expect(user!.content).not.toContain(SECRET_VALUE)
    expect(user!.content, '口令应被替换成掩码而不是整句删掉').toContain('password')
  })

  it('2. system 提示里的注意力上下文同样脱敏', async () => {
    const c = ctx()
    c.attentionContext = `最近一次执行：${SECRET_LINE}`
    const r = await stepBuildPrompt(c as never)
    expect(r.success).toBe(true)
    const sys = (c.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'system')
    expect(sys!.content).not.toContain(SECRET_VALUE)
  })

  it('3. 正对照：不含凭据的 prompt 原样进 messages（这道闸不是涂黑一切）', async () => {
    const c = ctx()
    c.input = '帮我看一下 nginx 的配置在哪'
    await stepBuildPrompt(c as never)
    const user = (c.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'user')
    expect(user!.content).toBe('帮我看一下 nginx 的配置在哪')
  })
})

describe('记忆被拦下时，凭据不跟着进审计表', () => {
  /** 只记录被执行的语句，不真连 SQLite */
  function recordingDb(): {
    rows: Array<{ sql: string; args: unknown[] }>
    db: unknown
  } {
    const rows: Array<{ sql: string; args: unknown[] }> = []
    const db = {
      prepare: (sql: string) => ({
        run: (...args: unknown[]) => {
          rows.push({ sql, args })
          return { changes: 1 }
        },
        all: () => [],
        get: () => null,
      }),
    }
    return { rows, db }
  }

  it('4. validateMemoryText 认出口令（前提先验，否则第 5 条是空跑）', () => {
    expect(validateMemoryText(SECRET_LINE)).toBe('secret')
    // 正对照：普通运维事实不许被当成凭据拦掉
    expect(validateMemoryText('这台机的 nginx 配置在 /etc/nginx/conf.d 下')).toBeNull()
  })

  it('5. 拒绝原因入库，但原文一个字都不入库', () => {
    const { rows, db } = recordingDb()
    const repo = new MemoryRepository(db as never)

    const result = repo.upsert({ type: 'fact', key: 'k-secret', text: SECRET_LINE } as never)
    expect(result).toBe('secret')

    const audit = rows.find((r) => r.sql.includes('memory_audit'))
    expect(audit, '被拦下的那条应当留一条审计记录').toBeTruthy()
    expect(JSON.stringify(audit!.args), '审计 detail 里带着原口令').not.toContain(SECRET_VALUE)
    expect(String(audit!.args[3])).toContain('secret(len=')
  })

  it('6. 普通记忆正常走写入路（这条闸不是逢记忆就拒）', () => {
    const { rows, db } = recordingDb()
    const repo = new MemoryRepository(db as never)
    const benign = '这台机的 nginx 配置在 /etc/nginx/conf.d 下'
    const result = repo.upsert({ type: 'environment', key: 'k-nginx', text: benign } as never)
    expect(result, '普通记忆不该被拒').not.toBe('secret')
    const memInsert = rows.find((r) => r.sql.includes('INSERT INTO agent_memories'))
    expect(memInsert, '普通记忆应真正落到 memories 表').toBeTruthy()
  })
})
