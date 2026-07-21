/**
 * Markdown 渲染器（MarkdownRenderer）
 *
 * 将 ProfilerResult + RiskItem[] 渲染为结构化 Markdown 报告。
 *
 * 报告结构（参考方案书 v8.0 板块 A.4 样式规范）：
 *   # 系统架构感知报告 — {host}
 *   > 元信息行
 *   ## 📊 风险概览
 *     风险摘要表 + 风险详情
 *   ## 一、系统标识
 *     命令输出 + 解析表
 *   ## 二、CPU 与内存
 *   ...
 *   ## 十、运维
 *   ---
 *   页脚
 *
 * 特性：
 *   - 层级清晰：H1 报告 → H2 章节 → H3 命令 → 表格/代码块
 *   - 风险高亮：> ⚠️ blockquote 标注
 *   - TDSF 提示：> 💡 友好提示
 *   - 输出内容 UTF-8，可直接 markdown-pdf 转 PDF
 *   - 失败项不阻塞，会标注 [失败原因]
 */

import type {
  ProfilerItem,
  ProfilerResult,
  RiskItem,
  RiskLevel
} from './types'
import { GROUP_LABELS, PROBE_CATALOG } from './system-profiler'

// ==================================================================
// 常量
// ==================================================================

/** 风险等级中文标签 */
const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  critical: '🔴 严重',
  high: '🟠 高',
  medium: '🟡 中',
  low: '🟢 低',
  info: '🔵 提示'
}

/** 风险等级对应 blockquote emoji */
const RISK_LEVEL_QUOTES: Record<RiskLevel, string> = {
  critical: '🚨',
  high: '⚠️',
  medium: '⚠️',
  low: '💡',
  info: 'ℹ️'
}

/** 章节顺序定义（与 PROBE_CATALOG 组顺序一致） */
const SECTION_ORDER: Array<{ group: keyof typeof GROUP_LABELS; title: string; number: string }> = [
  { group: 'system', title: '系统标识', number: '一' },
  { group: 'cpu-memory', title: 'CPU 与内存', number: '二' },
  { group: 'storage', title: '存储', number: '三' },
  { group: 'network', title: '网络', number: '四' },
  { group: 'users', title: '用户', number: '五' },
  { group: 'services', title: '服务', number: '六' },
  { group: 'tools', title: '开发工具', number: '七' },
  { group: 'virt', title: '虚拟化', number: '八' },
  { group: 'web', title: 'Web 应用', number: '九' },
  { group: 'ops', title: '运维', number: '十' }
]

/** 已知命令的可读标题（用于命令分组标题） */
const CMD_LABELS: Record<string, string> = {
  'uname -a': '内核信息',
  'cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/lsb-release 2>/dev/null || echo "未识别发行版"': '操作系统',
  'hostname -f 2>/dev/null; hostname': '主机名',
  uptime: '运行时间',
  date: '当前时间',
  'lscpu | head -20': 'CPU 详细信息',
  'nproc; cat /proc/cpuinfo | grep "model name" | head -1': 'CPU 核心数与型号',
  'free -h': '内存使用',
  'lsblk -a 2>/dev/null || echo "lsblk 未安装"': '块设备',
  'df -hT | head -20': '文件系统使用',
  'mount | head -20': '已挂载文件系统',
  'ip addr show 2>/dev/null || ifconfig 2>/dev/null || echo "无网络工具"': '网络接口',
  'ip route 2>/dev/null || route -n 2>/dev/null': '路由表',
  'cat /etc/resolv.conf 2>/dev/null | head -5': 'DNS 配置',
  'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "无端口查看工具"': '监听端口',
  'whoami; id': '当前用户与身份',
  'cat /etc/passwd | grep -v nologin | grep -v false': '可登录用户',
  'sudo -n true 2>&1 | head -3 || echo "需要密码"': 'sudo 权限',
  'systemctl list-units --type=service --state=running 2>/dev/null | head -30 || ps aux | head -30': '运行中的服务',
  'systemctl list-unit-files --type=service --state=enabled 2>/dev/null | head -30': '自启动服务',
  'systemd-detect-virt 2>/dev/null || echo "未检测到虚拟化"': '虚拟化类型',
  'cat /proc/1/cgroup 2>/dev/null | head -3': 'Cgroup 信息',
  'crontab -l 2>/dev/null; ls /etc/cron.d/ 2>/dev/null': '定时任务',
  'ls /var/log/ 2>/dev/null | head -20': '日志目录'
}

