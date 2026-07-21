/**
 * Markdown 渲染器（MarkdownRenderer）单元测试
 *
 * 验证：
 * - 工具函数正确性（时间格式化、输出截断、解析函数）
 * - 头部 / 风险概览 / 页脚 渲染
 * - 各章节渲染
 * - 顶层 renderProfilerMarkdown 入口
 * - 边界情况（空数据、失败项）
 */
import { describe, it, expect } from 'vitest'
import {
  renderProfilerMarkdown,
  _internal
} from '../../../src/main/services/profiler/markdown-renderer'
import type { ProfilerResult, ProfilerItem, RiskItem } from '../../../src/main/services/profiler/types'

// ==================================================================
// 工具函数测试
// ==================================================================

describe('MarkdownRenderer - 工具函数', () => {
  const {
    formatTime,
    truncateOutput,
    parseOsRelease,
    parseUptime,
    parseTools,
    parseRunningServices,
    parseEnabledServices
  } = _internal

  describe('formatTime', () => {
    it('格式化毫秒时间戳为 YYYY-MM-DD HH:mm:ss', () => {
      // 2026-07-16 13:30:00
      const ts = new Date(2026, 6, 16, 13, 30, 0).getTime()
      expect(formatTime(ts)).toBe('2026-07-16 13:30:00')
    })

    it('补零（个位数月/日/时/分/秒）', () => {
      const ts = new Date(2026, 0, 5, 9, 5, 3).getTime()
      expect(formatTime(ts)).toBe('2026-01-05 09:05:03')
    })
  })

  describe('truncateOutput', () => {
    it('不超过 maxLines 不截断', () => {
      const out = 'a\nb\nc'
      expect(truncateOutput(out, 10)).toBe('a\nb\nc')
    })

    it('超过 maxLines 显示省略行数', () => {
      const out = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n')
      const result = truncateOutput(out, 5)
      expect(result).toContain('line0')
      expect(result).toContain('line4')
      expect(result).not.toContain('line5')
      expect(result).toContain('省略 45 行')
    })

    it('超长单行截断加 ...', () => {
      const out = 'x'.repeat(500)
      const result = truncateOutput(out, 100, 100)
      expect(result).toContain('...')
      expect(result.length).toBeLessThan(500)
    })
  })

  describe('parseOsRelease', () => {
    it('提取 PRETTY_NAME', () => {
      const out = `NAME="openEuler"
VERSION="20.03 (LTS-SP4)"
ID="openEuler"
PRETTY_NAME="openEuler 20.03 (LTS-SP4)"`
      expect(parseOsRelease(out)).toBe('openEuler 20.03 (LTS-SP4)')
    })

    it('无 PRETTY_NAME 时回退到首行', () => {
      expect(parseOsRelease('NAME=Linux')).toBe('NAME=Linux')
    })
  })

  describe('parseUptime', () => {
    it('提取运行时长与负载', () => {
      const out = ' 13:30:01 up 57 min,  1 user,  load average: 0.00, 0.01, 0.05'
      const r = parseUptime(out)
      expect(r.uptime).toContain('57 min')
      expect(r.load).toBe('0.00, 0.01, 0.05')
    })
  })

  describe('parseTools', () => {
    it('区分已安装和未安装', () => {
      const out = `Y python3: /usr/bin/python3
N git: 未安装
Y curl: /usr/bin/curl`
      const r = parseTools(out)
      expect(r.installed).toEqual(['python3', 'curl'])
      expect(r.missing).toEqual(['git'])
    })

    it('空输出返回空对象', () => {
      const r = parseTools('')
      expect(r.installed).toEqual([])
      expect(r.missing).toEqual([])
    })
  })

  describe('parseRunningServices', () => {
    it('解析 systemctl 输出', () => {
      const out = `UNIT                LOAD   ACTIVE SUB     DESCRIPTION
firewalld.service    loaded active running firewalld - dynamic firewall daemon
sshd.service         loaded active running SSH server
foo.service          loaded active failed  broken service`
      const r = parseRunningServices(out)
      expect(r.length).toBe(2)
      expect(r[0]).toContain('firewalld.service')
      expect(r[0]).toContain('dynamic firewall')
    })
  })

  describe('parseEnabledServices', () => {
    it('解析 enabled 服务', () => {
      const out = `UNIT                STATE   PRESET
sshd.service        enabled enabled
httpd.service       enabled enabled`
      const r = parseEnabledServices(out)
      expect(r).toEqual(['sshd.service', 'httpd.service'])
    })
  })
})

