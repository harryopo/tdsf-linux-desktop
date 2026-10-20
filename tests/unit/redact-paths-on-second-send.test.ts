/**
 * tests/unit/redact-paths-on-second-send.test.ts — 拦下来的凭据不能被再从第二条路发出去（#3 后端审查）
 *
 * 两条路都是"第一道闸装了、第二道没装"：
 * 1. chat 发模型前逐条 redactSecrets，但对话结束后的自动记忆提取拿的是原 messages。
 * 2. 记忆写入前用 SECRET_RE 拦住带凭据的条目，却把原文（含凭据前 60 字）抄进
 *    memory_audit.detail —— 那张表是永久行，还会被 auditLog() 原样回给界面。
 *    等于"拦住了写进 memories，另存了一份到另一张表"。
 * 3. 正对照：普通内容不许被改动，否则这几条测试只是在证明"全都被涂黑"。
 *
 * 调研依据：2026-10-13 后端审查（supervisor.ts:1305 / memory-repo.ts:132）
 */
import { describe, it, expect } from 'vitest'
import { MemoryRepository, validateMemoryText } from '../../src/main/services/db/memory-repo'

/** 拼出来而不是写成字面量：测试夹具里不留完整凭据形状 */
const SECRET_VALUE = ['Sup3r', 'SecretValue'].join('')
const SECRET_LINE = `ssh root@10.0.0.1，password=${SECRET_VALUE} 记得先备份`

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

  it('1. validateMemoryText 认出口令（前提先验，否则第 2 条是空跑）', () => {
    expect(validateMemoryText(SECRET_LINE)).toBe('secret')
    // 正对照：普通运维事实不许被当成凭据拦掉
    expect(validateMemoryText('这台机的 nginx 配置在 /etc/nginx/conf.d 下')).toBeNull()
  })

  it('2. 拒绝原因入库，但原文一个字都不入库', () => {
    const { rows, db } = recordingDb()
    const repo = new MemoryRepository(db as never)

    const result = repo.upsert({ type: 'fact', key: 'k-secret', text: SECRET_LINE } as never)
    expect(result).toBe('secret')

    const audit = rows.find((r) => r.sql.includes('memory_audit'))
    expect(audit, '被拦下的那条应当留一条审计记录').toBeTruthy()
    expect(JSON.stringify(audit!.args), '审计 detail 里带着原口令').not.toContain(SECRET_VALUE)
    expect(String(audit!.args[3])).toContain('secret(len=')
  })

  it('3. 普通记忆正常走写入路（这条闸不是逢记忆就拒）', () => {
    const { rows, db } = recordingDb()
    const repo = new MemoryRepository(db as never)
    const benign = '这台机的 nginx 配置在 /etc/nginx/conf.d 下'
    const result = repo.upsert({ type: 'environment', key: 'k-nginx', text: benign } as never)
    expect(result, '普通记忆不该被拒').not.toBe('secret')
    const memInsert = rows.find((r) => r.sql.includes('INSERT INTO agent_memories'))
    expect(memInsert, '普通记忆应真正落到 memories 表').toBeTruthy()
  })
})
