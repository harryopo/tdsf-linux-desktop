/**
 * Agent 工作流 IPC Handlers
 *
 * 注册 Agent 工作流相关的 IPC 通道，集成 LlmClient + AgentWorkflow +
 * SshConnectionManager + SystemMonitor 四大服务。
 *
 * 通道列表（与 IpcChannelMap 对应）：
 * - agent:start   — 启动 Agent 工作流（sessionId, problem）
 * - agent:confirm — 人工确认（sessionId, approved）
 * - agent:cancel  — 取消工作流
 *
 * Agent 步骤推送：
 * - 工作流步骤变化时通过 mainWindow.webContents.send('agent:step', state) 推送
 * - 渲染进程监听 'agent:step' 通道更新 UI
 *
 * 工作流管理：
 * - 每个 sessionId 对应一个独立的 AgentWorkflow 实例
 * - 使用 Map<sessionId, AgentWorkflow> 管理并发工作流
 * - 工作流完成后自动从 Map 中移除
 */

import { ipcMain, BrowserWindow } from 'electron'
import { AgentWorkflow, WORKFLOW_EVENTS } from '../core/agent-workflow'
import type { SshExecutor, EvidenceCollector } from '../core/agent-workflow'
import { SshConnectionManager } from '../services/ssh/connection-manager'
import { LlmClient } from '../services/llm/client'
import { ConfigStore } from '../services/storage/config-store'
import { SecureStore } from '../services/storage/secure-store'
import { DatabaseManager } from '../services/db/database'
import { DecisionRepository } from '../services/db/decision-repo'
import type { Evidence, LlmConfig } from '@shared/models'

/** Agent 步骤推送通道名 */
const AGENT_STEP_CHANNEL = 'agent:step'

/** 活跃工作流表：sessionId → AgentWorkflow */
const activeWorkflows = new Map<string, AgentWorkflow>()

/**
 * SSH 命令执行器适配器
 *
 * 将 SshConnectionManager.exec() 适配为 AgentWorkflow 需要的 SshExecutor 接口。
 */
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
      stderr: result.stderr
    }
  }
}

/**
 * LLM 证据采集器
 *
 * 使用 LlmClient.analyze() 将环境信息转化为证据条目。
 * 当 LLM 不可用时降级为空证据列表（AgentWorkflow 会用默认逻辑处理）。
 */
class LlmEvidenceCollector implements EvidenceCollector {
  private readonly llmClient: LlmClient

  constructor(llmClient: LlmClient) {
    this.llmClient = llmClient
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
        verified: true
      })
    }

    // 尝试用 LLM 分析问题，生成额外的诊断证据
    try {
      const analysis = await this.llmClient.analyze(problem, evidences)
      evidences.push({
        id: `ev_llm_${now}`,
        source: 'knowledge',
        sourceDetail: 'LLM 分析',
        content: `根因假设: ${analysis.hypothesis}\n建议命令: ${analysis.fixCommand}`,
        drainMatch: analysis.confidence,
        sourcePrior: 0.7,
        confidence: analysis.confidence,
        timestamp: now,
        verified: false
      })
    } catch {
      // LLM 分析失败不影响主流程
    }

    return evidences
  }
}

/**
 * 获取 LLM 客户端实例
 * @returns LlmClient 实例
 */
function getLlmClient(): LlmClient {
  const config = ConfigStore.getLlmConfig()
  if (!config) {
    return new LlmClient({
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.7,
      maxTokens: 2048,
      timeout: 30_000
    })
  }
  const apiKey = SecureStore.getApiKey('llm') ?? ''
  const fullConfig: LlmConfig = { ...config, apiKey }
  return new LlmClient(fullConfig)
}

/**
 * 注册 Agent 工作流相关 IPC handlers
 *
 * @param mainWindow 主窗口实例，用于推送步骤变化到渲染进程
 */
