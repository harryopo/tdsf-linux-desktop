/**
 * AST 风险评估引擎（基于 tree-sitter-bash）- 主入口
 *
 * 替代 risk-engine.ts 的正则方案，使用 AST 解析覆盖 6 类绕过：
 * 1. 命令拼接：`rm -rf /; malicious`（list 节点遍历所有子命令）
 * 2. 引号拼接：`r""m -rf /`（concatenation 节点拼接命令名）
 * 3. 命令替换：`$(rm -rf /)`（递归检查 command_substitution）
 * 4. 进程替换：`>(rm -rf /)`（递归检查 process_substitution）
 * 5. 变量展开：`cmd="rm"; $cmd -rf /`（检测变量展开后接危险参数）
 * 6. Base64 混淆：`echo "..." | base64 -d | sh`（检测 base64 管道到 sh）
 *
 * 调研依据：docs/调研-Bash命令解析库选型-危险命令识别.md
 * 对标方案：Claude Code 的 AST + 正则 + ML 三层防御（本模块实现 AST + 正则两层）
 *
 * Hard Constraints 对齐：
 * - HC-6 沙箱命令始终审批：AST 解析准确识别高危命令
 * - 质量绝对优先：不降级为纯正则，引入 tree-sitter-bash 依赖
 *
 * 方案书依据：v0.9 §8（沙箱集成）+ 调研文档 §6（Bash 危险命令识别）
 *
 * v0.9.1 P1 警告修复（单文件 ≤ 500 行）：
 * 本文件作为 AST 风险评估引擎的主入口，从原 690 行拆分为 3 个文件：
 * - risk-engine-rules.ts：类型定义 + 高/中危命令规则（~280 行）
 * - risk-engine-ast-utils.ts：AST 遍历工具函数（~220 行）
 * - risk-engine-ast.ts（本文件）：Parser 单例 + 主评估函数（~190 行）
 *
 * v0.9.4 批次 1 新增：
 * - getParser / assessWithAst 失败时输出明确降级 warn 日志
 * - assessWithAst 返回值填充 approvalReason（教学属性的结构化审批理由）
 * - assessWithAst 调用 assessCommandCombination 合并多命令组合风险
 *
 * 向后兼容：
 * - assessWithAst / resetAstParser 仍从本文件导出
 * - 类型 RiskAssessmentResult / CommandRiskLevel 通过 re-export 保持原导出路径
 * - 调用方（sandbox.ts / 测试文件）无需修改 import 路径
 */

import { Parser, Language } from 'web-tree-sitter'
import * as path from 'node:path'
import { logger } from '../services/log/logger'

// 规则与类型（from risk-engine-rules）
import {
  HIGH_RISK_COMMANDS,
  HIGH_RISK_PATTERNS,
  MEDIUM_RISK_COMMANDS,
  MEDIUM_RISK_PATTERNS,
} from './risk-engine-rules'
import type { CommandRiskLevel, RiskAssessmentResult, ApprovalReason } from './risk-engine-rules'

// 只读命令白名单 + 注入防御模式（from risk-engine-readonly，v0.9.4 新增）
import { READONLY_BASH_COMMANDS, detectInjectionPatterns } from './risk-engine-readonly'

// AST 工具函数（from risk-engine-ast-utils）
import {
  extractCommands,
  extractWord,
  detectBase64Obfuscation,
  detectForkBomb,
  assessCommandCombination,
} from './risk-engine-ast-utils'

// 类型 re-export（保持向后兼容：测试文件 / sandbox.ts 仍从本文件导入类型）
export type { CommandRiskLevel, RiskAssessmentResult, ApprovalReason } from './risk-engine-rules'

// ============================================================================
// Parser 单例（懒加载）
// ============================================================================

let parserInstance: Parser | null = null
let languageLoaded = false
let initError: Error | null = null

/** 降级日志统一前缀（v0.9.4：明确日志输出） */
const LOG_TAG = 'RISK.AST'
const FALLBACK_LOG_PREFIX = '[risk-engine-ast]'

/**
 * 获取 tree-sitter Parser 单例（懒加载 WASM）
 *
 * 加载策略：
 * 1. 开发环境：从 node_modules/tree-sitter-bash/tree-sitter-bash.wasm 加载
 * 2. 生产环境：从 process.resourcesPath/tree-sitter-bash.wasm 加载
 * 3. 加载失败：抛出明确错误，调用方降级到正则方案
 *
 * v0.9.4 改造：WASM 加载失败时输出明确的 warn 日志（包含失败原因 + 降级到正则方案）
 */
