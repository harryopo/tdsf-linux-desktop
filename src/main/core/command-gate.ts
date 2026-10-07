/**
 * 命令风险闸（唯一权威）
 *
 * 所有 SSH 命令执行出口都应经过本模块，而不是各自维护一份正则表。
 * 判定按"命令段"做：以 shell 连接符切段后逐段解析，因此
 * `sudo rm -rf /`、`cd /tmp && rm -rf /`、`bash -c "rm -rf /"` 都能命中。
 *
 * 判据分两层（D4：规则数据化）：
 *   - 数据层 command-rules.json：命令名单、级别、要不要确认/审计/是否不可逆。
 *     加一条命令或调级别改数据文件，不动代码。
 *   - 代码层（本文件）：靠参数结构和正则才能判出来的拦截 ——
 *     fork 炸弹、rm -rf 根级目录、dd 写块设备、重定向覆写磁盘、根级 chmod/chown。
 *     这几条写成数据只会让人误以为"级别可以调低"，所以留在代码里，
 *     并由 denyBaseline.blockDetectors 与 BLOCK_DETECTOR_IDS 对账钉住。
 *
 * 不变量（不许放宽）：工具入参永不携带审批字段。级别只用于 UI 标注与卡点，
 * block 级在 assertCommandAllowed() 里无条件拒绝，不接受"已批准"绕过。
 */

import rulesJson from './command-rules.json'

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

/** 数据文件里的一条命令规则 */
interface ArgvRule {
  id: string
  /** 命令名数组；写成 '@xxx' 表示引用数据文件同级的名单 */
  commands: string[] | string
  /** null = 只看 argv0；数组 = 参数里还要命中其中之一 */
  subcommands: string[] | null
  level: CommandRiskLevel
  reason: string
  requiresConfirm: boolean
  audit: boolean
  irreversible: boolean
}

interface CommandRules {
  version: number
  protectedTargets: string[]
  powerCommands: string[]
  shellLaunchers: string[]
  readonlyCommands: string[]
  prefixSkips: { commands: string[]; valueFlags: string[] }
  argvRules: ArgvRule[]
  denyBaseline: { mustNotBeBelow: Record<string, CommandRiskLevel>; blockDetectors: string[] }
}

const RULES = rulesJson as unknown as CommandRules

/**
 * 代码实现的结构性拦截器 id
 *
 * 必须与 RULES.denyBaseline.blockDetectors 一一对应，
 * 由 tests/unit/command-gate-rules.test.ts 对账。
 */
export const BLOCK_DETECTOR_IDS: readonly string[] = [
  'forkBomb',
  'rmRfProtectedTarget',
  'deviceDestruction',
  'powerOff',
  'rootPermissionOpen',
]

const LEVEL_RANK: Record<CommandRiskLevel, number> = { safe: 0, low: 1, medium: 2, high: 3, block: 4 }

/** 数据文件里的命名名单引用（'@readonlyCommands' → RULES.readonlyCommands） */
function resolveCommands(commands: string[] | string): string[] {
  if (Array.isArray(commands)) return commands
  if (commands.startsWith('@')) {
    const key = commands.slice(1) as keyof CommandRules
    const target = RULES[key]
    if (!Array.isArray(target)) {
      throw new Error(`command-rules.json: 规则引用了不存在的名单 ${commands}`)
    }
    return target as string[]
  }
  throw new Error(`command-rules.json: commands 字段形状不认识 ${commands}`)
}

/** argv0 → 规则列表（保持数据文件里的顺序，先命中先用） */
const RULES_BY_ARGV0: Map<string, ArgvRule[]> = (() => {
  const map = new Map<string, ArgvRule[]>()
  for (const rule of RULES.argvRules) {
    for (const cmd of resolveCommands(rule.commands)) {
      const list = map.get(cmd) ?? []
      list.push(rule)
      map.set(cmd, list)
    }
  }
  return map
})()

/**
 * 加载时就检查"数据有没有把底线调低"
 *
 * 闸宁可不启动也不要一个被调松的闸：这里抛错会让主进程起不来，
 * 而不是等到漏放一条 rm -rf 才发现。
 */