// ==================================================================
// 头部/风险/页脚 渲染
// ==================================================================

/** 构造一个最小但完整的 ProfilerResult */
function makeResult(items: ProfilerItem[] = [], errors: any[] = []): ProfilerResult {
  return {
    host: '192.168.45.200',
    sessionId: 'sess-1',
    generatedAt: new Date(2026, 6, 16, 13, 30, 0).getTime(),
    totalDurationMs: 2500,
    items,
    errors
  }
}

function makeItem(
  group: ProfilerItem['group'],
  cmd: string,
  stdout: string,
  ok = true
): ProfilerItem {
  return {
    group,
    groupLabel: group,
    cmd,
    stdout,
    stderr: '',
    exitCode: ok ? 0 : -1,
    durationMs: 10,
    ok
  }
}

describe('MarkdownRenderer - 头部与页脚', () => {
  it('头部包含目标主机与时间戳', () => {
    const result = makeResult()
    const md = renderProfilerMarkdown(result, [])
    expect(md).toMatch(/# 系统架构感知报告 — 192\.168\.45\.200/)
    expect(md).toContain('2026-07-16 13:30:00')
    expect(md).toContain('TDSF-Linux v0.4.0')
  })

  it('无风险时头部显示 ✅ 无风险', () => {
    const result = makeResult()
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('✅ 无风险')
  })

  it('有 high 风险时头部显示高危数量', () => {
    const result = makeResult()
    const risks: RiskItem[] = [
      { level: 'high', category: '网络安全', title: 'test', description: '', evidence: '', suggestion: '' },
      { level: 'critical', category: '资源', title: 'test2', description: '', evidence: '', suggestion: '' }
    ]
    const md = renderProfilerMarkdown(result, risks)
    expect(md).toContain('2 项风险')
    expect(md).toContain('2 项高危')
  })

  it('页脚包含统计与时间', () => {
    const result = makeResult([], [])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('共 0 项探查')
    expect(md).toContain('2.50 秒')
    expect(md).toContain('TDSF-Linux v0.4.0')
  })
})

describe('MarkdownRenderer - 风险概览', () => {
  it('无风险时显示"未发现风险"', () => {
    const result = makeResult()
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 📊 风险概览')
    expect(md).toContain('未发现风险')
  })

  it('有风险时显示统计表 + 详情', () => {
    const result = makeResult()
    const risks: RiskItem[] = [
      { level: 'critical', category: '资源风险', title: '磁盘爆满', description: '磁盘已满', evidence: 'df 输出', suggestion: '清理日志' },
      { level: 'high', category: '网络安全', title: 'Samba 暴露', description: '139 端口开放', evidence: 'ss 输出', suggestion: '关闭服务' },
      { level: 'info', category: '虚拟化', title: '嵌套虚拟化', description: '检测到', evidence: 'cgroup', suggestion: '监控' }
    ]
    const md = renderProfilerMarkdown(result, risks)
    expect(md).toContain('## 📊 风险概览')
    expect(md).toContain('| 等级 | 数量 |')
    expect(md).toContain('| 🔴 严重 | 1 |')
    expect(md).toContain('| 🟠 高 | 1 |')
    expect(md).toContain('### 🚨 [🔴 严重] 磁盘爆满')
    expect(md).toContain('### ⚠️ [🟠 高] Samba 暴露')
    expect(md).toContain('### ℹ️ [🔵 提示] 嵌套虚拟化')
    expect(md).toContain('**类别**：资源风险')
    expect(md).toContain('**建议**：清理日志')
  })
})

// ==================================================================
// 各章节渲染
// ==================================================================

describe('MarkdownRenderer - 章节渲染', () => {
  it('系统标识章节包含 H2 + 表格', () => {
    const result = makeResult([
      makeItem('system', 'uname -a', 'Linux server 4.19.90-2312.1.0.0255.oe2003sp4.x86_64'),
      makeItem('system', 'cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/lsb-release 2>/dev/null || echo "未识别发行版"',
        'PRETTY_NAME="openEuler 20.03 (LTS-SP4)"'),
      makeItem('system', 'hostname -f 2>/dev/null; hostname', 'server\nserver'),
      makeItem('system', 'uptime', ' 13:30:01 up 57 min,  1 user,  load average: 0.00, 0.01, 0.05'),
      makeItem('system', 'date', '2026-07-16 13:30:01')
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 一、系统标识')
    expect(md).toContain('| 主机名 |')
    expect(md).toContain('| 操作系统 |')
    expect(md).toContain('**openEuler 20.03 (LTS-SP4)**')
    expect(md).toContain('| 内核 |')
    expect(md).toContain('| 启动时间 | 57 min')
  })

  it('CPU 与内存章节：CPU 型号 + 核心数 + 内存 free 输出', () => {
    const result = makeResult([
      makeItem('cpu-memory', 'lscpu | head -20', 'Architecture: x86_64\nCPU(s): 1'),
      makeItem('cpu-memory', 'nproc; cat /proc/cpuinfo | grep "model name" | head -1', '1\nmodel name : Intel(R) Core(TM) i9-14900HX'),
      makeItem('cpu-memory', 'free -h',
        `              total        used        free      shared  buff/cache   available
Mem:          958Mi       205Mi       100Mi       0.0Mi       653Mi       553Mi
Swap:         2.0Gi          0B       2.0Gi`)
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 二、CPU 与内存')
    expect(md).toContain('i9-14900HX')
    expect(md).toContain('**逻辑核心数**：1')
    expect(md).toContain('### 内存信息')
    expect(md).toContain('Mem:')
  })

  it('存储章节：块设备 + df + mount', () => {
    const result = makeResult([
      makeItem('storage', 'lsblk -a 2>/dev/null || echo "lsblk 未安装"',
        'NAME   MAJ:MIN RM  SIZE RO TYPE MOUNTPOINT\nsda      8:0    0   20G  0 disk\n├─sda1   8:1    0   20G  0 part /'),
      makeItem('storage', 'df -hT | head -20',
        'Filesystem     Type  Size  Used Avail Use% Mounted on\n/dev/sda1      ext4   20G   18G  1.0G  90% /'),
      makeItem('storage', 'mount | head -20', '/dev/sda1 on / type ext4 (rw,relatime)')
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 三、存储')
    expect(md).toContain('### 块设备')
    expect(md).toContain('### 文件系统使用率')
    expect(md).toContain('### 已挂载文件系统')
  })

  it('网络章节：4 个子节', () => {
    const result = makeResult([
      makeItem('network', 'ip addr show 2>/dev/null || ifconfig 2>/dev/null || echo "无网络工具"',
        '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n    inet 127.0.0.1/8\n2: ens33: <BROADCAST> mtu 1500\n    inet 192.168.45.200/24'),
      makeItem('network', 'ip route 2>/dev/null || route -n 2>/dev/null', 'default via 192.168.45.2 dev ens33'),
      makeItem('network', 'cat /etc/resolv.conf 2>/dev/null | head -5', 'nameserver 114.114.114.114'),
      makeItem('network', 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "无端口查看工具"',
        'LISTEN 0 128 *:22 *:*\nLISTEN 0 128 *:82 *:*')
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 四、网络')
    expect(md).toContain('### 网络接口')
    expect(md).toContain('### 路由表')
    expect(md).toContain('### DNS 配置')
    expect(md).toContain('### 监听端口')
    expect(md).toContain('192.168.45.200/24')
  })

  it('用户章节：当前用户 + 可登录用户 + sudo', () => {
    const result = makeResult([
      makeItem('users', 'whoami; id', 'root\nuid=0(root) gid=0(root) groups=0(root)'),
      makeItem('users', 'cat /etc/passwd | grep -v nologin | grep -v false', 'root:x:0:0:root:/root:/bin/bash\nops:x:1000:1000:ops:/home/ops:/bin/bash'),
      makeItem('users', 'sudo -n true 2>&1 | head -3 || echo "需要密码"', '需要密码')
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 五、用户')
    expect(md).toContain('**当前用户**：`root`')
    expect(md).toContain('### 可登录用户')
    expect(md).toContain('### sudo 权限')
  })

  it('服务章节：运行中 + 自启动', () => {
    const result = makeResult([
      makeItem('services', 'systemctl list-units --type=service --state=running 2>/dev/null | head -30 || ps aux | head -30',
        'UNIT                LOAD   ACTIVE SUB     DESCRIPTION\nfirewalld.service    loaded active running firewalld - dynamic firewall daemon\nsshd.service         loaded active running SSH server'),
      makeItem('services', 'systemctl list-unit-files --type=service --state=enabled 2>/dev/null | head -30',
        'UNIT                STATE   PRESET\nsshd.service        enabled enabled\nhttpd.service       enabled enabled')
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 六、服务')
    expect(md).toContain('### 运行中服务（共 2 项）')
    expect(md).toContain('`firewalld.service`')
    expect(md).toContain('### 自启动服务（共 2 项）')
  })

  it('开发工具章节：已安装/未安装分组', () => {
    const result = makeResult([
      makeItem('tools', 'for tool in python python3 node npm java gcc g++ make git curl wget vim nano ssh rsync docker podman nginx apache2 httpd mysql mariadb psql redis-server php php-fpm; do command -v $tool >/dev/null && echo "Y $tool: $(command -v $tool)" || echo "N $tool: 未安装"; done',
        'Y python3: /usr/bin/python3\nY curl: /usr/bin/curl\nN git: 未安装\nN docker: 未安装\nN vim: 未安装')
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 七、开发工具')
    expect(md).toContain('**已安装**：2 项 | **未安装**：3 项')
    expect(md).toContain('### ✅ 已安装')
    expect(md).toContain('`python3` · `curl`')
    expect(md).toContain('### ❌ 未安装')
  })

  it('虚拟化章节：virt + cgroup', () => {
    const result = makeResult([
      makeItem('virt', 'systemd-detect-virt 2>/dev/null || echo "未检测到虚拟化"', 'vmware'),
      makeItem('virt', 'cat /proc/1/cgroup 2>/dev/null | head -3', '0::/docker/abc123')
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 八、虚拟化')
    expect(md).toContain('`vmware`')
    expect(md).toContain('0::/docker/abc123')
  })

  it('Web 应用章节：列目录', () => {
    const result = makeResult([
      makeItem('web', 'ls /var/www/ 2>/dev/null; ls /usr/share/nginx/html/ 2>/dev/null; ls /etc/nginx/sites-enabled/ 2>/dev/null; ls /etc/apache2/sites-enabled/ 2>/dev/null; ls /etc/httpd/conf.d/ 2>/dev/null',
        'html')
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 九、Web 应用')
    expect(md).toContain('html')
  })

  it('运维章节：crontab + 日志', () => {
    const result = makeResult([
      makeItem('ops', 'crontab -l 2>/dev/null; ls /etc/cron.d/ 2>/dev/null', '0 * * * * /usr/bin/backup.sh\n0hourly'),
      makeItem('ops', 'ls /var/log/ 2>/dev/null | head -20', 'messages\nsecure\naudit')
    ])
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('## 十、运维')
    expect(md).toContain('### 定时任务')
    expect(md).toContain('### 日志目录')
  })
})

// ==================================================================
// 完整流程
// ==================================================================

describe('MarkdownRenderer - 完整流程', () => {
  it('完整报告包含所有章节且 H1/H2 层级正确', () => {
    const result = makeResult([
      makeItem('system', 'uname -a', 'Linux server 4.19.0 x86_64'),
      makeItem('system', 'cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/lsb-release 2>/dev/null || echo "未识别发行版"', 'PRETTY_NAME="openEuler"'),
      makeItem('system', 'hostname -f 2>/dev/null; hostname', 'server'),
      makeItem('system', 'uptime', 'up 1 hour'),
      makeItem('system', 'date', '2026-07-16'),
      makeItem('cpu-memory', 'lscpu | head -20', 'CPU info'),
      makeItem('cpu-memory', 'nproc; cat /proc/cpuinfo | grep "model name" | head -1', '1\nmodel name : x86'),
      makeItem('cpu-memory', 'free -h', 'Mem: 1Gi')
    ])
    const md = renderProfilerMarkdown(result, [])
    // H1 应只有 1 个
    expect((md.match(/^# /gm) || []).length).toBe(1)
    expect(md).toContain('## 十、运维')
    // 应包含页脚分隔符
    expect(md).toContain('---')
    expect(md).toContain('报告统计')
  })

  it('空 items 数组不报错，输出空骨架', () => {
    const result = makeResult()
    const md = renderProfilerMarkdown(result, [])
    expect(md).toContain('# 系统架构感知报告')
    expect(md).toContain('未发现风险')
    expect(md).toContain('## 一、系统标识')  // 章节标题仍输出
  })

  it('失败的探查项不会让渲染崩溃', () => {
    const result = makeResult([
      // system uname 失败
      { group: 'system', groupLabel: '系统标识', cmd: 'uname -a', stdout: '', stderr: 'fail', exitCode: -1, durationMs: 5, ok: false, error: 'fail' },
      // 但 os-release 成功
      makeItem('system', 'cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/lsb-release 2>/dev/null || echo "未识别发行版"', 'PRETTY_NAME="openEuler"')
    ])
    const md = renderProfilerMarkdown(result, [])
    // 不应崩溃，正常生成章节
    expect(md).toContain('## 一、系统标识')
    expect(md).toContain('**openEuler**')
  })
})
