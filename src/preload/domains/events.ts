/** events 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { AgentChunkPayload, AgentDonePayload, AgentErrorPayload, AgentToolEventPayload } from '@shared/agent-types'
import type { AgentWorkflowState, ExternalMcpServerStatus, LlmError, LlmStreamChunk, McpStateContext, MonitorData, SftpProgressEvent, SshHostKeyPromptEvent, SshStateEvent, SystemInfo } from '@shared/models'
import type { PaorIterationEvent } from '@shared/paor-types'
import type { SchedulerTaskStatus } from '@shared/scheduler-types'
import { AGENT, CLAUDE_SDK, FILE_WATCH, LOCAL_TTY, LLM, LOOP, MCP, MONITOR, PAOR, SANDBOX, SCHEDULER, SFTP, SSH, TASK, TERMINAL } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import type { FileChangedPayload, PaorApprovalRequest, SandboxApprovalRequest, TaskPermissionApprovalRequest } from '../types'
import { createListener } from '../ipc-util'

/**
 * 事件监听 API
 *
 * 每个方法返回一个取消监听函数，调用后移除该监听器。
 * 推荐在 React useEffect 中使用：
 *   useEffect(() => {
 *     const off = window.electronAPI.on.terminalData((sid, data) => {...})
 *     return off  // 组件卸载时自动取消监听
 *   }, [])
 */
