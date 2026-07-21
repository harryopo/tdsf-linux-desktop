/**
 * 运行 Subagent（Running Subagent）
 *
 * 职责：
 * - 命令执行、结果观察
 * - SSH 命令执行（ssh:exec / ssh:shell）
 * - 沙箱隔离执行（v1.3 Docker 容器，当前仅进程级 + 权限白名单）
 * - 红线命令拦截（rm -rf / / dd if=/dev/zero / mkfs 等高危命令必须人工审批）
 *
 * 主要工具：ssh:exec / ssh:shell / 沙箱
 *
 * 实现策略：
 * - 主路径：调用风险引擎（assessRisk）分析命令风险等级，给出执行建议
 * - 降级路径：风险引擎不可用时使用基础正则风险检查
 *
 * 注意：本子代理只分析和建议，不直接执行命令。
 *
 * 方案书依据：v0.9 §3.1 表格第 3 行 + §10 Hard Constraint 4（人工审批闸门）
 */
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'
import { assessRisk, checkShellSyntax, logToAudit } from '../../risk-engine'
import type { RiskAssessment } from '@shared/models'

/**
 * 运行 Subagent 输入
 */
export interface RunningSubagentInput {
  /** 需要分析/执行的命令 */
  command: string
  /** 可选：命令执行的目的说明 */
  purpose?: string
  /** 可选：目标操作系统/发行版 */
  targetOs?: string
}

/**
 * 命令分析结果
 */
interface CommandAnalysis {
  /** 原始命令 */
  command: string
  /** 风险评估结果 */
  riskAssessment: RiskAssessment
  /** 语法检查结果 */
  syntaxValid: boolean
  /** 语法错误信息（如有） */
  syntaxError?: string
  /** 执行建议 */
  guidance: string
  /** 预期输出说明 */
  expectedOutput: string
  /** 风险警告（高风险时有值） */
  warning?: string
  /** 分析来源 */
  source: 'risk-engine' | 'regex-fallback'
}

