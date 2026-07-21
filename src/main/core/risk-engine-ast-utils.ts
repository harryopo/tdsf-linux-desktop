/**
 * AST 风险评估引擎 - AST 遍历工具函数
 *
 * 从 risk-engine-ast.ts 拆分而来（v0.9.1 P1 警告修复：单文件 ≤ 500 行）。
 * 本文件集中管理 AST 节点遍历与提取逻辑：
 * - extractCommands：从 AST 提取所有命令（command 节点）
 * - extractWord：从 AST 节点提取单词文本（处理 concatenation / 引号拼接）
 * - detectBase64Obfuscation：检测 Base64 混淆模式
 * - detectForkBomb：检测 fork bomb
 *
 * 设计依据：docs/调研-Bash命令解析库选型-危险命令识别.md
 *
 * 覆盖 6 类绕过：
 * 1. 命令拼接：`rm -rf /; malicious`（list 节点遍历所有子命令）
 * 2. 引号拼接：`r""m -rf /`（concatenation 节点拼接命令名）
 * 3. 命令替换：`$(rm -rf /)`（递归检查 command_substitution）
 * 4. 进程替换：`>(rm -rf /)`（递归检查 process_substitution）
 * 5. 变量展开：`cmd="rm"; $cmd -rf /`（检测变量展开后接危险参数）
 * 6. Base64 混淆：`echo "..." | base64 -d | sh`（detectBase64Obfuscation 检测）
 */

import type { Node } from 'web-tree-sitter'

// ============================================================================
// AST 遍历工具函数
// ============================================================================

/**
 * 从 AST 节点中提取所有命令（command 节点）
 *
 * 递归遍历，处理：
 * - list 节点（; && ||）：每个子命令独立评估
 * - pipeline 节点（|）：每个子命令独立评估
 * - command_substitution 节点 $(...)：递归提取内部命令
 * - process_substitution 节点 <(...) >(...)：递归提取内部命令
 * - concatenation 节点：拼接 word 节点形成命令名
 */
export function extractCommands(node: Node): Array<{ name: string; args: string[]; raw: string }> {
  const commands: Array<{ name: string; args: string[]; raw: string }> = []

  function visit(n: Node): void {
    if (!n) return

    switch (n.type) {
      case 'command': {
        // 提取命令名 + 参数
        const nameNode = n.childForFieldName('name')
        if (nameNode) {
          const name = extractWord(nameNode)
          const args: string[] = []
          // Bug 修复：tree-sitter-bash v0.25 的 command 节点没有 'arguments' 字段
          // 参数是直接作为 word/number 等子节点挂在 command 下
          // 遍历所有 named children，跳过 command_name，其余作为 args
          for (let i = 0; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (child && child.type !== 'command_name') {
              args.push(extractWord(child))
            }
          }
          commands.push({ name, args, raw: n.text })
        }
        // Bug 修复：递归遍历所有 named children
        // command_name 可能包含 command_substitution/process_substitution（如 $(rm -rf /)），
        // 内部有嵌套命令需要提取
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) visit(child)
        }
        break
      }
      case 'list':
      case 'pipeline':
      case 'subshell':
      case 'command_substitution':
      case 'process_substitution': {
        // 递归遍历子节点
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) visit(child)
        }
        break
      }
      default: {
        // 其他节点类型：递归遍历子节点
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) visit(child)
        }
      }
    }
  }

  visit(node)
  return commands
}

/**
 * 从 AST 节点提取单词文本（处理 concatenation / 引号拼接）
 *
 * 关键：concatenation 节点会把 `r""m` 拼接为 `rm`，
 * 这样能识别引号拼接绕过技巧。
 */
