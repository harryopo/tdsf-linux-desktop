/**
 * 系统风险检测器（Risk Detector）
 *
 * 基于 SystemProfiler 的探查结果（ProfilerResult.items 中的 stdout），
 * 用规则引擎匹配潜在的安全/运维风险，输出 RiskItem[]。
 *
 * 设计原则：
 *   1. 每条规则独立可测试，输入是 ProfilerItem[]，输出是 RiskItem[]
 *   2. 规则注册为 RuleDef，遍历执行；新增规则只需在 RISK_RULES 数组追加
 *   3. 风险等级（critical / high / medium / low / info）由规则定义
 *   4. 证据片段直接从探查输出截取，避免重复解析
 *
 * 规则清单（10 条，覆盖方案书要求的 8+ 条）：
 *   R01 ROOT_CURRENT_USER     - 当前用户是 root
 *   R02 LOW_MEMORY            - 可用内存不足 200MB
 *   R03 DISK_HIGH_USAGE       - 任一挂载点使用率 >= 90%
 *   R04 SAMBA_EXPOSED         - 139/445 端口对外开放
 *   R05 NFS_UNAUTH            - 2049 端口对外开放（NFS 默认无认证）
 *   R06 WEB_NONSTANDARD_PORT  - Web 服务监听非 80/443 端口
 *   R07 MISSING_CRITICAL_TOOLS- 关键开发工具大面积缺失
 *   R08 KERNEL_EOL            - 内核版本 < 4.0（已停止维护）
 *   R09 NESTED_VIRT           - 检测到嵌套虚拟化
 *   R10 FIREWALL_DISABLED     - 未检测到 firewalld/iptables 运行
 */

import type {
  ProfilerItem,
  RiskItem,
  RiskLevel
} from './types'

/** 风险等级权重（用于统计排序） */
const RISK_LEVEL_WEIGHT: Record<RiskLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0
}

/** 单条风险规则的上下文：包含所有探查项，便于跨组查询 */
interface RuleContext {
  items: ProfilerItem[]
}

/** 风险规则定义 */
interface RiskRule {
  /** 规则 ID（稳定不变） */
  id: string
  /** 风险类别 */
  category: string
  /** 规则说明（开发用） */
  description: string
  /** 检测函数：返回 null 表示未触发；返回 RiskItem 表示触发 */
  detect: (ctx: RuleContext) => RiskItem | null
}

// ==================================================================
// 工具函数
// ==================================================================

/**
 * 在探查项中查找首个匹配 group 且 ok=true 的项
 */
function findItem(items: ProfilerItem[], group: string): ProfilerItem | null {
  for (const item of items) {
    if (item.group === group && item.ok) {
      return item
    }
  }
  return null
}

/**
 * 在所有探查项的 stdout 中全局搜索首个匹配正则的行
 * 风险检测经常需要"看任意探查的输出是否符合"
 */
function searchAnyOutput(items: ProfilerItem[], pattern: RegExp): string | null {
  for (const item of items) {
    if (!item.ok) continue
    const match = item.stdout.match(pattern)
    if (match) return match[0]
  }
  return null
}

/** 截断证据文本（避免超长） */
function truncate(text: string, maxLen = 200): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLen) return trimmed
  return trimmed.slice(0, maxLen) + '...'
}

/**
 * 从 uname -a 输出解析内核主版本号
 * uname 输出形如：Linux server 4.19.90-... x86_64
 */
function parseKernelMajor(unameOutput: string): number | null {
  const match = unameOutput.match(/Linux\s+\S+\s+(\d+)\.(\d+)/)
  if (!match) return null
  return parseInt(match[1], 10)
}

/**
 * 解析 free -h 输出，提取 available 列的 MB 数
 * 形如：
 *                total        used        free      avail
 *   Mem:          958Mi       405Mi       200Mi       400Mi
 *   Swap:         2.0Gi          0B       2.0Gi
 */
function parseAvailableMemoryMB(freeOutput: string): number | null {
  const lines = freeOutput.split('\n')
  for (const line of lines) {
    if (!line.startsWith('Mem:')) continue
    // 匹配 avail 列（M/G 单位）
    const m = line.match(/(\d+(?:\.\d+)?)(Mi|Gi|M|G)\s*$/)
    if (!m) continue
    const value = parseFloat(m[1])
    const unit = m[2].toLowerCase()
    if (unit.startsWith('g')) return value * 1024
    return value
  }
 return null
}

