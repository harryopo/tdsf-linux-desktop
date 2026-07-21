/**
 * 风险检测器（RiskDetector）单元测试
 *
 * 覆盖 10 条规则的正例 / 反例 / 边界，并验证：
 * - 整体 detectRisks 入口
 * - summarizeRisks 统计
 * - 按风险等级排序（critical > high > medium > low > info）
 */
import { describe, it, expect } from 'vitest'
import {
  detectRisks,
  summarizeRisks,
  _internal
} from '../../../src/main/services/profiler/risk-detector'
import type { ProfilerItem } from '../../../src/main/services/profiler/types'

// ==================================================================
// 工具函数单元测试
// ==================================================================

describe('RiskDetector - 工具函数', () => {
  const { parseKernelMajor, parseAvailableMemoryMB, findHighUsageMounts, isPortListening, countMissingCriticalTools } = _internal

  describe('parseKernelMajor', () => {
    it('解析标准内核版本', () => {
      expect(parseKernelMajor('Linux server 4.19.90-2312.1.0.0255.oe2003sp4.x86_64 x86_64')).toBe(4)
      expect(parseKernelMajor('Linux host 3.10.0-1160.el7.x86_64 #1 SMP')).toBe(3)
      expect(parseKernelMajor('Linux host 5.15.0-100-generic #110-Ubuntu')).toBe(5)
    })

    it('无法解析时返回 null', () => {
      expect(parseKernelMajor('非 Linux 输出')).toBeNull()
      expect(parseKernelMajor('')).toBeNull()
    })
  })

  describe('parseAvailableMemoryMB', () => {
    it('解析 Mi 单位', () => {
      const out = `              total        used        free      shared  buff/cache   available
Mem:          958Mi       205Mi       100Mi       0.0Mi       653Mi       553Mi
Swap:         2.0Gi          0B       2.0Gi`
      expect(parseAvailableMemoryMB(out)).toBe(553)
    })

    it('解析 Gi 单位', () => {
      const out = `Mem:           16Gi        3.0Gi        8.0Gi       100Mi        4.0Gi       12Gi`
      expect(parseAvailableMemoryMB(out)).toBe(12 * 1024)  // Gi 转 Mi
    })

    it('无 Mem 行返回 null', () => {
      expect(parseAvailableMemoryMB('not a free output')).toBeNull()
    })
  })

  describe('findHighUsageMounts', () => {
    it('查找 >= 90% 的挂载点', () => {
      const out = `Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/sda1      ext4   20G   18G  1.0G  95% /
/dev/sda2      ext4   50G   10G   40G  20% /home
/dev/sdb1      xfs    100G  95G  5.0G  95% /data`
      const high = findHighUsageMounts(out, 90)
      expect(high).toContain('/（95%）')
      expect(high).toContain('/data（95%）')
      expect(high).not.toContain('/home（20%）')
    })

    it('没有高使用率挂载点返回空数组', () => {
      const out = `Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/sda1      ext4   20G   5G   15G  25% /`
      expect(findHighUsageMounts(out, 90)).toEqual([])
    })
  })

  describe('isPortListening', () => {
    it('匹配 *:22 形式', () => {
      const out = `LISTEN 0 128    *:22    *:*  users:(("sshd",pid=774,fd=3))`
      expect(isPortListening(out, 22)).toBe(true)
    })

    it('匹配 0.0.0.0:445 形式', () => {
      const out = `LISTEN 0 64  0.0.0.0:445  0.0.0.0:*  users:(("smbd",pid=1166,fd=34))`
      expect(isPortListening(out, 445)).toBe(true)
    })

    it('未监听返回 false', () => {
      const out = `LISTEN 0 128    *:22    *:*  users:(("sshd",pid=774,fd=3))`
      expect(isPortListening(out, 445)).toBe(false)
    })

    it('避免误匹配 8222/8200（边界正则）', () => {
      const out = `LISTEN 0 128    *:8222    *:*  users:(("test",pid=1,fd=1))`
      expect(isPortListening(out, 82)).toBe(false)
    })
  })

  describe('countMissingCriticalTools', () => {
    it('只统计关键工具缺失', () => {
      const out = `Y python3: /usr/bin/python3
N git: 未安装
N docker: 未安装
N gcc: 未安装
Y curl: /usr/bin/curl`
      const { missing, total } = countMissingCriticalTools(out)
      expect(total).toBe(5)
      expect(missing).toContain('git')
      expect(missing).toContain('docker')
      expect(missing).not.toContain('gcc') // gcc 不在关键列表
      expect(missing).not.toContain('curl') // 已安装
    })
  })
})

