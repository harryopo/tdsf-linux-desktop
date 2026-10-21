/** ssh 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { CommandResult, GenerateKeyPairRequest, GenerateKeyPairResponse, ShellIntegrationResult, ShellIntegrationStatus, SshConfig, SshHostKeyResponseAction, SshKeyPair } from '@shared/models'
import { SHELL_INTEGRATION, SSH } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import { invokeChecked } from '../ipc-util'

// ============================================================================
// invoke 通道封装（渲染 → 主，请求-响应）
// ============================================================================

/**
 * SSH 相关 invoke 调用
 */
const ssh = {
  /** 建立 SSH 连接，返回 sessionId */
  connect: (config: SshConfig): Promise<string> =>
    ipcRenderer.invoke(SSH.CONNECT, config),

  /**
   * 按已保存的服务器 ID 连接（凭据留在主进程，渲染层只交 ID）
   * @param oneTimePassword 用户此刻手输的一次性口令；不传就用主进程存好的凭据
   */
  connectById: (serverId: string, oneTimePassword?: string): Promise<string> =>
    invokeChecked<string>('sshConnectById', SSH.CONNECT_BY_ID, serverId, oneTimePassword),

  /** 断开 SSH 连接 */
  disconnect: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(SSH.DISCONNECT, sessionId),

  /** 执行 SSH 命令 */
  exec: (sessionId: string, command: string): Promise<CommandResult> =>
    invokeChecked<CommandResult>('sshExec', SSH.EXEC, sessionId, command),

  /** 交互式 Shell 操作（身份是 shellId：一条连接可以开多个终端） */
  shell: {
    /** 新开一条交互式 Shell，返回 shellId */
    start: (sessionId: string, size?: { cols: number; rows: number }): Promise<string> =>
      invokeChecked<string>('sshShellStart', SSH.SHELL_START, sessionId, size),

    /** 关闭一条终端通道（不断连接） */
    close: (shellId: string): Promise<boolean> =>
      invokeChecked<boolean>('sshShellClose', SSH.SHELL_CLOSE, shellId),

    /** 列出某条会话当前开着的 shellId */
    list: (sessionId: string): Promise<string[]> =>
      invokeChecked<string[]>('sshShellList', SSH.SHELL_LIST, sessionId),

    /** 向 shell 写入数据（仅供用户键入，主进程不判定整条命令） */
    write: (shellId: string, data: string): Promise<boolean> =>
      invokeChecked<boolean>('sshShellWrite', SSH.SHELL_WRITE, shellId, data),

    /** 执行整条代写命令（AI 建议 / 决策页重跑）：主进程先过风险闸 */
    runAuthored: (shellId: string, command: string): Promise<boolean> =>
      invokeChecked<boolean>('sshRunAuthored', SSH.SHELL_RUN_AUTHORED, shellId, command),

    /** 调整 shell 终端窗口大小 */
    resize: (shellId: string, cols: number, rows: number): Promise<boolean> =>
      invokeChecked<boolean>('sshShellResize', SSH.SHELL_RESIZE, shellId, cols, rows),
  },

  /**
   * 远端 Shell 集成（#61）：装/卸那台机器上的 OSC 133/633 钩子。
   * 三条都只交 sessionId——写哪个文件、写什么内容由主进程定死，
   * status 带回来的 snippetText / rcBlockText 就是界面要逐字给用户看的那两份原文。
   */
  shellIntegration: {
    status: (sessionId: string): Promise<ShellIntegrationStatus> =>
      invokeChecked<ShellIntegrationStatus>(
        'sshShellIntegrationStatus',
        SHELL_INTEGRATION.STATUS,
        sessionId,
      ),
    install: (sessionId: string): Promise<ShellIntegrationResult> =>
      invokeChecked<ShellIntegrationResult>(
        'sshShellIntegrationInstall',
        SHELL_INTEGRATION.INSTALL,
        sessionId,
      ),
    uninstall: (sessionId: string): Promise<ShellIntegrationResult> =>
      invokeChecked<ShellIntegrationResult>(
        'sshShellIntegrationUninstall',
        SHELL_INTEGRATION.UNINSTALL,
        sessionId,
      ),
  },

  /**
   * 响应主机密钥确认弹窗（Phase L）
   *
   * 渲染进程收到 onSshHostKeyPrompt 事件后，弹窗等待用户选择，
   * 然后调用此方法将用户选择发送回主进程，恢复 SSH 握手。
   *
   * @param requestId 关联请求 ID（来自 SshHostKeyPromptEvent.requestId）
   * @param action 用户选择的动作
   */
  respondHostKey: (
    requestId: string,
    action: SshHostKeyResponseAction,
  ): Promise<boolean> => ipcRenderer.invoke(SSH.HOST_KEY_RESPONSE, { requestId, action }),

  // ========================================================================
  // Phase M：SSH 密钥管理（删除 / 上传 / 生成 / 列表）
  // ========================================================================
  // 通道与主进程 ipc/ssh.ts 一一对应：
  // - ssh:delete-keypair   → deleteKeyring（幂等删除 ~/.ssh/<keyName> + .pub）
  // - ssh:upload-keypair   → uploadKeypair（文件对话框 + 复制 + chmod 600 + derive 公钥）
  // - ssh:generate-keypair → generateKeypair（ssh-keygen 生成 ed25519/rsa 密钥对）
  // - ssh:list-keypairs    → listKeypairs（扫描 ~/.ssh/ 列出所有密钥对）
  //
  // 安全说明：
  // - 所有文件 I/O 在主进程执行，渲染进程不直接访问文件系统
  // - 私钥权限 600（owner rw only），公钥 644（owner rw / others r）
  // - 删除操作幂等：删除不存在的密钥返回 success=true，不抛错
  // ========================================================================

  /**
   * 删除 SSH 密钥对（Phase M）
   *
   * 幂等：删除不存在的密钥返回 success=true，不抛错。
   *
   * @param keyName 密钥名称（如 id_ed25519），不含路径
   * @returns { success: boolean, error?: string }
   */
  deleteKeyring: (
    keyName: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(SSH.DELETE_KEYPAIR, keyName),

  /**
   * 上传 SSH 私钥到 ~/.ssh/（Phase M）
   *
   * 流程：
   * 1. 主进程弹出文件选择对话框
   * 2. 用户选择私钥文件后复制到 ~/.ssh/<filename>
   * 3. chmod 600 设置私钥权限
   * 4. ssh-keygen -y derive 公钥，写入 .pub，chmod 644
   *
   * 用户取消选择时返回 { success: false, canceled: true }，UI 应静默处理。
   *
   * @returns { success, keyPair?, error?, canceled? }
   */
  uploadKeypair: (): Promise<{
    success: boolean
    keyPair?: SshKeyPair
    error?: string
    canceled?: boolean
  }> => ipcRenderer.invoke(SSH.UPLOAD_KEYPAIR),

  /**
   * 生成 SSH 密钥对（Phase M）
   *
   * 调用 ssh-keygen 生成 ed25519（默认）或 rsa（4096 位）密钥对，
   * 输出到 ~/.ssh/<name>。私钥权限 600，公钥 644。
   *
   * @param request { type, name, passphrase?, comment? }
   * @returns GenerateKeyPairResponse（成功含 keyPair，失败含 error）
   */
  generateKeypair: (
    request: GenerateKeyPairRequest,
  ): Promise<GenerateKeyPairResponse> =>
    ipcRenderer.invoke(SSH.GENERATE_KEYPAIR, request),

  /**
   * 列出 ~/.ssh/ 目录下所有密钥对（Phase M）
   *
   * 扫描 ~/.ssh/ 目录，排除 .pub / known_hosts / config / authorized_keys /
   * 备份文件 / 隐藏文件，返回 SshKeyPair[]。
   *
   * @returns SshKeyPair[]（空目录返回空数组，不抛错）
   */
  listKeypairs: (): Promise<SshKeyPair[]> =>
    ipcRenderer.invoke(SSH.LIST_KEYPAIRS),
}

export { ssh }