export function extractWord(node: Node): string {
  if (!node) return ''

  switch (node.type) {
    case 'command_name': {
      // Bug 修复：command_name 是 tree-sitter-bash v0.25 的包装节点，
      // 内部包含 word/concatenation/command_substitution 等。
      // 必须递归提取内部子节点，否则 r""m 会返回 'r""m' 而非 'rm'。
      if (node.namedChildCount === 1) {
        const child = node.namedChild(0)
        return child ? extractWord(child) : node.text
      }
      let result = ''
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) result += extractWord(child)
      }
      return result
    }
    case 'word':
    case 'ansi_c_string':
    case 'number':
      return node.text
    case 'raw_string': {
      // 单引号字符串：'hello' → hello（去掉引号，否则引号拼接 r''m 会变成 r''m 而非 rm）
      const text = node.text
      if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
        return text.slice(1, -1)
      }
      return text
    }
    case 'string': {
      // 双引号字符串："hello" → hello（去掉引号，否则引号拼接 r""m 会变成 r""m 而非 rm）
      const text = node.text
      if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
        return text.slice(1, -1)
      }
      return text
    }
    case 'concatenation': {
      // 拼接所有子节点文本（如 r""m → rm）
      let result = ''
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) result += extractWord(child)
      }
      return result
    }
    case 'simple_expansion':
    case 'expansion': {
      // 变量展开：返回占位符（无法静态求值）
      return '${VAR}'
    }
    case 'command_substitution': {
      // 命令替换 $(...)：返回占位符
      return '$(CMD)'
    }
    default:
      return node.text
  }
}

/**
 * 检测 Base64 混淆模式
 *
 * 模式：echo "..." | base64 -d | sh / bash
 * AST 识别：pipeline 中存在 base64 -d 命令 + 管道到 sh / bash
 */
export function detectBase64Obfuscation(rootNode: Node): { detected: boolean; reason: string } {
  let found = false
  let reason = ''

  function visit(n: Node): void {
    if (found) return
    if (!n) return

    if (n.type === 'pipeline') {
      // 收集 pipeline 中所有命令名
      const cmds: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child && child.type === 'command') {
          const nameNode = child.childForFieldName('name')
          if (nameNode) cmds.push(extractWord(nameNode))
        }
      }
      // 检测：base64 -d + sh/bash
      const hasBase64Decode = cmds.includes('base64')
      const hasShell = cmds.includes('sh') || cmds.includes('bash')
      if (hasBase64Decode && hasShell) {
        found = true
        reason = 'Base64 混淆：base64 -d 管道到 sh/bash，可能执行解码后的危险命令'
        return
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (child) visit(child)
    }
  }

  visit(rootNode)
  return { detected: found, reason }
}

/**
 * 检测 fork bomb（经典 :(){:|:&};: 形式）
 *
 * AST 识别：function_definition 节点 + 函数名为 : + 内部有 pipeline + 后台执行 &
 */
