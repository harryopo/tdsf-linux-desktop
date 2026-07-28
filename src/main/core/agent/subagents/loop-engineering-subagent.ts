/**
 * 循环工程配置子 Agent（Loop Engineering Subagent）
 *
 * 用户原话：
 *   "我要从「假设计 → 可演示真 IDE」做完一整轮，你设计循环工程配置子agent达到这个目标"
 *   "之前是，「视觉壳 + mock 数据」，还没真正接到 Agent"
 *
 * 核心职责（编排者，非标准 SubagentName）：
 *   1. 调用 Supervisor.chat 做 LLM 推理，从自然语言问题提取
 *      { hypothesis, fixCommand, confidence } 三元组（假设计阶段）
 *   2. 启动 AgentWorkflow 7 步 HITL（collect→analyze→reason→check→confirm→execute→verify）
 *      把 LLM 推理结果通过 getLlmFixCommand 注入工作流
 *   3. 通过 EventEmitter 向 IPC 层推送实时进度：
 *      - 'loop:step'      — 步骤变化（含完整 AgentWorkflowState）
 *      - 'loop:decision'  — 决策卡片就绪（含 DecisionCard，confirm 步骤触发）
 *      - 'loop:done'      — 工作流完成（含最终 DecisionCard）
 *      - 'loop:error'     — 工作流出错（含错误信息）
 *   4. 把关键日志转发到 DiagnosticsService（实现"检测后端"）：
 *      - LLM 推理阶段日志
 *      - SSH 命令执行日志
 *      - 工作流步骤变化日志
 *      - 错误日志
 *
 * 架构：
 *   [AIPanel 演示模式]
 *         ↓ loop:start IPC（problem + connId）
 *   [LoopEngineeringSubagent]
 *         ├── 1. Supervisor.chat → LLM 推理 → {hypothesis, fixCommand, confidence}
 *         ├── 2. AgentWorkflow.start({ getLlmFixCommand, sshExecutor, evidenceCollector })
 *         │      └── 7 步 HITL：collect→analyze→reason→check→confirm→execute→verify
 *         ├── 3. EventEmitter → IPC 推送 loop:step/decision/done/error
 *         └── 4. DiagnosticsService.ingestLog({source:'agent', level, raw})
 *
 * 与现有 Supervisor.chat 主路径的关系：
 *   - Supervisor.chat 仍是 AIPanel 普通对话的主路径（保留不动）
 *   - 本子 agent 是"演示模式"专用编排器，复用 Supervisor.chat 做 LLM 推理
 *   - 复用 AgentWorkflow 做 7 步 HITL 执行
 *   - 复用 DiagnosticsService 做日志检测
 *
 * 方案书依据：
 *   - v0.9 §3.1（Subagent 架构）
 *   - v0.9 §3.2（PAOR 循环 - 本子 agent 实现简化的 P→A→O→R）
 *   - v1.5 诊断服务（循环工程启动时利用后端的日志进行分析）
 *   - AGENT_MAIN_PATH.md（Supervisor.chat 主路径冻结）
 */

import { EventEmitter } from 'node:events'
import type { ModelMessage } from 'ai'
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'
import { getSupervisor } from '../supervisor'
import { AgentWorkflow, WORKFLOW_EVENTS, type SshExecutor, type EvidenceCollector } from '../../agent-workflow'
import type { AgentWorkflowState, DecisionCard, Evidence } from '../../../../shared/models'
import { SshConnectionManager } from '../../../services/ssh/connection-manager'
import { LlmClient } from '../../../services/llm/client'
import { resolveLlmConfig } from '../../../services/llm/llm-config-resolver'
import type { ChatMessage } from '../../../../shared/models'
import { getDiagnosticsService } from '../../../services/diagnostics/diagnostics-service'
import type { LogSource, LogLevel } from '../../../services/diagnostics/types'
import type { ThinkingStrength } from '../providers/types'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 循环工程子 agent 输入
 */
export interface LoopEngineeringInput {
  /** 用户问题描述（自然语言，如"磁盘空间不足"） */
  problem: string
  /** SSH 连接 ID（已连接的服务器 sessionId） */
  connId: string
  /** Provider ID（不传用默认） */
  providerId?: string
  /** 思考强度 */
  strength?: ThinkingStrength
  /** 关联 ID（用于日志追踪） */
  correlationId?: string
}

/**
 * LLM 推理结果（假设计阶段输出）
 *
 * 通过 Supervisor.chat 调用 LLM 后解析得到，注入 AgentWorkflow.getLlmFixCommand。
 */