function assertDenyBaseline(): void {
  for (const [cmd, minLevel] of Object.entries(RULES.denyBaseline.mustNotBeBelow)) {
    const matched = (RULES_BY_ARGV0.get(cmd) ?? []).filter((r) => r.subcommands === null)
    const worst = matched.reduce<CommandRiskLevel>(
      (acc, r) => (LEVEL_RANK[r.level] > LEVEL_RANK[acc] ? r.level : acc),
      'safe'
    )
    if (LEVEL_RANK[worst] < LEVEL_RANK[minLevel]) {
      throw new Error(
        `command-rules.json: ${cmd} 被判成 ${worst}，低于底线要求的 ${minLevel}，拒绝加载`
      )
    }
  }
}
assertDenyBaseline()

/** 受保护的根级目录（rm -rf 目标命中即 block） */
const PROTECTED_TARGETS = new Set(RULES.protectedTargets)

/** 关机/重启类命令 */
const POWER_COMMANDS = new Set(RULES.powerCommands)

/** 会把引号里的命令真正执行起来的解释器 */
const SHELL_LAUNCHERS = new Set(RULES.shellLaunchers)

/** 以 shell 连接符切段：; && || | 换行 与子 shell 括号 */
function splitSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||[;|\n()])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 去掉 sudo/nohup/time/env 赋值等前缀，取真正的命令名 */
function baseCommand(tokens: string[]): string {
  const wrappers = new Set(RULES.prefixSkips.commands)
  const valueFlags = new Set(RULES.prefixSkips.valueFlags)
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || wrappers.has(t)) {
      i += 1
      continue
    }
    if (valueFlags.has(t)) {
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

/** rm -rf 指向受保护目录（blockDetectors: rmRfProtectedTarget） */
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

/** dd 写块设备、mkfs 格式化、重定向覆写块设备（blockDetectors: deviceDestruction） */
function checkDeviceDestruction(tokens: string[], argv0: string, segment: string): string | null {
  if (argv0 === 'mkfs' || /^mkfs\./.test(argv0) || argv0 === 'mkswap') return '格式化磁盘/分区'
  if (argv0 === 'dd' && tokens.some((t) => /^of=\/dev\//.test(t))) return 'dd 写入块设备'
  if (/>>?\s*\/dev\/(sd|nvme|vd|hd|disk|mapper)/.test(segment)) return '重定向覆写块设备'
  return null
}

/** 关机重启（blockDetectors: powerOff；init 0 / telinit 0 才算，init 5 之类不拦） */
function checkPower(argv0: string, tokens: string[]): string | null {
  if (!POWER_COMMANDS.has(argv0)) return null
  if (argv0 === 'init' || argv0 === 'telinit') {
    return tokens[1] === '0' || tokens[1] === '6' ? '切换运行级别导致关机/重启' : null
  }
  return '关机/重启/停机命令'
}

/** fork 炸弹（blockDetectors: forkBomb；容忍任意空白） */
function checkForkBomb(segment: string): string | null {
  return /:\s*\(\s*\)\s*\{?\s*:\s*\|\s*:\s*&\s*\}?\s*;?\s*:/.test(segment) ? 'Fork 炸弹' : null
}

/** chmod 777 / 或 chown -R 指向根级目录（blockDetectors: rootPermissionOpen） */
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

/** 不禁止但需要标注/审批的操作 —— 纯查表 */
function checkSoftRisk(
  tokens: string[],
  argv0: string
): { level: CommandRiskLevel; reason: string; ruleId: string } | null {
  for (const rule of RULES_BY_ARGV0.get(argv0) ?? []) {
    if (rule.subcommands && !rule.subcommands.some((sub) => tokens.includes(sub))) continue
    return { level: rule.level, reason: rule.reason, ruleId: rule.id }
  }
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

  let worst: CommandVerdict = safe
  const raise = (v: CommandVerdict): void => {
    if (LEVEL_RANK[v.level] > LEVEL_RANK[worst.level]) worst = v
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

/** 导出一份数据快照，供 UI/审计侧读级别与确认要求（不含判定逻辑） */
export const COMMAND_RULES_SNAPSHOT = {
  version: RULES.version,
  blockDetectors: RULES.denyBaseline.blockDetectors,
  rules: RULES.argvRules.map((r) => ({
    id: r.id,
    // 命令名给解析后的真实名单：数据文件里 '@readonlyCommands' 这种引用直接显示给用户看不懂
    commands: resolveCommands(r.commands),
    subcommands: r.subcommands,
    level: r.level,
    reason: r.reason,
    requiresConfirm: r.requiresConfirm,
    audit: r.audit,
    irreversible: r.irreversible,
  })),
} as const