// ==================================================================
// 工具函数
// ==================================================================

/** 格式化时间戳（毫秒 → YYYY-MM-DD HH:mm:ss） */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 截断代码块输出（避免超长报告） */
function truncateOutput(text: string, maxLines = 30, maxLineLen = 200): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines && lines.every((l) => l.length <= maxLineLen)) {
    return text
  }
  const truncated = lines.slice(0, maxLines).map((l) => l.length > maxLineLen ? l.slice(0, maxLineLen) + '...' : l)
  truncated.push(`\n... (省略 ${lines.length - maxLines} 行)`)
  return truncated.join('\n')
}

/** 转义 Markdown 表格中的 `|` 字符 */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** 提取 uname -a 第一段（内核版本 + 主机名） */
function parseUname(stdout: string): string {
  return stdout.split('\n')[0] || stdout
}

/** 解析 /etc/os-release 提取 PRETTY_NAME */
function parseOsRelease(stdout: string): string {
  const m = stdout.match(/PRETTY_NAME="?([^"\n]+)"?/)
  return m ? m[1] : stdout.split('\n')[0]
}

/** 解析 free -h 提取关键行 */
function parseFree(stdout: string): string {
  const lines = stdout.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return stdout
  return lines.slice(0, 3).join('\n')  // 表头 + Mem + Swap
}

/** 解析 lscpu 提取关键信息 */
function parseLscpu(stdout: string): string[] {
  const lines = stdout.split('\n').filter((l) => l.trim())
  // 提取前 5 行关键信息
  return lines.slice(0, 5)
}

/** 解析 ip addr 简化输出（接口名 + IP） */
function parseIpAddr(stdout: string): string {
  // 输出形如：
  //   1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536
  //       inet 127.0.0.1/8 scope host lo
  //   2: ens33: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500
  //       inet 192.168.45.200/24 brd 192.168.45.255 scope global ens33
  const lines = stdout.split('\n')
  const blocks: string[] = []
  let current = ''
  for (const line of lines) {
    if (/^\d+:/.test(line)) {
      if (current) blocks.push(current)
      current = line
    } else if (/inet /.test(line)) {
      current += '\n  ' + line.trim()
    }
  }
  if (current) blocks.push(current)
  return blocks.slice(0, 6).join('\n\n')
}

/** 解析 ss/netstat 端口列表（精简） */
function parseListeningPorts(stdout: string): string {
  const lines = stdout.split('\n').filter((l) => l.includes('LISTEN'))
  return lines.slice(0, 20).join('\n')
}

/** 解析 tools 输出为可读表格 */
function parseTools(stdout: string): { installed: string[]; missing: string[] } {
  const installed: string[] = []
  const missing: string[] = []
  for (const line of stdout.split('\n')) {
    const m = line.match(/^[YN]\s+(\S+?):\s*(.+)$/)
    if (!m) continue
    const tool = m[1]
    if (line.startsWith('Y ')) installed.push(tool)
    else missing.push(tool)
  }
  return { installed, missing }
}

/** 解析 running services 为列表 */
function parseRunningServices(stdout: string): string[] {
  const services: string[] = []
  const lines = stdout.split('\n')
  for (const line of lines) {
    // systemctl list-units 输出：UNIT LOAD ACTIVE SUB DESCRIPTION
    // 如：firewalld.service loaded active running firewalld - ...
    const m = line.match(/^(\S+\.service)\s+loaded\s+active\s+running\s+(.*)$/)
    if (m) services.push(`${m[1]} — ${m[2].trim()}`)
  }
  return services
}

/** 解析 enabled services */
function parseEnabledServices(stdout: string): string[] {
  const services: string[] = []
  const lines = stdout.split('\n')
  for (const line of lines) {
    const m = line.match(/^(\S+\.service)\s+enabled\s+(.*)$/)
    if (m) services.push(`${m[1]}`)
  }
  return services
}

