/** ssh 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { CommandResult, GenerateKeyPairRequest, GenerateKeyPairResponse, SshConfig, SshHostKeyResponseAction, SshKeyPair } from '@shared/models'
import { SSH } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

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

  /** 断开 SSH 连接 */
  disconnect: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(SSH.DISCONNECT, sessionId),

  /** 执行 SSH 命令 */
  exec: (sessionId: string, command: string): Promise<CommandResult> =>
    ipcRenderer.invoke(SSH.EXEC, sessionId, command),

  /** 交互式 Shell 操作 */
  shell: {
    /** 启动交互式 shell */
    start: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke(SSH.SHELL_START, sessionId),

    /** 向 shell 写入数据（仅供用户键入，主进程不判定整条命令） */
    write: (sessionId: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke(SSH.SHELL_WRITE, sessionId, data),

    /** 执行整条代写命令（AI 建议 / 决策页重跑）：主进程先过风险闸 */
    runAuthored: (sessionId: string, command: string): Promise<boolean> =>
      ipcRenderer.invoke(SSH.SHELL_RUN_AUTHORED, sessionId, command),

    /** 调整 shell 终端窗口大小 */
    resize: (sessionId: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke(SSH.SHELL_RESIZE, sessionId, cols, rows),
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
