/**
 * tests/unit/log-source-distro-coverage.test.ts —— 远端日志入口要覆盖两套发行版（#102）
 *
 * 真机实测（openEuler 靶子）：侧栏原来四选一里 /var/log/syslog 与 /var/log/auth.log
 * 都不存在，而真实存在的 /var/log/secure（5816 行）根本没列出来。
 * 更糟的是提示语写"不存在或为空"，把"这台机器不叫这个名字"说成了"没有内容"。
 */
import { describe, it, expect } from 'vitest'
import { LOG_SOURCES, missingLogFileHint } from '../../src/renderer/src/components/logs/v1/logs-data'

const systemPaths = LOG_SOURCES.filter((s) => s.group === 'system').map((s) => s.label)

describe('侧栏列出的远端日志路径', () => {
  it('阳性对照：确实扫到了系统日志组（0 项就是判据空转）', () => {
    expect(systemPaths.length).toBeGreaterThanOrEqual(5)
  })

  it('两套发行版的认证日志都在：Debian 的 auth.log 与 RHEL 系的 secure', () => {
    expect(systemPaths).toContain('/var/log/auth.log')
    expect(systemPaths).toContain('/var/log/secure')
  })

  it('两套发行版的系统日志都在：messages 与 syslog', () => {
    expect(systemPaths).toContain('/var/log/messages')
    expect(systemPaths).toContain('/var/log/syslog')
  })

  it('每个列出来的路径都有对应说明（不许留一个点了只会说"不存在"的入口）', () => {
    const missing = systemPaths.filter((p) => missingLogFileHint(p) === '这台机器上没有这个文件')
    expect(missing, `这些路径没有针对性说明：${missing.join(', ')}`).toEqual([])
  })

  it('成对互指：点错发行版时，提示要把对的那个文件说出来', () => {
    expect(missingLogFileHint('/var/log/auth.log')).toContain('/var/log/secure')
    expect(missingLogFileHint('/var/log/secure')).toContain('/var/log/auth.log')
    expect(missingLogFileHint('/var/log/syslog')).toContain('/var/log/messages')
    expect(missingLogFileHint('/var/log/messages')).toContain('/var/log/syslog')
  })

  it('nginx 那条说清是"没装/没写过"，而不是含糊的"不存在或为空"', () => {
    const hint = missingLogFileHint('/var/log/nginx/error.log')
    expect(hint).toContain('nginx')
    expect(hint).not.toContain('或为空')
  })
})