// ==================================================================
// 规则检测测试
// ==================================================================

/** 构造一份空 ProfilerItem[] 的工具 */
function makeItem(
  group: string,
  cmd: string,
  stdout: string,
  ok = true
): ProfilerItem {
  return {
    group: group as ProfilerItem['group'],
    groupLabel: group,
    cmd,
    stdout,
    stderr: '',
    exitCode: ok ? 0 : -1,
    durationMs: 10,
    ok
  }
}

/** 构造一份模拟探查结果（贴近真实 openEuler 20.03 探查输出） */
function makeRealisticResult(): ProfilerItem[] {
  return [
    makeItem('system', 'uname -a', 'Linux server 4.19.90-2312.1.0.0255.oe2003sp4.x86_64 #1 SMP'),
    makeItem('system', 'cat /etc/os-release', 'NAME="openEuler"\nVERSION="20.03 (LTS-SP4)"'),
    makeItem('cpu-memory', 'lscpu', 'Architecture: x86_64'),
    makeItem('cpu-memory', 'free -h',
      `              total        used        free      shared  buff/cache   available
Mem:          958Mi       205Mi       100Mi       0.0Mi       653Mi       553Mi
Swap:         2.0Gi          0B       2.0Gi`
    ),
    makeItem('storage', 'df -hT',
      `Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/sda1      ext4   20G   18G  1.0G  90% /
/dev/sdb1      xfs    100G  5G   95G  5% /data`
    ),
    makeItem('network', 'ss -tlnp',
      `LISTEN 0 128    *:22    *:*  users:(("sshd",pid=774,fd=3))
LISTEN 0 128    *:82    *:*  users:(("httpd",pid=1234,fd=4))
LISTEN 0 64  0.0.0.0:445  0.0.0.0:*  users:(("smbd",pid=1166,fd=34))
LISTEN 0 64  0.0.0.0:2049  0.0.0.0:*`
    ),
    makeItem('users', 'whoami; id', 'root\nuid=0(root) gid=0(root) groups=0(root)'),
    makeItem('services', 'systemctl list-units',
      `firewalld.service   loaded active running   firewalld - dynamic firewall daemon
sshd.service        loaded active running   SSH server
httpd.service       loaded active running   The Apache HTTP Server`
    ),
    makeItem('tools', 'for tool in ...',
      `Y python3: /usr/bin/python3
N git: 未安装
N docker: 未安装
N vim: 未安装
N node: 未安装
Y curl: /usr/bin/curl`
    ),
    makeItem('virt', 'systemd-detect-virt', 'vmware'),
    makeItem('virt', 'cat /proc/1/cgroup', '0::/docker/abcdef'),
    makeItem('web', 'ls /var/www/', 'html'),
    makeItem('ops', 'ls /var/log/', 'messages secure audit')
  ]
}