async function getParser(): Promise<Parser | null> {
  if (initError) return null
  if (parserInstance && languageLoaded) return parserInstance

  try {
    await Parser.init()
    const parser = new Parser()

    // 解析 WASM 文件路径
    let wasmPath: string
    if (process.env.NODE_ENV === 'production' && process.resourcesPath) {
      // 生产环境：electron-builder 把 wasm 文件打包到 resources/
      wasmPath = path.join(process.resourcesPath, 'tree-sitter-bash.wasm')
    } else {
      // 开发环境：从 node_modules 加载
      // __dirname 在编译后为 out/main/core，需要回退到项目根 node_modules
      wasmPath = require.resolve('tree-sitter-bash/tree-sitter-bash.wasm')
    }

    const bashLanguage = await Language.load(wasmPath)
    parser.setLanguage(bashLanguage)

    parserInstance = parser
    languageLoaded = true
    logger.info(LOG_TAG, 'tree-sitter-bash Parser 初始化完成', { wasmPath })
    return parser
  } catch (err) {
    initError = err as Error
    // v0.9.4：明确降级日志（包含失败原因 + 降级到正则方案）
    const errorMsg = (err as Error).message
    logger.warn(
      LOG_TAG,
      `${FALLBACK_LOG_PREFIX} WASM load failed: ${errorMsg}, fallback to regex`,
      { error: errorMsg, phase: 'parser-init' }
    )
    return null
  }
}

// ============================================================================
// 审批理由构建（v0.9.4 新增）
// ============================================================================
//
// 根据 risk + reasons + 命令上下文构建结构化 approvalReason（教学属性）
// 帮助 UI 在审批弹窗中展示「为什么这条命令危险」+「推荐操作」
// ============================================================================

/**
 * 根据 reasons 文本提取命令作用简述
 */
function inferActionFromReasons(reasons: string[]): string {
  if (reasons.length === 0) return '只读命令'
  // 取第一条原因作为主作用描述（最严重的原因排在前）
  const first = reasons[0]
  // 提取「：」前的关键字
  const colonIdx = first.indexOf('：')
  if (colonIdx > 0) return first.slice(0, colonIdx)
  return first.length > 40 ? first.slice(0, 40) + '…' : first
}

/**
 * 根据 risk + reasons 构建详细解释（教学属性）
 */
function buildExplanation(risk: CommandRiskLevel, reasons: string[], commandCount: number): string {
  if (risk === 'high') {
    const parts: string[] = []
    if (reasons.some((r) => r.includes('rm -rf'))) {
      parts.push('rm -rf 会递归强制删除文件，无法恢复，可能擦除整个文件系统。')
    }
    if (reasons.some((r) => r.includes('chmod 777'))) {
      parts.push('chmod 777 把文件权限开放给所有用户，破坏最小权限原则，可能被攻击者利用。')
    }
    if (reasons.some((r) => r.includes('mkfs'))) {
      parts.push('mkfs 会格式化整个文件系统，所有数据将永久丢失。')
    }
    if (reasons.some((r) => r.includes('dd 写入'))) {
      parts.push('dd 直接写入块设备会绕过文件系统，可能破坏分区表或覆盖整个磁盘。')
    }
    if (reasons.some((r) => r.includes('iptables'))) {
      parts.push('iptables -F/-X 会清空防火墙规则，导致服务器暴露在网络攻击下。')
    }
    if (reasons.some((r) => r.includes('killall'))) {
      parts.push('killall 会按名称批量终止进程，可能误杀关键服务。')
    }
    if (reasons.some((r) => r.toLowerCase().includes('fork bomb'))) {
      parts.push('fork bomb 会以指数级速度创建子进程，迅速耗尽系统资源导致拒绝服务。')
    }
    if (reasons.some((r) => r.includes('Base64'))) {
      parts.push('Base64 混淆是一种绕过静态检测的技巧，攻击者把恶意命令编码后再解码执行。')
    }
    if (reasons.some((r) => r.includes('高危命令'))) {
      parts.push('该命令属于系统级高危操作，执行后可能导致系统不可用或数据丢失。')
    }
    if (reasons.some((r) => r.includes('数据外发链路'))) {
      parts.push('命令组合形成数据外发链路，可能将系统敏感数据（如 /etc/passwd）发送到外部。')
    }
    if (parts.length === 0) {
      parts.push('该命令具有高危特征，建议在审批前仔细确认执行上下文。')
    }
    if (commandCount > 1) {
      parts.push(`本命令包含 ${commandCount} 个子命令，需整体评估。`)
    }
    return parts.join(' ')
  }

  if (risk === 'medium') {
    const parts: string[] = []
    if (reasons.some((r) => r.includes('包管理操作'))) {
      parts.push('包管理操作会修改系统软件，可能引入未审计的依赖或破坏系统稳定性。')
    }
    if (reasons.some((r) => r.includes('服务管理'))) {
      parts.push('服务管理操作会改变运行中的服务状态，可能影响业务可用性。')
    }
    if (reasons.some((r) => r.includes('用户管理') || r.includes('用户组管理'))) {
      parts.push('用户/用户组管理会改变系统访问权限，可能被用于提权或留后门。')
    }
    if (reasons.some((r) => r.includes('sudo 提权'))) {
      parts.push('sudo 提权命令将以 root 身份执行，建议确认命令来源可信。')
    }
    if (reasons.some((r) => r.includes('密码修改'))) {
      parts.push('密码修改会改变账户凭据，可能影响其他服务（如 SSH 登录）。')
    }
    if (reasons.some((r) => r.includes('定时任务'))) {
      parts.push('crontab 修改会添加/删除定时任务，可能被攻击者用于持久化。')
    }
    if (reasons.some((r) => r.includes('信息收集链路') || r.includes('侦察行为'))) {
      parts.push('多命令组合呈现信息收集链路特征，可能为攻击者前期的侦察行为。')
    }
    if (reasons.some((r) => r.includes('命令组合数量'))) {
      parts.push('多命令组合可能隐藏风险，建议人工审核整体意图。')
    }
    if (reasons.some((r) => r.includes('中危命令'))) {
      parts.push('该命令属于中危操作，需要管理员确认。')
    }
    if (parts.length === 0) {
      parts.push('该命令具有中危特征，建议管理员审批后再执行。')
    }
    if (commandCount > 1) {
      parts.push(`本命令包含 ${commandCount} 个子命令，需整体评估。`)
    }
    return parts.join(' ')
  }

  // low 风险（可选填充，用于教学说明）
  if (commandCount > 1) {
    return `本命令包含 ${commandCount} 个子命令，但均为只读操作，可安全执行。`
  }
  return '该命令为只读操作，不会修改系统状态，可安全执行。'
}