/**
 * 解析 df -hT 输出，查找使用率 >= 阈值的挂载点
 * 形如：
 *   Filesystem     Type  Size  Used Avail Use% Mounted
 *   /dev/sda1      ext4   20G   18G  1.0G  95% /
 */
function findHighUsageMounts(dfOutput: string, threshold: number): string[] {
  const high: string[] = []
  const lines = dfOutput.split('\n').slice(1) // 跳标题
  for (const line of lines) {
    const m = line.match(/(\d+)%\s+(\S+)/)
    if (!m) continue
    const usePct = parseInt(m[1], 10)
    const mount = m[2]
    if (usePct >= threshold) {
      high.push(`${mount}（${usePct}%）`)
    }
  }
  return high
}

/**
 * 解析 ss/netstat 监听端口，匹配指定端口
 * 形如：LISTEN 0 128 *:22 *:* users:(("sshd",pid=774,fd=3))
 *            或 LISTEN 0 64 0.0.0.0:445 0.0.0.0:*
 */
function isPortListening(ssOutput: string, port: number): boolean {
  // 匹配 0.0.0.0:PORT / [::]:PORT / *:PORT 形式
  // 形如：
  //   LISTEN 0 64  0.0.0.0:445  0.0.0.0:*
  //   LISTEN 0 128 *:22         *:*
  //   LISTEN 0 64  [::]:2049    [::]:*
  // 用 word boundary \b 避免误匹配 8222/8200
  const regex = new RegExp(
    `(?:^|[\\s\\*\\[\\]:])(?:0\\.0\\.0\\.0|::|\\*)?:${port}\\b`,
    'm'
  )
  return regex.test(ssOutput)
}

/**
 * 解析 tools 探查输出，统计缺失的关键工具
 * 探查命令输出形如：
 *   Y python3: /usr/bin/python3
 *   N docker: 未安装
 */
function countMissingCriticalTools(toolsOutput: string): { missing: string[]; total: number } {
  const missing: string[] = []
  let total = 0
  const lines = toolsOutput.split('\n')
  for (const line of lines) {
    const m = line.match(/^[YN]\s+(\S+?):/)
    if (!m) continue
    total++
    const tool = m[1]
    if (line.startsWith('N ')) {
      // 关键工具：git / docker / curl / wget / vim / ssh 之一
      if (['git', 'docker', 'curl', 'wget', 'vim', 'ssh', 'rsync', 'node', 'python3'].includes(tool)) {
        missing.push(tool)
      }
    }
  }
  return { missing, total }
}

// ==================================================================
// 规则定义（10 条）
// ==================================================================

/** R01: 当前用户是 root */
const RULE_ROOT_CURRENT_USER: RiskRule = {
  id: 'R01-ROOT-CURRENT-USER',
  category: '账户安全',
  description: '当前 SSH 登录用户是 root',
  detect: ({ items }) => {
    const usersItem = findItem(items, 'users')
    if (!usersItem) return null
    // whoami; id 命令：第一行是 whoami 输出
    const firstLine = usersItem.stdout.split('\n')[0].trim()
    if (firstLine !== 'root') return null
    return {
      level: 'medium',
      category: '账户安全',
      title: '当前用户为 root',
      description: '以 root 账户直接远程登录是高风险操作，建议改用普通用户 + sudo。',
      evidence: truncate(usersItem.stdout.split('\n').slice(0, 2).join(' | ')),
      suggestion: '1) 创建普通用户 useradd -m -s /bin/bash ops；2) 配置 sudo 权限；3) 修改 /etc/ssh/sshd_config 中 PermitRootLogin no；4) 重启 sshd。'
    }
  }
}

