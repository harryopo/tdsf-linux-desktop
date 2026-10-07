// 生成物，别手改：来源 src/shared/ipc-contract.ts，重生成 pnpm ipc:gen
// 改了契约没重生成 → tests/unit/ipc-contract.test.ts 会红
import type { AgentChunkPayload, AgentDonePayload, AgentErrorPayload, PersistedProviderConfig, ProviderConfig, ThinkingStrength } from '@shared/agent-types'
import type { ChatMessage } from '@shared/models'
import type { PaorLoopResult } from '@shared/paor-types'

/** 已纳入契约的 invoke 通道：electronAPI 上这些方法的签名以这里为准 */
export interface ContractedInvokeApi {
  /** 发起一轮 Supervisor 对话，返回 correlationId
   * 通道 `agent:chat` */
  agentChat(messages: ChatMessage[], providerId?: string, strength?: ThinkingStrength | "auto", sshSessionId?: string, terminalContext?: string): Promise<string>

  /** 按 correlationId 或 sessionId 取消进行中的对话
   * 通道 `agent:chat:cancel` */
  agentChatCancel(sessionIdOrCorrelationId: string): Promise<boolean>

  /** 跑一轮 PAOR 自主循环
   * 通道 `agent:paor` */
  agentPaor(task: string, sshSessionId: string, maxIterations?: number): Promise<PaorLoopResult>

  /** 列出 Provider（不含 apiKey，附 hasApiKey）
   * 通道 `provider:list` */
  providerList(onlyEnabled?: boolean): Promise<PersistedProviderConfig[]>

  /** 取单个 Provider
   * 通道 `provider:get` */
  providerGet(id: string): Promise<PersistedProviderConfig | null>

  /** 保存 Provider（apiKey 由主进程走 SecureStore）
   * 通道 `provider:save` */
  providerSave(config: ProviderConfig): Promise<boolean>

  /** 设默认 Provider
   * 通道 `provider:set-default` */
  providerSetDefault(id: string): Promise<boolean>

  /** 读默认 Provider ID
   * 通道 `provider:get-default` */
  providerGetDefault(): Promise<string>
}

/** 已纳入契约的推送通道：订阅函数的负载类型以这里为准 */
export interface ContractedEventApi {
  /** 流式增量（前端按 messageSync 的事件分类表合并，不逐 token setState）
   * 通道 `agent:chunk` */
  onAgentChunk(callback: (payload: AgentChunkPayload) => void): () => void

  /** 本轮结束
   * 通道 `agent:done` */
  onAgentDone(callback: (payload: AgentDonePayload) => void): () => void

  /** 本轮失败
   * 通道 `agent:error` */
  onAgentError(callback: (payload: AgentErrorPayload) => void): () => void
}
