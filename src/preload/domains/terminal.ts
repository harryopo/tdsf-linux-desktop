/** terminal 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { AtCommand, AtCommandParseResult, AtCommandSource, AtCommandType } from '@shared/at-command-types'
import type { TerminalCompletionSuggestion } from '@shared/agent-types'
import { AT_COMMANDS, SANDBOX, TERMINAL_COMPLETION } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import type { AtCommandInfo, DockerInfo, SandboxCommandResult, SandboxErrorResponse, SandboxHealthStatus, SandboxInfo, SandboxPage } from '../types'

/**
 * v0.9 OpenHands 沙箱集成 invoke 调用
 *
 * 通道与主进程 ipc/sandbox.ts 一一对应：
 * - sandbox:detect-docker → detectDocker
 * - sandbox:start         → start
 * - sandbox:stop          → stop
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
  /** 检测 Docker Desktop 是否安装且运行 */
  detectDocker: (): Promise<DockerInfo> =>
    ipcRenderer.invoke(SANDBOX.DETECT_DOCKER),

  /** 启动 OpenHands App Server 容器（首次启动需拉镜像，可能数分钟） */
  start: (): Promise<{ success: true } | SandboxErrorResponse> =>
    ipcRenderer.invoke(SANDBOX.START),

  /** 停止 OpenHands App Server 容器 */
  stop: (): Promise<{ success: true } | SandboxErrorResponse> =>
    ipcRenderer.invoke(SANDBOX.STOP),

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
 * v0.9 @命令 invoke 调用（8 类：log/cmd/file/metric/decision/kb/skill/server）
 *
 * 通道与主进程 ipc/at-commands.ts 一一对应：
 * - at:list    → list
 * - at:resolve → resolve
 * - at:parse   → parse
 *
 * 使用场景：
 * - ChatPanel 输入 `@` 触发选择器：list 获取 8 类命令元信息
 * - 拖拽注入 / 单命令解析：resolve 构造 AtCommand 对象
 * - 提交输入框前：parse 解析文本中所有 @命令，拼装到 LLM prompt
 */
const atCommands = {
  /**
   * 列出所有可用 @命令（8 类）
   *
   * @returns AtCommandInfo[]（含 type / label / icon / description）
   */
  list: (): Promise<AtCommandInfo[]> =>
    ipcRenderer.invoke(AT_COMMANDS.LIST),

  /**
   * 解析单个 @命令
   *
   * @param type 命令类型（log/cmd/file/metric/decision/kb/skill/server）
   * @param args 命令参数（键值对，由 UI 收集）
   * @param source 来源标识（IDE/终端/监控/历史/chat-input/drag-drop）
   * @param userId 用户 ID（可选，预留多用户场景）
   * @returns 完整的 AtCommand 对象（含 displayText 与 injectedText）
   */
  resolve: (
    type: AtCommandType,
    args: Record<string, unknown>,
    source?: AtCommandSource,
    userId?: string
  ): Promise<AtCommand> =>
    ipcRenderer.invoke(AT_COMMANDS.RESOLVE, type, args, source, userId),

  /**
   * 解析文本中所有 @命令
   *
   * @param text ChatPanel 输入框原始文本
   * @param source 来源标识
   * @param userId 用户 ID（可选）
   * @returns AtCommandParseResult（含 text 去除 @命令后的纯文本 + commands 列表）
   */
  parse: (
    text: string,
    source?: AtCommandSource,
    userId?: string
  ): Promise<AtCommandParseResult> =>
    ipcRenderer.invoke(AT_COMMANDS.PARSE, text, source, userId),
}

/**
 * v0.9.7 P3 M1 新增：终端智能补全 invoke 调用
 *
 * 通道与主进程 ipc/terminal-completion.ts 一一对应：
 * - terminal-completion:complete → complete（请求补全建议）
 * - terminal-completion:accept   → accept（接受建议，提升 Frecency 分数）
 * - terminal-completion:import   → import（批量导入历史命令）
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

  /**
   * 批量导入历史命令（如读取远端 ~/.bash_history）
   *
   * @param commands 命令列表
   * @param directory 工作目录（可选）
   * @returns boolean 是否成功
   */
  import: (commands: string[], directory?: string): Promise<boolean> =>
    ipcRenderer.invoke(TERMINAL_COMPLETION.IMPORT, commands, directory),
}

export { sandbox, atCommands, terminalCompletion }
