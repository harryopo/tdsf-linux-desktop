/**
 * rollback-generator 单元测试
 *
 * 覆盖：
 *   - 18 条回滚规则各一个用例
 *   - 不可逆命令黑名单（rm -rf / mkfs / dd / shutdown / reboot / halt / poweroff）
 *   - 文件路径解析（/etc/ 文件 + 其他路径 + sed -i）
 *   - 边界情况（空命令 / 未知命令 / high 风险未匹配）
 *   - 辅助函数（listRollbackRuleNames / countIrreversiblePatterns）
 */

import { describe, it, expect } from 'vitest'
import {
  generateRollbackCommand,
  isIrreversible,
  listRollbackRuleNames,
  countIrreversiblePatterns,
} from '@main/services/security/rollback-generator'

describe('rollback-generator', () => {
  // ==========================================================================
  // 1. 不可逆命令黑名单
  // ==========================================================================
  describe('不可逆命令黑名单', () => {
    it('rm -rf 应识别为不可逆', () => {
      expect(isIrreversible('rm -rf /var/log')).toBe(true)
      expect(isIrreversible('rm -rf /')).toBe(true)
    })

    it('mkfs 应识别为不可逆', () => {
      expect(isIrreversible('mkfs.ext4 /dev/sda1')).toBe(true)
    })

    it('dd 应识别为不可逆', () => {
      expect(isIrreversible('dd if=/dev/zero of=/dev/sda')).toBe(true)
    })

    it('shutdown/reboot/halt/poweroff 应识别为不可逆', () => {
      expect(isIrreversible('shutdown -h now')).toBe(true)
      expect(isIrreversible('reboot')).toBe(true)
      expect(isIrreversible('halt')).toBe(true)
      expect(isIrreversible('poweroff')).toBe(true)
    })

    it('写入块设备应识别为不可逆', () => {
      expect(isIrreversible('echo data > /dev/sda')).toBe(true)
      expect(isIrreversible('cat img > /dev/nvme0n1')).toBe(true)
    })

    it('普通命令不应识别为不可逆', () => {
      expect(isIrreversible('ls -la')).toBe(false)
      expect(isIrreversible('systemctl restart nginx')).toBe(false)
      expect(isIrreversible('echo hello > /tmp/test.txt')).toBe(false)
    })

    it('不可逆命令的回滚建议应为 undefined', () => {
      expect(generateRollbackCommand('rm -rf /var/log', 'high')).toBeUndefined()
      expect(generateRollbackCommand('mkfs.ext4 /dev/sda1', 'high')).toBeUndefined()
      expect(generateRollbackCommand('dd if=/dev/zero of=/dev/sda', 'high')).toBeUndefined()
      expect(generateRollbackCommand('shutdown -h now', 'high')).toBeUndefined()
    })
  })

  // ==========================================================================
  // 2. 18 条回滚规则测试
  // ==========================================================================
  describe('18 条回滚规则', () => {
    // ─── 1-3. Git 操作 ──────────────────────────────────────────
    it('规则 1: git add/commit → git reset --hard HEAD~1', () => {
      expect(generateRollbackCommand('git add .', 'low')).toBe('git reset --hard HEAD~1')
      expect(generateRollbackCommand('git commit -m "test"', 'low')).toBe(
        'git reset --hard HEAD~1',
      )
    })

    it('规则 2: git checkout → git checkout -', () => {
      expect(generateRollbackCommand('git checkout feature', 'low')).toBe(
        'git checkout -（恢复到上一个分支）',
      )
    })

    it('规则 3: git reset → git reflog', () => {
      expect(generateRollbackCommand('git reset --hard HEAD~1', 'medium')).toBe(
        'git reflog + git reset --hard <旧 commit>',
      )
    })

    // ─── 4-5. 包管理 ────────────────────────────────────────────
    it('规则 4: yum/dnf install → remove', () => {
      expect(generateRollbackCommand('yum install nginx', 'medium')).toBe('yum remove nginx')
      expect(generateRollbackCommand('dnf install httpd', 'medium')).toBe('dnf remove httpd')
    })

    it('规则 5: apt install → apt remove', () => {
      expect(generateRollbackCommand('apt install nginx', 'medium')).toBe('apt remove nginx')
      expect(generateRollbackCommand('apt-get install curl', 'medium')).toBe('apt remove curl')
    })

    // ─── 6-7. 服务管理 ──────────────────────────────────────────
    it('规则 6: systemctl start/stop/restart → 反向操作', () => {
      expect(generateRollbackCommand('systemctl stop nginx', 'medium')).toBe(
        'systemctl start nginx',
      )
      expect(generateRollbackCommand('systemctl start nginx', 'medium')).toBe(
        'systemctl stop nginx',
      )
      expect(generateRollbackCommand('systemctl restart nginx', 'medium')).toBe(
        'systemctl stop nginx',
      )
    })

    it('规则 7: systemctl enable/disable → 反向操作', () => {
      expect(generateRollbackCommand('systemctl enable nginx', 'medium')).toBe(
        'systemctl disable nginx',
      )
      expect(generateRollbackCommand('systemctl disable nginx', 'medium')).toBe(
        'systemctl enable nginx',
      )
    })

    // ─── 8-10. 文件修改（备份优先策略）──────────────────────────
    it('规则 8: > /etc/xxx → 从备份恢复（含真实路径）', () => {
      const result = generateRollbackCommand('echo "new" > /etc/sysctl.conf', 'high')
      expect(result).toContain('/etc/sysctl.conf.bak')
      expect(result).toContain('/etc/sysctl.conf')
      expect(result).toContain('备份')
    })

    it('规则 9: > /other/path → 从备份恢复（含真实路径）', () => {
      const result = generateRollbackCommand('echo "data" > /var/log/app.log', 'medium')
      expect(result).toContain('/var/log/app.log.bak')
      expect(result).toContain('/var/log/app.log')
    })

    it('规则 10: sed -i → 从备份恢复（提取文件路径）', () => {
      const result = generateRollbackCommand(
        "sed -i 's/old/new/g' /etc/nginx/nginx.conf",
        'medium',
      )
      expect(result).toContain('/etc/nginx/nginx.conf.bak')
      expect(result).toContain('/etc/nginx/nginx.conf')
    })

    // ─── 11-12. 权限/所有者修改 ────────────────────────────────
    it('规则 11: chmod → 恢复原权限', () => {
      const result = generateRollbackCommand('chmod 777 /etc/passwd', 'medium')
      expect(result).toContain('恢复原权限')
      expect(result).toContain('/etc/passwd')
      expect(result).toContain('stat -c %a')
    })

    it('规则 12: chown → 恢复原所有者', () => {
      const result = generateRollbackCommand('chown user:group /var/log/app.log', 'medium')
      expect(result).toContain('恢复原所有者')
      expect(result).toContain('/var/log/app.log')
      expect(result).toContain('stat -c %U:%G')
    })

    // ─── 13-14. 文件操作 ───────────────────────────────────────
    it('规则 13: cp → 删除复制副本', () => {
      const result = generateRollbackCommand('cp /etc/hosts /tmp/hosts.bak', 'low')
      expect(result).toContain('rm -f /tmp/hosts.bak')
      expect(result).toContain('/etc/hosts')
    })

    it('规则 14: mv → 移回原位置', () => {
      const result = generateRollbackCommand('mv /tmp/old.txt /tmp/new.txt', 'low')
      expect(result).toBe('移回原位置：mv /tmp/new.txt /tmp/old.txt')
    })

    // ─── 15. 网络规则 ──────────────────────────────────────────
    it('规则 15: iptables -A → iptables -D 删除规则', () => {
      const result = generateRollbackCommand(
        'iptables -A INPUT -p tcp --dport 80 -j ACCEPT',
        'medium',
      )
      expect(result).toContain('iptables -D')
      expect(result).toContain('INPUT -p tcp --dport 80 -j ACCEPT')
    })

    // ─── 16-17. 用户管理 ───────────────────────────────────────
    it('规则 16: useradd → userdel -r', () => {
      expect(generateRollbackCommand('useradd testuser', 'medium')).toBe(
        '删除用户：userdel -r testuser',
      )
    })

    it('规则 17: userdel → useradd（需备份恢复）', () => {
      const result = generateRollbackCommand('userdel testuser', 'medium')
      expect(result).toContain('useradd testuser')
      expect(result).toContain('备份恢复 home')
    })

    // ─── 18. 容器管理 ──────────────────────────────────────────
    it('规则 18: docker run → docker stop + rm', () => {
      const result = generateRollbackCommand(
        'docker run --name web -d nginx',
        'medium',
      )
      expect(result).toContain('docker stop web')
      expect(result).toContain('docker rm web')
    })

    it('规则 18: docker run 无 --name → 使用 <容器ID>', () => {
      const result = generateRollbackCommand('docker run -d nginx', 'medium')
      expect(result).toContain('<容器ID>')
    })
  })

  // ==========================================================================
  // 3. 路径解析专项
  // ==========================================================================
  describe('文件路径解析', () => {
    it('应从重定向提取 /etc/ 路径', () => {
      const result = generateRollbackCommand(
        'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-forward.conf',
        'high',
      )
      expect(result).toContain('/etc/sysctl.d/99-forward.conf')
    })

    it('应从 sed -i 提取目标文件路径', () => {
      const result = generateRollbackCommand(
        "sed -i 's/SELINUX=enforcing/SELINUX=disabled/' /etc/selinux/config",
        'medium',
      )
      expect(result).toContain('/etc/selinux/config')
    })

    it('sed -i 无文件路径时应使用占位符', () => {
      const result = generateRollbackCommand("sed -i 's/old/new/g'", 'medium')
      expect(result).toContain('<目标文件>')
    })
  })

  // ==========================================================================
  // 4. 边界情况
  // ==========================================================================
  describe('边界情况', () => {
    it('空命令应返回 undefined', () => {
      expect(generateRollbackCommand('', 'low')).toBeUndefined()
    })

    it('未知命令应返回 undefined', () => {
      expect(generateRollbackCommand('ls -la', 'low')).toBeUndefined()
      expect(generateRollbackCommand('cat /etc/hosts', 'low')).toBeUndefined()
    })

    it('high 风险未匹配规则应返回 undefined（保守策略）', () => {
      expect(generateRollbackCommand('some-unknown-high-risk-cmd', 'high')).toBeUndefined()
    })

    it('low/medium 风险未匹配规则应返回 undefined', () => {
      expect(generateRollbackCommand('some-unknown-cmd', 'low')).toBeUndefined()
      expect(generateRollbackCommand('some-unknown-cmd', 'medium')).toBeUndefined()
    })

    it('默认风险等级应为 medium', () => {
      expect(generateRollbackCommand('systemctl stop nginx')).toBe('systemctl start nginx')
    })
  })

  // ==========================================================================
  // 5. 辅助函数
  // ==========================================================================
  describe('辅助函数', () => {
    it('listRollbackRuleNames 应返回 18 条规则名称', () => {
      const names = listRollbackRuleNames()
      expect(names).toHaveLength(18)
      expect(names).toContain('git-add-commit')
      expect(names).toContain('docker-run')
      expect(names).toContain('iptables-append')
    })

    it('countIrreversiblePatterns 应返回 5 个不可逆模式', () => {
      expect(countIrreversiblePatterns()).toBe(5)
    })
  })

  // ==========================================================================
  // 6. P1-8 修复回归测试（确保不再出现硬编码 xxx.bak）
  // ==========================================================================
  describe('P1-8 回归测试', () => {
    it('/etc/ 文件修改不应返回硬编码 xxx.bak', () => {
      const result = generateRollbackCommand(
        'echo "test" > /etc/nginx/nginx.conf',
        'high',
      )
      expect(result).not.toContain('xxx.bak')
      expect(result).not.toContain('xxx')
      expect(result).toContain('/etc/nginx/nginx.conf')
    })

    it('所有文件修改回滚建议应包含真实路径', () => {
      const commands = [
        'echo "a" > /etc/sysctl.conf',
        'echo "b" > /var/log/app.log',
        "sed -i 's/x/y/g' /etc/hosts",
      ]
      for (const cmd of commands) {
        const result = generateRollbackCommand(cmd, 'medium')
        expect(result).toBeDefined()
        expect(result).not.toContain('xxx')
      }
    })
  })
})