export function registerAgentHandlers(mainWindow: BrowserWindow): void {
  const sshManager = SshConnectionManager.getInstance()

  // ------------------------------------------------------------------
  // agent:start — 启动 Agent 工作流
  // ------------------------------------------------------------------

  /**
   * 参数：(sessionId: string, problem: string)
   * 返回：boolean（工作流是否成功启动）
   *
   * 工作流异步执行，步骤变化通过 'agent:step' 通道推送。
   * 完成后决策卡片自动保存到数据库。
   */
  ipcMain.handle(
    'agent:start',
    async (_event, sessionId: string, problem: string) => {
      // 已存在活跃工作流则拒绝
      if (activeWorkflows.has(sessionId)) {
        throw new Error(`会话 ${sessionId} 已有进行中的工作流`)
      }

      try {
        const workflow = new AgentWorkflow()
        activeWorkflows.set(sessionId, workflow)

        // 注册步骤变化事件 → 推送到渲染进程
        workflow.on(WORKFLOW_EVENTS.STEP_CHANGED, (state) => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send(AGENT_STEP_CHANNEL, state)
          }
        })

        // 注册完成事件 → 保存决策卡片并清理
        workflow.on(WORKFLOW_EVENTS.COMPLETED, (state) => {
          if (state.decisionCard) {
            try {
              const db = DatabaseManager.getInstance()
              const repo = new DecisionRepository(db)
              repo.save(state.decisionCard)
            } catch {
              // 保存失败不影响主流程
            }
          }
          activeWorkflows.delete(sessionId)
        })

        // 注册取消/错误事件 → 清理
        workflow.on(WORKFLOW_EVENTS.CANCELLED, () => {
          activeWorkflows.delete(sessionId)
        })
        workflow.on(WORKFLOW_EVENTS.ERROR, () => {
          activeWorkflows.delete(sessionId)
        })

        // 构造执行器和采集器
        const sshExecutor = new SshExecutorAdapter(sshManager)
        const llmClient = getLlmClient()
        const evidenceCollector = new LlmEvidenceCollector(llmClient)

        // 异步启动工作流（不等待完成，立即返回 true）
        workflow
          .start({
            problem,
            logs: '', // logs 可后续从渲染进程传入
            connId: sessionId,
            sshExecutor,
            evidenceCollector
          })
          .catch(() => {
            // 异常已在事件中处理，这里仅清理
            activeWorkflows.delete(sessionId)
          })

        return true
      } catch (err) {
        activeWorkflows.delete(sessionId)
        throw new Error(`启动 Agent 工作流失败: ${(err as Error).message}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // agent:confirm — 人工确认
  // ------------------------------------------------------------------

  /**
   * 参数：(sessionId: string, approved: boolean)
   * 返回：boolean（确认是否成功传递）
   *
   * 工作流在 confirm 步骤暂停等待，此方法恢复执行。
   */
  ipcMain.handle(
    'agent:confirm',
    async (_event, sessionId: string, approved: boolean) => {
      const workflow = activeWorkflows.get(sessionId)
      if (!workflow) {
        throw new Error(`会话 ${sessionId} 无活跃工作流`)
      }
      try {
        workflow.confirm(approved)
        return true
      } catch (err) {
        throw new Error(`确认失败: ${(err as Error).message}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // agent:cancel — 取消工作流
  // ------------------------------------------------------------------

  /**
   * 参数：(sessionId: string)
   * 返回：boolean
   */
  ipcMain.handle('agent:cancel', async (_event, sessionId: string) => {
    const workflow = activeWorkflows.get(sessionId)
    if (!workflow) {
      return false
    }
    try {
      workflow.cancel()
      activeWorkflows.delete(sessionId)
      return true
    } catch {
      return false
    }
  })
}

/**
 * 取消所有活跃工作流（应用退出时调用）
 */
export function cancelAllWorkflows(): void {
  for (const [, workflow] of activeWorkflows) {
    try {
      workflow.cancel()
    } catch {
      // 忽略取消错误
    }
  }
  activeWorkflows.clear()
}
