/**
 * 7 步 HITL（Human-in-the-Loop）Agent 工作流
 *
 * 步骤：
 *   1. collect  — 采集环境信息（SSH 执行只读命令获取系统状态）
 *   2. analyze  — 分析日志（结合用户问题和环境信息）
 *   3. reason   — 生成建议（LLM/规则推理，产出证据链）
 *   4. check    — 安全检查（风险评估 + 决策卡片生成）
 *   5. confirm  — 人工确认（暂停等待，HITL 核心）
 *   6. execute  — 执行命令（SSH 执行确认的修复命令）
 *   7. verify   — 验证结果（采集执行后状态对比）
 *
 * 使用 Node.js EventEmitter 通知 UI 步骤变化，
 * confirm 步骤通过 Promise 暂停等待人工确认。
 */

import { EventEmitter } from 'events'
import type { AgentStep, AgentWorkflowState, DecisionCard, Evidence } from '../../shared/models'
import { assessRisk } from './risk-engine'
import { generateDecisionCard } from './decision-engine'
import { verifyAllEvidences, type ToolCallRecord } from './grounding'
import { getDrain3Bridge, type LogTemplate } from '../services/log/drain3-bridge'
import { shouldResample, resampleAndVote } from './sampling'
import { calculateEvidenceConfidence } from './confidence'

/** 工作流事件名常量 */
export const WORKFLOW_EVENTS = {
  STEP_CHANGED: 'step:changed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  ERROR: 'error',
  CONFIRMATION_REQUIRED: 'confirmation:required'
} as const

/** 环境信息采集命令（只读） */
const ENV_COMMANDS = [
  'hostname',
  'uname -a',
  'cat /etc/os-release',
  'free -m',
  'df -h',
  'cat /proc/loadavg',
  'ps aux --sort=-%cpu | head -10'
]

/**
 * 已知日志模式定义（R14 增强）
 *
 * analyze 步骤扫描日志文本，匹配这些模式后产出诊断信号，
 * 供 reason 步骤和 UI 展示使用。
 */
interface LogPatternDef {
  /** 唯一标识 */
  id: string
  /** 匹配正则 */
  pattern: RegExp
  /** 人类可读描述 */
  description: string
  /** 严重度 */
  severity: 'info' | 'warning' | 'critical'
}