/** 高风险命令正则（降级用） */
const HIGH_RISK_REGEX = [
  { pattern: /\brm\s+(-\w*r\w*f|-\w*f\w*r)\s+\S/, desc: '递归强制删除' },
  { pattern: /\bmkfs\b/, desc: '格式化文件系统' },
  { pattern: /\bdd\s+.*if=.*of=\/dev\//, desc: '直接写入块设备' },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/, desc: '关机/重启' },
  { pattern: /\bchmod\s+(-\w*R\w*\s+)?777\b/, desc: '设置 777 权限' },
  { pattern: /\bkill\s+-9\b/, desc: '强制杀死进程' },
  { pattern: /\biptables\s+.*-F\b/, desc: '清空防火墙规则' },
  { pattern: /\buserdel\b|\bgroupdel\b/, desc: '删除用户/组' },
]

/** 只读命令白名单（降级用） */
const READONLY_COMMANDS = [
  'cat', 'ls', 'ps', 'df', 'free', 'top', 'head', 'tail', 'grep', 'find',
  'ss', 'netstat', 'uptime', 'uname', 'hostname', 'journalctl', 'dmesg',
  'stat', 'wc', 'which', 'whereis', 'file', 'diff', 'id', 'du', 'echo',
  'pwd', 'whoami', 'date',
]

export class RunningSubagent extends BaseSubagent {
  readonly name = 'running' as const
  readonly displayName = '运行 Subagent'
  readonly description = '命令执行、结果观察（SSH exec + 沙箱 + 高危命令拦截）'

  /**
   * 运行 Subagent 默认需要审批（执行远程命令属高危操作）
   *
   * 根据具体命令的风险等级动态判断：
   * - SAFE/LOW（如 ls / cat）→ 直接执行
   * - HIGH/CRITICAL（如 rm / dd / mkfs）→ 必须人工审批
   */
  protected isApprovalRequired(_task: SubagentTask): boolean {
    return true
  }

  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()
    const input = this.parseInput(task)

    if (!input.command) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: '缺少必需字段：command（需要分析/执行的命令）',
        durationMs: Date.now() - startTime,
      }
    }

    this.log.info(`[${this.name}] 开始分析命令`, {
      taskId: task.id,
      command: input.command.slice(0, 100),
      purpose: input.purpose,
    })

    // 主路径：使用风险引擎分析
    try {
      const analysis = this.analyzeWithRiskEngine(input)
      return {
        taskId: task.id,
        success: true,
        output: analysis,
        confidence: analysis.riskAssessment.level === 'CRITICAL' ? 0.95 : 0.85,
        durationMs: Date.now() - startTime,
        requiresApproval: analysis.riskAssessment.requireConfirmation,
        approvalPreview: analysis.warning
          ? `⚠️ 高风险命令需要确认：\n命令：${input.command}\n风险：${analysis.warning}`
          : undefined,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.warn(`[${this.name}] 风险引擎调用失败，降级到正则检查`, {
        taskId: task.id,
        error: errorMsg,
      })
    }

    // 降级路径：基础正则风险检查
    try {
      const analysis = this.analyzeWithRegexFallback(input)
      return {
        taskId: task.id,
        success: true,
        output: analysis,
        confidence: 0.6,
        durationMs: Date.now() - startTime,
        requiresApproval: analysis.riskAssessment.requireConfirmation,
        approvalPreview: analysis.warning
          ? `⚠️ 高风险命令需要确认：\n命令：${input.command}\n风险：${analysis.warning}`
          : undefined,
      }
    } catch (err) {
      this.log.warn(`[${this.name}] 正则降级也失败`, {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 全部失败
    return {
      taskId: task.id,
      success: false,
      output: null,
      error: '命令分析失败：风险引擎和降级检查均不可用。请检查系统配置后重试。',
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * 使用风险引擎分析命令
   */
  private analyzeWithRiskEngine(input: RunningSubagentInput): CommandAnalysis {
    const { command } = input

    // L1: 语法检查
    const syntaxResult = checkShellSyntax(command)

    // L2: 风险评估
    const assessment = assessRisk(command)

    // L4: 审计日志
    logToAudit(command, assessment)

    // 构建执行建议
    const guidance = this.buildGuidance(assessment, syntaxResult.valid)
    const expectedOutput = this.buildExpectedOutput(command, assessment)
    const warning = this.buildWarning(assessment)

    return {
      command,
      riskAssessment: assessment,
      syntaxValid: syntaxResult.valid,
      syntaxError: syntaxResult.error,
      guidance,
      expectedOutput,
      warning,
      source: 'risk-engine',
    }
  }

  /**
   * 降级：基础正则风险检查
   */
  private analyzeWithRegexFallback(input: RunningSubagentInput): CommandAnalysis {
    const { command } = input
    const cmd = command.trim()
    const firstWord = cmd.split(/\s+/)[0] || ''

    // 检查高风险模式
    const hits: string[] = []
    for (const { pattern, desc } of HIGH_RISK_REGEX) {
      if (pattern.test(cmd)) {
        hits.push(desc)
      }
    }

    let level: RiskAssessment['level']
    let score: number
    let description: string

    if (hits.length > 0) {
      level = 'HIGH'
      score = 75
      description = `高风险操作：${hits.join('; ')}`
    } else if (READONLY_COMMANDS.includes(firstWord)) {
      level = 'LOW'
      score = 30
      description = '只读查询命令'
    } else {
      level = 'MEDIUM'
      score = 50
      description = '未匹配已知模式，按中等风险处理'
    }

    const assessment: RiskAssessment = {
      level,
      score,
      matchedRules: hits,
      description,
      requireConfirmation: level === 'HIGH',
      blocked: false,
    }

    const guidance = this.buildGuidance(assessment, true)
    const expectedOutput = this.buildExpectedOutput(command, assessment)
    const warning = this.buildWarning(assessment)

    return {
      command,
      riskAssessment: assessment,
      syntaxValid: true,
      guidance,
      expectedOutput,
      warning,
      source: 'regex-fallback',
    }
  }

  /**
   * 构建执行建议
   */
  private buildGuidance(assessment: RiskAssessment, syntaxValid: boolean): string {
    const parts: string[] = []

    if (!syntaxValid) {
      parts.push('⚠️ 命令存在语法问题，请先修正后再执行。')
    }

    switch (assessment.level) {
      case 'SAFE':
        parts.push('✅ 安全命令，可直接执行。')
        break
      case 'LOW':
        parts.push('✅ 只读查询命令，风险极低，可安全执行。')
        break
      case 'MEDIUM':
        parts.push('⚡ 中等风险操作，建议执行前确认目标路径/对象是否正确。')
        parts.push('建议：先在测试环境验证，或添加 --dry-run 参数（如支持）。')
        break
      case 'HIGH':
        parts.push('⚠️ 高风险操作！执行前必须人工确认。')
        parts.push('建议：1) 备份相关数据 2) 确认操作目标 3) 准备回滚方案。')
        break
      case 'CRITICAL':
        parts.push('🚫 极高风险操作！已阻止自动执行。')
        parts.push('此命令可能导致不可逆的数据丢失或系统损坏，强烈建议不要执行。')
        parts.push('如确需执行，必须经过人工审批并准备完整的灾难恢复方案。')
        break
    }

    return parts.join('\n')
  }

  /**
   * 构建预期输出说明
   */
  private buildExpectedOutput(command: string, assessment: RiskAssessment): string {
    const firstWord = command.trim().split(/\s+/)[0] || ''

    const outputMap: Record<string, string> = {
      ls: '列出目录内容（文件名、权限、大小等）',
      cat: '输出文件完整内容到终端',
      ps: '显示当前进程列表（PID、用户、CPU/内存占用等）',
      df: '显示磁盘分区使用情况（容量、已用、可用、挂载点）',
      free: '显示内存使用情况（总量、已用、空闲、缓存）',
      top: '实时显示系统资源使用和进程信息（交互式）',
      grep: '输出匹配指定模式的行',
      find: '输出符合条件的文件路径列表',
      systemctl: '显示服务状态或执行服务操作',
      journalctl: '输出系统日志内容',
      ss: '显示网络连接和套接字信息',
      netstat: '显示网络连接、路由表、接口统计信息',
    }

    if (outputMap[firstWord]) {
      return outputMap[firstWord]
    }

    if (assessment.level === 'CRITICAL' || assessment.level === 'HIGH') {
      return '此命令为变更/破坏性操作，可能无标准输出或输出操作确认信息。执行后需验证系统状态。'
    }

    return '命令执行结果将输出到终端（stdout/stderr）。'
  }

  /**
   * 构建风险警告（仅高风险及以上）
   */
  private buildWarning(assessment: RiskAssessment): string | undefined {
    if (assessment.level !== 'HIGH' && assessment.level !== 'CRITICAL') {
      return undefined
    }
    const rules = assessment.matchedRules.length > 0
      ? assessment.matchedRules.join('、')
      : assessment.description
    return `[${assessment.level}] ${rules}（风险评分：${assessment.score}/100）`
  }

  /**
   * 解析任务输入（兼容字符串和结构化对象）
   */
  private parseInput(task: SubagentTask): RunningSubagentInput {
    if (typeof task.input === 'string') {
      return { command: task.input }
    }
    if (task.input && typeof task.input === 'object') {
      const obj = task.input as Record<string, unknown>
      return {
        command: typeof obj.command === 'string'
          ? obj.command
          : typeof obj.cmd === 'string'
            ? obj.cmd
            : (task.description ?? ''),
        purpose: typeof obj.purpose === 'string' ? obj.purpose : undefined,
        targetOs: typeof obj.targetOs === 'string' ? obj.targetOs : undefined,
      }
    }
    return { command: task.description ?? '' }
  }
}