/** R02: 可用内存不足 200MB */
const RULE_LOW_MEMORY: RiskRule = {
  id: 'R02-LOW-MEMORY',
  category: '资源风险',
  description: '可用内存不足 200MB，可能导致 OOM',
  detect: ({ items }) => {
    const memItem = findItem(items, 'cpu-memory')
    if (!memItem) return null
    const availMB = parseAvailableMemoryMB(memItem.stdout)
    if (availMB === null || availMB >= 200) return null
    return {
      level: availMB < 100 ? 'high' : 'medium',
      category: '资源风险',
      title: `可用内存仅 ${Math.round(availMB)}MB`,
      description: '可用内存低于 200MB 阈值，在负载升高时极易触发 OOM 杀进程或服务崩溃。',
      evidence: truncate(memItem.stdout),
      suggestion: '1) 排查内存占用：ps aux --sort=-%mem | head -10；2) 清理缓存：sync && echo 3 > /proc/sys/vm/drop_caches；3) 评估扩容或调整服务内存上限。'
    }
  }
}

/** R03: 磁盘使用率 >= 90% */
const RULE_DISK_HIGH_USAGE: RiskRule = {
  id: 'R03-DISK-HIGH-USAGE',
  category: '资源风险',
  description: '磁盘使用率过高，存在写满宕机风险',
  detect: ({ items }) => {
    const storageItem = findItem(items, 'storage')
    if (!storageItem) return null
    const high = findHighUsageMounts(storageItem.stdout, 90)
    if (high.length === 0) return null
    const maxPct = Math.max(
      ...high.map((m) => {
        const match = m.match(/(\d+)%/)
        return match ? parseInt(match[1], 10) : 0
      })
    )
    return {
      level: maxPct >= 95 ? 'critical' : 'high',
      category: '资源风险',
      title: `磁盘使用率告警：${high.join(', ')}`,
      description: '磁盘使用率达到 90% 以上，存在被写满导致服务不可用的风险。',
      evidence: truncate(storageItem.stdout.split('\n').filter((l) => l.includes('%')).join('\n')),
      suggestion: '1) 查找大文件：du -h --max-depth=1 / | sort -hr | head -10；2) 清理日志：journalctl --vacuum-size=100M；3) 扩容或迁移。'
    }
  }
}

/** R04: Samba 端口对外开放 */
const RULE_SAMBA_EXPOSED: RiskRule = {
  id: 'R04-SAMBA-EXPOSED',
  category: '网络安全',
  description: 'SMB 端口 139/445 监听中',
  detect: ({ items }) => {
    const netItem = findItem(items, 'network')
    if (!netItem) return null
    const has139 = isPortListening(netItem.stdout, 139)
    const has445 = isPortListening(netItem.stdout, 445)
    if (!has139 && !has445) return null
    const ports = [has139 && '139', has445 && '445'].filter(Boolean).join('/')
    return {
      level: 'medium',
      category: '网络安全',
      title: `Samba 端口 ${ports} 已开放`,
      description: 'SMB 服务对外暴露存在被攻击或被勒索软件利用的风险。',
      evidence: truncate(netItem.stdout.split('\n').filter((l) => l.includes('139') || l.includes('445')).join('\n') || netItem.stdout),
      suggestion: '1) 若无需对外共享，关闭 smb.service；2) 配置 /etc/samba/smb.conf 中 bind interfaces only = yes；3) 使用 firewall-cmd 限制源 IP；4) 启用 SMB 签名。'
    }
  }
}

/** R05: NFS 端口开放（默认无认证） */
const RULE_NFS_UNAUTH: RiskRule = {
  id: 'R05-NFS-UNAUTH',
  category: '网络安全',
  description: 'NFS 端口 2049 监听中',
  detect: ({ items }) => {
    const netItem = findItem(items, 'network')
    if (!netItem) return null
    if (!isPortListening(netItem.stdout, 2049)) return null
    return {
      level: 'medium',
      category: '网络安全',
      title: 'NFS 端口 2049 已开放',
      description: 'NFS 协议默认无强认证（依赖 IP 信任），暴露在公网或不可信网络存在数据泄露风险。',
      evidence: truncate(netItem.stdout.split('\n').filter((l) => l.includes('2049')).join('\n') || netItem.stdout),
      suggestion: '1) 配置 /etc/exports 使用 sec=krb5p 强认证；2) 用 firewall-cmd 限制 NFS 端口仅允许可信子网；3) 非必要不暴露到 0.0.0.0。'
    }
  }
}

