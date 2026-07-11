/**
 * 风险控制引擎单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkShellSyntax,
  assessRisk,
  requiresConfirmation,
  shouldBlock,
  logToAudit,
  getAuditLog,
  clearAuditLog
} from '../../src/main/core/risk-engine'

describe('risk-engine — 风险控制引擎', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  // ────────── L1: 语法检查 ──────────

  it('checkShellSyntax: 正常命令通过验证', () => {
    expect(checkShellSyntax('ls -la /home')).toEqual({ valid: true })
    expect(checkShellSyntax('echo "hello world"')).toEqual({ valid: true })
    expect(checkShellSyntax("grep 'error' /var/log/syslog")).toEqual({ valid: true })
  })

  it('checkShellSyntax: 检测未闭合引号', () => {
    expect(checkShellSyntax("echo 'unclosed")).toEqual({ valid: false, error: '未闭合的单引号' })
    expect(checkShellSyntax('echo "unclosed')).toEqual({ valid: false, error: '未闭合的双引号' })
  })

  it('checkShellSyntax: 空命令返回错误', () => {
    const result = checkShellSyntax('   ')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('命令为空')
  })

  it('checkShellSyntax: 管道符开头/结尾检测', () => {
    expect(checkShellSyntax('| grep error').valid).toBe(false)
    expect(checkShellSyntax('cat file |').valid).toBe(false)
  })

  it('checkShellSyntax: 括号不匹配检测', () => {
    expect(checkShellSyntax('echo (unclosed').valid).toBe(false)
    expect(checkShellSyntax('echo [test').valid).toBe(false)
  })

  // ────────── L2: 风险评估 ──────────

  it('assessRisk: rm -rf / 为 CRITICAL 且被阻止', () => {
    const result = assessRisk('rm -rf /')
    expect(result.level).toBe('CRITICAL')
    expect(result.blocked).toBe(true)
    expect(result.requireConfirmation).toBe(true)
    expect(result.score).toBe(100)
  })

  it('assessRisk: mkfs 为 CRITICAL', () => {
    expect(assessRisk('mkfs.ext4 /dev/sda1').level).toBe('CRITICAL')
  })

  it('assessRisk: fork 炸弹为 CRITICAL', () => {
    const result = assessRisk(':(){ :|:& };:')
    expect(result.level).toBe('CRITICAL')
  })

  it('assessRisk: chmod 777 file 为 HIGH', () => {
    const result = assessRisk('chmod 777 /home/user/file')
    expect(result.level).toBe('HIGH')
    expect(result.requireConfirmation).toBe(true)
    expect(result.blocked).toBe(false)
  })

  it('assessRisk: kill -9 为 HIGH', () => {
    expect(assessRisk('kill -9 1234').level).toBe('HIGH')
  })

  it('assessRisk: systemctl stop 为 MEDIUM', () => {
    const result = assessRisk('systemctl stop nginx')
    expect(result.level).toBe('MEDIUM')
    // MEDIUM 不需要人工确认（仅 HIGH/CRITICAL 需要）
    expect(result.requireConfirmation).toBe(false)
    expect(result.blocked).toBe(false)
  })

  it('assessRisk: echo 为 SAFE', () => {
    const result = assessRisk('echo hello')
    expect(result.level).toBe('SAFE')
    expect(result.blocked).toBe(false)
    expect(result.requireConfirmation).toBe(false)
  })

  it('assessRisk: ls 为 LOW', () => {
    const result = assessRisk('ls -la /home')
    expect(result.level).toBe('LOW')
    expect(result.blocked).toBe(false)
    expect(result.requireConfirmation).toBe(false)
  })

  it('assessRisk: 空命令为 SAFE', () => {
    expect(assessRisk('').level).toBe('SAFE')
  })

  it('assessRisk: shutdown 为 CRITICAL', () => {
    expect(assessRisk('shutdown -h now').level).toBe('CRITICAL')
  })

  // ────────── L3: 人工确认 ──────────

  it('requiresConfirmation: HIGH 和 CRITICAL 返回 true', () => {
    expect(requiresConfirmation('HIGH')).toBe(true)
    expect(requiresConfirmation('CRITICAL')).toBe(true)
  })

  it('requiresConfirmation: SAFE/LOW/MEDIUM 返回 false', () => {
    expect(requiresConfirmation('SAFE')).toBe(false)
    expect(requiresConfirmation('LOW')).toBe(false)
    expect(requiresConfirmation('MEDIUM')).toBe(false)
  })

  // ────────── shouldBlock ──────────

  it('shouldBlock: 仅 CRITICAL 返回 true', () => {
    expect(shouldBlock('CRITICAL')).toBe(true)
    expect(shouldBlock('HIGH')).toBe(false)
    expect(shouldBlock('MEDIUM')).toBe(false)
    expect(shouldBlock('LOW')).toBe(false)
    expect(shouldBlock('SAFE')).toBe(false)
  })

  // ────────── L4: 审计日志 ──────────

  it('logToAudit/getAuditLog: 记录并获取审计日志', () => {
    const assessment = assessRisk('ls -la')
    logToAudit('ls -la', assessment)
    const log = getAuditLog()
    expect(log).toHaveLength(1)
    expect(log[0].command).toBe('ls -la')
    expect(log[0].assessment.level).toBe('LOW')
    expect(log[0].timestamp).toBeGreaterThan(0)
  })

  it('clearAuditLog: 清空审计日志', () => {
    logToAudit('echo test', assessRisk('echo test'))
    expect(getAuditLog()).toHaveLength(1)
    clearAuditLog()
    expect(getAuditLog()).toHaveLength(0)
  })
})