export interface LlmHypothesis {
  /** 根因假设（自然语言描述） */
  hypothesis: string
  /** 建议修复命令（Shell 命令） */
  fixCommand: string
  /** LLM 自评置信度 [0, 1] */
  confidence: number
}

/**
 * 循环工程子 agent 事件
 */
export type LoopEngineeringEvent =
  | { type: 'loop:llm-start'; correlationId: string; problem: string }
  | { type: 'loop:llm-done'; correlationId: string; hypothesis: LlmHypothesis }
  | { type: 'loop:step'; correlationId: string; state: AgentWorkflowState }
  | { type: 'loop:decision'; correlationId: string; state: AgentWorkflowState; decisionCard: DecisionCard }
  | { type: 'loop:done'; correlationId: string; state: AgentWorkflowState; decisionCard: DecisionCard | null }
  | { type: 'loop:error'; correlationId: string; error: string; state?: AgentWorkflowState }
  | { type: 'loop:blocked'; correlationId: string; step: string; reason: string; message: string }

// ============================================================================
// SSH 执行器适配器（复用 agent.ts 中的实现，独立一份避免循环依赖）
// ============================================================================

class SshExecutorAdapter implements SshExecutor {
  private readonly sshManager: SshConnectionManager

  constructor(sshManager: SshConnectionManager) {
    this.sshManager = sshManager
  }

  async execute(
    connId: string,
    command: string,
    _timeout?: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await this.sshManager.exec(connId, command)
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }
}

// ============================================================================
// LLM 证据采集器（复用 agent.ts 中的实现，独立一份避免循环依赖）
// ============================================================================

class LlmEvidenceCollector implements EvidenceCollector {
  private readonly llmClient: LlmClient
  /** LLM 分析结果（供工作流读取 fixCommand） */
  llmAnalysis: LlmHypothesis | null = null
  /** 日志转发器（可选） */
  private readonly logForwarder?: (level: LogLevel, raw: string) => void

  constructor(llmClient: LlmClient, logForwarder?: (level: LogLevel, raw: string) => void) {
    this.llmClient = llmClient
    this.logForwarder = logForwarder
  }

  async collect(
    problem: string,
    envInfo: Record<string, string>
  ): Promise<Evidence[]> {
    const evidences: Evidence[] = []
    const now = Date.now()

    // 将环境信息转化为证据条目
    for (const [cmd, output] of Object.entries(envInfo)) {
      evidences.push({
        id: `ev_${now}_${Math.random().toString(36).slice(2, 8)}`,
        source: 'command',
        sourceDetail: cmd,
        content: output,
        drainMatch: 0.8,
        sourcePrior: 0.9,
        confidence: 0.8,
        timestamp: now,
        verified: true,
      })
    }

    // 尝试用 LLM 分析问题，生成额外的诊断证据
    try {
      const analysis = await this.llmClient.analyze(problem, evidences)
      this.llmAnalysis = {
        hypothesis: analysis.hypothesis,
        fixCommand: analysis.fixCommand,
        confidence: analysis.confidence,
      }
      evidences.push({
        id: `ev_llm_${now}`,
        source: 'knowledge',
        sourceDetail: 'LLM 分析',
        content: `根因假设: ${analysis.hypothesis}\n建议命令: ${analysis.fixCommand}`,
        drainMatch: analysis.confidence,
        sourcePrior: 0.7,
        confidence: analysis.confidence,
        timestamp: now,
        verified: false,
      })
      this.logForwarder?.('INFO', `[LlmEvidenceCollector] LLM 分析完成：${analysis.hypothesis}`)
    } catch (err) {
      // LLM 分析失败不影响主流程
      this.logForwarder?.(
        'WARN',
        `[LlmEvidenceCollector] LLM 分析失败：${err instanceof Error ? err.message : String(err)}`
      )
    }

    return evidences
  }
}

// ============================================================================
// 循环工程子 Agent 主类
// ============================================================================

/**
 * LoopEngineeringSubagent
 *
 * 继承 BaseSubagent 但不注册到 SubagentName 联合类型（避免修改现有接口）。
 * 通过 createLoopEngineeringSubagent() 工厂方法创建，由 IPC 层直接持有实例。
 *
 * 使用方式：
 *   const sub = createLoopEngineeringSubagent()
 *   sub.on('loop:step', (evt) => ipcPush(evt))
 *   const result = await sub.execute(task)
 */