/**
 * 构建 approvalReason（v0.9.4 教学属性结构化审批理由）
 */
function buildApprovalReason(
  risk: CommandRiskLevel,
  reasons: string[],
  commandNames: string[]
): ApprovalReason {
  const action = inferActionFromReasons(reasons)
  const explanation = buildExplanation(risk, reasons, commandNames.length)
  // 推荐操作策略：high → deny / medium → require-admin / low → approve
  const recommendation: ApprovalReason['recommendation'] =
    risk === 'high' ? 'deny' : risk === 'medium' ? 'require-admin' : 'approve'
  return { action, riskLevel: risk, recommendation, explanation }
}

// ============================================================================
// 主评估函数
// ============================================================================

/**
 * 用 AST 评估命令危险度
 *
 * @param command 用户输入的 shell 命令
 * @returns 评估结果（risk + reasons + matchedCommands + approvalReason）。AST 解析失败时返回 null，调用方降级到正则。
 *
 * v0.9.4 改造：
 * - 失败时输出明确的 warn 日志（WASM 加载失败 / AST 解析失败）
 * - 填充 approvalReason（教学属性的结构化审批理由）
 * - 调用 assessCommandCombination 合并多命令组合风险
 */
export async function assessWithAst(command: string): Promise<RiskAssessmentResult | null> {
  const parser = await getParser()
  if (!parser) {
    // v0.9.4：WASM 加载失败时已由 getParser 输出 warn 日志，此处仅返回 null
    // （避免重复日志，但调用方知道发生了降级）
    return null // 降级到正则方案
  }

  try {
    const tree = parser.parse(command)
    if (!tree) {
      // v0.9.4：AST 解析返回 null（极端情况）输出明确 warn 日志
      logger.warn(
        LOG_TAG,
        `${FALLBACK_LOG_PREFIX} AST parse returned null, fallback to regex`,
        { command: command.slice(0, 100), phase: 'parse-null' }
      )
      return null
    }

    const rootNode = tree.rootNode

    // 1. 检测 Base64 混淆
    const base64Result = detectBase64Obfuscation(rootNode)
    const reasons: string[] = []
    const matchedCommands: string[] = []

    if (base64Result.detected) {
      reasons.push(base64Result.reason)
      matchedCommands.push('base64 -d | sh')
    }

    // 2. 检测 fork bomb
    const forkResult = detectForkBomb(rootNode)
    if (forkResult.detected) {
      reasons.push(forkResult.reason)
      matchedCommands.push('function_definition + pipeline + &')
    }

    // 3. 提取所有命令，逐个评估
    const commands = extractCommands(rootNode)
    const commandNames: string[] = []
    for (const cmd of commands) {
      const name = cmd.name.toLowerCase()
      commandNames.push(name)

      // 高危命令（无参数也危险）
      if (HIGH_RISK_COMMANDS.has(name)) {
        reasons.push(`高危命令：${name}`)
        matchedCommands.push(cmd.raw)
        continue
      }

      // 高危命令 + 参数组合
      let matched = false
      for (const pattern of HIGH_RISK_PATTERNS) {
        if (pattern.command === name) {
          const result = pattern.matchArgs(cmd.args)
          if (result.dangerous) {
            reasons.push(result.reason)
            matchedCommands.push(cmd.raw)
            matched = true
            break
          }
        }
      }
      if (matched) continue

      // 中危命令 + 参数组合
      // P2-1 清理：删除 `|| pattern.command === '*'` 死代码
      // 原因：Bug 4 修复后 MEDIUM_RISK_PATTERNS 中已无 `command: '*'` 兜底规则，
      //       该判断永远不会命中，属于历史死代码。
      for (const pattern of MEDIUM_RISK_PATTERNS) {
        if (pattern.command === name) {
          const result = pattern.matchArgs(cmd.args)
          if (result.dangerous) {
            reasons.push(result.reason)
            matchedCommands.push(cmd.raw)
            matched = true
            break
          }
        }
      }
      if (matched) continue

      // 中危命令（无参数也中危）
      if (MEDIUM_RISK_COMMANDS.has(name)) {
        reasons.push(`中危命令：${name}`)
        matchedCommands.push(cmd.raw)
      }
    }

    // 4. 评估危险度（单条命令维度）
    let risk: CommandRiskLevel = 'low'
    if (reasons.length > 0) {
      // 有高危原因 → high
      const hasHigh = reasons.some((r) =>
        r.includes('高危') ||
        r.includes('rm -rf') ||
        r.includes('chmod 777') ||
        r.includes('mkfs') ||
        r.includes('dd 写入') ||
        r.includes('iptables') ||
        r.includes('killall') ||
        r.includes('fork bomb') ||
        r.includes('Base64 混淆') ||
        r.includes('关机') ||
        r.includes('重启')
      )
      risk = hasHigh ? 'high' : 'medium'
    }

    // 5. v0.9.4 新增：命令组合风险评估（多命令组合）
    const combinationRisk = assessCommandCombination(commandNames)
    if (combinationRisk.upgraded) {
      // 把组合风险原因合并到 reasons
      reasons.push(...combinationRisk.reasons)
      // 风险升级（取较高者）
      if (combinationRisk.risk === 'high') {
        risk = 'high'
      } else if (combinationRisk.risk === 'medium' && risk === 'low') {
        risk = 'medium'
      }
    }

    // 6. v0.9.4 新增：填充 approvalReason（教学属性的结构化审批理由）
    // - high/medium 必须填充
    // - low 风险：若全是只读命令 → 填充 approve 提示；含注入字符 → 不填充（由 sandbox.ts 走审批）
    let approvalReason: ApprovalReason | undefined
    if (risk !== 'low') {
      approvalReason = buildApprovalReason(risk, reasons, commandNames)
    } else {
      // low 风险：检查是否纯只读命令（含注入字符的不算纯只读）
      const injectionHits = detectInjectionPatterns(command)
      const allReadOnly =
        commandNames.length > 0 &&
        commandNames.every((n) => READONLY_BASH_COMMANDS.has(n)) &&
        injectionHits.length === 0
      if (allReadOnly) {
        approvalReason = buildApprovalReason(risk, reasons, commandNames)
      }
    }

    tree.delete()
    return { risk, reasons, matchedCommands, approvalReason }
  } catch (err) {
    // v0.9.4：AST 解析失败时输出明确 warn 日志（包含失败原因 + 降级到正则方案）
    const errorMsg = (err as Error).message
    logger.warn(
      LOG_TAG,
      `${FALLBACK_LOG_PREFIX} AST parse failed: ${errorMsg}, fallback to regex`,
      { command: command.slice(0, 100), error: errorMsg, phase: 'parse-exception' }
    )
    return null
  }
}

/**
 * 重置 Parser 实例（测试用）
 */
export function resetAstParser(): void {
  parserInstance = null
  languageLoaded = false
  initError = null
}