const on = {
  /** 监听终端 Shell 数据推送（shellId 定位是哪个终端，2026-10-10 起不再按 sessionId） */
  terminalData: (callback: (shellId: string, data: string) => void): (() => void) => {
    return createListener(TERMINAL.DATA, callback)
  },

  /**
   * 监听本机终端进程退出（载荷是退出的那条 shellId）
   *
   * 输出复用 terminal:data，退出单独一条：远端终端没有"进程退出"这种推送可依赖，
   * 而本机终端用户天天敲 exit，标签必须跟着走。
   */
  localTtyExit: (callback: (shellId: string) => void): (() => void) => {
    return createListener(LOCAL_TTY.EXIT, callback)
  },

  /** 监听 SSH 心跳保活状态变更（K.2：心跳失败/重连/最终断开时推送） */
  sshStateChanged: (callback: (event: SshStateEvent) => void): (() => void) => {
    return createListener(SSH.STATE_CHANGED, callback)
  },

  /**
   * 监听主机密钥确认弹窗推送（Phase L）
   *
   * 首次连接或密钥变更时，主进程推送 SshHostKeyPromptEvent，
   * 渲染进程弹窗等待用户选择后通过 sshRespondHostKey 响应。
   */
  sshHostKeyPrompt: (callback: (prompt: SshHostKeyPromptEvent) => void): (() => void) => {
    return createListener(SSH.HOST_KEY_PROMPT, callback)
  },

  /** 监听监控数据推送（实时指标，每 interval 秒一次） */
  monitorData: (callback: (sessionId: string, data: MonitorData) => void): (() => void) => {
    return createListener(MONITOR.DATA, callback)
  },

  /** 监听系统信息推送（首次采集时推送一次） */
  monitorSystemInfo: (callback: (sessionId: string, info: SystemInfo) => void): (() => void) => {
    return createListener(MONITOR.SYSTEM_INFO, callback)
  },

  /**
   * 监听 SFTP 上传/下载进度推送（v0.9.7 SFTP 文件浏览增强）
   *
   * 主进程在 sftp:upload / sftp:download 传输过程中通过 step 回调推送进度，
   * 渲染进程通过本监听器接收 SftpProgressEvent，更新传输队列 UI。
   */
  sftpProgress: (callback: (event: SftpProgressEvent) => void): (() => void) => {
    return createListener(SFTP.PROGRESS, callback)
  },

  /** 监听 LLM 流式 token 推送（兼容旧版） */
  llmToken: (callback: (token: string) => void): (() => void) => {
    return createListener(LLM.TOKEN, callback)
  },

  /** 监听 LLM 流式 token 块推送（增强版，含 totalTokens） */
  llmChunk: (callback: (chunk: LlmStreamChunk) => void): (() => void) => {
    return createListener(LLM.CHUNK, callback)
  },

  /** 监听 LLM 流式完成信号（含完整文本） */
  llmDone: (callback: (fullText: string) => void): (() => void) => {
    return createListener(LLM.DONE, callback)
  },

  /** 监听 LLM 流式错误信号（含错误码/消息/是否可重试） */
  llmError: (callback: (error: LlmError) => void): (() => void) => {
    return createListener(LLM.ERROR, callback)
  },

  /** 监听 Agent 工作流步骤变更 */
  agentStep: (callback: (state: AgentWorkflowState) => void): (() => void) => {
    return createListener(AGENT.STEP, callback)
  },

  // v0.9.5 P0 新增：MCP 5 阶段生命周期状态机（借鉴 claw-code §3.3）
  /** 获取 MCP 状态机当前状态 */
  mcpGetState: (): Promise<McpStateContext> => {
    return ipcRenderer.invoke(MCP.GET_STATE)
  },
  /** 重置 MCP 状态机（用户手动恢复） */
  mcpReset: (): Promise<boolean> => {
    return ipcRenderer.invoke(MCP.RESET)
  },
  /** 监听 MCP 状态变更推送 */
  mcpStateChanged: (callback: (ctx: McpStateContext) => void): (() => void) => {
    return createListener(MCP.STATE_CHANGED, callback)
  },

  // v0.9.6 新增：外部 MCP Server（Client 侧）
  /** 获取所有外部 MCP 服务器状态 */
  mcpExternalStatus: (): Promise<ExternalMcpServerStatus[]> => {
    return ipcRenderer.invoke(MCP.EXTERNAL_STATUS)
  },
  /** 列出所有外部 MCP 工具 */
  mcpExternalTools: (): Promise<
    Array<{ name: string; description: string; serverId: string; serverName: string }>
  > => {
    return ipcRenderer.invoke(MCP.EXTERNAL_TOOLS)
  },
  /** 调用外部 MCP 工具 */
  mcpExternalCall: (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{
    success: boolean
    content: Array<{ type: 'text'; text: string }>
    error?: string
  }> => {
    return ipcRenderer.invoke(MCP.EXTERNAL_CALL, serverId, toolName, args)
  },
  /** 重连外部 MCP 服务器 */
  mcpExternalReconnect: (serverId: string): Promise<boolean> => {
    return ipcRenderer.invoke(MCP.EXTERNAL_RECONNECT, serverId)
  },

  // v0.9 Supervisor chat 流式事件
  /** 监听 Supervisor 流式 token 块推送 */
  agentChunk: (callback: (payload: AgentChunkPayload) => void): (() => void) => {
    return createListener(AGENT.CHUNK, callback)
  },
  /** 监听 Supervisor chat 完成信号（含完整结果） */
  agentDone: (callback: (payload: AgentDonePayload) => void): (() => void) => {
    return createListener(AGENT.DONE, callback)
  },
  /** 监听 Supervisor chat 错误信号 */
  agentError: (callback: (payload: AgentErrorPayload) => void): (() => void) => {
    return createListener(AGENT.ERROR, callback)
  },
  /** 监听 Supervisor 工具调用事件（v2.4：真实工具执行可视化） */
  agentToolEvent: (callback: (payload: AgentToolEventPayload) => void): (() => void) => {
    return createListener(AGENT.TOOL_EVENT, callback)
  },

  // v0.9 Claude Agent SDK 流式事件（独立于 agent:chunk/done/error，避免通道混用）
  /** 监听 Claude SDK 流式 token 块推送 */
  claudeSdkChunk: (callback: (payload: AgentChunkPayload) => void): (() => void) => {
    return createListener(CLAUDE_SDK.CHUNK, callback)
  },
  /** 监听 Claude SDK 完成信号（含完整 ChatResult） */
  claudeSdkDone: (callback: (payload: AgentDonePayload) => void): (() => void) => {
    return createListener(CLAUDE_SDK.DONE, callback)
  },
  /** 监听 Claude SDK 错误信号 */
  claudeSdkError: (callback: (payload: AgentErrorPayload) => void): (() => void) => {
    return createListener(CLAUDE_SDK.ERROR, callback)
  },

  /**
   * 监听沙箱命令审批请求（P-2：HC-6 强制审批）
   *
   * 主进程在 sandbox:execute 调用时会推送 sandbox:approval-request 事件，
   * 渲染进程通过本监听器接收审批请求载荷，弹窗让用户确认后调用 sandboxApprove() 响应。
   *
   * 注意：30 秒未响应主进程会自动拒绝并返回 APPROVAL_DENIED 错误。
   */
  sandboxApprovalRequest: (callback: (request: SandboxApprovalRequest) => void): (() => void) => {
    return createListener(SANDBOX.APPROVAL_REQUEST, callback)
  },

  /**
   * 监听 PAOR 审批请求（v0.9.5 新增）
   *
   * 主进程在 PAOR 循环遇到 HIGH/CRITICAL 命令时推送 paor:approval-request 事件，
   * 渲染进程通过本监听器接收审批请求载荷，弹窗让用户确认后调用 paorApprove() 响应。
   *
   * 注意：60 秒未响应主进程会自动拒绝。
   */
  paorApprovalRequest: (callback: (request: PaorApprovalRequest) => void): (() => void) => {
    return createListener(PAOR.APPROVAL_REQUEST, callback)
  },

  /**
   * 监听 PAOR 迭代进度（v0.9.5 新增，P0-3 补全 IPC 4 步同步）
   *
   * 主进程在每轮 PAOR 迭代（Plan→Act→Observe→Reflect）完成后推送
   * agent:paor:iteration 事件，渲染进程通过本监听器接收迭代轨迹，
   * 用于实时展示 PAOR 循环进度（执行命令、输出、反思决策）。
   *
   * 事件载荷：{ sshSessionId, iteration: PaorIteration }
   * - sshSessionId: 关联的 SSH 会话 ID（多会话区分）
   * - iteration: 本轮迭代轨迹（含 act/observe/reflect 三个阶段结果）
   */
  agentPaorIteration: (callback: (event: PaorIterationEvent) => void): (() => void) => {
    return createListener(AGENT.PAOR_ITERATION, callback)
  },

  /**
   * 监听 Task Protocol 审批请求（v0.9.3 §11 遗留项 2 P2-H 新增）
   *
   * 主进程在 task-protocol step 2 check-permission 推送 task:permission-approval-request 事件，
   * 渲染进程通过本监听器接收审批请求载荷，弹窗让用户确认后调用 taskPermissionApprove() 响应。
   *
   * 注意：30 秒未响应主进程会自动拒绝。
   */
  taskPermissionApprovalRequest: (callback: (request: TaskPermissionApprovalRequest) => void): (() => void) => {
    return createListener(TASK.PERMISSION_APPROVAL_REQUEST, callback)
  },

  // v1.5 循环工程事件监听器
  loopLlmStart: (callback: (payload: unknown) => void): (() => void) => {
    return createListener(LOOP.LLM_START, callback)
  },
  loopLlmDone: (callback: (payload: unknown) => void): (() => void) => {
    return createListener(LOOP.LLM_DONE, callback)
  },
  loopStep: (callback: (payload: unknown) => void): (() => void) => {
    return createListener(LOOP.STEP, callback)
  },
  loopDecision: (callback: (payload: unknown) => void): (() => void) => {
    return createListener(LOOP.DECISION, callback)
  },
  loopDone: (callback: (payload: unknown) => void): (() => void) => {
    return createListener(LOOP.DONE, callback)
  },
  loopError: (callback: (payload: unknown) => void): (() => void) => {
    return createListener(LOOP.ERROR, callback)
  },
  loopBlocked: (callback: (payload: unknown) => void): (() => void) => {
    return createListener(LOOP.BLOCKED, callback)
  },

  // Phase 6 Task 6.5：调度器状态变更推送（主 → 渲染）
  /**
   * 监听调度器任务状态变更
   *
   * 主进程在任务 task-start / task-done / task-error 事件触发后，
   * 通过 scheduler:status 通道推送最新 SchedulerTaskStatus 到渲染层。
   * 渲染层据此更新任务卡片（lastRunAt / lastResult / nextRunAt）。
   *
   * @param callback 回调函数，接收变更后的 SchedulerTaskStatus
   * @returns 取消监听函数（在 React useEffect cleanup 中调用）
   */
  schedulerStatus: (callback: (status: SchedulerTaskStatus) => void): (() => void) => {
    return createListener(SCHEDULER.STATUS, callback)
  },

  // v2.0 Phase C 新增：远程文件变更事件监听
  /**
   * 监听远程文件变更（file:changed 推送）
   *
   * 主进程 FileWatcherAdapter 在 inotifywait / 轮询检测到文件变更时，
   * 通过 file:changed 通道推送 FileChangedPayload 到渲染层。
   * 渲染层据此刷新 FileTree / EditorArea / 决策卡片等 UI。
   *
   * @param callback 回调函数，接收 FileChangedPayload
   * @returns 取消监听函数（在 React useEffect cleanup 中调用）
   */
  fileChanged: (callback: (payload: FileChangedPayload) => void): (() => void) => {
    return createListener(FILE_WATCH.CHANGED, callback)
  },
}

export { on }