/** R06: Web 服务监听非标准端口 */
const RULE_WEB_NONSTANDARD_PORT: RiskRule = {
  id: 'R06-WEB-NONSTANDARD-PORT',
  category: '配置风险',
  description: 'Web 服务监听非 80/443 端口',
  detect: ({ items }) => {
    const netItem = findItem(items, 'network')
    if (!netItem) return null
    // 提取所有 LISTEN 行的端口号
    const lines = netItem.stdout.split('\n')
    const nonStandard: string[] = []
    for (const line of lines) {
      if (!line.includes('LISTEN')) continue
      // 匹配 *:82 或 0.0.0.0:8080 形式
      const m = line.match(/(?:\*|0\.0\.0\.0|::):(\d+)\b/)
      if (!m) continue
      const port = parseInt(m[1], 10)
      if (port !== 80 && port !== 443 && port < 10000) {
        // 排除已知非 Web 端口
        if (![22, 139, 445, 111, 2049, 20048, 3306, 5432, 6379, 25].includes(port)) {
          nonStandard.push(`${port}(${line.trim().split(/\s+/).slice(6).join(' ').slice(0, 50)})`)
        }
      }
    }
    if (nonStandard.length === 0) return null
    return {
      level: 'low',
      category: '配置风险',
      title: `检测到非标准 Web 端口：${nonStandard.slice(0, 3).join(', ')}`,
      description: 'Web 服务监听非标准端口可能导致客户端访问困难或被误判为可疑服务。',
      evidence: truncate(nonStandard.join('\n')),
      suggestion: '1) 评估是否改回 80/443 + 反向代理；2) 若使用非标准端口，确保在客户端文档中明确标注；3) 在防火墙中放行该端口。'
    }
  }
}