const LOG_PATTERNS: LogPatternDef[] = [
  // ── critical ──
  { id: 'oom_kill', pattern: /oom[- ]?killer|out of memory|killed process/i, description: 'OOM Killer 触发', severity: 'critical' },
  { id: 'segfault', pattern: /segfault at [0-9a-f]+/i, description: '段错误（Segfault）', severity: 'critical' },
  { id: 'kernel_panic', pattern: /kernel panic|panic\[|unable to handle/i, description: '内核恐慌（Kernel Panic）', severity: 'critical' },
  { id: 'disk_full', pattern: /no space left on device|filesystem full|disk full/i, description: '磁盘空间耗尽', severity: 'critical' },
  { id: 'fs_readonly', pattern: /remounting.*read.only|filesystem.*read.only|EXT[234]-fs error/i, description: '文件系统只读/错误', severity: 'critical' },

  // ── warning ──
  { id: 'conn_refused', pattern: /connection refused|connect ECONNREFUSED/i, description: '连接被拒绝', severity: 'warning' },
  { id: 'conn_timeout', pattern: /connection timed? ?out|ETIMEDOUT|timeout.*expired/i, description: '连接超时', severity: 'warning' },
  { id: 'perm_denied', pattern: /permission denied|EACCES|access denied/i, description: '权限拒绝', severity: 'warning' },
  { id: 'service_fail', pattern: /failed to start|activat.*failed|service.*failed|Unit.*entered failed state/i, description: '服务启动失败', severity: 'warning' },
  { id: 'high_cpu', pattern: /load average:\s*([0-9]+\.)*[0-9]+/i, description: '负载异常（需结合 CPU 核数判断）', severity: 'info' },
  { id: 'ssh_fail', pattern: /ssh.*error|ssh.*failed|broken pipe.*ssh/i, description: 'SSH 连接异常', severity: 'warning' },
  { id: 'nginx_5xx', pattern: /\b5[0-9]{2}\b.*upstream|upstream.*timed? ?out|nginx.*error/i, description: 'Nginx 5xx / upstream 错误', severity: 'warning' },
  { id: 'mysql_slow', pattern: /slow query|locked.*wait.*lock|deadlock/i, description: 'MySQL 慢查询/锁等待/死锁', severity: 'warning' },

  // ── info ──
  { id: 'service_restart', pattern: /restarting|restart.*service|systemctl.*restart/i, description: '服务重启事件', severity: 'info' },
  { id: 'auth_fail', pattern: /authentication failure|failed password|invalid user|pam.*auth/i, description: '认证失败', severity: 'warning' }
]

/** 日志模式匹配结果 */
export interface LogPatternMatch {
  patternId: string
  description: string
  matchCount: number
  severity: 'info' | 'warning' | 'critical'
  /** 匹配到的首条日志行（截断到 200 字符） */
  sampleLine: string
}

/** SSH 命令执行器接口（解耦具体 SSH 实现） */
export interface SshExecutor {
  execute(connId: string, command: string, timeout?: number): Promise<{
    exitCode: number
    stdout: string
    stderr: string
  }>
}

/** 证据采集器接口（解耦具体证据来源） */
export interface EvidenceCollector {
  collect(problem: string, envInfo: Record<string, string>): Promise<Evidence[]>
}

/** 工作流启动参数 */
export interface WorkflowStartParams {
  /** 用户问题描述 */
  problem: string
  /** 日志文本 */
  logs: string
  /** SSH 连接 ID */
  connId: string
  /** SSH 执行器（可选，不传则跳过实际 SSH 操作） */
  sshExecutor?: SshExecutor
  /** 证据采集器（可选） */
  evidenceCollector?: EvidenceCollector
  /** P2-4: LLM 修复命令获取器（优先使用 LLM 建议的命令，降级才用 deriveFixCommand） */
  getLlmFixCommand?: () => { hypothesis: string; fixCommand: string; confidence: number } | null
  /**
   * 方案书 §4.3 自适应自洽采样：异步 LLM 推理器
   *
   * 当返回的 confidence < 0.7 时，工作流会自动重采样 3 次并取多数票，
   * 降低单次推理的随机性。不传则退化为单次推理。
   */
  llmReasoner?: (problem: string, evidences: Evidence[]) => Promise<{
    hypothesis: string
    confidence: number
  } | null>
}

/**
 * Agent 工作流管理器
 *
 * 管理完整的 7 步 HITL 工作流，通过 EventEmitter 通知 UI 步骤变化，
 * 在 confirm 步骤暂停等待人工确认。
 *
 * @example
 * const workflow = new AgentWorkflow()
 * workflow.on('step:changed', (state) => updateUI(state))
 * workflow.on('confirmation:required', (card) => showConfirmDialog(card))
 *
 * // 异步启动工作流
 * workflow.start({ problem: '磁盘空间不足', logs: '...', connId: 'server-1', sshExecutor })
 *
 * // 用户确认后恢复
 * workflow.confirm(true)  // 批准执行
 * // 或
 * workflow.confirm(false) // 拒绝执行
 */
export class AgentWorkflow extends EventEmitter {
  private state: AgentWorkflowState
  private confirmResolve: ((approved: boolean) => void) | null = null
  /** P2-6: 确认超时定时器 */
  private confirmTimeout: ReturnType<typeof setTimeout> | null = null
  private cancelled = false

  constructor() {
    super()
    this.state = this.createInitialState()
  }

  /**
   * 获取当前工作流状态（返回副本，防止外部修改）
   */
  getState(): AgentWorkflowState {
    return {
      ...this.state,
      completedSteps: [...this.state.completedSteps],
      stepDetails: { ...this.state.stepDetails },
      decisionCard: this.state.decisionCard ? { ...this.state.decisionCard } : null
    }
  }

  /**
   * 启动工作流
   *
   * 依次执行 7 个步骤，在 confirm 步骤暂停等待人工确认。
   * 用户通过 confirm() 方法恢复工作流。
   *
   * @param params - 启动参数
   * @returns 最终决策卡片，出错或取消返回 null
   */
  async start(params: WorkflowStartParams): Promise<DecisionCard | null> {
    this.reset()
    const { problem, logs, connId, sshExecutor, evidenceCollector, getLlmFixCommand, llmReasoner } = params

    // ── 方案书 §4.2：工具调用溯源日志（Ground-Check 的输入） ──
    const toolCallLog: ToolCallRecord[] = []
    const trackedSsh: SshExecutor | undefined = sshExecutor
      ? this.wrapSshWithTracking(sshExecutor, toolCallLog, connId)
      : undefined

    try {
      // Step 1: 采集环境（所有 SSH 调用自动记录到 toolCallLog）
      const envInfo = await this.runStep('collect', async () => {
        return trackedSsh ? await this.collectEnvironment(connId, trackedSsh) : {}
      })

      // Step 2: 分析 + Drain3 模板提取 + 日志模式匹配（R14 增强）
      let templates: LogTemplate[] = []
      let patternMatches: LogPatternMatch[] = []
      await this.runStep('analyze', async () => {
        templates = await this.extractLogTemplates(logs)
        patternMatches = this.detectLogPatterns(logs)

        // 将模式匹配存入 state，供 UI 和 reason 步骤使用
        this.state.logPatterns = patternMatches.map((m) => ({
          patternId: m.patternId,
          description: m.description,
          matchCount: m.matchCount,
          severity: m.severity
        }))

        return {
          problem,
          logsLength: logs.length,
          envInfoKeys: Object.keys(envInfo),
          templateCount: templates.length,
          patternMatches: patternMatches.length,
          criticalPatterns: patternMatches.filter((m) => m.severity === 'critical').length
        }
      })

      // Step 3: 推理（采集证据 → Drain3 置信度增强 → Ground-Check 溯源验证）
      let evidences: Evidence[] = []
      await this.runStep('reason', async () => {
        if (evidenceCollector) {
          evidences = await evidenceCollector.collect(problem, envInfo)

          // §4.1：用 Drain3 模板匹配度重算每条证据的置信度
          evidences = this.enrichEvidencesWithDrain(evidences, templates)

          // §4.2：Ground-Check — 验证证据确实来自真实工具调用
          evidences = await this.runGroundCheck(evidences, toolCallLog, problem, envInfo, evidenceCollector)
        }
        return {
          evidenceCount: evidences.length,
          groundCheck: this.state.groundCheck
        }
      })

      // Step 4: 安全检查 + 决策卡片生成
      // P2-4: 优先使用 LLM 建议的修复命令，降级才用 deriveFixCommand
      const llmResult = getLlmFixCommand?.()
      const fixCommand = (llmResult && llmResult.fixCommand && llmResult.confidence >= 0.5)
        ? llmResult.fixCommand
        : this.deriveFixCommand(evidences, problem)

      // §4.3：自适应自洽采样 — 低置信度时 3 次重采样 + 多数票
      const hypothesis = await this.deriveHypothesisAdaptive(
        llmResult, llmReasoner, problem, evidences
      )

      await this.runStep('check', async () => {
        return assessRisk(fixCommand)
      })

      const card = generateDecisionCard(problem, hypothesis, evidences, fixCommand)
      this.state.decisionCard = card

      // Step 5: 人工确认（暂停等待）
      const approved = await this.runStep('confirm', async () => {
        return this.waitForConfirmation()
      })

      if (!approved) {
        this.state.decisionCard = { ...card, status: 'rejected' }
        this.emitComplete()
        return this.state.decisionCard
      }

      if (this.cancelled) {
        this.emitCancel()
        return null
      }

      // Step 6: 执行（同样记录到 toolCallLog，供后续审计）
      await this.runStep('execute', async () => {
        if (trackedSsh) {
          return await trackedSsh.execute(connId, fixCommand)
        }
        return { exitCode: 0, stdout: 'dry-run mode', stderr: '' }
      })

      // Step 7: 验证（场景特定 + 通用环境对比）
      await this.runStep('verify', async () => {
        if (!trackedSsh) return { envChanged: false }
        const postEnv = await this.collectEnvironment(connId, trackedSsh)
        const envChanged = JSON.stringify(postEnv) !== JSON.stringify(envInfo)

        // 场景特定验证命令
        const verifyCmd = this.deriveVerifyCommand(problem)
        let verifyOutput = ''
        if (verifyCmd) {
          try {
            const r = await trackedSsh.execute(connId, verifyCmd)
            verifyOutput = r.stdout.slice(0, 2000)
          } catch {
            verifyOutput = '(验证命令执行失败)'
          }
        }
        return { envChanged, verifyOutput }
      })

      this.state.decisionCard = { ...card, status: 'verified' }
      this.emitComplete()
      return this.state.decisionCard
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err)
      this.emit(WORKFLOW_EVENTS.ERROR, this.state.error)
      return null
    }
  }

  /**
   * 用户确认或拒绝执行
   *
   * 在 confirmation:required 事件触发后调用此方法恢复工作流。
   *
   * @param approved - true 批准执行，false 拒绝执行
   */
  confirm(approved: boolean): void {
    if (this.confirmTimeout) {
      clearTimeout(this.confirmTimeout)
      this.confirmTimeout = null
    }
    if (this.confirmResolve) {
      this.confirmResolve(approved)
      this.confirmResolve = null
    }
  }

  /**
   * 取消工作流
   *
   * 取消正在执行的工作流，如果在 confirm 步骤则自动拒绝。
   */
  cancel(): void {
    this.cancelled = true
    this.confirm(false)
    this.emit(WORKFLOW_EVENTS.CANCELLED, this.getState())
  }

  // ────────── 内部方法 ──────────

  /**
   * 创建初始状态
   */
  private createInitialState(): AgentWorkflowState {
    return {
      currentStep: 'collect',
      completedSteps: [],
      stepDetails: {} as Record<AgentStep, string>,
      waitingForConfirmation: false,
      decisionCard: null,
      error: null,
      timestamp: Date.now()
    }
  }

  /**
   * 重置工作流状态
   */
  private reset(): void {
    this.cancelled = false
    this.confirmResolve = null
    if (this.confirmTimeout) {
      clearTimeout(this.confirmTimeout)
      this.confirmTimeout = null
    }
    this.state = this.createInitialState()
  }

  /**
   * 执行单个步骤，自动更新状态并发射事件
   *
   * 关键修复（P0-2 根因 A）：
   *   - confirm 步骤需在 emit STEP_CHANGED 之前设置 waitingForConfirmation = true
   *   - 这样 UI 接收到的状态才能正确反映"等待确认"语义
   *   - 否则 UI 会把 confirm 步骤当作普通执行中步骤，不显示批准提示
   *
   * @param step - 步骤名
   * @param fn - 步骤执行函数
   * @returns 步骤执行结果
   */
  private async runStep<T>(step: AgentStep, fn: () => Promise<T>): Promise<T> {
    this.state.currentStep = step
    // confirm 步骤特殊处理：先标记等待状态再 emit，确保 UI 接收到的状态正确
    if (step === 'confirm') {
      this.state.waitingForConfirmation = true
    }
    this.emit(WORKFLOW_EVENTS.STEP_CHANGED, this.getState())
    const result = await fn()
    this.state.completedSteps.push(step)
    this.state.stepDetails[step] = this.truncate(this.safeStringify(result))
    return result
  }

  /**
   * 等待人工确认（通过 Promise 暂停）
   *
   * 关键修复（P0-2 根因 B）：
   *   - emit CONFIRMATION_REQUIRED 时携带完整 state（含 decisionCard）
   *   - 让 IPC 层能转发到 UI，UI 据此显示批准按钮
   *   - waitingForConfirmation 已在 runStep 中提前设置
   *
   * P2-6: 增加 5 分钟超时机制，防止用户关闭应用后工作流永久挂起
   */
  private async waitForConfirmation(): Promise<boolean> {
    // waitingForConfirmation 已在 runStep('confirm') 中提前设为 true
    const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟
    return new Promise<boolean>((resolve) => {
      // 关键：先赋值 confirmResolve，再 emit 事件。
      // 否则同步事件处理器调用 confirm() 时 confirmResolve 仍为 null，
      // 导致 Promise 永远无法 resolve（测试超时）。
      this.confirmResolve = resolve
      // 超时自动拒绝
      this.confirmTimeout = setTimeout(() => {
        if (this.confirmResolve) {
          console.log('[AgentWorkflow] 确认超时（5分钟），自动拒绝')
          this.confirmResolve(false)
          this.confirmResolve = null
        }
      }, CONFIRM_TIMEOUT_MS)
      // emit 放在赋值之后，确保同步事件处理器中的 confirm() 调用生效
      this.emit(WORKFLOW_EVENTS.CONFIRMATION_REQUIRED, this.getState())
    })
  }

  /**
   * 通过 SSH 采集环境信息
   *
   * P1-5: 改为并发执行（Promise.allSettled），7 条命令同时发出，
   * 总耗时从 7×10s=70s 降至 max(10s)≈10s
   */
  private async collectEnvironment(
    connId: string,
    ssh: SshExecutor
  ): Promise<Record<string, string>> {
    const envInfo: Record<string, string> = {}
    // 并发执行所有采集命令
    const results = await Promise.allSettled(
      ENV_COMMANDS.map((cmd) => ssh.execute(connId, cmd, 10))
    )
    for (let i = 0; i < ENV_COMMANDS.length; i++) {
      const cmd = ENV_COMMANDS[i]
      const result = results[i]
      if (result.status === 'fulfilled') {
        envInfo[cmd] = result.value.exitCode === 0
          ? result.value.stdout.trim()
          : `(exit=${result.value.exitCode})`
      } else {
        envInfo[cmd] = `(error: ${result.reason instanceof Error ? result.reason.message : 'unknown'})`
      }
    }
    return envInfo
  }

  /**
   * 包装 SSH 执行器，自动记录工具调用日志
   *
   * 方案书 §4.2：Ground-Check 的输入是 tool_call_transcripts，
   * 即所有真实工具调用的完整记录（工具名、输入、输出、时间戳）。
   */
  private wrapSshWithTracking(
    ssh: SshExecutor,
    toolCallLog: ToolCallRecord[],
    sessionId: string
  ): SshExecutor {
    return {
      execute: async (connId: string, command: string, timeout?: number) => {
        const timestamp = Date.now()
        const result = await ssh.execute(connId, command, timeout)
        toolCallLog.push({
          toolName: 'ssh_exec',
          input: command,
          output: result.stdout + (result.stderr ? `\n${result.stderr}` : ''),
          timestamp,
          sessionId
        })
        return result
      }
    }
  }

  /**
   * 提取日志模板（Drain3 桥接，方案书 §4.1）
   *
   * Drain3 将原始日志压缩为"模板 + 参数"，用于：
   *   1. 计算证据的 drainMatch 维度（置信度公式 0.7×drainMatch + 0.3×sourcePrior）
   *   2. 减少 LLM 输入 token（模板摘要替代原始日志全文）
   *
   * 降级策略：Python 进程不可用时使用本地正则模板化，不影响主流程。
   */
  private async extractLogTemplates(logs: string): Promise<LogTemplate[]> {
    if (!logs || logs.trim().length === 0) return []
    try {
      const bridge = getDrain3Bridge()
      const logLines = logs.split('\n').filter((l) => l.trim().length > 0).slice(-200)
      if (logLines.length === 0) return []
      return await bridge.extractTemplates(logLines)
    } catch (err) {
      console.warn('[AgentWorkflow] Drain3 模板提取降级:', err instanceof Error ? err.message : err)
      return []
    }
  }

  /**
   * 日志模式匹配（R14 增强）
   *
   * 扫描日志文本，匹配 LOG_PATTERNS 中定义的已知错误模式。
   * 输出诊断信号供 reason 步骤和 UI 展示使用。
   *
   * 设计原则：
   *   - 纯同步计算，无 IO 开销
   *   - 每个模式独立匹配，不互相排斥
   *   - 返回匹配次数 + 首条样本行，方便 UI 展示
   */
  private detectLogPatterns(logs: string): LogPatternMatch[] {
    if (!logs || logs.trim().length === 0) return []

    const lines = logs.split('\n').filter((l) => l.trim().length > 0)
    const matches: LogPatternMatch[] = []

    for (const def of LOG_PATTERNS) {
      let matchCount = 0
      let sampleLine = ''

      for (const line of lines) {
        if (def.pattern.test(line)) {
          matchCount++
          if (!sampleLine) {
            sampleLine = line.length > 200 ? line.slice(0, 200) + '...' : line
          }
        }
      }

      if (matchCount > 0) {
        matches.push({
          patternId: def.id,
          description: def.description,
          matchCount,
          severity: def.severity,
          sampleLine
        })
      }
    }

    // 按严重度排序：critical > warning > info
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 }
    matches.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

    return matches
  }

  /**
   * 用 Drain3 模板匹配度增强证据置信度（方案书 §4.1）
   *
   * 匹配度评分规则：
   *   - 证据内容精确匹配已知模板 → 1.0
   *   - 结构匹配（模板化后相同）但参数不同 → 0.7
   *   - 无匹配（新型日志）→ 0.3，标记"待补充模板"
   *
   * 之后用公式 confidence = 0.7×drainMatch + 0.3×sourcePrior 重算置信度。
   */
  private enrichEvidencesWithDrain(evidences: Evidence[], templates: LogTemplate[]): Evidence[] {
    return evidences.map((evidence) => {
      // 仅对日志类证据计算 Drain3 匹配度；命令/指标输出本身就是结构化数据
      const drainMatch = evidence.source === 'log'
        ? this.computeDrainMatchScore(evidence.content, templates)
        : evidence.drainMatch > 0 ? evidence.drainMatch : 0.8 // 非日志证据默认高匹配
      // 用统一公式重算置信度
      return calculateEvidenceConfidence({ ...evidence, drainMatch })
    })
  }

  /**
   * 计算证据内容与 Drain3 模板的匹配度
   *
   * @param content - 证据内容
   * @param templates - Drain3 提取的模板列表
   * @returns 匹配度 [0, 1]
   */
  private computeDrainMatchScore(content: string, templates: LogTemplate[]): number {
    if (templates.length === 0 || !content) return 0.3

    // 将证据内容模板化（与 Drain3 相同的归一化规则）
    const normalized = content
      .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '<*>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<*>')
      .replace(/\b\d+\b/g, '<*>')

    for (const t of templates) {
      // 精确匹配已知模板
      if (t.template === content || t.template === normalized) return 1.0
      // 结构匹配：模板化后与已知模板相同（参数不同）
      if (normalized.includes(t.template) || t.template.includes(normalized.slice(0, 40))) return 0.7
    }
    // 无匹配：新型日志，标记待补充模板
    return 0.3
  }

  /**
   * Ground-Check 溯源验证（方案书 §4.2）
   *
   * 验证每条证据确实来自真实工具调用，而非 LLM 凭空编造：
   *   1. 对所有证据执行 verifyAllEvidences（内容匹配 + 来源匹配 + 时序合理）
   *   2. 被拒绝的证据标记 verified=false（UI 显示"仅供参考"）
   *   3. 若存在被拒绝证据 → 定向重采 1 次（更精确的采集提示），重采结果替换被拒证据
   *
   * 最多 1 次重试以控制成本（方案书明确要求）。
   */
  private async runGroundCheck(
    evidences: Evidence[],
    toolCallLog: ToolCallRecord[],
    problem: string,
    envInfo: Record<string, string>,
    collector: EvidenceCollector
  ): Promise<Evidence[]> {
    // 第一轮验证
    let verified = verifyAllEvidences(evidences, toolCallLog)
    let rejected = verified.filter((e) => !e.verified)
    let retried = false

    // 存在被拒绝证据 → 定向重采（最多 1 次，方案书成本控制要求）
    if (rejected.length > 0 && rejected.length < verified.length) {
      retried = true
      try {
        // 定向重采：将被拒证据的来源信息作为提示，引导采集器精确查询
        const rejectedHint = rejected.map((e) => e.sourceDetail).filter(Boolean).join(', ')
        const retryProblem = `${problem}（需补充验证来源: ${rejectedHint}，请用精确 grep/tail 命令采集）`
        const retryEvidences = await collector.collect(retryProblem, envInfo)

        if (retryEvidences.length > 0) {
          // 重采证据同样经过 Drain3 增强不需要（已有置信度），直接验证
          const retryVerified = verifyAllEvidences(retryEvidences, toolCallLog)
          // 用通过验证的重采证据替换被拒证据
          const kept = verified.filter((e) => e.verified)
          verified = [...kept, ...retryVerified]
          rejected = verified.filter((e) => !e.verified)
          console.log(`[AgentWorkflow] Ground-Check 重采: 补充 ${retryVerified.length} 条证据`)
        }
      } catch (err) {
        console.warn('[AgentWorkflow] Ground-Check 重采失败（不影响主流程）:', err instanceof Error ? err.message : err)
      }
    }

    if (rejected.length > 0) {
      console.log(`[AgentWorkflow] Ground-Check: ${rejected.length}/${verified.length} 条证据未通过溯源，标记为"仅供参考"`)
    }

    this.state.groundCheck = {
      total: verified.length,
      verified: verified.length - rejected.length,
      rejected: rejected.length,
      retried
    }
    return verified
  }

  /**
   * 自适应假设生成（方案书 §4.3 Self-Consistency）
   *
   * 策略：
   *   - 有 llmReasoner 且首次置信度 < 0.7 → 3 次重采样 + 多数票
   *   - 有 llmReasoner 且置信度 ≥ 0.7 → 单次推理（省 token）
   *   - 无 llmReasoner → 退化为 getLlmFixCommand 或规则推导
   */
  private async deriveHypothesisAdaptive(
    llmResult: { hypothesis: string; fixCommand: string; confidence: number } | null | undefined,
    llmReasoner: WorkflowStartParams['llmReasoner'],
    problem: string,
    evidences: Evidence[]
  ): Promise<string> {
    // 优先使用异步 LLM 推理器（支持自洽采样）
    if (llmReasoner) {
      try {
        const first = await llmReasoner(problem, evidences)
        if (first && first.hypothesis) {
          if (!shouldResample(first.confidence)) {
            // 高置信度：单次推理即可
            return first.hypothesis
          }
          // 低置信度：再采 2 次，3 票取多数
          const samples = [first.hypothesis]
          const extra = await Promise.allSettled([
            llmReasoner(problem, evidences),
            llmReasoner(problem, evidences)
          ])
          for (const r of extra) {
            if (r.status === 'fulfilled' && r.value?.hypothesis) {
              samples.push(r.value.hypothesis)
            }
          }
          const voted = resampleAndVote(samples)
          console.log(`[AgentWorkflow] Self-Consistency: ${samples.length} 次采样，多数票假设已选定`)
          return voted || first.hypothesis
        }
      } catch (err) {
        console.warn('[AgentWorkflow] llmReasoner 降级:', err instanceof Error ? err.message : err)
      }
    }

    // 降级路径：同步 LLM 结果或规则推导
    if (llmResult && llmResult.hypothesis) return llmResult.hypothesis
    return this.deriveHypothesis(evidences, problem)
  }

  /**
   * 根据证据和问题推导修复/诊断命令
   *
   * 优先匹配明确关键词（磁盘/内存/CPU/负载）。
   * 对于模糊问题（如"检查问题"、"看看状态"），返回综合健康检查脚本，
   * 而不是无意义的 echo，确保用户能看到实际诊断输出。
   */
  private deriveFixCommand(evidences: Evidence[], problem: string): string {
    if (evidences.length === 0) return 'echo "需要更多证据支持"'
    const lower = problem.toLowerCase()

    // 场景 1：慢查询 → Web 502（MySQL 慢查询 + Nginx upstream 超时）
    if (lower.includes('慢查询') || lower.includes('slow query') || lower.includes('502') ||
        lower.includes('nginx') || lower.includes('mysql') || lower.includes('数据库') ||
        lower.includes('超时') || lower.includes('timeout') || lower.includes('upstream')) {
      return "echo '=== 慢查询 → 502 诊断 ===' && echo '--- MySQL 进程列表 ---' && (mysql -e 'SHOW PROCESSLIST' 2>/dev/null || echo 'MySQL 未运行或无权限') && echo '--- MySQL 慢查询日志（最近10条） ---' && (tail -20 /var/log/mysql/mysql-slow.log 2>/dev/null || tail -20 /var/lib/mysql/*-slow.log 2>/dev/null || echo '未找到慢查询日志') && echo '--- Nginx 错误日志（最近10条） ---' && (tail -10 /var/log/nginx/error.log 2>/dev/null || echo '未找到 Nginx 日志') && echo '--- Nginx upstream 状态 ---' && (curl -s -o /dev/null -w 'HTTP %{http_code} (耗时 %{time_total}s)' http://localhost/ 2>/dev/null || echo 'Nginx 未响应')"
    }

    // 场景 2：磁盘满 → 服务异常
    if (lower.includes('磁盘') || lower.includes('disk') || lower.includes('space') ||
        lower.includes('空间') || lower.includes('满') || lower.includes('full') ||
        lower.includes('no space')) {
      return "echo '=== 磁盘满诊断 ===' && echo '--- 磁盘使用率 ---' && df -h && echo '--- /var/log 大文件 TOP10 ---' && du -sh /var/log/* 2>/dev/null | sort -rh | head -10 && echo '--- 根目录大目录 TOP10 ---' && du -sh /* 2>/dev/null | sort -rh | head -10 && echo '--- 已删除但未释放的文件 ---' && (lsof +L1 2>/dev/null | head -10 || echo 'lsof 不可用')"
    }

    // 场景 3：OOM Killer 杀进程
    if (lower.includes('oom') || lower.includes('out of memory') || lower.includes('内存') ||
        lower.includes('memory') || lower.includes('kill') || lower.includes('进程被杀') ||
        lower.includes('被杀')) {
      return "echo '=== OOM Killer 诊断 ===' && echo '--- 内核 OOM 日志 ---' && (dmesg | grep -i 'oom\\|out of memory\\|killed process' | tail -10 2>/dev/null || echo '无 OOM 记录') && echo '--- 内存使用 ---' && free -m && echo '--- Swap 使用 ---' && swapon --show 2>/dev/null && echo '--- 内存占用 TOP10 ---' && ps aux --sort=-%mem | head -10 && echo '--- 被杀服务状态 ---' && (systemctl status mysql nginx 2>/dev/null | head -20 || echo '服务状态查询失败')"
    }

    // CPU / 负载
    if (lower.includes('cpu') || lower.includes('负载') || lower.includes('load')) {
      return 'ps aux --sort=-%cpu | head -10'
    }

    // 通用健康检查：当问题模糊时给出一份结构化诊断输出
    return "echo '=== 系统健康检查 ===' && uname -a && echo '--- CPU/负载 ---' && uptime && cat /proc/loadavg && echo '--- 内存 ---' && free -h && echo '--- 磁盘 ---' && df -h && echo '--- 顶部进程 ---' && ps aux --sort=-%cpu | head -10"
  }

  /**
   * 根据证据和问题推导根因假设
   */
  private deriveHypothesis(evidences: Evidence[], problem: string): string {
    if (evidences.length === 0) return '暂无足够证据，需进一步排查'
    const lower = problem.toLowerCase()

    // 场景 1：慢查询 → 502
    if (lower.includes('慢查询') || lower.includes('slow query') || lower.includes('502') ||
        lower.includes('nginx') || lower.includes('mysql') || lower.includes('数据库')) {
      return `基于 ${evidences.length} 条证据分析：MySQL 慢查询导致连接池耗尽，Nginx upstream 超时返回 502。建议检查慢查询日志定位具体 SQL，优化查询或增加连接池上限。`
    }

    // 场景 2：磁盘满
    if (lower.includes('磁盘') || lower.includes('disk') || lower.includes('space') ||
        lower.includes('空间') || lower.includes('满') || lower.includes('full')) {
      return `基于 ${evidences.length} 条证据分析：磁盘空间不足导致服务写入失败（日志/临时文件/数据库）。建议清理 /var/log 旧日志、/tmp 临时文件，或扩容磁盘。`
    }

    // 场景 3：OOM Killer
    if (lower.includes('oom') || lower.includes('out of memory') || lower.includes('内存') ||
        lower.includes('memory') || lower.includes('kill') || lower.includes('被杀')) {
      return `基于 ${evidences.length} 条证据分析：系统内存不足触发 OOM Killer，终止了高内存进程。建议检查内存泄漏、调整 OOM 优先级（oom_score_adj）或增加物理内存/Swap。`
    }

    const hasErrors = evidences.some((e) =>
      e.content.toLowerCase().includes('error') ||
      e.content.toLowerCase().includes('failed') ||
      e.content.toLowerCase().includes('(exit=') ||
      e.content.toLowerCase().includes('(error:')
    )
    if (hasErrors) {
      return `基于 ${evidences.length} 条证据分析：部分采集命令失败或系统存在异常，建议执行综合健康检查进一步定位。`
    }
    if (lower.includes('检查') || lower.includes('查看') || lower.includes('status') || lower.includes('问题')) {
      return `基于 ${evidences.length} 条证据分析：当前请求为通用状态检查，已采集系统负载、内存、磁盘和进程信息，未发现明显告警。`
    }
    return `基于 ${evidences.length} 条证据分析：${problem}`
  }

  /**
   * 根据问题推导场景特定验证命令（verify 步骤用）
   *
   * 返回 null 表示使用通用验证（环境对比）。
   */
  private deriveVerifyCommand(problem: string): string | null {
    const lower = problem.toLowerCase()

    // 场景 1：慢查询 → 502 → 验证 HTTP 状态码恢复
    if (lower.includes('慢查询') || lower.includes('slow query') || lower.includes('502') ||
        lower.includes('nginx') || lower.includes('mysql') || lower.includes('数据库')) {
      return "echo '=== 验证：HTTP 状态 ===' && curl -s -o /dev/null -w 'HTTP %{http_code} (耗时 %{time_total}s)\\n' http://localhost/ 2>/dev/null && echo '--- MySQL 连接数 ---' && (mysql -e 'SHOW STATUS LIKE \"Threads_connected\"' 2>/dev/null || echo 'MySQL 查询失败')"
    }

    // 场景 2：磁盘满 → 验证磁盘使用率下降
    if (lower.includes('磁盘') || lower.includes('disk') || lower.includes('space') ||
        lower.includes('空间') || lower.includes('满') || lower.includes('full')) {
      return "echo '=== 验证：磁盘使用率 ===' && df -h / && echo '--- /var/log 当前大小 ---' && du -sh /var/log 2>/dev/null"
    }

    // 场景 3：OOM → 验证内存恢复 + 服务存活
    if (lower.includes('oom') || lower.includes('out of memory') || lower.includes('内存') ||
        lower.includes('memory') || lower.includes('kill') || lower.includes('被杀')) {
      return "echo '=== 验证：内存状态 ===' && free -m && echo '--- 服务存活检查 ---' && (systemctl is-active mysql nginx 2>/dev/null || echo '服务状态查询失败') && echo '--- 最近 OOM 记录 ---' && (dmesg | grep -i 'oom' | tail -3 2>/dev/null || echo '无')"
    }

    return null
  }

  /**
   * 发射完成事件
   */
  private emitComplete(): void {
    this.emit(WORKFLOW_EVENTS.COMPLETED, this.getState())
  }

  /**
   * 发射取消事件
   */
  private emitCancel(): void {
    this.emit(WORKFLOW_EVENTS.CANCELLED, this.getState())
  }

  /**
   * 安全序列化为字符串
   */
  private safeStringify(value: unknown): string {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  /**
   * 截断字符串到最大长度
   */
  private truncate(s: string, max = 500): string {
    return s.length > max ? s.slice(0, max) + '...' : s
  }
}