/** 解析 uname 提取主机名 */
function parseHostname(unameOut: string, hostnameOut: string): string {
  // hostname -f 失败时回退到 hostname
  const first = hostnameOut.split('\n')[0].trim()
  if (first && first !== 'localhost' && !first.includes(';')) return first
  return unameOut.split(' ')[1] || 'unknown'
}

/** 解析 uptime 提取启动时间与运行时长 */
function parseUptime(stdout: string): { uptime: string; load: string } {
  // 形如： 13:30:01 up 57 min,  1 user,  load average: 0.00, 0.01, 0.05
  const uptimeMatch = stdout.match(/up\s+(.+?),\s+\d+\s+user/)
  const loadMatch = stdout.match(/load average:\s*([\d.,\s]+)/)
  return {
    uptime: uptimeMatch ? uptimeMatch[1] : stdout,
    load: loadMatch ? loadMatch[1] : ''
  }
}

// ==================================================================
// 风险概览渲染
// ==================================================================

/** 渲染风险概览章节 */
function renderRisksSection(risks: RiskItem[]): string {
  if (risks.length === 0) {
    return `## 📊 风险概览

> ✅ **未发现风险** — 系统当前状态健康，建议保持定期巡检。
`
  }

  // 统计
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const r of risks) counts[r.level]++

  const lines: string[] = []
  lines.push('## 📊 风险概览')
  lines.push('')
  lines.push('| 等级 | 数量 |')
  lines.push('|------|------|')
  lines.push(`| ${RISK_LEVEL_LABELS.critical} | ${counts.critical} |`)
  lines.push(`| ${RISK_LEVEL_LABELS.high} | ${counts.high} |`)
  lines.push(`| ${RISK_LEVEL_LABELS.medium} | ${counts.medium} |`)
  lines.push(`| ${RISK_LEVEL_LABELS.low} | ${counts.low} |`)
  lines.push(`| ${RISK_LEVEL_QUOTES.info} ${RISK_LEVEL_LABELS.info} | ${counts.info} |`)
  lines.push('')
  lines.push(`**共 ${risks.length} 项风险**，按严重程度排序：`)
  lines.push('')

  for (const r of risks) {
    const emoji = RISK_LEVEL_QUOTES[r.level]
    lines.push(`### ${emoji} [${RISK_LEVEL_LABELS[r.level]}] ${r.title}`)
    lines.push('')
    lines.push(`- **类别**：${r.category}`)
    lines.push(`- **描述**：${r.description}`)
    lines.push(`- **证据**：\`\`\`\n${truncateOutput(r.evidence, 6, 180)}\n\`\`\``)
    lines.push(`- **建议**：${r.suggestion}`)
    lines.push('')
  }
  return lines.join('\n')
}

// ==================================================================
// 章节渲染
// ==================================================================

/** 找到指定组的所有探查项 */
function itemsInGroup(items: ProfilerItem[], group: string): ProfilerItem[] {
  return items.filter((it) => it.group === group)
}

/** 找到指定 cmd 的探查项 */
function findByCmd(items: ProfilerItem[], cmd: string): ProfilerItem | undefined {
  return items.find((it) => it.cmd === cmd && it.ok)
}

/** 渲染系统标识章节 */
function renderSystemSection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 一、系统标识', '']
  const uname = findByCmd(items, 'uname -a')
  const osRelease = findByCmd(items, 'cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/lsb-release 2>/dev/null || echo "未识别发行版"')
  const hostname = findByCmd(items, 'hostname -f 2>/dev/null; hostname')
  const uptime = findByCmd(items, 'uptime')
  const date = findByCmd(items, 'date')

  lines.push('| 项 | 值 |')
  lines.push('|----|----|')
  if (hostname && uname) {
    lines.push(`| 主机名 | \`${parseHostname(uname.stdout, hostname.stdout)}\` |`)
  }
  if (osRelease) {
    lines.push(`| 操作系统 | **${escapeTableCell(parseOsRelease(osRelease.stdout))}** |`)
  }
  if (uname) {
    const kernel = parseUname(uname.stdout)
    lines.push(`| 内核 | \`${escapeTableCell(kernel)}\` |`)
  }
  if (uptime) {
    const { uptime: up, load } = parseUptime(uptime.stdout)
    lines.push(`| 启动时间 | ${up}${load ? `（负载 ${load.trim()}）` : ''} |`)
  }
  if (date) {
    lines.push(`| 当前时间 | \`${escapeTableCell(date.stdout.trim())}\` |`)
  }
  lines.push('')
  return lines.join('\n')
}

