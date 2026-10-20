/** events åï¼ä» src/preload/index.ts æåæåºãæ´é²åä»¥ index.ts éç electronApi ä¸ºåï¼å¿«ç§é¸ç¯ç */
import type { AgentChunkPayload, AgentDonePayload, AgentErrorPayload, AgentToolEventPayload } from '@shared/agent-types'
import type { AgentWorkflowState, ExternalMcpServerStatus, LlmError, LlmStreamChunk, McpStateContext, MonitorData, SftpProgressEvent, SshHostKeyPromptEvent, SshStateEvent, SystemInfo } from '@shared/models'
import type { PaorIterationEvent } from '@shared/paor-types'
import type { SchedulerTaskStatus } from '@shared/scheduler-types'
import { AGENT, FILE_WATCH, LOCAL_TTY, LLM, LOOP, MCP, MONITOR, PAOR, SANDBOX, SCHEDULER, SFTP, SSH, TERMINAL } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import type { FileChangedPayload, PaorApprovalRequest, SandboxApprovalRequest } from '../types'
import { createListener } from '../ipc-util'

/**
 * äºä»¶çå¬ API
 *
 * æ¯ä¸ªæ¹æ³è¿åä¸ä¸ªåæ¶çå¬å½æ°ï¼è°ç¨åç§»é¤è¯¥çå¬å¨ã
 * æ¨èå¨ React useEffect ä¸­ä½¿ç¨ï¼
 *   useEffect(() => {
 *     const off = window.electronAPI.on.terminalData((sid, data) => {...})
 *     return off  // ç»ä»¶å¸è½½æ¶èªå¨åæ¶çå¬
 *   }, [])
 */
