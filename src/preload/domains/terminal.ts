/** terminal 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { TerminalCompletionSuggestion } from '@shared/agent-types'
import { LOCAL_TTY, SANDBOX, TERMINAL_COMPLETION } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import { invokeChecked } from '../ipc-util'
import type { SandboxCommandResult, SandboxErrorResponse, SandboxHealthStatus, SandboxInfo, SandboxPage } from '../types'

/**
 * v0.9 OpenHands 沙箱集成 invoke 调用
 *
 * 通道与主进程 ipc/sandbox.ts 一一对应：
 * - sandbox:start         → start
 * - sandbox:status        → status
 * - sandbox:create        → create
 * - sandbox:list          → list
 * - sandbox:execute       → execute
 * - sandbox:delete        → delete
 *
 * 安全说明：
 * - execute 始终需要 UI 层审批（参考 RiskConfirm 组件）
 * - 通过 Mastra Tool 调用时，sandbox-exec.ts 已设 requireApproval: true
 */
const sandbox = {
  /** 启动 OpenHands App Server 容器（首次启动需拉镜像，可能数分钟） */
  start: (): Promise<{ success: true } | SandboxErrorResponse> =>
    ipcRenderer.invoke(SANDBOX.START),

  /** 获取沙箱集成状态（Docker + OpenHands 健康） */
  status: (): Promise<SandboxHealthStatus> =>
    ipcRenderer.invoke(SANDBOX.STATUS),

  /** 创建新沙箱（隔离 Docker 容器） */
  create: (sandboxSpecId?: string): Promise<SandboxInfo | SandboxErrorResponse> =>
    ipcRenderer.invoke(SANDBOX.CREATE, sandboxSpecId),

  /** 列出当前用户的所有沙箱 */
  list: (limit?: number): Promise<SandboxPage | SandboxErrorResponse> =>
    ipcRenderer.invoke(SANDBOX.LIST, limit),

  /**
   * 在沙箱内执行 shell 命令
   *
   * P-2 + P-4 修复：
   * - session_api_key 不再传入渲染进程（句柄模式）
   * - 主进程 IPC 层会自动推送审批请求（sandbox:approval-request）
   * - 用户通过 sandboxApprove() 响应审批后才执行命令
   *
   * @param sandboxId 沙箱 ID
   * @param command shell 命令
   */
  execute: (
    sandboxId: string,
    command: string
  ): Promise<SandboxCommandResult | SandboxErrorResponse> =>
    ipcRenderer.invoke(SANDBOX.EXECUTE, sandboxId, command),

  /**
   * 响应沙箱命令审批请求（P-2：HC-6 强制审批）
   *
   * 主进程推送 sandbox:approval-request 事件后，
   * 渲染进程弹窗让用户确认，通过本函数回传审批结果。
   *
   * @param callId 审批调用 ID（来自 sandbox:approval-request 事件载荷）
   * @param approved 是否批准执行
   */
  approve: (callId: string, approved: boolean): Promise<boolean> =>
    ipcRenderer.invoke(SANDBOX.APPROVE, callId, approved),

  /** 删除沙箱（不可逆，工作区数据将丢失） */
  delete: (sandboxId: string): Promise<{ success: true } | SandboxErrorResponse> =>
    ipcRenderer.invoke(SANDBOX.DELETE, sandboxId),
}

/**
 * v0.9.7 P3 M1 新增：终端智能补全 invoke 调用
 *
 * 通道与主进程 ipc/terminal-completion.ts 一一对应：
 * - terminal-completion:complete → complete（请求补全建议）
 * - terminal-completion:accept   → accept（接受建议，提升 Frecency 分数）
 *
 * 与现有 terminalData 的区别：
 * - terminalData 是 push 模式（主 → 渲染，Shell 数据回传）
 * - terminalCompletion 是 invoke 模式（渲染 → 主，请求-响应）
 *
 * 使用场景：
 * - 终端 UI 输入时调用 complete(input) 弹窗展示建议
 * - 用户按 Tab 接受某条建议后调用 accept(command) 提升权重
 * - 远端登录后调用 import(commands) 导入 ~/.bash_history
 */
const terminalCompletion = {
  /**
   * 请求补全建议
   *
   * @param input 当前已输入的文本（如 "tail -"）
   * @returns CompletionSuggestion[] 按 Frecency 分数降序排列
   */
  complete: (input: string): Promise<TerminalCompletionSuggestion[]> =>
    ipcRenderer.invoke(TERMINAL_COMPLETION.COMPLETE, input),

  /**
   * 接受某条建议（提升 Frecency 分数，让后续补全更精准）
   *
   * @param command 完整命令文本
   * @returns boolean 是否成功
   */
  accept: (command: string): Promise<boolean> =>
    ipcRenderer.invoke(TERMINAL_COMPLETION.ACCEPT, command),

}

/**
 * 本机终端（W3）invoke 调用
 *
 * 六条都走 invokeChecked：参数与返回值由 src/shared/ipc-contract.ts 单源生成，
 * 界面拿到的类型和主进程真实返回的是同一份表。
 * 身份同样是 shellId（与远端终端共用 terminal:data 那条输出通道），
 * 所以渲染层的分发、暂存、对账逻辑不用写第二遍。
 */
const localTty = {
  /** 可用性（node-pty 没装上的平台会给出原因，界面据此提示而不是静默失败） */
  status: (): Promise<{ available: boolean; reason: string | null; shellPath: string | null }> =>
    invokeChecked('localTtyStatus', LOCAL_TTY.STATUS),

  /** 开一条本机终端，返回 shellId */
  start: (size?: { cols: number; rows: number }): Promise<string> =>
    invokeChecked('localTtyStart', LOCAL_TTY.START, size),

  /** 列出开着的本机终端（标签对账用） */
  list: (): Promise<string[]> => invokeChecked('localTtyList', LOCAL_TTY.LIST),

  /** 写入键入数据（仅供用户敲键盘，主进程不逐键判定） */
  write: (shellId: string, data: string): Promise<boolean> =>
    invokeChecked('localTtyWrite', LOCAL_TTY.WRITE, shellId, data),

  /** 调整窗口尺寸 */
  resize: (shellId: string, cols: number, rows: number): Promise<boolean> =>
    invokeChecked('localTtyResize', LOCAL_TTY.RESIZE, shellId, cols, rows),

  /** 关闭一条本机终端 */
  close: (shellId: string): Promise<boolean> =>
    invokeChecked('localTtyClose', LOCAL_TTY.CLOSE, shellId),

  /** 执行整条代写命令（AI 建议 / 决策页重跑）：主进程先过风险闸 */
  runAuthored: (shellId: string, command: string): Promise<boolean> =>
    invokeChecked('localTtyRunAuthored', LOCAL_TTY.RUN_AUTHORED, shellId, command),
}

export { sandbox, terminalCompletion, localTty }
