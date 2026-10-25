/** agent 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { ChatMessage } from '@shared/models'
import type { PaorLoopResult } from '@shared/paor-types'
import type { ThinkingStrength } from '@shared/agent-types'
import { AGENT, PAOR } from '@shared/ipc-channels'
import { assertContractArgs } from '../../shared/ipc-contract'
import { ipcRenderer } from 'electron'
import { invokeChecked } from '../ipc-util'

/**
 * v0.9 Agent Runtime invoke 调用（Supervisor chat + 取消请求）
 */
const agentRuntime = {
  /**
   * 启动 Supervisor 流式 chat
   *
   * 异步执行，立即返回 correlationId。
   * 渲染进程通过 onAgentChunk/onAgentDone/onAgentError 监听后续事件。
   *
   * v0.9.4 新增：流式事件载荷携带 sessionId（可选，未传时主进程自动生成）
   *
   * @param messages 对话消息列表
   * @param providerId Provider ID（可选，不传用默认）
   * @param strength 思考强度（fast/standard/deep，可选）
   * @returns correlationId（用于监听事件 + 取消请求）
   */
  chat: (
    messages: ChatMessage[],
    providerId?: string,
    strength?: ThinkingStrength | 'auto',
    sshSessionId?: string,
    terminalContext?: string,
  ): Promise<string> => {
    assertContractArgs('agentChat', [messages, providerId, strength, sshSessionId, terminalContext])
    // 参数顺序与 src/shared/ipc-contract.ts 的 agentChat 声明逐位对齐：
    // 曾经在这里插一个占位 undefined 去顶主进程那个没人传的 sessionId 形参，
    // 于是线上跑 6 个位置、契约写 5 个，主进程侧按契约校验会把对话整条拒掉（P1-3 对账查出）。
    return ipcRenderer.invoke(
      AGENT.CHAT,
      messages,
      providerId,
      strength,
      sshSessionId,
      terminalContext,
    )
  },

  /**
   * 取消进行中的 chat 请求
   *
   * v0.9.4 改造：主进程 handler 已兼容 sessionId 与 correlationId 两种 ID
   * （先按 sessionId 查找 session-registry，回退到 correlationId）。
   * 调用方可传入任一种 ID，均可成功取消。
   *
   * @param sessionIdOrCorrelationId 会话 ID 或关联 ID
   * @returns 是否成功取消（false 表示请求已结束或不存在）
   */
  cancel: (sessionIdOrCorrelationId: string): Promise<boolean> =>
    invokeChecked<boolean>('agentChatCancel', AGENT.CHAT_CANCEL, sessionIdOrCorrelationId),

  /**
   * PAOR 自动循环（Plan→Act→Observe→Reflect 多步自主编排）
   *
   * 方案书 v0.9 §3.2：对多步运维任务自动规划并逐步执行，
   * 每轮迭代通过 agent:paor:iteration 事件实时推送到渲染进程。
   * 高危命令自动拦截（安全默认策略）。
   *
   * @param task 运维任务描述
   * @param sshSessionId SSH 会话 ID
   * @param maxIterations 最大迭代次数（默认 5）
   * @returns PAOR 循环完整结果（含可审计的迭代轨迹）
   */
  paor: (task: string, sshSessionId: string, maxIterations?: number): Promise<PaorLoopResult> =>
    invokeChecked<PaorLoopResult>('agentPaor', AGENT.PAOR, task, sshSessionId, maxIterations),

  /**
   * 响应 PAOR 审批请求（v0.9.5 新增）
   *
   * 主进程推送 paor:approval-request 事件后，
   * 渲染进程弹窗让用户确认，通过本函数回传审批结果。
   *
   * @param callId 审批调用 ID（来自 paor:approval-request 事件载荷）
   * @param approved 是否批准执行
   */
  approve: (callId: string, approved: boolean): Promise<boolean> =>
    ipcRenderer.invoke(PAOR.APPROVE, callId, approved),
}


export { agentRuntime }
