/**
 * 4 层风险控制引擎
 *
 * L1 语法检查：Shell 语法基础验证（未闭合引号、管道、括号等）
 * L2 风险评估：5 级风险分级（SAFE/LOW/MEDIUM/HIGH/CRITICAL）
 * L3 人工确认：HIGH 及以上需要人工确认
 * L4 审计日志：记录所有命令及风险评估结果
 *
 * 风险分级标准：
 *   - CRITICAL：rm -rf /, mkfs, dd if=, shutdown, reboot, fork 炸弹 → 阻止
 *   - HIGH：rm -rf, chmod 777, kill -9, iptables -F, userdel → 需确认
 *   - MEDIUM：systemctl stop, service stop, cp/mv 覆盖, sudo → 需确认
 *   - LOW：cat, ls, ps, df, free, top（只读命令） → 提示
 *   - SAFE：echo, pwd, whoami, date → 自动执行
 */

import type { RiskAssessment, RiskLevel } from '../../shared/models'

// ────────── 风险模式定义 ──────────

interface RiskPattern {
  /** 正则表达式 */
  pattern: RegExp
  /** 风险描述 */
  description: string
}

/**
 * 检测命令是否为 rm 同时包含递归（-r/--recursive）和强制（-f/--force）标志
 *
 * 覆盖短标志组合（-rf, -fr, -r -f 等）和长标志组合（--recursive --force 等），
 * 以及混合形式（-r --force, --recursive -f 等）。
 *
 * @param cmd 命令字符串
 * @param requireRootTarget 为 true 时还要求目标路径为 /（根目录）
 */
function isRmRecursiveForce(cmd: string, requireRootTarget = false): boolean {
  if (!/\brm\s+/.test(cmd)) return false

  // 检查递归标志：-r/-R 或 --recursive
  const hasRecursive = /(?:^|\s)-(?:\w*r\w*|R)(?:\s|$)/.test(cmd) || /\s--recursive\b/.test(cmd)
  // 检查强制标志：-f 或 --force
  const hasForce = /(?:^|\s)-\w*f\w*(?:\s|$)/.test(cmd) || /\s--force\b/.test(cmd)

  if (!hasRecursive || !hasForce) return false

  if (requireRootTarget) {
    // 目标为 /（后面跟空格、行尾、或 *）
    return /\s\/(\s|$|\*)/.test(cmd)
  }
  return true
}

/** CRITICAL 黑名单（直接阻止） */
const CRITICAL_PATTERNS: RiskPattern[] = [
  { pattern: { test: (cmd: string) => isRmRecursiveForce(cmd, true) } as RegExp, description: '递归强制删除根目录' },
  { pattern: /\bmkfs\b/, description: '格式化文件系统' },
  { pattern: /\bdd\s+.*if=.*of=\/dev\//, description: '直接写入块设备' },
  { pattern: /\bshutdown\b/, description: '关机命令' },
  { pattern: /\breboot\b/, description: '重启命令' },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/, description: 'Fork 炸弹' },
  { pattern: /\bchmod\s+(-\w*R\w*\s+)?777\s+\/(\s|$)/, description: '递归修改根目录权限为 777' },
  { pattern: /\bwipefs\b/, description: '擦除文件系统签名' },
  { pattern: /\bhalt\b/, description: '停机命令' },
  { pattern: /\bpoweroff\b/, description: '关机命令' }
]

/** HIGH 风险（强制确认） */
const HIGH_PATTERNS: RiskPattern[] = [
  { pattern: { test: (cmd: string) => isRmRecursiveForce(cmd, false) } as RegExp, description: '递归强制删除' },
  { pattern: /\bchmod\s+(-\w*R\w*\s+)?777\b/, description: '设置 777 权限' },
  { pattern: /\bkill\s+-9\b/, description: '强制杀死进程' },
  { pattern: /\biptables\s+.*-F\b/, description: '清空防火墙规则' },
  { pattern: /\buserdel\b/, description: '删除用户' },
  { pattern: /\bgroupdel\b/, description: '删除用户组' },
  { pattern: /\bpasswd\b/, description: '修改用户密码' },
  { pattern: /\bvisudo\b/, description: '修改 sudoers 配置' }
]