export class LoopEngineeringSubagent extends BaseSubagent {
  readonly name = 'loop-engineering' as const
  readonly displayName = '循环工程 Subagent'
  readonly description = '编排 Supervisor.chat + AgentWorkflow 7 步 HITL + DiagnosticsService 日志检测'

  /** 内部 EventEmitter，供 IPC 层订阅 */
  public readonly events = new EventEmitter()

  /** 活跃工作流表：correlationId → AgentWorkflow（用于 confirm/cancel） */
  private readonly activeWorkflows = new Map<string, AgentWorkflow>()

  /** SSH 连接管理器（单例） */
  private readonly sshManager = SshConnectionManager.getInstance()

  /** 诊断服务（单例） */
  private readonly diagnostics = getDiagnosticsService()

  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const input = task.input as LoopEngineeringInput
    const correlationId =
      task.correlationId ?? input.correlationId ?? `loop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 参数校验
    if (!input?.problem || !input?.connId) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: 'LoopEngineeringInput 缺少必需字段：problem / connId',
        durationMs: 0,
      }
    }

    // ─── SSH 预检查：显式检测是否有活动 SSH 连接 ───────────────────
    // 不依赖 requireConnected 抛错兜底，提供更早的 UI 提示
    // 原有 requireConnected 抛错兜底保留作为第二层防线
    if (!this.sshManager.hasActiveConnection()) {
      const blockedMessage = '请先连接 SSH 服务器后再执行此操作'
      this.emit('loop:blocked', {
        correlationId,
        step: 'execute',
        reason: 'SSH_NO_CONNECTION',
        message: blockedMessage,
      })
      this.forwardLog(
        'agent',
        'WARN',
        `[LoopEngineering] SSH 预检查未通过：无活动连接，已阻止 execute 步骤`
      )
      return {
        taskId: task.id,
        success: false,
        output: { correlationId, status: 'blocked', reason: 'SSH_NO_CONNECTION' },
        error: blockedMessage,
        durationMs: 0,
      }
    }

    this.log.info('[LoopEngineering] 循环工程启动', {
      taskId: task.id,
      correlationId,
      problem: input.problem,
      connId: input.connId,
      providerId: input.providerId,
      strength: input.strength,
    })

    // 转发日志到 DiagnosticsService
    this.forwardLog('agent', 'INFO', `[LoopEngineering] 启动循环工程：${input.problem}`)

    try {
      // ─── 阶段 1：LLM 推理（假设计） ───────────────────────────
      // 通过 Supervisor.chat 调用 LLM，从自然语言问题提取 hypothesis + fixCommand
      this.emit('loop:llm-start', { correlationId, problem: input.problem })
      this.forwardLog('agent', 'INFO', `[LoopEngineering] 阶段 1：LLM 推理（Supervisor.chat）`)

      const hypothesis = await this.runLlmHypothesis(input, correlationId)

      this.emit('loop:llm-done', { correlationId, hypothesis })
      this.forwardLog(
        'agent',
        'INFO',
        `[LoopEngineering] LLM 推理完成：${hypothesis.hypothesis}（confidence=${hypothesis.confidence}）`
      )

      // ─── 阶段 2：启动 AgentWorkflow 7 步 HITL ───────────────────
      this.forwardLog('agent', 'INFO', `[LoopEngineering] 阶段 2：启动 AgentWorkflow 7 步 HITL`)

      const workflow = new AgentWorkflow()
      this.activeWorkflows.set(correlationId, workflow)

      // 注册工作流事件 → 转发到 IPC 层 + DiagnosticsService
      this.attachWorkflowListeners(workflow, correlationId)

      // 构造执行器和采集器
      const sshExecutor = new SshExecutorAdapter(this.sshManager)
      const llmClient = this.getLlmClient()
      const evidenceCollector = new LlmEvidenceCollector(llmClient, (level, raw) =>
        this.forwardLog('agent', level, raw)
      )
      // 注入 LLM 推理结果（优先用 Supervisor.chat 的结果，再降级到 LlmClient.analyze）
      evidenceCollector.llmAnalysis = hypothesis

      // 异步启动工作流（不等待完成，立即返回 pending 结果）
      // 工作流完成后通过 'loop:done' 事件通知 IPC 层
      void workflow
        .start({
          problem: input.problem,
          logs: '',
          connId: input.connId,
          sshExecutor,
          evidenceCollector,
          getLlmFixCommand: () => evidenceCollector.llmAnalysis,
        })
        .then((decisionCard) => {
          const state = workflow.getState()
          this.emit('loop:done', {
            correlationId,
            state,
            decisionCard,
          })
          this.forwardLog(
            'agent',
            decisionCard?.status === 'verified' ? 'INFO' : 'WARN',
            `[LoopEngineering] 工作流完成：status=${decisionCard?.status ?? 'null'}`
          )
          // 延迟清理 Map，确保 IPC 层有时间接收最终状态
          setTimeout(() => this.activeWorkflows.delete(correlationId), 1000)
        })
        .catch((err: unknown) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          this.emit('loop:error', {
            correlationId,
            error: errorMsg,
            state: workflow.getState(),
          })
          this.forwardLog('agent', 'ERROR', `[LoopEngineering] 工作流异常：${errorMsg}`)
          this.activeWorkflows.delete(correlationId)
        })

      // 立即返回 pending 结果（工作流异步执行，最终结果通过事件推送）
      return {
        taskId: task.id,
        success: true,
        output: {
          correlationId,
          hypothesis,
          status: 'workflow-started',
          message: '循环工程已启动，监听 loop:* 事件获取进度',
        },
        confidence: hypothesis.confidence,
        durationMs: 0,
        requiresApproval: true, // 等待用户在 confirm 步骤批准
        approvalPreview: `建议命令：${hypothesis.fixCommand}`,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.emit('loop:error', { correlationId, error: errorMsg })
      this.forwardLog('agent', 'ERROR', `[LoopEngineering] 启动失败：${errorMsg}`)
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: errorMsg,
        durationMs: 0,
      }
    }
  }

  // ========================================================================
  // 公开方法（供 IPC 层调用）
  // ========================================================================

  /**
   * 用户确认/拒绝执行
   *
   * 在 'loop:decision' 事件触发后调用此方法恢复工作流。
   *
   * @param correlationId 关联 ID
   * @param approved true 批准执行，false 拒绝
   * @param newCommand T.6: 用户修改后的修复命令（approved=true 时生效）
   */
  confirm(correlationId: string, approved: boolean, newCommand?: string): boolean {
    const workflow = this.activeWorkflows.get(correlationId)
    if (!workflow) {
      this.log.warn(`[LoopEngineering] confirm 失败：correlationId 不存在或工作流已结束`, { correlationId })
      return false
    }
    try {
      workflow.confirm(approved, newCommand)
      this.forwardLog('agent', 'INFO', `[LoopEngineering] 用户${approved ? '批准' : '拒绝'}执行`)
      return true
    } catch (err) {
      this.forwardLog(
        'agent',
        'ERROR',
        `[LoopEngineering] confirm 失败：${err instanceof Error ? err.message : String(err)}`
      )
      return false
    }
  }

  /**
   * 取消工作流
   *
   * @param correlationId 关联 ID
   */
  cancel(correlationId: string): boolean {
    const workflow = this.activeWorkflows.get(correlationId)
    if (!workflow) {
      return false
    }
    try {
      workflow.cancel()
      this.activeWorkflows.delete(correlationId)
      this.forwardLog('agent', 'WARN', `[LoopEngineering] 工作流已取消`)
      return true
    } catch {
      return false
    }
  }

  // ========================================================================
  // 内部方法
  // ========================================================================

  /**
   * 阶段 1：LLM 推理（假设计）
   *
   * 通过 Supervisor.chat 调用 LLM，让模型从自然语言问题中提取：
   * - hypothesis：根因假设
   * - fixCommand：建议修复命令
   * - confidence：置信度
   *
   * 使用 system prompt 约束 LLM 输出 JSON 格式。
   */
  private async runLlmHypothesis(
    input: LoopEngineeringInput,
    correlationId: string
  ): Promise<LlmHypothesis> {
    const supervisor = getSupervisor()

    // 构造 system prompt，约束 LLM 输出 JSON（含 3 个竞赛演示场景示例）
    const systemPrompt = `你是一位资深的 Linux 运维工程师。请分析用户的问题，给出根因假设和建议修复命令。

要求：
1. 必须返回 JSON 格式：{"hypothesis": "...", "fixCommand": "...", "confidence": 0.0-1.0}
2. fixCommand 必须是可直接执行的 Shell 命令（只读诊断命令优先）
3. confidence 表示你对根因假设的置信度（0.0-1.0）
4. 不要返回任何其他内容，只返回 JSON

场景示例：

问题："网站返回502，数据库有慢查询"
返回：{"hypothesis":"MySQL 慢查询导致连接池耗尽，Nginx upstream 超时返回 502。需检查慢查询日志定位具体 SQL","fixCommand":"echo '--- MySQL 进程 ---' && mysql -e 'SHOW PROCESSLIST' 2>/dev/null && echo '--- 慢查询日志 ---' && tail -20 /var/log/mysql/mysql-slow.log 2>/dev/null && echo '--- Nginx 错误 ---' && tail -10 /var/log/nginx/error.log 2>/dev/null","confidence":0.85}

问题："磁盘空间不足，服务写入失败"
返回：{"hypothesis":"磁盘空间被日志或临时文件占满，导致服务无法写入。需定位大文件并清理","fixCommand":"df -h && du -sh /var/log/* 2>/dev/null | sort -rh | head -10 && du -sh /tmp/* 2>/dev/null | sort -rh | head -5","confidence":0.9}

问题："进程被OOM Killer杀掉了"
返回：{"hypothesis":"系统内存不足触发 OOM Killer，终止了高内存进程。需检查内存使用和 OOM 日志","fixCommand":"dmesg | grep -i 'oom\\\\|killed process' | tail -10 && free -m && ps aux --sort=-%mem | head -10","confidence":0.88}

问题："磁盘空间不足"
返回：{"hypothesis":"磁盘空间可能被日志或临时文件占满","fixCommand":"df -h && du -sh /var/log/* 2>/dev/null | sort -rh | head -10","confidence":0.85}`

    const userMessage: ChatMessage = {
      role: 'user',
      content: `服务器连接 ID: ${input.connId}\n问题: ${input.problem}\n\n请分析并返回 JSON。`,
    }

    // 收集完整 LLM 响应
    let fullText = ''
    await new Promise<void>((resolve, reject) => {
      void supervisor.chat({
        messages: [
          { role: 'system', content: systemPrompt } as ModelMessage,
          userMessage as ModelMessage,
        ],
        providerId: input.providerId,
        strength: input.strength ?? 'standard',
        correlationId: `${correlationId}_llm`,
        onToken: (delta) => {
          fullText += delta
        },
        onDone: () => resolve(),
        onError: (err) => reject(err),
      })
    })

    // 解析 JSON（容错：尝试提取 JSON 片段）
    const hypothesis = this.parseLlmHypothesis(fullText)
    return hypothesis
  }

  /**
   * 解析 LLM 输出的 JSON（容错处理）
   */
  private parseLlmHypothesis(text: string): LlmHypothesis {
    const fallback: LlmHypothesis = {
      hypothesis: 'LLM 输出解析失败，使用默认诊断命令',
      fixCommand:
        "echo '=== 系统健康检查 ===' && uname -a && echo '--- CPU/负载 ---' && uptime && echo '--- 内存 ---' && free -h && echo '--- 磁盘 ---' && df -h",
      confidence: 0.3,
    }

    if (!text || text.trim().length === 0) {
      return fallback
    }

    try {
      // 尝试直接解析
      const parsed = JSON.parse(text)
      if (
        typeof parsed.hypothesis === 'string' &&
        typeof parsed.fixCommand === 'string' &&
        typeof parsed.confidence === 'number'
      ) {
        return {
          hypothesis: parsed.hypothesis,
          fixCommand: parsed.fixCommand,
          confidence: Math.max(0, Math.min(1, parsed.confidence)),
        }
      }
    } catch {
      // 不是纯 JSON，尝试提取 JSON 片段
    }

    // 尝试从 markdown code block 中提取
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1].trim())
        if (
          typeof parsed.hypothesis === 'string' &&
          typeof parsed.fixCommand === 'string' &&
          typeof parsed.confidence === 'number'
        ) {
          return {
            hypothesis: parsed.hypothesis,
            fixCommand: parsed.fixCommand,
            confidence: Math.max(0, Math.min(1, parsed.confidence)),
          }
        }
      } catch {
        // 忽略
      }
    }

    // 尝试从 { ... } 中提取
    const jsonObjMatch = text.match(/\{[\s\S]*\}/)
    if (jsonObjMatch) {
      try {
        const parsed = JSON.parse(jsonObjMatch[0])
        if (
          typeof parsed.hypothesis === 'string' &&
          typeof parsed.fixCommand === 'string' &&
          typeof parsed.confidence === 'number'
        ) {
          return {
            hypothesis: parsed.hypothesis,
            fixCommand: parsed.fixCommand,
            confidence: Math.max(0, Math.min(1, parsed.confidence)),
          }
        }
      } catch {
        // 忽略
      }
    }

    return fallback
  }

  /**
   * 附加工作流事件监听器 → 转发到 IPC 层 + DiagnosticsService
   */
  private attachWorkflowListeners(workflow: AgentWorkflow, correlationId: string): void {
    // 步骤变化 → loop:step
    workflow.on(WORKFLOW_EVENTS.STEP_CHANGED, (state: AgentWorkflowState) => {
      this.emit('loop:step', { correlationId, state })
      this.forwardLog(
        'agent',
        'DEBUG',
        `[LoopEngineering] 步骤变化：${state.currentStep}（waiting=${state.waitingForConfirmation}）`
      )
    })

    // 等待人工确认 → loop:decision（携带完整状态 + 决策卡片）
    workflow.on(WORKFLOW_EVENTS.CONFIRMATION_REQUIRED, (state: AgentWorkflowState) => {
      if (state.decisionCard) {
        this.emit('loop:decision', {
          correlationId,
          state,
          decisionCard: state.decisionCard,
        })
        this.forwardLog(
          'agent',
          'INFO',
          `[LoopEngineering] 决策卡片就绪，等待用户确认：${state.decisionCard.fixCommand}`
        )
      }
    })

    // 工作流完成 → loop:done（已在 start().then() 中处理，这里不重复）
    workflow.on(WORKFLOW_EVENTS.COMPLETED, (state: AgentWorkflowState) => {
      this.forwardLog(
        'agent',
        'INFO',
        `[LoopEngineering] 工作流 COMPLETED 事件：step=${state.currentStep}, cardStatus=${state.decisionCard?.status ?? 'null'}`
      )
    })

    // 取消
    workflow.on(WORKFLOW_EVENTS.CANCELLED, (state: AgentWorkflowState) => {
      this.emit('loop:done', {
        correlationId,
        state,
        decisionCard: state.decisionCard,
      })
      this.forwardLog('agent', 'WARN', `[LoopEngineering] 工作流已取消`)
    })

    // 错误
    workflow.on(WORKFLOW_EVENTS.ERROR, (errMsg: unknown) => {
      const errorMsg = typeof errMsg === 'string' ? errMsg : String(errMsg)
      this.emit('loop:error', {
        correlationId,
        error: errorMsg,
        state: workflow.getState(),
      })
      this.forwardLog('agent', 'ERROR', `[LoopEngineering] 工作流错误：${errorMsg}`)
    })
  }

  /**
   * 获取 LLM 客户端实例（配置统一走 resolveLlmConfig，Provider 体系优先）
   */
  private getLlmClient(): LlmClient {
    return new LlmClient(resolveLlmConfig('loop-engineering-subagent'))
  }

  /**
   * 转发日志到 DiagnosticsService
   *
   * 实现"建立一个检测的后端，当循环工程启动时利用后端的日志进行分析"。
   */
  private forwardLog(source: LogSource, level: LogLevel, raw: string): void {
    try {
      this.diagnostics.ingestLog({
        timestamp: new Date().toISOString(),
        source,
        level,
        raw,
      })
    } catch (err) {
      // 日志转发失败不影响主流程
      this.log.warn('[LoopEngineering] 转发日志到 DiagnosticsService 失败', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * EventEmitter.emit 包装（自动注入 type 属性）
   */
  private emit<T extends LoopEngineeringEvent['type']>(
    type: T,
    payload: Omit<Extract<LoopEngineeringEvent, { type: T }>, 'type'>
  ): boolean {
    const event = { type, ...payload } as unknown as LoopEngineeringEvent
    return this.events.emit(type, event)
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let loopEngineeringInstance: LoopEngineeringSubagent | null = null

/**
 * 获取 LoopEngineeringSubagent 单例
 *
 * @returns LoopEngineeringSubagent 实例
 */
export function getLoopEngineeringSubagent(): LoopEngineeringSubagent {
  if (!loopEngineeringInstance) {
    loopEngineeringInstance = new LoopEngineeringSubagent()
  }
  return loopEngineeringInstance
}

/**
 * 重置单例（仅用于测试）
 */
export function resetLoopEngineeringSubagent(): void {
  if (loopEngineeringInstance) {
    loopEngineeringInstance.events.removeAllListeners()
    loopEngineeringInstance = null
  }
}
