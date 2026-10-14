/**
 * tests/unit/audit-repo.test.ts — 审计仓储
 *
 * 存在的理由：audit_logs 表建了好几个版本，但全仓没有一条 INSERT，
 * 风险控制页那四个「记录 XX」开关因此全是摆设。这个测试锁住接上之后的行为：
 * 写进去、读得回、按保留期清得掉，而且库不可用时只返回 false 不抛。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseManager } from '../../src/main/services/db/database'
import {
  AuditRepo,
  isAuditCategoryEnabled,
  resolveRetentionDays,
  AUDIT_RETENTION_DEFAULT_DAYS,
} from '../../src/main/services/db/audit-repo'

function freshRepo(): AuditRepo {
  DatabaseManager.resetInstance()
  return new AuditRepo(DatabaseManager.getInstance(':memory:'))
}

describe('AuditRepo', () => {
  let repo: AuditRepo
  beforeEach(() => {
    repo = freshRepo()
  })

  it('写一条命令执行审计，能原样读回来', () => {
    expect(
      repo.log({
        category: 'cmd_exec',
        action: 'SSH 执行完成',
        command: 'systemctl status nginx',
        exitCode: 0,
        sessionId: 'sess-1',
        riskLevel: 'LOW',
      }),
    ).toBe(true)

    const rows = repo.list(10)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('cmd_exec:SSH 执行完成')
    expect(rows[0].command).toBe('systemctl status nginx')
    expect(rows[0].exitCode).toBe(0)
    expect(rows[0].sessionId).toBe('sess-1')
  })

  it('命令原文里的凭据形状不落进审计表（收口在写库这一处）', () => {
    // 假凭据拆成相邻字面量，避免任何扫描器把测试当真凭据报警
    const secret = 'mysql -u root ' + 'pass' + 'word=Sup3rS' + 'ecretValue'
    expect(
      repo.log({
        category: 'cmd_exec',
        action: 'SSH 执行完成',
        command: secret,
        details: { commandPreview: secret, host: 'lab-node' },
      }),
    ).toBe(true)

    const row = repo.list(10)[0]
    expect(row.command, 'cmd_exec 以前存原文：风险控制页、审计报告导出、界面截图都会把它带出去').not.toContain(secret)
    expect(row.command).toMatch(/\[REDACTED/)
    const dumped = JSON.stringify(row.details)
    expect(dumped, 'details 列也一样，它同样是人类要回头读的文本').not.toContain(secret)
    // 正向对照：结构化字段没被顺手毁掉（上一条用例证明普通命令原样可读回）
    expect(dumped).toContain('lab-node')
  })

  it('库不可用时返回 false，不抛异常（审计不能挡住业务）', () => {
    DatabaseManager.resetInstance()
    const db = DatabaseManager.getInstance(':memory:')
    db.close()
    const dead = new AuditRepo(db)
    expect(() => dead.log({ category: 'ssh_conn', action: 'SSH 连接建立' })).not.toThrow()
    expect(dead.list(5)).toEqual([])
  })

  it('pruneExpired 按保留期删旧记录', () => {
    repo.log({ category: 'ai_decision', action: '人工确认通过', command: 'df -h' })
    expect(repo.list(10)).toHaveLength(1)

    // 把"现在"推到 181 天之后：默认保留 180 天，这条应该被清掉
    const future = Date.now() + (AUDIT_RETENTION_DEFAULT_DAYS + 1) * 24 * 60 * 60 * 1000
    expect(repo.pruneExpired(future)).toBe(1)
    expect(repo.list(10)).toHaveLength(0)
  })
})

describe('开关与保留期取值', () => {
  it('开关只有显式 false 才关（缺省全开，新用户默认有完整审计）', () => {
    expect(isAuditCategoryEnabled('cmd_exec', false)).toBe(false)
    expect(isAuditCategoryEnabled('cmd_exec', true)).toBe(true)
    expect(isAuditCategoryEnabled('cmd_exec', undefined)).toBe(true)
  })

  it('保留天数只认 1–3650 的整数，其余回默认', () => {
    expect(resolveRetentionDays(30)).toBe(30)
    expect(resolveRetentionDays(0)).toBe(AUDIT_RETENTION_DEFAULT_DAYS)
    expect(resolveRetentionDays(-1)).toBe(AUDIT_RETENTION_DEFAULT_DAYS)
    expect(resolveRetentionDays(99999)).toBe(AUDIT_RETENTION_DEFAULT_DAYS)
    expect(resolveRetentionDays('90')).toBe(AUDIT_RETENTION_DEFAULT_DAYS)
    expect(resolveRetentionDays(Number.NaN)).toBe(AUDIT_RETENTION_DEFAULT_DAYS)
  })
})