describe('RiskDetector - 规则检测', () => {
  it('完整真实场景应触发多条风险', () => {
    const items = makeRealisticResult()
    const risks = detectRisks({ items })

    // 应包含：root、低内存的相反（足够）、磁盘 90%、Samba 暴露、NFS 暴露、非标 82 端口、缺工具、内核 4（>=4 不触发）、vmware+docker（触发 R09）、防火墙已运行
    expect(risks.length).toBeGreaterThanOrEqual(5)

    const ids = risks.map((r) => r.title)
    expect(ids.some((t) => t.includes('root'))).toBe(true)
    expect(ids.some((t) => t.includes('Samba'))).toBe(true)
    expect(ids.some((t) => t.includes('NFS'))).toBe(true)
    expect(ids.some((t) => t.includes('磁盘'))).toBe(true)
    expect(ids.some((t) => t.includes('非标准 Web'))).toBe(true)
    expect(ids.some((t) => t.includes('嵌套虚拟化'))).toBe(true)
  })

  it('R01: whoami=ops 不触发 root 风险', () => {
    const items = [makeItem('users', 'whoami; id', 'ops\nuid=1000(ops)')]
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.id === undefined && r.title.includes('root'))).toBeUndefined()
  })

  it('R02: 内存 < 100MB 触发 high 等级', () => {
    const items = [makeItem('cpu-memory', 'free -h',
      `Mem:          958Mi       800Mi       100Mi       0.0Mi       58Mi       50Mi
Swap:         2.0Gi          0B       2.0Gi`)]
    const risks = detectRisks({ items })
    const mem = risks.find((r) => r.title.includes('内存'))
    expect(mem).toBeDefined()
    expect(mem!.level).toBe('high')
  })

  it('R02: 内存 >= 200MB 不触发', () => {
    const items = [makeItem('cpu-memory', 'free -h',
      `Mem:          958Mi       205Mi       100Mi       0.0Mi       653Mi       553Mi
Swap:         2.0Gi          0B       2.0Gi`)]
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.title.includes('内存'))).toBeUndefined()
  })

  it('R03: 磁盘 >= 95% 触发 critical', () => {
    const items = [makeItem('storage', 'df -hT',
      `Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/sda1      ext4   20G   19G  1.0G  95% /`)]
    const risks = detectRisks({ items })
    const disk = risks.find((r) => r.title.includes('磁盘'))
    expect(disk).toBeDefined()
    expect(disk!.level).toBe('critical')
  })

  it('R04: 139 监听触发 Samba 风险', () => {
    const items = [makeItem('network', 'ss -tlnp', 'LISTEN 0 64  0.0.0.0:139  0.0.0.0:*')]
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.title.includes('Samba'))).toBeDefined()
  })

  it('R05: 2049 监听触发 NFS 风险', () => {
    const items = [makeItem('network', 'ss -tlnp', 'LISTEN 0 64  0.0.0.0:2049  0.0.0.0:*')]
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.title.includes('NFS'))).toBeDefined()
  })

  it('R06: 监听 82 端口触发非标 Web 风险', () => {
    const items = [makeItem('network', 'ss -tlnp',
      `LISTEN 0 128    *:82    *:*  users:(("httpd",pid=1,fd=1))`)]
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.title.includes('非标准 Web'))).toBeDefined()
  })

  it('R06: 只监听 80/443 不触发', () => {
    const items = [makeItem('network', 'ss -tlnp',
      `LISTEN 0 128    *:80    *:*  users:(("httpd",pid=1,fd=1))
LISTEN 0 128    *:443   *:*  users:(("httpd",pid=1,fd=2))`)]
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.title.includes('非标准 Web'))).toBeUndefined()
  })

  it('R07: 缺失 5+ 关键工具触发 medium 等级', () => {
    const items = [makeItem('tools', 'for tool in ...',
      `N git: 未安装
N docker: 未安装
N vim: 未安装
N node: 未安装
N rsync: 未安装
Y python3: /usr/bin/python3`)]
    const risks = detectRisks({ items })
    const tool = risks.find((r) => r.title.includes('关键工具'))
    expect(tool).toBeDefined()
    expect(tool!.level).toBe('medium')
  })

  it('R07: 缺失 < 3 个关键工具不触发', () => {
    const items = [makeItem('tools', 'for tool in ...',
      `N git: 未安装
N docker: 未安装
Y python3: /usr/bin/python3`)]
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.title.includes('关键工具'))).toBeUndefined()
  })

  it('R08: 内核 3.x 触发 high', () => {
    const items = [makeItem('system', 'uname -a', 'Linux server 3.10.0-1160.el7.x86_64 #1 SMP')]
    const risks = detectRisks({ items })
    const k = risks.find((r) => r.title.includes('内核'))
    expect(k).toBeDefined()
    expect(k!.level).toBe('high')
  })

  it('R08: 内核 4.x 不触发', () => {
    const items = [makeItem('system', 'uname -a', 'Linux server 4.19.0 x86_64')]
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.title.includes('内核'))).toBeUndefined()
  })

  it('R09: vmware + docker cgroup 触发嵌套虚拟化', () => {
    const items = [
      makeItem('virt', 'systemd-detect-virt', 'vmware'),
      makeItem('virt', 'cat /proc/1/cgroup', '0::/docker/abc123')
    ]
    const risks = detectRisks({ items })
    const v = risks.find((r) => r.title.includes('嵌套虚拟化'))
    expect(v).toBeDefined()
    expect(v!.level).toBe('info')
  })

  it('R10: 防火墙未运行触发 high', () => {
    const items = [makeItem('services', 'systemctl list-units',
      `sshd.service        loaded active running
httpd.service       loaded active running`)]
    const risks = detectRisks({ items })
    const f = risks.find((r) => r.title.includes('防火墙'))
    expect(f).toBeDefined()
    expect(f!.level).toBe('high')
  })

  it('R10: 防火墙运行中不触发', () => {
    const items = [makeItem('services', 'systemctl list-units',
      `firewalld.service   loaded active running   firewalld - dynamic firewall daemon`)]
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.title.includes('防火墙'))).toBeUndefined()
  })
})

