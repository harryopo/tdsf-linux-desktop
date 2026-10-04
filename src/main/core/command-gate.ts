/**
 * 命令风险闸（唯一权威）
 *
 * 所有 SSH 命令执行出口都应经过本模块，而不是各自维护一份正则表。
 * 判定按"命令段"做：以 shell 连接符切段后逐段解析，因此
 * `sudo rm -rf /`、`cd /tmp && rm -rf /`、`bash -c "rm -rf /"` 都能命中。
 */

/** 风险等级：block=禁止执行，high/medium=执行但标注并需审批卡点，low=只读查询，safe=未识别 */
export type CommandRiskLevel = 'block' | 'high' | 'medium' | 'low' | 'safe'

export interface CommandVerdict {
  level: CommandRiskLevel
  reason: string
  /** 命中的命令段（用于日志/UI，已截断） */
  matched: string
}

/** 被闸拦下时抛出的错误类型，便于调用方区分"拦截"与"执行失败" */
export class CommandBlockedError extends Error {
  readonly verdict: CommandVerdict
  constructor(verdict: CommandVerdict) {
    super(`高危命令已拦截：${verdict.reason}`)
    this.name = 'CommandBlockedError'
    this.verdict = verdict
  }
}

/** 受保护的根级目录（rm -rf 目标命中即 block） */
const PROTECTED_TARGETS = new Set([
  '/', '/*', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64',
  '/root', '/sbin', '/srv', '/usr', '/var', '/opt',
])

/** 关机/重启类命令 */
const POWER_COMMANDS = new Set(['shutdown', 'reboot', 'halt', 'poweroff', 'init', 'telinit'])

/** 会把引号里的命令真正执行起来的解释器 */
const SHELL_LAUNCHERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])

/** 以 shell 连接符切段：; && || | 换行 与子 shell 括号 */
function splitSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||[;|\n()])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 去掉 sudo/nohup/time/env 赋值等前缀，取真正的命令名 */
function baseCommand(tokens: string[]): string {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || ['sudo', 'nohup', 'time', 'nice', 'env', 'xargs'].includes(t)) {
      i += 1
      continue
    }
    if (t === '-u' || t === '--user' || t === '-n') {
      i += 2
      continue
    }
    break
  }
  const head = tokens[i] ?? ''
  return head.split('/').pop() ?? ''
}

function tokenize(segment: string): string[] {
  return segment.split(/\s+/).filter(Boolean)
}

/** rm -rf 指向受保护目录 */
function checkRm(tokens: string[], argv0: string): string | null {
  if (argv0 !== 'rm') return null
  const recursive = tokens.some((t) => /^-[a-z]*[rR][a-z]*$/.test(t) || t === '--recursive')
  const force = tokens.some((t) => /^-[a-z]*f[a-z]*$/.test(t) || t === '--force')
  if (!recursive || !force) return null
  const targets = tokens.filter((t) => !t.startsWith('-'))
  return targets.some((t) => PROTECTED_TARGETS.has(t.replace(/\/+$/, '') || '/'))
    ? '递归强制删除根级/系统目录'
    : null
}

/** dd 写块设备、mkfs 格式化、重定向覆写块设备 */
function checkDeviceDestruction(tokens: string[], argv0: string, segment: string): string | null {
  if (argv0 === 'mkfs' || /^mkfs\./.test(argv0) || argv0 === 'mkswap') return '格式化磁盘/分区'
  if (argv0 === 'dd' && tokens.some((t) => /^of=\/dev\//.test(t))) return 'dd 写入块设备'
  if (/>>?\s*\/dev\/(sd|nvme|vd|hd|disk|mapper)/.test(segment)) return '重定向覆写块设备'
  return null
}

/** 关机重启（init 0 / telinit 0 才算，init 5 之类不拦） */
function checkPower(argv0: string, tokens: string[]): string | null {
  if (!POWER_COMMANDS.has(argv0)) return null
  if (argv0 === 'init' || argv0 === 'telinit') {
    return tokens[1] === '0' || tokens[1] === '6' ? '切换运行级别导致关机/重启' : null
  }
  return '关机/重启/停机命令'
}

/** fork 炸弹（容忍任意空白） */
function checkForkBomb(segment: string): string | null {
  return /:\s*\(\s*\)\s*\{?\s*:\s*\|\s*:\s*&\s*\}?\s*;?\s*:/.test(segment) ? 'Fork 炸弹' : null
}

/** chmod 777 / 或 chown -R 指向根级目录 */
function checkPerms(tokens: string[], argv0: string): string | null {
  if (argv0 !== 'chmod' && argv0 !== 'chown') return null
  const targets = tokens.filter((t) => !t.startsWith('-'))
  const pathTarget = targets.find((t) => t.startsWith('/'))
  if (!pathTarget) return null
  const rootish = /^\/(\*?)$/.test(pathTarget) || ['/etc', '/usr', '/var', '/boot', '/root'].includes(pathTarget)
  if (!rootish) return null
  if (argv0 === 'chmod' && tokens.includes('777')) return '将根级目录权限放开为 777'
  if (argv0 === 'chown' && tokens.some((t) => /^-[a-z]*r[a-z]*$/i.test(t))) return '递归改根级目录属主'
  return null
}

/** 只读查询类命令（风险最低，用于 UI 标签分级） */
const READONLY_COMMANDS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'find', 'fd',
  'ls', 'll', 'ps', 'top', 'htop', 'free', 'df', 'du', 'uptime', 'whoami', 'id',
  'hostname', 'uname', 'which', 'whereis', 'stat', 'file', 'wc', 'sort', 'uniq',
  'date', 'env', 'printenv', 'ip', 'ifconfig', 'ss', 'netstat', 'lsof', 'journalctl',
])