const on = {
  /** çå¬ç»ç«¯ Shell æ°æ®æ¨éï¼shellId å®ä½æ¯åªä¸ªç»ç«¯ï¼2026-10-10 èµ·ä¸åæ sessionIdï¼ */
  terminalData: (callback: (shellId: string, data: string) => void): (() => void) => {
    return createListener(TERMINAL.DATA, callback)
  },

  /**
   * çå¬æ¬æºç»ç«¯è¿ç¨éåºï¼è½½è·æ¯éåºçé£æ¡ shellIdï¼
   *
   * è¾åºå¤ç¨ terminal:dataï¼éåºåç¬ä¸æ¡ï¼è¿ç«¯ç»ç«¯æ²¡æ"è¿ç¨éåº"è¿ç§æ¨éå¯ä¾èµï¼
   * èæ¬æºç»ç«¯ç¨æ·å¤©å¤©æ² exitï¼æ ç­¾å¿é¡»è·çèµ°ã
   */
  localTtyExit: (callback: (shellId: string) => void): (() => void) => {
    return createListener(LOCAL_TTY.EXIT, callback)
  },

  /** çå¬ SSH å¿è·³ä¿æ´»ç¶æåæ´ï¼K.2ï¼å¿è·³å¤±è´¥/éè¿/æç»æ­å¼æ¶æ¨éï¼ */
  sshStateChanged: (callback: (event: SshStateEvent) => void): (() => void) => {
    return createListener(SSH.STATE_CHANGED, callback)
  },

  /**
   * çå¬ä¸»æºå¯é¥ç¡®è®¤å¼¹çªæ¨éï¼Phase Lï¼
   *
   * é¦æ¬¡è¿æ¥æå¯é¥åæ´æ¶ï¼ä¸»è¿ç¨æ¨é SshHostKeyPromptEventï¼
   * æ¸²æè¿ç¨å¼¹çªç­å¾ç¨æ·éæ©åéè¿ sshRespondHostKey ååºã
   */
  sshHostKeyPrompt: (callback: (prompt: SshHostKeyPromptEvent) => void): (() => void) => {
    return createListener(SSH.HOST_KEY_PROMPT, callback)
  },

  /** çå¬çæ§æ°æ®æ¨éï¼å®æ¶ææ ï¼æ¯ interval ç§ä¸æ¬¡ï¼ */
  monitorData: (callback: (sessionId: string, data: MonitorData) => void): (() => void) => {
    return createListener(MONITOR.DATA, callback)
  },

  /** çå¬ç³»ç»ä¿¡æ¯æ¨éï¼é¦æ¬¡ééæ¶æ¨éä¸æ¬¡ï¼ */
  monitorSystemInfo: (callback: (sessionId: string, info: SystemInfo) => void): (() => void) => {
    return createListener(MONITOR.SYSTEM_INFO, callback)
  },

  /**
   * çå¬ SFTP ä¸ä¼ /ä¸è½½è¿åº¦æ¨éï¼v0.9.7 SFTP æä»¶æµè§å¢å¼ºï¼
   *
   * ä¸»è¿ç¨å¨ sftp:upload / sftp:download ä¼ è¾è¿ç¨ä¸­éè¿ step åè°æ¨éè¿åº¦ï¼
   * æ¸²æè¿ç¨éè¿æ¬çå¬å¨æ¥æ¶ SftpProgressEventï¼æ´æ°ä¼ è¾éå UIã
   */
  sftpProgress: (callback: (event: SftpProgressEvent) => void): (() => void) => {
    return createListener(SFTP.PROGRESS, callback)
  },

  /** çå¬ LLM æµå¼ token æ¨éï¼å¼å®¹æ§çï¼ */
  llmToken: (callback: (token: string) => void): (() => void) => {
    return createListener(LLM.TOKEN, callback)
  },

  /** çå¬ LLM æµå¼ token åæ¨éï¼å¢å¼ºçï¼å« totalTokensï¼ */
  llmChunk: (callback: (chunk: LlmStreamChunk) => void): (() => void) => {
    return createListener(LLM.CHUNK, callback)
  },

  /** çå¬ LLM æµå¼å®æä¿¡å·ï¼å«å®æ´ææ¬ï¼ */
  llmDone: (callback: (fullText: string) => void): (() => void) => {
    return createListener(LLM.DONE, callback)
  },

  /** çå¬ LLM æµå¼éè¯¯ä¿¡å·ï¼å«éè¯¯ç /æ¶æ¯/æ¯å¦å¯éè¯ï¼ */
  llmError: (callback: (error: LlmError) => void): (() => void) => {
    return createListener(LLM.ERROR, callback)
  },

  /** çå¬ Agent å·¥ä½æµæ­¥éª¤åæ´ */
  agentStep: (callback: (state: AgentWorkflowState) => void): (() => void) => {
    return createListener(AGENT.STEP, callback)
  },

  // v0.9.5 P0 æ°å¢ï¼MCP 5 é¶æ®µçå½å¨æç¶ææºï¼åé´ claw-code Â§3.3ï¼
  /** è·å MCP ç¶ææºå½åç¶æ */
  mcpGetState: (): Promise<McpStateContext> => {
    return ipcRenderer.invoke(MCP.GET_STATE)
  },
  /** éç½® MCP ç¶ææºï¼ç¨æ·æå¨æ¢å¤ï¼ */
  mcpReset: (): Promise<boolean> => {
    return ipcRenderer.invoke(MCP.RESET)
  },
  /** çå¬ MCP ç¶æåæ´æ¨é */
  mcpStateChanged: (callback: (ctx: McpStateContext) => void): (() => void) => {
    return createListener(MCP.STATE_CHANGED, callback)
  },

  // v0.9.6 æ°å¢ï¼å¤é¨ MCP Serverï¼Client ä¾§ï¼
  /** è·åææå¤é¨ MCP æå¡å¨ç¶æ */
  mcpExternalStatus: (): Promise<ExternalMcpServerStatus[]> => {
    return ipcRenderer.invoke(MCP.EXTERNAL_STATUS)
  },
  /** ååºææå¤é¨ MCP å·¥å· */
  mcpExternalTools: (): Promise<
    Array<{ name: string; description: string; serverId: string; serverName: string }>
  > => {
    return ipcRenderer.invoke(MCP.EXTERNAL_TOOLS)
  },
  /** è°ç¨å¤é¨ MCP å·¥å· */
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
  /** éè¿å¤é¨ MCP æå¡å¨ */
  mcpExternalReconnect: (serverId: string): Promise<boolean> => {
    return ipcRenderer.invoke(MCP.EXTERNAL_RECONNECT, serverId)
  },

  // v0.9 Supervisor chat æµå¼äºä»¶
  /** çå¬ Supervisor æµå¼ token åæ¨é */
  agentChunk: (callback: (payload: AgentChunkPayload) => void): (() => void) => {
    return createListener(AGENT.CHUNK, callback)
  },
  /** çå¬ Supervisor chat å®æä¿¡å·ï¼å«å®æ´ç»æï¼ */
  agentDone: (callback: (payload: AgentDonePayload) => void): (() => void) => {
    return createListener(AGENT.DONE, callback)
  },
  /** çå¬ Supervisor chat éè¯¯ä¿¡å· */
  agentError: (callback: (payload: AgentErrorPayload) => void): (() => void) => {
    return createListener(AGENT.ERROR, callback)
  },
  /** çå¬ Supervisor å·¥å·è°ç¨äºä»¶ï¼v2.4ï¼çå®å·¥å·æ§è¡å¯è§åï¼ */
  agentToolEvent: (callback: (payload: AgentToolEventPayload) => void): (() => void) => {
    return createListener(AGENT.TOOL_EVENT, callback)
  },

  /**
   * çå¬æ²ç®±å½ä»¤å®¡æ¹è¯·æ±ï¼P-2ï¼HC-6 å¼ºå¶å®¡æ¹ï¼
   *
   * ä¸»è¿ç¨å¨ sandbox:execute è°ç¨æ¶ä¼æ¨é sandbox:approval-request äºä»¶ï¼
   * æ¸²æè¿ç¨éè¿æ¬çå¬å¨æ¥æ¶å®¡æ¹è¯·æ±è½½è·ï¼å¼¹çªè®©ç¨æ·ç¡®è®¤åè°ç¨ sandboxApprove() ååºã
   *
   * æ³¨æï¼30 ç§æªååºä¸»è¿ç¨ä¼èªå¨æç»å¹¶è¿å APPROVAL_DENIED éè¯¯ã
   */
  sandboxApprovalRequest: (callback: (request: SandboxApprovalRequest) => void): (() => void) => {
    return createListener(SANDBOX.APPROVAL_REQUEST, callback)
  },

  /**
   * çå¬ PAOR å®¡æ¹è¯·æ±ï¼v0.9.5 æ°å¢ï¼
   *
   * ä¸»è¿ç¨å¨ PAOR å¾ªç¯éå° HIGH/CRITICAL å½ä»¤æ¶æ¨é paor:approval-request äºä»¶ï¼
   * æ¸²æè¿ç¨éè¿æ¬çå¬å¨æ¥æ¶å®¡æ¹è¯·æ±è½½è·ï¼å¼¹çªè®©ç¨æ·ç¡®è®¤åè°ç¨ paorApprove() ååºã
   *
   * æ³¨æï¼60 ç§æªååºä¸»è¿ç¨ä¼èªå¨æç»ã
   */
  paorApprovalRequest: (callback: (request: PaorApprovalRequest) => void): (() => void) => {
    return createListener(PAOR.APPROVAL_REQUEST, callback)
  },

  /**
   * çå¬ PAOR è¿­ä»£è¿åº¦ï¼v0.9.5 æ°å¢ï¼P0-3 è¡¥å¨ IPC 4 æ­¥åæ­¥ï¼
   *
   * ä¸»è¿ç¨å¨æ¯è½® PAOR è¿­ä»£ï¼PlanâActâObserveâReflectï¼å®æåæ¨é
   * agent:paor:iteration äºä»¶ï¼æ¸²æè¿ç¨éè¿æ¬çå¬å¨æ¥æ¶è¿­ä»£è½¨è¿¹ï¼
   * ç¨äºå®æ¶å±ç¤º PAOR å¾ªç¯è¿åº¦ï¼æ§è¡å½ä»¤ãè¾åºãåæå³ç­ï¼ã
   *
   * äºä»¶è½½è·ï¼{ sshSessionId, iteration: PaorIteration }
   * - sshSessionId: å³èç SSH ä¼è¯ IDï¼å¤ä¼è¯åºåï¼
   * - iteration: æ¬è½®è¿­ä»£è½¨è¿¹ï¼å« act/observe/reflect ä¸ä¸ªé¶æ®µç»æï¼
   */
  agentPaorIteration: (callback: (event: PaorIterationEvent) => void): (() => void) => {
    return createListener(AGENT.PAOR_ITERATION, callback)
  },


  // v1.5 å¾ªç¯å·¥ç¨äºä»¶çå¬å¨
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

  // Phase 6 Task 6.5ï¼è°åº¦å¨ç¶æåæ´æ¨éï¼ä¸» â æ¸²æï¼
  /**
   * çå¬è°åº¦å¨ä»»å¡ç¶æåæ´
   *
   * ä¸»è¿ç¨å¨ä»»å¡ task-start / task-done / task-error äºä»¶è§¦ååï¼
   * éè¿ scheduler:status ééæ¨éææ° SchedulerTaskStatus å°æ¸²æå±ã
   * æ¸²æå±æ®æ­¤æ´æ°ä»»å¡å¡çï¼lastRunAt / lastResult / nextRunAtï¼ã
   *
   * @param callback åè°å½æ°ï¼æ¥æ¶åæ´åç SchedulerTaskStatus
   * @returns åæ¶çå¬å½æ°ï¼å¨ React useEffect cleanup ä¸­è°ç¨ï¼
   */
  schedulerStatus: (callback: (status: SchedulerTaskStatus) => void): (() => void) => {
    return createListener(SCHEDULER.STATUS, callback)
  },

  // v2.0 Phase C æ°å¢ï¼è¿ç¨æä»¶åæ´äºä»¶çå¬
  /**
   * çå¬è¿ç¨æä»¶åæ´ï¼file:changed æ¨éï¼
   *
   * ä¸»è¿ç¨ FileWatcherAdapter å¨ inotifywait / è½®è¯¢æ£æµå°æä»¶åæ´æ¶ï¼
   * éè¿ file:changed ééæ¨é FileChangedPayload å°æ¸²æå±ã
   * æ¸²æå±æ®æ­¤å·æ° FileTree / EditorArea / å³ç­å¡çç­ UIã
   *
   * @param callback åè°å½æ°ï¼æ¥æ¶ FileChangedPayload
   * @returns åæ¶çå¬å½æ°ï¼å¨ React useEffect cleanup ä¸­è°ç¨ï¼
   */
  fileChanged: (callback: (payload: FileChangedPayload) => void): (() => void) => {
    return createListener(FILE_WATCH.CHANGED, callback)
  },
}

export { on }
