/**
 * 命令风险判定只允许一份规则表（#95「重复的风险规则表」）
 *
 * 实测过的分叉（2026-10-13，合并前）：
 *   rm -rf /var/log     risk-engine=HIGH   审批卡正则表=low     ← 审批时更松，最坏方向
 *   useradd -m hacker   risk-engine=LOW    审批卡正则表=medium
 *   killall -9 node     risk-engine=LOW    审批卡正则表=high
 * 审批卡上的等级是用户决定"要不要放行"的唯一依据，它比权威引擎松就是在帮放行。
 *
 * 现在兜底走 assessRisk（只做等级映射），本判据钉两件事：
 *   1. AST 不可用时，审批路径与权威引擎同向（危险命令绝不比权威表更松）；
 *   2. 正向对照：AST 返回 null 时确实走到了兜底（否则第 1 条是拿 AST 结果在自证）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../../src/main/services/log/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/main/windows/main-window', () => ({ broadcastToWindows: vi.fn() }))

const mockAssessWithAst = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/core/risk-engine-ast', () => ({
  assessWithAst: (...args: unknown[]) => mockAssessWithAst(...args),
}))

import { assessCommandRisk } from '../../src/main/ipc/sandbox-approval'
import { assessRisk } from '../../src/main/core/risk-engine'

/** 五档压成三档后的序：审批卡只有 low/medium/high */
const SEV: Record<string, number> = { safe: 0, low: 0, medium: 1, high: 2, critical: 2 }

const DANGEROUS = [
  'rm -rf /',
  'rm -rf /var/log',
  'chmod 777 /etc/passwd',
  'mkfs.ext4 /dev/sda1',
  'dd if=/dev/zero of=/dev/sda',
  ':(){ :|:& };:',
  'shutdown -h now',
  'iptables -F',
  "python -c \"import os;os.system('rm -rf /')\"",
  'sudo systemctl restart nginx',
]

const BENIGN = [
  'ls -la /var/log',
  'cat /etc/nginx/nginx.conf',
  'echo hello > /tmp/a.txt',
  // 重定向精度（2026-10-13）：这两类目标不是"覆写文件"，
  // 每次都弹中危等于训练用户一路点确认
  'systemctl status nginx > /dev/null 2>&1',
  'make 2> /var/tmp/build.err',
]

describe('审批路径与权威风险引擎同源', () => {
  beforeEach(() => {
    mockAssessWithAst.mockReset()
    // 一律返回 null：强制走兜底，测的就是"兜底那份是不是权威表"
    mockAssessWithAst.mockResolvedValue(null)
  })

  it('正向对照：AST 返回 null 时确实调到了兜底（不是拿 AST 结果自证）', async () => {
    const r = await assessCommandRisk('rm -rf /')
    expect(mockAssessWithAst).toHaveBeenCalledTimes(1)
    expect(r.risk).toBe('high')
    expect(r.reasons.length, '兜底必须带得上原因，否则卡片只显示一个等级').toBeGreaterThan(0)
  })

  for (const cmd of DANGEROUS) {
    it(`危险命令不许被审批卡判得更松：${cmd}`, async () => {
      const authoritative = SEV[assessRisk(cmd).level.toLowerCase()] ?? -1
      const card = (await assessCommandRisk(cmd)).risk
      expect(SEV[card], `审批卡 ${card} 比权威引擎低（后者=${authoritative}）`).toBeGreaterThanOrEqual(
        authoritative
      )
    })
  }

  for (const cmd of BENIGN) {
    it(`正常运维命令不许被误伤成高危：${cmd}`, async () => {
      const card = (await assessCommandRisk(cmd)).risk
      expect(card).toBe('low')
    })
  }

  it('反向对照：临时目录豁免不能顺手放过系统路径覆写', async () => {
    for (const cmd of ['echo x > /etc/hosts', 'echo x >> /etc/profile', 'cat z > /var/log/syslog']) {
      const card = (await assessCommandRisk(cmd)).risk
      expect(card, `${cmd} 被临时目录豁免漏掉了`).not.toBe('low')
    }
  })
})