/** R07: 关键开发工具大面积缺失 */
const RULE_MISSING_CRITICAL_TOOLS: RiskRule = {
  id: 'R07-MISSING-CRITICAL-TOOLS',
  category: '工具链',
  description: '多个关键开发工具未安装',
  detect: ({ items }) => {
    const toolsItem = findItem(items, 'tools')
    if (!toolsItem) return null
    const { missing, total } = countMissingCriticalTools(toolsItem.stdout)
    if (missing.length < 3) return null
    return {
      level: missing.length >= 5 ? 'medium' : 'low',
      category: '工具链',
      title: `缺失 ${missing.length} 个关键工具：${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
      description: `已检测 ${total} 个常用工具，关键工具大面积缺失可能影响日常运维效率。`,
      evidence: truncate(toolsItem.stdout.split('\n').filter((l) => l.startsWith('N ')).slice(0, 5).join('\n')),
      suggestion: `使用包管理器补装：yum install -y ${missing.slice(0, 5).join(' ')}（openEuler/CentOS）；apt install -y ${missing.slice(0, 5).join(' ')}（Ubuntu/Debian）。`
    }
  }
}

/** R08: 内核版本过旧（< 4.0） */
const RULE_KERNEL_EOL: RiskRule = {
  id: 'R08-KERNEL-EOL',
  category: '系统安全',
  description: '内核主版本低于 4.0',
  detect: ({ items }) => {
    const sysItem = findItem(items, 'system')
    if (!sysItem) return null
    const major = parseKernelMajor(sysItem.stdout)
    if (major === null || major >= 4) return null
    return {
      level: 'high',
      category: '系统安全',
      title: `内核版本过旧：${major}.x（已停止维护）`,
      description: '内核主版本低于 4.0 不再接收安全更新，存在已知 CVE 未修复风险。',
      evidence: truncate(sysItem.stdout.split('\n')[0]),
      suggestion: '1) 评估业务兼容性后规划升级；2) 短期可启用 SELinux/AppArmor 缓解；3) 关注发行版 EOL 日志，提前迁移到新 LTS。'
    }
  }
}

/** 合并指定组的所有 stdout（按行拼接），用于跨项分析（如 virt + cgroup） */
function concatGroupOutput(items: ProfilerItem[], group: string): string {
  return items
    .filter((it) => it.group === group && it.ok)
    .map((it) => it.stdout)
    .join('\n')
}

/** R09: 嵌套虚拟化 */
const RULE_NESTED_VIRT: RiskRule = {
  id: 'R09-NESTED-VIRT',
  category: '虚拟化',
  description: '检测到嵌套虚拟化（性能损耗）',
  detect: ({ items }) => {
    // 合并所有 virt 项输出（systemd-detect-virt + /proc/1/cgroup）
    const virtOut = concatGroupOutput(items, 'virt').toLowerCase()
    if (!virtOut) return null
    // 嵌套虚拟化标志：vmware/kvm/qemu + docker/kubepods/containerd
    const isHardwareVirt = /\b(vmware|kvm|qemu|microsoft|oracle|amazon|xen|bochs)\b/.test(virtOut)
    const hasContainerCgroup = /\b(docker|kubepods|containerd|lxc)\b/.test(virtOut)
    if (!isHardwareVirt || !hasContainerCgroup) return null
    return {
      level: 'info',
      category: '虚拟化',
      title: '检测到嵌套虚拟化（VM + 容器）',
      description: '系统运行在 VMware/KVM 之上同时使用容器，I/O 与网络性能会受双重虚拟化影响。',
      evidence: truncate(concatGroupOutput(items, 'virt')),
      suggestion: '1) 生产环境建议用 --cgroup-parent 显式控制 cgroup；2) 性能敏感场景考虑 SR-IOV / DPDK 旁路；3) 监控网络与磁盘延迟基线。'
    }
  }
}

/** R10: 防火墙未启用 */
const RULE_FIREWALL_DISABLED: RiskRule = {
  id: 'R10-FIREWALL-DISABLED',
  category: '网络安全',
  description: '未检测到 firewalld 运行',
  detect: ({ items }) => {
    const svcItem = findItem(items, 'services')
    if (!svcItem) return null
    const lower = svcItem.stdout.toLowerCase()
    // firewalld 可能在但未运行；这里检查"running"列表
    const isFirewalldRunning = /firewalld\.service\s+active\s+running/.test(svcItem.stdout) ||
                               /firewalld\.service.*running/.test(lower)
    if (isFirewalldRunning) return null
    return {
      level: 'high',
      category: '网络安全',
      title: '防火墙未运行',
      description: '未检测到 firewalld 处于运行状态，所有端口在网络层面无防护。',
      evidence: truncate(svcItem.stdout.split('\n').filter((l) => l.toLowerCase().includes('firewalld') || l.toLowerCase().includes('iptables')).join('\n') || 'firewalld 未在 running 服务列表中'),
      suggestion: '1) systemctl enable --now firewalld；2) firewall-cmd --list-all 检查当前规则；3) 配置 trusted zone 仅放行业务端口。'
    }
  }
}

/** 全部风险规则 */
const RISK_RULES: RiskRule[] = [
  RULE_ROOT_CURRENT_USER,
  RULE_LOW_MEMORY,
  RULE_DISK_HIGH_USAGE,
  RULE_SAMBA_EXPOSED,
  RULE_NFS_UNAUTH,
  RULE_WEB_NONSTANDARD_PORT,
  RULE_MISSING_CRITICAL_TOOLS,
  RULE_KERNEL_EOL,
  RULE_NESTED_VIRT,
  RULE_FIREWALL_DISABLED
]

// ==================================================================
// 对外 API
// ==================================================================

/**
 * 在 ProfilerResult 上运行全部风险规则
 *
 * @param result 完整的探查结果
 * @returns 风险列表（按风险等级降序）
 */
export function detectRisks(result: { items: ProfilerItem[] }): RiskItem[] {
  const ctx: RuleContext = { items: result.items }
  const risks: RiskItem[] = []

  for (const rule of RISK_RULES) {
    try {
      const risk = rule.detect(ctx)
      if (risk) {
        risks.push(risk)
      }
    } catch {
      // 单条规则异常不影响其他规则
    }
  }

  // 按风险等级降序
  risks.sort((a, b) => RISK_LEVEL_WEIGHT[b.level] - RISK_LEVEL_WEIGHT[a.level])
  return risks
}

/**
 * 风险统计摘要
 */
export function summarizeRisks(risks: RiskItem[]): {
  total: number
  critical: number
  high: number
  medium: number
  low: number
  info: number
} {
  const summary = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const r of risks) {
    summary.total++
    summary[r.level]++
  }
  return summary
}

/** 导出供测试使用 */
export const _internal = {
  RISK_RULES,
  parseKernelMajor,
  parseAvailableMemoryMB,
  findHighUsageMounts,
  isPortListening,
  countMissingCriticalTools
}