// ==================================================================
// 排序与摘要
// ==================================================================

describe('RiskDetector - 排序与摘要', () => {
  it('风险按等级降序排序（critical > high > medium > low > info）', () => {
    const items = [
      // 制造一个磁盘 95%（critical）+ 内存 50MB（high）+ 缺工具 medium + vmware+docker info
      makeItem('system', 'uname -a', 'Linux server 4.19.90 x86_64'),
      makeItem('cpu-memory', 'free -h',
        `Mem:          958Mi       800Mi       100Mi       0.0Mi       58Mi       50Mi
Swap:         2.0Gi          0B       2.0Gi`),
      makeItem('storage', 'df -hT',
        `Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/sda1      ext4   20G   19G  1.0G  95% /`),
      makeItem('tools', 'for tool in ...',
        `N git: 未安装
N docker: 未安装
N vim: 未安装
N node: 未安装
N rsync: 未安装`),
      makeItem('virt', 'systemd-detect-virt', 'vmware'),
      makeItem('virt', 'cat /proc/1/cgroup', '0::/docker/abc')
    ]
    const risks = detectRisks({ items })
    expect(risks.length).toBeGreaterThan(0)

    // 验证：第一个的 level 权重 >= 后一个
    const weights = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
    for (let i = 1; i < risks.length; i++) {
      expect(weights[risks[i - 1].level]).toBeGreaterThanOrEqual(weights[risks[i].level])
    }
  })

  it('summarizeRisks 正确统计', () => {
    const risks = [
      { level: 'critical' as const, category: '', title: '', description: '', evidence: '', suggestion: '' },
      { level: 'high' as const, category: '', title: '', description: '', evidence: '', suggestion: '' },
      { level: 'high' as const, category: '', title: '', description: '', evidence: '', suggestion: '' },
      { level: 'medium' as const, category: '', title: '', description: '', evidence: '', suggestion: '' },
      { level: 'info' as const, category: '', title: '', description: '', evidence: '', suggestion: '' }
    ]
    const summary = summarizeRisks(risks)
    expect(summary).toEqual({
      total: 5,
      critical: 1,
      high: 2,
      medium: 1,
      low: 0,
      info: 1
    })
  })

  it('summarizeRisks 空数组返回零统计', () => {
    expect(summarizeRisks([])).toEqual({
      total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0
    })
  })
})

// ==================================================================
// 健壮性
// ==================================================================

describe('RiskDetector - 健壮性', () => {
  it('空 items 数组不报错，返回空数组', () => {
    expect(detectRisks({ items: [] })).toEqual([])
  })

  it('部分探查失败（ok=false）的项不影响其他规则', () => {
    const items: ProfilerItem[] = [
      // users 探查失败
      { group: 'users' as ProfilerItem['group'], groupLabel: '用户', cmd: 'whoami; id', stdout: '', stderr: 'fail', exitCode: 1, durationMs: 5, ok: false, error: 'fail' },
      // 但 storage 正常
      makeItem('storage', 'df -hT',
        `Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/sda1      ext4   20G   19G  1.0G  95% /`)
    ]
    const risks = detectRisks({ items })
    // 应仍能检测到磁盘风险
    expect(risks.find((r) => r.title.includes('磁盘'))).toBeDefined()
  })

  it('规则检测函数抛出异常时不中断其他规则', () => {
    // 通过传入畸形数据，触发部分规则解析失败
    const items: ProfilerItem[] = [
      makeItem('system', 'uname -a', '$$$畸形输出$$$'),
      makeItem('cpu-memory', 'free -h', '$$$无法解析$$$'),
      makeItem('storage', 'df -hT', '$$$无法解析$$$'),
      // 正常的 network 探查仍应能触发 Samba 风险
      makeItem('network', 'ss -tlnp', 'LISTEN 0 64  0.0.0.0:445  0.0.0.0:*')
    ]
    // 不应抛错
    const risks = detectRisks({ items })
    expect(risks.find((r) => r.title.includes('Samba'))).toBeDefined()
  })
})
