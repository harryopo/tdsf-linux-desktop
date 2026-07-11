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
    const { problem, logs, connId, sshExecutor, evidenceCollector } = params

    try {
      // Step 1: 采集环境
      const envInfo = await this.runStep('collect', async () => {
        return sshExecutor ? await this.collectEnvironment(connId, sshExecutor) : {}
      })

      // Step 2: 分析
      await this.runStep('analyze', async () => {
        return { problem, logsLength: logs.length, envInfoKeys: Object.keys(envInfo) }
      })

      // Step 3: 推理（采集证据）
      let evidences: Evidence[] = []
      await this.runStep('reason', async () => {
        if (evidenceCollector) {
          evidences = await evidenceCollector.collect(problem, envInfo)
        }
        return { evidenceCount: evidences.length }
      })

      // Step 4: 安全检查 + 决策卡片生成
      const fixCommand = this.deriveFixCommand(evidences, problem)
      await this.runStep('check', async () => {
        return assessRisk(fixCommand)
      })

      const card = generateDecisionCard(problem, this.deriveHypothesis(evidences, problem), evidences, fixCommand)
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

      // Step 6: 执行
      await this.runStep('execute', async () => {
        if (sshExecutor) {
          return await sshExecutor.execute(connId, fixCommand)
        }
        return { exitCode: 0, stdout: 'dry-run mode', stderr: '' }
      })

      // Step 7: 验证
      await this.runStep('verify', async () => {
        if (sshExecutor) {
          const postEnv = await this.collectEnvironment(connId, sshExecutor)
          return { envChanged: JSON.stringify(postEnv) !== JSON.stringify(envInfo) }
        }
        return { envChanged: false }
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
    this.state = this.createInitialState()
  }

  /**
   * 执行单个步骤，自动更新状态并发射事件
   * @param step - 步骤名
   * @param fn - 步骤执行函数
   * @returns 步骤执行结果
   */
  private async runStep<T>(step: AgentStep, fn: () => Promise<T>): Promise<T> {
    this.state.currentStep = step
    this.emit(WORKFLOW_EVENTS.STEP_CHANGED, this.getState())
    const result = await fn()
    this.state.completedSteps.push(step)
    this.state.stepDetails[step] = this.truncate(this.safeStringify(result))
    return result
  }

  /**
   * 等待人工确认（通过 Promise 暂停）
   */
  private async waitForConfirmation(): Promise<boolean> {
    this.state.waitingForConfirmation = true
    this.emit(WORKFLOW_EVENTS.CONFIRMATION_REQUIRED, this.state.decisionCard)
    return new Promise<boolean>((resolve) => {
      this.confirmResolve = resolve
    })
  }

  /**
   * 通过 SSH 采集环境信息
   */
  private async collectEnvironment(
    connId: string,
    ssh: SshExecutor
  ): Promise<Record<string, string>> {
    const envInfo: Record<string, string> = {}
    for (const cmd of ENV_COMMANDS) {
      try {
        const result = await ssh.execute(connId, cmd, 10)
        envInfo[cmd] = result.exitCode === 0 ? result.stdout.trim() : `(exit=${result.exitCode})`
      } catch (err) {
        envInfo[cmd] = `(error: ${err instanceof Error ? err.message : 'unknown'})`
      }
    }
    return envInfo
  }

  /**
   * 根据证据和问题推导修复命令
   */
  private deriveFixCommand(evidences: Evidence[], problem: string): string {
    if (evidences.length === 0) return 'echo "需要更多证据支持"'
    const lower = problem.toLowerCase()
    if (lower.includes('磁盘') || lower.includes('disk') || lower.includes('space')) {
      return 'df -h'
    }
    if (lower.includes('内存') || lower.includes('memory') || lower.includes('oom')) {
      return 'free -m'
    }
    if (lower.includes('cpu') || lower.includes('负载') || lower.includes('load')) {
      return 'ps aux --sort=-%cpu | head -10'
    }
    return 'echo "请人工诊断"'
  }

  /**
   * 根据证据和问题推导根因假设
   */
  private deriveHypothesis(evidences: Evidence[], problem: string): string {
    if (evidences.length === 0) return '暂无足够证据，需进一步排查'
    return `基于 ${evidences.length} 条证据分析：${problem}`
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
