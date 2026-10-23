// 生成物，别手改：来源 src/shared/ipc-contract.ts，重生成 pnpm ipc:gen
// 改了契约没重生成 → tests/unit/ipc-contract.test.ts 会红
import type { AgentChunkPayload, AgentDonePayload, AgentErrorPayload, PersistedProviderConfig, ProviderConfig, ThinkingStrength } from '@shared/agent-types'
import type { BlockedCommandRecord } from '@shared/audit-types'
import type { BootLoadingStage } from '@shared/boot-types'
import type { ChatMessage, CommandResult, DecisionAuditView, ExternalMcpServer, ExternalMcpServerDraft, GenerateKeyPairResponse, PreviewHandleInfo, PreviewTarget, SftpEntry, SftpTransferResult, ShellIntegrationResult, ShellIntegrationStatus, SshKeyPair } from '@shared/models'
import type { PaorLoopResult } from '@shared/paor-types'
import type { SshConfigScanResult } from '@shared/ssh-config-types'

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

  /** 新开一条交互式 Shell，返回 shellId（一条连接可开多个终端）
   * 通道 `ssh:shell:start` */
  sshShellStart(sessionId: string, size?: { cols: number; rows: number }): Promise<string>

  /** 关掉一条终端通道（不断整条 SSH 连接）
   * 通道 `ssh:shell:close` */
  sshShellClose(shellId: string): Promise<boolean>

  /** 列出某条会话当前开着的 shellId（渲染层恢复标签用）
   * 通道 `ssh:shell:list` */
  sshShellList(sessionId: string): Promise<string[]>

  /** 向指定终端写入键入数据（主进程行缓冲到回车时过风险闸，block 时返回 false）
   * 通道 `ssh:shell:write` */
  sshShellWrite(shellId: string, data: string): Promise<boolean>

  /** 执行整条代写命令；主进程先过风险闸，block 级抛错
   * 通道 `ssh:shell:run-authored` */
  sshRunAuthored(shellId: string, command: string): Promise<boolean>

  /** 调整指定终端窗口尺寸
   * 通道 `ssh:shell:resize` */
  sshShellResize(shellId: string, cols: number, rows: number): Promise<boolean>

  /** 再开一个应用窗口，返回当前窗口数
   * 通道 `window:open-secondary` */
  windowOpenSecondary(): Promise<number>

  /** 为一个远端目标铸预览句柄，返回 token 与 iframe 用的 URL
   * 通道 `preview:open` */
  previewOpen(target: PreviewTarget): Promise<PreviewHandleInfo>

  /** 作废一个预览句柄（关掉预览标签时调）
   * 通道 `preview:close` */
  previewClose(token: string): Promise<boolean>

  /** 读句柄入口文件的文本（Markdown 在渲染层安全渲染，不进 iframe）
   * 通道 `preview:readText` */
  previewReadText(token: string): Promise<string>

  /** 问这台服务器的 shell 集成状态，并带回将要写入的两处原文
   * 通道 `ssh:shell-integration:status` */
  sshShellIntegrationStatus(sessionId: string): Promise<ShellIntegrationStatus>

  /** 用户逐台确认之后才调：写入集成脚本并在 rc 里加标记块
   * 通道 `ssh:shell-integration:install` */
  sshShellIntegrationInstall(sessionId: string): Promise<ShellIntegrationResult>

  /** 从 rc 里剥掉标记块并删掉集成脚本
   * 通道 `ssh:shell-integration:uninstall` */
  sshShellIntegrationUninstall(sessionId: string): Promise<ShellIntegrationResult>

  /** 本机终端是否可用（node-pty 装没装上、用的是哪个 Shell）
   * 通道 `local-tty:status` */
  localTtyStatus(): Promise<{ available: boolean; reason: string | null; shellPath: string | null }>

  /** 开一条本机终端，返回 shellId；不可用时抛错并带原因
   * 通道 `local-tty:start` */
  localTtyStart(size?: { cols: number; rows: number }): Promise<string>

  /** 列出当前开着的本机终端 shellId（标签对账用）
   * 通道 `local-tty:list` */
  localTtyList(): Promise<string[]>

  /** 向本机终端写入键入数据（主进程行缓冲到回车时过风险闸，block 时返回 false）
   * 通道 `local-tty:write` */
  localTtyWrite(shellId: string, data: string): Promise<boolean>

  /** 调整本机终端窗口尺寸
   * 通道 `local-tty:resize` */
  localTtyResize(shellId: string, cols: number, rows: number): Promise<boolean>

  /** 关闭一条本机终端（连带杀掉它的子进程树）
   * 通道 `local-tty:close` */
  localTtyClose(shellId: string): Promise<boolean>

  /** 在本机终端执行整条代写命令；主进程先过风险闸，block 级抛错
   * 通道 `local-tty:run-authored` */
  localTtyRunAuthored(shellId: string, command: string): Promise<boolean>

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

  /** 拉取最近一次启动阶段；主进程还没推过时为 null
   * 通道 `boot:get-state` */
  bootGetState(): Promise<BootLoadingStage | null>

  /** 按服务器 ID 连接；一次性口令只用于本次连接
   * 通道 `ssh:connectById` */
  sshConnectById(serverId: string, oneTimePassword?: string): Promise<string>

  /** 在已连接会话上执行一条命令（主进程侧还有命令闸）
   * 通道 `ssh:exec` */
  sshExec(sessionId: string, command: string): Promise<CommandResult>

  /** 覆盖写入远程文件；系统关键路径由 remote-write-guard 拒绝
   * 通道 `sftp:writeFile` */
  sftpWriteFile(sessionId: string, remotePath: string, content: string): Promise<boolean>

  /** 删除远程文件/目录；系统关键路径由 remote-write-guard 拒绝
   * 通道 `sftp:delete` */
  sftpDelete(sessionId: string, remotePath: string): Promise<boolean>

  /** 重命名远程文件/目录；源与目标都过 remote-write-guard
   * 通道 `sftp:rename` */
  sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<boolean>

  /** 修改远程文件权限；系统关键路径由 remote-write-guard 拒绝
   * 通道 `sftp:chmod` */
  sftpChmod(sessionId: string, remotePath: string, mode: number): Promise<boolean>

  /** 创建远程目录；系统关键路径由 remote-write-guard 拒绝
   * 通道 `sftp:mkdir` */
  sftpMkdir(sessionId: string, remotePath: string): Promise<boolean>

  /** 高危命令拦截记录，按时间倒序，limit 缺省 200、上限 1000
   * 通道 `history:blocks` */
  historyBlocks(limit?: number): Promise<BlockedCommandRecord[]>

  /** 决策审计链：库里存的行 + 主进程重算的校验结论（渲染层不参与算哈希）
   * 通道 `history:audit` */
  historyAudit(decisionId: string): Promise<DecisionAuditView>

  /** 列出远程目录
   * 通道 `sftp:list` */
  sftpList(sessionId: string, remotePath: string): Promise<SftpEntry[]>

  /** 上传本地文件到远程目录；本地路径由主进程对话框决定
   * 通道 `sftp:upload` */
  sftpUpload(sessionId: string, remotePath: string, transferId?: string): Promise<SftpTransferResult>

  /** 下载远程文件；保存位置由主进程对话框决定
   * 通道 `sftp:download` */
  sftpDownload(sessionId: string, remotePath: string, transferId?: string): Promise<SftpTransferResult>

  /** 读取远程文件内容（UTF-8 文本，10MB 上限）
   * 通道 `sftp:readFile` */
  sftpReadFile(sessionId: string, remotePath: string): Promise<string>

  /** 获取远程文件/目录元信息
   * 通道 `sftp:stat` */
  sftpStat(sessionId: string, remotePath: string): Promise<SftpEntry | null>

  /** 对话框选择私钥并复制到 ~/.ssh（chmod 600）
   * 通道 `ssh:upload-keypair` */
  sshUploadKeypair(): Promise<{ success: boolean; keyPair?: SshKeyPair; error?: string; canceled?: boolean }>

  /** 生成 ed25519/rsa 密钥对
   * 通道 `ssh:generate-keypair` */
  sshGenerateKeypair(request: { type: "ed25519" | "rsa"; name: string; passphrase?: string; comment?: string }): Promise<GenerateKeyPairResponse>

  /** 读取 ~/.ssh/config 的 Host 列表（固定路径、只读、不含凭据）
   * 通道 `ssh:list-config-hosts` */
  sshListConfigHosts(): Promise<SshConfigScanResult>

  /** 对话框选择图片并返回 base64 data URL
   * 通道 `fs:upload-image` */
  fsUploadImage(): Promise<{ success: true; dataUrl: string; fileName: string; fileSize: number; mimeType: string } | { success: false; error: string }>

  /** 弹保存框导出服务器列表（不含密码/私钥）
   * 通道 `server:export-file` */
  serverExportFile(): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>

  /** 弹打开框导入服务器列表（新 ID，凭据留空）
   * 通道 `server:import-file` */
  serverImportFile(): Promise<{ ok: boolean; canceled?: boolean; imported?: number; error?: string }>

  /** 列出已登记的外部 MCP 服务器（形状里没有环境变量值）
   * 通道 `mcp:external-list` */
  mcpExternalList(): Promise<ExternalMcpServer[]>

  /** 登记一台外部 MCP 服务器；形状由 external-server-store 当场判，拒绝原因原样回给界面
   * 通道 `mcp:external-add` */
  mcpExternalAdd(draft: ExternalMcpServerDraft): Promise<ExternalMcpServer>

  /** 移除一台外部 MCP 服务器（同时断开它的子进程，不只是从配置里消失）
   * 通道 `mcp:external-remove` */
  mcpExternalRemove(serverId: string): Promise<boolean>
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

  /** 主进程走到某个启动阶段（渲染层据此显示一句人话，stage=done 即就绪）
   * 通道 `boot:loading-stage` */
  onBootLoadingStage(callback: (payload: BootLoadingStage) => void): () => void
}
