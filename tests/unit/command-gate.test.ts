/**
 * command-gate 单元测试
 *
 * 目的：证明"红线 3 高危命令拦截"在补齐后真的生效——
 * 既覆盖原 12 条黑名单的每一类，也覆盖旧实现的绕过面（行首锚定）。
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateCommand,
  assertCommandAllowed,
  CommandBlockedError,
} from '../../src/main/core/command-gate'

describe('evaluateCommand — block 级（原 12 条黑名单的每一类）', () => {
  const blocked = [
    'rm -rf /',
    'rm -rf /*',
    'rm -fr /',
    'shutdown',
    'shutdown -h now',
    'reboot',
    'poweroff',
    'halt',
    'init 0',
    'telinit 6',
    'mkfs.ext4 /dev/sda1',
    'mkswap /dev/sdb2',
    'dd if=/dev/zero of=/dev/sda',
    'chmod 777 /',
    'chmod -R 777 /etc',
    'chown -R nobody /var',
    ':(){ :|:& };:',
    '> /dev/sda',
    'echo x > /dev/nvme0',
  ]
  it.each(blocked)('%s 应判 block', (cmd) => {
    expect(evaluateCommand(cmd).level).toBe('block')
  })
})

describe('evaluateCommand — 旧实现的绕过面现在拦得住', () => {
  // 旧黑名单全部 ^\s* 锚行首，以下形态在修复前一律放行
  const bypassCases = [
    'sudo rm -rf /',
    'cd /tmp && rm -rf /',
    'echo hi; rm -rf /etc',
    'FOO=1 mkfs.ext4 /dev/sda1',
    'sudo -u root shutdown',
    'ls && dd if=/dev/zero of=/dev/sda',
    'bash -c "rm -rf /"',
  ]
  it.each(bypassCases)('%s 应判 block', (cmd) => {
    expect(evaluateCommand(cmd).level).toBe('block')
  })
})

describe('evaluateCommand — 日常命令不得误伤', () => {
  const allowed = [
    'ls -la',
    'df -h',
    'free -m',
    'cat /etc/os-release',
    'systemctl status nginx',
    'journalctl -u sshd -n 50',
    'rm build.log',
    'rm -rf ./dist',
    'chmod 644 /etc/nginx/nginx.conf',
    'nginx -t && systemctl reload nginx',
    'tail -f /var/log/syslog',
    'ps aux | grep node',
    'top -bn1',
    'whoami',
    'grep -r "shutdown" /var/log/syslog',
    "sed -i 's/reboot/enabled/' /etc/systemd/foo",
    '',
    '   ',
  ]
  it.each(allowed)('%s 不应是 block', (cmd) => {
    expect(evaluateCommand(cmd).level).not.toBe('block')
  })

  it('只读命令判 low', () => {
    expect(evaluateCommand('cat /etc/hostname').level).toBe('low')
  })
  it('删除类判 high（可执行，但需审批卡点）', () => {
    expect(evaluateCommand('rm -rf ./dist').level).toBe('high')
  })
  it('包管理/服务变更判 medium', () => {
    expect(evaluateCommand('systemctl stop nginx').level).toBe('medium')
    expect(evaluateCommand('apt install curl').level).toBe('medium')
  })
})

describe('assertCommandAllowed — fail-closed', () => {
  it('block 级抛 CommandBlockedError', () => {
    expect(() => assertCommandAllowed('rm -rf /')).toThrow(CommandBlockedError)
  })
  it('抛错信息带上命中原因，便于 UI 显示', () => {
    try {
      assertCommandAllowed('sudo mkfs.xfs /dev/vdb1')
      expect.unreachable('应当抛错')
    } catch (e) {
      expect((e as CommandBlockedError).verdict.reason).toContain('格式化')
    }
  })
  it('非 block 级返回判定不抛错', () => {
    expect(() => assertCommandAllowed('df -h')).not.toThrow()
    expect(assertCommandAllowed('df -h').level).toBe('low')
  })
})