/** 渲染 CPU 与内存章节 */
function renderCpuMemorySection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 二、CPU 与内存', '']
  const lscpu = findByCmd(items, 'lscpu | head -20')
  const cpuinfo = findByCmd(items, 'nproc; cat /proc/cpuinfo | grep "model name" | head -1')
  const free = findByCmd(items, 'free -h')

  lines.push('### CPU 信息')
  lines.push('')
  if (cpuinfo) {
    const [nprocLine, modelLine] = cpuinfo.stdout.split('\n')
    if (modelLine) {
      const model = modelLine.replace(/^.*model name\s*:\s*/, '').trim()
      lines.push(`- **CPU 型号**：${model}`)
    }
    if (nprocLine) lines.push(`- **逻辑核心数**：${nprocLine.trim()}`)
  }
  if (lscpu) {
    const key = parseLscpu(lscpu.stdout)
    for (const k of key) {
      if (/Architecture|Model name|CPU\(s\)|Thread|Core|Socket|Vendor/.test(k)) {
        lines.push(`- ${escapeTableCell(k)}`)
      }
    }
  }
  lines.push('')

  if (free) {
    lines.push('### 内存信息')
    lines.push('')
    lines.push('```')
    lines.push(parseFree(free.stdout))
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

/** 渲染存储章节 */
function renderStorageSection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 三、存储', '']
  const lsblk = findByCmd(items, 'lsblk -a 2>/dev/null || echo "lsblk 未安装"')
  const df = findByCmd(items, 'df -hT | head -20')
  const mount = findByCmd(items, 'mount | head -20')

  if (lsblk) {
    lines.push('### 块设备')
    lines.push('')
    lines.push('```')
    lines.push(truncateOutput(lsblk.stdout, 15))
    lines.push('```')
    lines.push('')
  }
  if (df) {
    lines.push('### 文件系统使用率')
    lines.push('')
    lines.push('```')
    lines.push(truncateOutput(df.stdout, 15))
    lines.push('```')
    lines.push('')
  }
  if (mount) {
    lines.push('### 已挂载文件系统（前 20 行）')
    lines.push('')
    lines.push('```')
    lines.push(truncateOutput(mount.stdout, 20))
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

/** 渲染网络章节 */
function renderNetworkSection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 四、网络', '']
  const ipAddr = findByCmd(items, 'ip addr show 2>/dev/null || ifconfig 2>/dev/null || echo "无网络工具"')
  const ipRoute = findByCmd(items, 'ip route 2>/dev/null || route -n 2>/dev/null')
  const resolv = findByCmd(items, 'cat /etc/resolv.conf 2>/dev/null | head -5')
  const ss = findByCmd(items, 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "无端口查看工具"')

  if (ipAddr) {
    lines.push('### 网络接口')
    lines.push('')
    lines.push('```')
    lines.push(parseIpAddr(ipAddr.stdout))
    lines.push('```')
    lines.push('')
  }
  if (ipRoute) {
    lines.push('### 路由表')
    lines.push('')
    lines.push('```')
    lines.push(truncateOutput(ipRoute.stdout, 10))
    lines.push('```')
    lines.push('')
  }
  if (resolv) {
    lines.push('### DNS 配置')
    lines.push('')
    lines.push('```')
    lines.push(resolv.stdout.trim())
    lines.push('```')
    lines.push('')
  }
  if (ss) {
    lines.push('### 监听端口')
    lines.push('')
    lines.push('```')
    lines.push(parseListeningPorts(ss.stdout))
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

/** 渲染用户章节 */
function renderUsersSection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 五、用户', '']
  const whoami = findByCmd(items, 'whoami; id')
  const passwd = findByCmd(items, 'cat /etc/passwd | grep -v nologin | grep -v false')
  const sudo = findByCmd(items, 'sudo -n true 2>&1 | head -3 || echo "需要密码"')

  if (whoami) {
    const [user, ...rest] = whoami.stdout.split('\n')
    lines.push(`- **当前用户**：\`${user.trim()}\``)
    if (rest.length) lines.push(`- **身份详情**：\`${escapeTableCell(rest.join(' '))}\``)
    lines.push('')
  }
  if (passwd) {
    lines.push('### 可登录用户')
    lines.push('')
    lines.push('```')
    lines.push(truncateOutput(passwd.stdout, 20))
    lines.push('```')
    lines.push('')
  }
  if (sudo) {
    lines.push('### sudo 权限')
    lines.push('')
    lines.push('```')
    lines.push(sudo.stdout.trim())
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

/** 渲染服务章节 */
function renderServicesSection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 六、服务', '']
  const running = findByCmd(items, 'systemctl list-units --type=service --state=running 2>/dev/null | head -30 || ps aux | head -30')
  const enabled = findByCmd(items, 'systemctl list-unit-files --type=service --state=enabled 2>/dev/null | head -30')

  if (running) {
    const services = parseRunningServices(running.stdout)
    lines.push(`### 运行中服务（共 ${services.length} 项）`)
    lines.push('')
    if (services.length > 0) {
      lines.push('| 服务 | 描述 |')
      lines.push('|------|------|')
      for (const s of services.slice(0, 20)) {
        const [name, ...desc] = s.split(' — ')
        lines.push(`| \`${name}\` | ${escapeTableCell(desc.join(' — '))} |`)
      }
    } else {
      lines.push('```')
      lines.push(truncateOutput(running.stdout, 20))
      lines.push('```')
    }
    lines.push('')
  }
  if (enabled) {
    const services = parseEnabledServices(enabled.stdout)
    lines.push(`### 自启动服务（共 ${services.length} 项）`)
    lines.push('')
    if (services.length > 0) {
      lines.push(services.map((s) => `- \`${s}\``).join('\n'))
    } else {
      lines.push('```')
      lines.push(truncateOutput(enabled.stdout, 20))
      lines.push('```')
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 渲染开发工具章节 */
function renderToolsSection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 七、开发工具', '']
  const tools = findByCmd(items, 'for tool in python python3 node npm java gcc g++ make git curl wget vim nano ssh rsync docker podman nginx apache2 httpd mysql mariadb psql redis-server php php-fpm; do command -v $tool >/dev/null && echo "Y $tool: $(command -v $tool)" || echo "N $tool: 未安装"; done')

  if (!tools) {
    lines.push('> ⚠️ 工具检测命令未执行')
    lines.push('')
    return lines.join('\n')
  }
  const { installed, missing } = parseTools(tools.stdout)
  lines.push(`**已安装**：${installed.length} 项 | **未安装**：${missing.length} 项`)
  lines.push('')
  if (installed.length > 0) {
    lines.push('### ✅ 已安装')
    lines.push('')
    lines.push(installed.map((t) => `\`${t}\``).join(' · '))
    lines.push('')
  }
  if (missing.length > 0) {
    lines.push('### ❌ 未安装')
    lines.push('')
    lines.push(missing.map((t) => `\`${t}\``).join(' · '))
    lines.push('')
  }
  lines.push('### 原始输出')
  lines.push('')
  lines.push('```')
  lines.push(truncateOutput(tools.stdout, 50))
  lines.push('```')
  lines.push('')
  return lines.join('\n')
}

/** 渲染虚拟化章节 */
function renderVirtSection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 八、虚拟化', '']
  const virt = findByCmd(items, 'systemd-detect-virt 2>/dev/null || echo "未检测到虚拟化"')
  const cgroup = findByCmd(items, 'cat /proc/1/cgroup 2>/dev/null | head -3')

  if (virt) {
    lines.push(`- **虚拟化类型**：\`${escapeTableCell(virt.stdout.trim())}\``)
  }
  if (cgroup) {
    lines.push('- **Cgroup 信息**：')
    lines.push('')
    lines.push('```')
    lines.push(cgroup.stdout.trim())
    lines.push('```')
  }
  lines.push('')
  return lines.join('\n')
}

/** 渲染 Web 应用章节 */
function renderWebSection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 九、Web 应用', '']
  const web = findByCmd(items, 'ls /var/www/ 2>/dev/null; ls /usr/share/nginx/html/ 2>/dev/null; ls /etc/nginx/sites-enabled/ 2>/dev/null; ls /etc/apache2/sites-enabled/ 2>/dev/null; ls /etc/httpd/conf.d/ 2>/dev/null')
  if (web) {
    lines.push('```')
    lines.push(web.stdout.trim() || '（未发现 Web 应用目录）')
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

/** 渲染运维章节 */
function renderOpsSection(items: ProfilerItem[]): string {
  const lines: string[] = ['## 十、运维', '']
  const crontab = findByCmd(items, 'crontab -l 2>/dev/null; ls /etc/cron.d/ 2>/dev/null')
  const logs = findByCmd(items, 'ls /var/log/ 2>/dev/null | head -20')

  if (crontab) {
    lines.push('### 定时任务')
    lines.push('')
    lines.push('```')
    lines.push(truncateOutput(crontab.stdout, 20))
    lines.push('```')
    lines.push('')
  }
  if (logs) {
    lines.push('### 日志目录')
    lines.push('')
    lines.push('```')
    lines.push(logs.stdout.trim())
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

/** 渲染报告页脚 */
function renderFooter(result: ProfilerResult): string {
  const time = formatTime(result.generatedAt)
  const duration = (result.totalDurationMs / 1000).toFixed(2)
  const successCount = result.items.filter((it) => it.ok).length
  return `---

> 📋 **报告统计**：共 ${result.items.length} 项探查，成功 ${successCount} 项，失败 ${result.errors.length} 项
> ⏱️ **耗时**：${duration} 秒 · **生成于**：${time}
> 🛠️ **工具**：TDSF-Linux v0.4.0 · **数据来源**：${result.host}
> 📝 **许可**：本报告由 TDSF-Linux 自动生成，可自由编辑和分发
`
}

/** 渲染报告头部 */
function renderHeader(result: ProfilerResult, risks: RiskItem[]): string {
  const time = formatTime(result.generatedAt)
  const riskSummary = risks.length === 0
    ? '✅ 无风险'
    : `⚠️ ${risks.length} 项风险（${risks.filter((r) => r.level === 'critical' || r.level === 'high').length} 项高危）`
  return `# 系统架构感知报告 — ${result.host}

> **目标主机**：${result.host} · **生成时间**：${time} · **工具**：TDSF-Linux v0.4.0
> **风险状态**：${riskSummary}

`
}

// ==================================================================
// 章节调度
// ==================================================================

/** 章节渲染器映射表 */
const SECTION_RENDERERS: Record<string, (items: ProfilerItem[]) => string> = {
  'system': renderSystemSection,
  'cpu-memory': renderCpuMemorySection,
  'storage': renderStorageSection,
  'network': renderNetworkSection,
  'users': renderUsersSection,
  'services': renderServicesSection,
  'tools': renderToolsSection,
  'virt': renderVirtSection,
  'web': renderWebSection,
  'ops': renderOpsSection
}

// ==================================================================
// 顶层入口
// ==================================================================

/**
 * 将 ProfilerResult + RiskItem[] 渲染为完整的 Markdown 报告
 *
 * @param result 完整探查结果
 * @param risks  风险列表（已排序）
 * @returns Markdown 文本（UTF-8，可直接写入文件或转 PDF）
 */
export function renderProfilerMarkdown(
  result: ProfilerResult,
  risks: RiskItem[]
): string {
  const parts: string[] = []

  // 1. 头部
  parts.push(renderHeader(result, risks))

  // 2. 风险概览
  parts.push(renderRisksSection(risks))

  // 3. 各章节
  for (const { group } of SECTION_ORDER) {
    const renderer = SECTION_RENDERERS[group]
    if (renderer) {
      parts.push(renderer(result.items))
    }
  }

  // 4. 页脚
  parts.push(renderFooter(result))

  return parts.join('\n')
}

/** 导出供测试使用 */
export const _internal = {
  formatTime,
  truncateOutput,
  parseOsRelease,
  parseUptime,
  parseTools,
  parseRunningServices,
  parseEnabledServices,
  renderHeader,
  renderRisksSection,
  renderFooter,
  CMD_LABELS,
  SECTION_ORDER
}