/** MEDIUM 风险（需确认） */
const MEDIUM_PATTERNS: RiskPattern[] = [
  { pattern: /\bsystemctl\s+stop\b/, description: '停止系统服务' },
  { pattern: /\bservice\s+\S+\s+stop\b/, description: '停止服务' },
  { pattern: /\bsystemctl\s+restart\b/, description: '重启系统服务' },
  { pattern: /\bcp\s+.*-\w*f\w*/, description: '强制复制覆盖文件' },
  { pattern: /\bmv\s+\S+\s+\S+/, description: '移动/重命名文件（可能覆盖）' },
  { pattern: /\bsudo\b/, description: '使用 sudo 提权' },
  { pattern: /[|&]?\s*>\s*[^>&|]/, description: '输出重定向（覆写文件）' },
  { pattern: /\bsed\s+.*-i\b/, description: 'sed 原地编辑文件' },
  { pattern: /\b(apt|apt-get|yum|dnf)\s+.*(install|remove|purge)\b/, description: '包管理操作' },
  { pattern: /\bmount\b/, description: '挂载文件系统' },
  { pattern: /\bumount\b/, description: '卸载文件系统' },
  { pattern: /\bsysctl\s+-w\b/, description: '修改内核参数' }
]

/** SAFE 白名单命令（自动执行） */
const SAFE_COMMANDS = ['echo', 'pwd', 'whoami', 'date', 'true', 'false', 'clear']

/** LOW 风险命令（只读查询） */
const LOW_COMMANDS = [
  'cat', 'ls', 'ps', 'df', 'free', 'top', 'head', 'tail', 'grep', 'find',
  'ss', 'netstat', 'uptime', 'uname', 'hostname', 'journalctl', 'dmesg',
  'stat', 'wc', 'less', 'more', 'which', 'whereis', 'file', 'diff', 'env',
  'id', 'groups', 'last', 'w', 'nproc', 'lscpu', 'lsmem', 'lsblk', 'du'
]

// ────────── 审计日志 ──────────

/** 审计日志条目 */
export interface AuditEntry {
  /** 执行的命令 */
  command: string
  /** 风险评估结果 */
  assessment: RiskAssessment
  /** 记录时间戳 */
  timestamp: number
}

/** 审计日志存储（模块级单例） */
const auditLog: AuditEntry[] = []

// ────────── L1: 语法检查 ──────────

/**
 * 检查 Shell 命令语法基础正确性
 * 检测未闭合引号、管道符、括号匹配等常见语法错误
 * @param command - 待检查的命令字符串
 * @returns 检查结果，valid 为 true 表示语法通过
 */
export function checkShellSyntax(command: string): { valid: boolean; error?: string } {
  const cmd = command.trim()
  if (!cmd) return { valid: false, error: '命令为空' }

  const quoteError = checkQuotes(cmd)
  if (quoteError) return { valid: false, error: quoteError }

  const pipeError = checkPipes(cmd)
  if (pipeError) return { valid: false, error: pipeError }

  const bracketError = checkBrackets(cmd)
  if (bracketError) return { valid: false, error: bracketError }

  return { valid: true }
}

/**
 * 检查引号是否闭合（支持转义字符）
 * @param cmd - 命令字符串
 * @returns 错误描述，null 表示通过
 */
function checkQuotes(cmd: string): string | null {
  let single = 0
  let double = 0
  let escaped = false
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === "'" && double % 2 === 0) single++
    else if (ch === '"' && single % 2 === 0) double++
  }
  if (single % 2 !== 0) return '未闭合的单引号'
  if (double % 2 !== 0) return '未闭合的双引号'
  return null
}

/**
 * 检查管道符号使用是否正确
 * @param cmd - 命令字符串
 * @returns 错误描述，null 表示通过
 */
function checkPipes(cmd: string): string | null {
  // 单独的 | 开头或结尾（排除 || 逻辑或）
  if (/^\|[^|]/.test(cmd)) return '命令以管道符开头'
  if (/[^|]\|$/.test(cmd)) return '命令以管道符结尾'
  return null
}

/**
 * 检查括号是否匹配（忽略引号内的括号）
 * @param cmd - 命令字符串
 * @returns 错误描述，null 表示通过
 */
function checkBrackets(cmd: string): string | null {
  const stack: string[] = []
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    if (inSingle || inDouble) continue
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch)
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length === 0 || stack[stack.length - 1] !== pairs[ch]) {
        return '括号不匹配'
      }
      stack.pop()
    }
  }
  if (stack.length > 0) return '未闭合的括号'
  return null
}

// ────────── L2: 风险评估 ──────────

/**
 * 评估命令的风险等级
 * 检查顺序：CRITICAL → HIGH → MEDIUM → SAFE → LOW → 默认 LOW
 * @param command - 待评估的命令
 * @returns 风险评估结果
 */