/** 不禁止但需要标注/审批的操作 */
function checkSoftRisk(tokens: string[], argv0: string): { level: CommandRiskLevel; reason: string } | null {
  if (argv0 === 'rm') return { level: 'high', reason: '删除文件/目录' }
  if (['userdel', 'groupdel', 'passwd'].includes(argv0)) return { level: 'high', reason: '账户/口令变更' }
  if (['kill', 'killall', 'pkill'].includes(argv0)) return { level: 'high', reason: '终止进程' }
  if (['systemctl', 'service'].includes(argv0) && tokens.some((t) => ['stop', 'disable', 'mask', 'restart'].includes(t))) {
    return { level: 'medium', reason: '停止/重启/禁用系统服务' }
  }
  if (['apt', 'apt-get', 'yum', 'dnf', 'zypper'].includes(argv0) && tokens.some((t) => ['remove', 'purge', 'install', 'update'].includes(t))) {
    return { level: 'medium', reason: '安装/卸载软件包' }
  }
  if (['iptables', 'firewall-cmd', 'ufw'].includes(argv0)) return { level: 'medium', reason: '变更防火墙规则' }
  if (READONLY_COMMANDS.has(argv0)) return { level: 'low', reason: '只读查询命令' }
  return null
}

/**
 * 评估一条命令的风险等级
 *
 * 三条判据并行：fork 炸弹按整条判（切段会把它拆散）、逐段判、
 * 引号内的命令体递归判（`bash -c "rm -rf /"`）。取最坏结果。
 */
export function evaluateCommand(command: string, depth = 0): CommandVerdict {
  const safe: CommandVerdict = { level: 'safe', reason: '未命中风险规则', matched: '' }
  if (!command || !command.trim()) return safe

  const rank: Record<CommandRiskLevel, number> = { safe: 0, low: 1, medium: 2, high: 3, block: 4 }
  let worst: CommandVerdict = safe
  const raise = (v: CommandVerdict): void => {
    if (rank[v.level] > rank[worst.level]) worst = v
  }

  const bomb = checkForkBomb(command)
  if (bomb) return { level: 'block', reason: bomb, matched: command.slice(0, 120) }

  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment)
    const argv0 = baseCommand(tokens)
    const hits: (string | null)[] = [
      checkRm(tokens, argv0),
      checkDeviceDestruction(tokens, argv0, segment),
      checkPower(argv0, tokens),
      checkPerms(tokens, argv0),
    ]
    for (const reason of hits) {
      if (reason) raise({ level: 'block', reason, matched: segment.slice(0, 120) })
    }
    const soft = checkSoftRisk(tokens, argv0)
    if (soft) raise({ level: soft.level, reason: soft.reason, matched: segment.slice(0, 120) })
  }

  // 只对 shell 解释器的 -c 参数体递归判定。
  // 不做全量引号扫描：否则 `grep "shutdown" /var/log` 这类查日志会被误拦。
  if (depth < 2) {
    for (const segment of splitSegments(command)) {
      const tokens = tokenize(segment)
      if (!SHELL_LAUNCHERS.has(baseCommand(tokens))) continue
      if (!tokens.some((t) => t === '-c' || t === '-lc')) continue
      for (const quoted of segment.matchAll(/["']([^"']{4,})["']/g)) {
        raise(evaluateCommand(quoted[1], depth + 1))
      }
    }
  }
  return worst
}

/**
 * 执行前硬闸：block 级一律拒绝，不留"已批准"后门。
 *
 * 依据 CLAUDE.md 红线 3——SSH exec 必须经过高危命令拦截；
 * 终端手输与 AI 工具走同一条路，用户在真实终端里仍可执行。
 *
 * @throws CommandBlockedError
 */
export function assertCommandAllowed(command: string): CommandVerdict {
  const verdict = evaluateCommand(command)
  if (verdict.level === 'block') {
    throw new CommandBlockedError(verdict)
  }
  return verdict
}