export function detectForkBomb(rootNode: Node): { detected: boolean; reason: string } {
  let found = false
  let reason = ''

  function visit(n: Node): void {
    if (found) return
    if (!n) return

    if (n.type === 'function_definition') {
      const nameNode = n.childForFieldName('name')
      const name = nameNode ? extractWord(nameNode) : ''
      // fork bomb 函数名通常为 : 或 f
      if (name === ':' || name === 'f' || name === 'fork') {
        // 检查函数体是否有 pipeline + 后台执行
        const body = n.childForFieldName('body')
        if (body && body.text.includes('|') && body.text.includes('&')) {
          found = true
          reason = `fork bomb 模式：函数 ${name} 内部有管道 + 后台执行`
          return
        }
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (child) visit(child)
    }
  }

  visit(rootNode)
  return { detected: found, reason }
}

// ============================================================================
// 命令组合风险评估（v0.9.4 批次 1 新增）
// ============================================================================
//
// 用途：
// - 评估多命令组合的整体风险（单条 low，组合后可能 medium/high）
// - 检测信息收集链路（whoami → id → uname → cat /etc/shadow）
// - 检测数据外发链路（cat + grep + mail / curl）
// - 命令数量阈值（≥5 条命令组合，风险升级）
//
// 输入：commands 命令名列表（已从 AST 提取，小写）
// 输出：CommandCombinationRisk（组合风险等级 + 原因 + 是否升级）
// ============================================================================

/**
 * 命令组合风险评估结果
 */
export interface CommandCombinationRisk {
  /** 组合风险等级（可能高于单条命令的最高等级） */
  risk: 'low' | 'medium' | 'high'
  /** 组合风险原因（教学属性：为什么这个组合危险） */
  reasons: string[]
  /** 是否触发风险升级（单条 low 但组合后 medium/high） */
  upgraded: boolean
}

/** 信息收集命令集（识别 reconnaissance 链路） */
const RECON_COMMANDS = new Set<string>([
  'whoami',
  'id',
  'uname',
  'hostname',
  'ifconfig',
  'ip',
  'netstat',
  'ss',
  'ps',
  'env',
  'printenv',
  'last',
  'w',
  'who',
])

/** 敏感文件读取命令集（识别敏感数据访问链路） */
const SENSITIVE_FILE_COMMANDS = new Set<string>([
  'cat',
  'less',
  'more',
  'head',
  'tail',
  'strings',
  'xxd',
  'od',
  'hexdump',
])

/** 数据外发命令集（识别数据外泄链路） */
const EXFIL_COMMANDS = new Set<string>([
  'mail',
  'sendmail',
  'curl',
  'wget',
  'nc',
  'ncat',
  'netcat',
  'scp',
  'rsync',
  'ftp',
  'sftp',
  'telnet',
  'python',
  'python3',
  'perl',
  'ruby',
  'php',
  'node',
])

/** 命令数量阈值：≥5 条命令组合触发风险升级 */
const COMBINATION_COUNT_THRESHOLD = 5

/**
 * 评估多命令组合的风险
 *
 * 评估策略（按优先级）：
 * 1. 数据外发链路：敏感文件读取 + 数据外发命令 → high
 *    示例：cat /etc/passwd + grep root + mail x@y.com
 * 2. 信息收集链路：≥3 条 recon 命令 + 敏感文件读取 → medium
 *    示例：whoami + id + uname -a + cat /etc/shadow
 * 3. 命令数量阈值：≥5 条命令组合 → medium（升级）
 * 4. 其他：维持原风险（不升级）
 *
 * @param commands 命令名列表（已小写化）
 * @returns 组合风险评估结果
 */
export function assessCommandCombination(commands: string[]): CommandCombinationRisk {
  const reasons: string[] = []
  let risk: 'low' | 'medium' | 'high' = 'low'
  let upgraded = false

  if (commands.length === 0) {
    return { risk, reasons, upgraded }
  }

  // 去重计数（同一命令多次出现仍计为一次）
  const uniqueCommands = new Set(commands)

  // 1. 数据外发链路检测：敏感文件读取 + 数据外发
  const hasSensitiveRead = Array.from(uniqueCommands).some((c) =>
    SENSITIVE_FILE_COMMANDS.has(c)
  )
  const hasExfil = Array.from(uniqueCommands).some((c) => EXFIL_COMMANDS.has(c))
  if (hasSensitiveRead && hasExfil) {
    risk = 'high'
    upgraded = true
    reasons.push(
      '命令组合检测到数据外发链路：敏感文件读取 + 数据外发命令（mail/curl/wget/nc 等），可能泄露系统数据'
    )
  }

  // 2. 信息收集链路检测：≥3 条 recon 命令 + 敏感文件读取
  const reconCount = Array.from(uniqueCommands).filter((c) =>
    RECON_COMMANDS.has(c)
  ).length
  if (reconCount >= 3 && hasSensitiveRead && risk !== 'high') {
    risk = 'medium'
    upgraded = true
    reasons.push(
      `命令组合检测到信息收集链路：${reconCount} 条 recon 命令（whoami/id/uname 等）+ 敏感文件读取，可能为攻击前期的侦察行为`
    )
  }

  // 3. 命令数量阈值：≥5 条命令组合 → 至少 medium
  if (uniqueCommands.size >= COMBINATION_COUNT_THRESHOLD && risk === 'low') {
    risk = 'medium'
    upgraded = true
    reasons.push(
      `命令组合数量达 ${uniqueCommands.size} 条（阈值 ${COMBINATION_COUNT_THRESHOLD}），多命令组合可能隐藏风险，建议人工审核`
    )
  }

  // 4. 单独的 recon 链路（无敏感文件读取）：≥4 条 recon 命令 → medium
  if (reconCount >= 4 && risk === 'low') {
    risk = 'medium'
    upgraded = true
    reasons.push(
      `命令组合检测到侦察行为：${reconCount} 条 recon 命令（whoami/id/uname/ifconfig 等），可能为攻击者前期信息收集`
    )
  }

  return { risk, reasons, upgraded }
}