export function assessRisk(command: string): RiskAssessment {
  const cmd = command.trim()
  if (!cmd) {
    return createAssessment('SAFE', 0, [], '空命令')
  }

  // 1) CRITICAL 黑名单 — 直接阻止
  const criticalHits = matchPatterns(cmd, CRITICAL_PATTERNS)
  if (criticalHits.length > 0) {
    return createAssessment('CRITICAL', 100, criticalHits, `危险操作：${criticalHits.join('; ')}`)
  }

  // 2) HIGH 风险 — 强制确认
  const highHits = matchPatterns(cmd, HIGH_PATTERNS)
  if (highHits.length > 0) {
    return createAssessment('HIGH', 75, highHits, `高风险操作：${highHits.join('; ')}`)
  }

  // 3) MEDIUM 风险 — 需确认
  const mediumHits = matchPatterns(cmd, MEDIUM_PATTERNS)
  if (mediumHits.length > 0) {
    return createAssessment('MEDIUM', 50, mediumHits, `中等风险操作：${mediumHits.join('; ')}`)
  }

  // 4) SAFE 白名单 — 自动执行
  if (isSafeCommand(cmd)) {
    return createAssessment('SAFE', 10, [], '安全命令，自动执行')
  }

  // 5) LOW 白名单 — 只读查询
  if (isLowRiskCommand(cmd)) {
    return createAssessment('LOW', 30, [], '只读查询命令')
  }

  // 6) 默认 — 未知命令按低风险处理
  return createAssessment('LOW', 35, [], '未匹配已知风险模式，按低风险处理')
}

/**
 * 匹配命令与风险模式列表，返回命中的描述
 * @param cmd - 命令字符串
 * @param patterns - 风险模式列表
 * @returns 命中的风险描述列表
 */
function matchPatterns(cmd: string, patterns: RiskPattern[]): string[] {
  const hits: string[] = []
  for (const { pattern, description } of patterns) {
    if (pattern.test(cmd)) hits.push(description)
  }
  return hits
}

/**
 * 判断是否为 SAFE 命令
 * @param cmd - 命令字符串（已去除环境变量前缀）
 */
function isSafeCommand(cmd: string): boolean {
  const firstWord = getFirstWord(cmd)
  return SAFE_COMMANDS.includes(firstWord)
}

/**
 * 判断是否为 LOW 风险命令（只读查询）
 * @param cmd - 命令字符串
 */
function isLowRiskCommand(cmd: string): boolean {
  const firstWord = getFirstWord(cmd)
  if (LOW_COMMANDS.includes(firstWord)) return true
  // systemctl status 是只读的
  if (firstWord === 'systemctl' && /\bstatus\b/.test(cmd)) return true
  return false
}

/**
 * 获取命令的第一个词（工具名），自动去除环境变量前缀
 * @param cmd - 命令字符串
 * @returns 第一个词
 */
function getFirstWord(cmd: string): string {
  const stripped = stripEnvPrefix(cmd)
  return stripped.split(/\s+/)[0] || ''
}

/**
 * 移除命令前的环境变量赋值部分
 * 例如 "LC_ALL=C LANG=en_US ls -la" → "ls -la"
 * @param cmd - 命令字符串
 * @returns 去除环境变量后的命令
 */
function stripEnvPrefix(cmd: string): string {
  const parts = cmd.split(/\s+/)
  let idx = 0
  for (const part of parts) {
    if (part.includes('=') && !part.startsWith('=')) {
      idx++
    } else {
      break
    }
  }
  return idx < parts.length ? parts.slice(idx).join(' ') : cmd
}

/**
 * 创建风险评估结果对象
 * @param level - 风险等级
 * @param score - 风险评分
 * @param matchedRules - 命中的规则列表
 * @param description - 风险描述
 * @returns 风险评估结果
 */
function createAssessment(
  level: RiskLevel,
  score: number,
  matchedRules: string[],
  description: string
): RiskAssessment {
  return {
    level,
    score,
    matchedRules,
    description,
    requireConfirmation: requiresConfirmation(level),
    blocked: shouldBlock(level)
  }
}

// ────────── L3: 人工确认 ──────────

/**
 * 判断指定风险等级是否需要人工确认
 * HIGH 及以上（HIGH、CRITICAL）需要确认
 * @param level - 风险等级
 * @returns true 表示需要人工确认
 */
export function requiresConfirmation(level: RiskLevel): boolean {
  return level === 'HIGH' || level === 'CRITICAL'
}

/**
 * 判断指定风险等级是否应该阻止执行
 * CRITICAL 级别直接阻止
 * @param level - 风险等级
 * @returns true 表示应该阻止
 */
export function shouldBlock(level: RiskLevel): boolean {
  return level === 'CRITICAL'
}

// ────────── L4: 审计日志 ──────────

/**
 * 将命令及风险评估记录到审计日志
 * @param command - 执行的命令
 * @param assessment - 风险评估结果
 */
export function logToAudit(command: string, assessment: RiskAssessment): void {
  auditLog.push({ command, assessment, timestamp: Date.now() })
}

/**
 * 获取审计日志副本
 * @returns 审计日志条目列表
 */
export function getAuditLog(): AuditEntry[] {
  return [...auditLog]
}

/**
 * 清空审计日志（主要用于测试）
 */
export function clearAuditLog(): void {
  auditLog.length = 0
}
