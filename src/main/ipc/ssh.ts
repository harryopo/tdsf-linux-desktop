/**
 * SSH IPC Handlers
 *
 * 注册所有 SSH/SFTP 相关的 ipcMain.handle 通道，桥接渲染进程与 SshConnectionManager/SftpManager。
 *
 * 通道列表（与 IpcChannelMap 对应）：
 * - ssh:connect / ssh:disconnect / ssh:exec
 * - ssh:shell:start / ssh:shell:write / ssh:shell:resize
 * - sftp:list / sftp:upload / sftp:download / sftp:delete / sftp:rename / sftp:chmod
 *
 * Shell 数据推送：
 * - ssh:shell:start 成功后，注册 onShellData 回调
 * - 回调通过 mainWindow.webContents.send('terminal:data', sessionId, data) 推送到渲染进程
 *
 * 错误处理：
 * - 异步方法抛出的 Error 会被 ipcMain.handle 自动转为 rejected Promise 传给渲染进程
 * - 这里额外捕获并转为 Error 对象，确保序列化正常
 */

import { ipcMain, BrowserWindow, dialog } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { SSH, SFTP, TERMINAL } from '@shared/ipc-channels'
import { SshConnectionManager } from '../services/ssh/connection-manager'
import { SftpManager } from '../services/ssh/sftp'
import { logger } from '../services/log/logger'
import { redactSecrets } from '../core/agent/providers/redact'
import { recordToolCall } from './model-stats'
import { DatabaseManager } from '../services/db/database'
import type {
  SshConfig,
  SshHostKeyPromptEvent,
  SshHostKeyResponseAction,
  SshHostKeyResponsePayload,
  SshKeyPair,
  GenerateKeyPairRequest,
  GenerateKeyPairResponse,
} from '@shared/models'

// ============================================================================
// v2.2 修复问题 #41：ssh:exec 高危命令拦截
// ============================================================================
// 设计要点：
// - 审计日志：每次 ssh:exec 调用都记录 sessionId + command（脱敏后）到 logger
// - 黑名单拦截：匹配高危命令模式的直接拒绝，返回错误，不透传到 SSH 通道
// - 完整 HITL 审批成本高（需复用 sandbox-approval 机制），此处采用简化方案
//   后续如需完整审批，可接入 task-permission-approval 通道
// ============================================================================

/**
 * 高危命令黑名单（匹配则拦截，不执行）
 *
 * 覆盖场景：
 * - rm -rf /           递归删除根目录
 * - shutdown / reboot  关机重启
 * - mkfs.*             格式化文件系统
 * - dd ... of=/dev/    写入块设备
 * - chmod 777 /        危险权限
 * - :(){:|:&};:        fork 炸弹
 * - > /dev/sda         覆盖块设备
 */
const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /^\s*rm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-[a-zA-Z]*f[a-zA-Z]*r?)\s+\/(\s|$)/, // rm -rf /
  /^\s*rm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-[a-zA-Z]*f[a-zA-Z]*r?)\s+\/\*\s*/,   // rm -rf /*
  /^\s*shutdown\b/,
  /^\s*reboot\b/,
  /^\s*poweroff\b/,
  /^\s*halt\b/,
  /^\s*init\s+0\b/,
  /^\s*mkfs\b/,
  /^\s*dd\b.*\bof=\/dev\//,
  /^\s*chmod\s+777\s+\/(\s|$)/,
  /^\s*:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
  /^\s*>\s*\/dev\/(sd|nvme|vd)/,
]

/**
 * 检查命令是否为高危命令
 *
 * @param command 用户输入的命令
 * @returns true 表示高危，应拦截
 */
function isDangerousCommand(command: string): boolean {
  const trimmed = command.trim()
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(trimmed)) {
      return true
    }
  }
  return false
}

/**
 * v2.3 修复问题 #41 补齐：ssh:exec 入参 zod 校验 schema（B9 用户输入 IPC 必须校验）
 *
 * 校验规则：
 * - sessionId: 非空字符串，长度 1-200（防止超长字符串攻击）
 * - command: 非空字符串，长度 1-10000（防止超长命令导致 SSH 通道阻塞）
 */
const sshExecSchema = z.object({
  sessionId: z.string().min(1).max(200),
  command: z.string().min(1).max(10000),
})

/** 终端数据推送通道名（引用共享常量，保持与 preload 一致） */
const TERMINAL_DATA_CHANNEL = TERMINAL.DATA

/**
 * Phase L：主机密钥确认弹窗 pending request 表
 *
 * key: requestId（SshHostKeyPromptEvent.requestId）
 * value: { resolve, reject, timer }
 *
 * 工作流程：
 * 1. hostKeyConfirmHandler 收到 prompt → 存入 pendingHostKeyRequests → webContents.send 推送
 * 2. 渲染进程弹窗，用户选择后 ipcRenderer.invoke('ssh:host-key-response', payload)
 * 3. ssh:host-key-response handler 取出 pending → resolve(action)
 * 4. hostKeyConfirmHandler 的 Promise resolve → hostVerifier 继续/中断握手
 *
 * 超时保护：5 分钟未响应自动 reject（用户可能离开电脑）
 */
const pendingHostKeyRequests = new Map<
  string,
  {
    resolve: (action: SshHostKeyResponseAction) => void
    reject: (err: Error) => void
    timer: NodeJS.Timeout
  }
>()

/** 主机密钥弹窗超时时间（毫秒） */
const HOST_KEY_PROMPT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * 注册 SSH/SFTP 相关 IPC handlers
 *
 * @param mainWindow 主窗口实例，用于推送 Shell 数据到渲染进程
 */
export function registerSshIpcHandlers(mainWindow: BrowserWindow): void {
  const sshManager = SshConnectionManager.getInstance()
  const sftpManager = new SftpManager(sshManager)

  // ------------------------------------------------------------------
  // SSH 心跳保活状态变更推送（K.2）
  // ------------------------------------------------------------------
  // 心跳失败 → 自动重连 → 最终断开时，SshConnectionManager 通过
  // onStateChanged 回调推送 SshStateEvent，这里转发到渲染进程。
  // 返回值 unsink 用于卸载（应用退出时由 disconnectAll 兜底）。
  sshManager.onStateChanged((event) => {
    // 窗口可能已关闭或正在销毁，需防御性检查
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(SSH.STATE_CHANGED, event)
    }
  })

  // ------------------------------------------------------------------
  // Phase L：主机密钥校验弹窗（known_hosts）
  // ------------------------------------------------------------------
  // 注册 hostKeyConfirmHandler：当 hostVerifier 检测到首次连接/密钥变更时，
  // 推送 SshHostKeyPromptEvent 到渲染进程，等待用户响应。
  sshManager.setHostKeyConfirmHandler(
    (prompt: SshHostKeyPromptEvent): Promise<SshHostKeyResponseAction> => {
      return new Promise<SshHostKeyResponseAction>((resolve, reject) => {
        // 超时保护：5 分钟未响应自动拒绝
        const timer = setTimeout(() => {
          pendingHostKeyRequests.delete(prompt.requestId)
          reject(new Error('主机密钥确认超时（5 分钟未响应）'))
        }, HOST_KEY_PROMPT_TIMEOUT_MS)

        pendingHostKeyRequests.set(prompt.requestId, { resolve, reject, timer })

        // 推送到渲染进程弹窗
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(SSH.HOST_KEY_PROMPT, prompt)
        } else {
          // 窗口已销毁，直接拒绝
          clearTimeout(timer)
          pendingHostKeyRequests.delete(prompt.requestId)
          reject(new Error('主窗口已关闭，无法显示主机密钥确认弹窗'))
        }
      })
    },
  )

  /** ssh:host-key-response — 渲染进程响应用户选择（Phase L） */
  ipcMain.handle(
    SSH.HOST_KEY_RESPONSE,
    async (_event, payload: SshHostKeyResponsePayload): Promise<boolean> => {
      const pending = pendingHostKeyRequests.get(payload.requestId)
      if (!pending) {
        throw new Error(`无效或已过期的主机密钥请求: ${payload.requestId}`)
      }
      clearTimeout(pending.timer)
      pendingHostKeyRequests.delete(payload.requestId)
      pending.resolve(payload.action)
      return true
    },
  )

  // ------------------------------------------------------------------
  // SSH 连接管理
  // ------------------------------------------------------------------

  /** ssh:connect — 建立 SSH 连接，返回 sessionId */
  ipcMain.handle(SSH.CONNECT, async (_event, config: SshConfig) => {
    // 调试日志：输出收到的连接配置（不记录密码/私钥原文，仅记录存在性）
    logger.debug('SSH', '收到连接请求', {
      host: config.host,
      port: config.port,
      username: config.username,
      authType: config.authType,
      hasPassword: !!config.password,
      hasPrivateKey: !!config.privateKey,
      hasPrivateKeyPath: !!config.privateKeyPath,
      name: config.name,
    })
    try {
      const sessionId = await sshManager.connect(config)
      return sessionId
    } catch (err) {
      const safeMsg = redactSecrets((err as Error).message)
      logger.error('SSH', '连接失败', { error: safeMsg })
      throw new Error(`SSH 连接失败: ${safeMsg}`)
    }
  })

  /** ssh:disconnect — 断开会话 */
  ipcMain.handle(SSH.DISCONNECT, async (_event, sessionId: string) => {
    try {
      return await sshManager.disconnect(sessionId)
    } catch (err) {
      const safeMsg = redactSecrets((err as Error).message)
      logger.error('SSH', '断开失败', { sessionId, error: safeMsg })
      throw new Error(`SSH 断开失败: ${safeMsg}`)
    }
  })

  /** ssh:exec — 执行命令（含 zod 校验 + 审计日志 + 高危命令拦截） */
  ipcMain.handle(
    SSH.EXEC,
    async (_event, sessionId: string, command: string) => {
      // v2.3 修复问题 #41 补齐：zod schema 校验（B9 用户输入 IPC 必须校验）
      const parsed = sshExecSchema.safeParse({ sessionId, command })
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
        logger.warn('SSH', 'exec 入参校验失败', { issues })
        throw new Error(`SSH exec 参数无效: ${issues}`)
      }
      const { sessionId: safeSessionId, command: safeCommand } = parsed.data

      // v2.2 修复问题 #41：命令审计日志（谁在什么时候执行了什么命令）
      logger.info('SSH', 'exec 审计', {
        sessionId: safeSessionId,
        command: redactSecrets(safeCommand),
      })

      // 高危命令黑名单拦截（简化方案，替代完整 HITL 审批）
      if (isDangerousCommand(safeCommand)) {
        logger.warn('SSH', '高危命令已拦截', {
          sessionId: safeSessionId,
          command: redactSecrets(safeCommand),
        })
        throw new Error('高危命令已被拦截，请通过终端手动执行')
      }

      try {
        const result = await sshManager.exec(safeSessionId, safeCommand)
        // v2.4 Phase A：记录用户直接通过终端执行命令的工具调用（区别于 LLM 工具调用）
        // 工具名与 ModelSettings 显示一致，让"功能调用统计"反映真实使用频率
        // recordToolCall 内部已 try/catch，db 不可用时静默返回
        recordToolCall(DatabaseManager.getInstance(), '终端命令执行')
        return result
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', '命令执行失败', { sessionId: safeSessionId, error: safeMsg })
        throw new Error(`命令执行失败: ${safeMsg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // 交互式 Shell
  // ------------------------------------------------------------------

  /** ssh:shell:start — 启动交互式 shell，并注册数据推送回调 */
  ipcMain.handle(SSH.SHELL_START, async (_event, sessionId: string) => {
    try {
      const ok = await sshManager.startShell(sessionId)
      if (!ok) {
        return false
      }
      // 注册 Shell 数据回调，推送到渲染进程
      sshManager.onShellData(sessionId, (data: string) => {
        // 窗口可能已关闭或正在销毁，需防御性检查
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(TERMINAL_DATA_CHANNEL, sessionId, data)
        }
      })
      return true
    } catch (err) {
      const safeMsg = redactSecrets((err as Error).message)
      logger.error('SSH', '启动 Shell 失败', { sessionId, error: safeMsg })
      throw new Error(`启动 Shell 失败: ${safeMsg}`)
    }
  })

  /** ssh:shell:write — 向 shell 写入数据 */
  ipcMain.handle(
    SSH.SHELL_WRITE,
    async (_event, sessionId: string, data: string) => {
      try {
        return await sshManager.writeShell(sessionId, data)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', '写入 Shell 失败', { sessionId, error: safeMsg })
        throw new Error(`写入 Shell 失败: ${safeMsg}`)
      }
    }
  )

  /** ssh:shell:resize — 调整 shell 终端窗口大小 */
  ipcMain.handle(
    SSH.SHELL_RESIZE,
    async (_event, sessionId: string, cols: number, rows: number) => {
      try {
        return await sshManager.resizeShell(sessionId, cols, rows)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', '调整 Shell 大小失败', { sessionId, error: safeMsg })
        throw new Error(`调整 Shell 大小失败: ${safeMsg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // SFTP 文件管理
  // ------------------------------------------------------------------

  /** sftp:list — 列出远程目录 */
  ipcMain.handle(
    SFTP.LIST,
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.list(sessionId, remotePath)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP 列目录失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP 列目录失败: ${safeMsg}`)
      }
    }
  )

  /** sftp:upload — 上传文件（支持 transferId + 进度推送） */
  ipcMain.handle(
    SFTP.UPLOAD,
    async (
      _event,
      sessionId: string,
      localPath: string,
      remotePath: string,
      transferId?: string
    ) => {
      try {
        return await sftpManager.upload(
          sessionId,
          localPath,
          remotePath,
          (transferred, total) => {
            if (!transferId || mainWindow.isDestroyed()) return
            mainWindow.webContents.send(SFTP.PROGRESS, {
              transferId,
              type: 'upload',
              remotePath,
              localPath,
              transferred,
              total,
            })
          }
        )
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP 上传失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP 上传失败: ${safeMsg}`)
      }
    }
  )

  /** sftp:download — 下载文件（支持 transferId + 进度推送） */
  ipcMain.handle(
    SFTP.DOWNLOAD,
    async (
      _event,
      sessionId: string,
      remotePath: string,
      localPath: string,
      transferId?: string
    ) => {
      try {
        return await sftpManager.download(
          sessionId,
          remotePath,
          localPath,
          (transferred, total) => {
            if (!transferId || mainWindow.isDestroyed()) return
            mainWindow.webContents.send(SFTP.PROGRESS, {
              transferId,
              type: 'download',
              remotePath,
              localPath,
              transferred,
              total,
            })
          }
        )
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP 下载失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP 下载失败: ${safeMsg}`)
      }
    }
  )

  /** sftp:delete — 删除文件/目录 */
  ipcMain.handle(
    SFTP.DELETE,
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.delete(sessionId, remotePath)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP 删除失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP 删除失败: ${safeMsg}`)
      }
    }
  )

  /** sftp:rename — 重命名 */
  ipcMain.handle(
    SFTP.RENAME,
    async (
      _event,
      sessionId: string,
      oldPath: string,
      newPath: string
    ) => {
      try {
        return await sftpManager.rename(sessionId, oldPath, newPath)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP 重命名失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP 重命名失败: ${safeMsg}`)
      }
    }
  )

  /** sftp:chmod — 修改权限 */
  ipcMain.handle(
    SFTP.CHMOD,
    async (_event, sessionId: string, remotePath: string, mode: number) => {
      try {
        return await sftpManager.chmod(sessionId, remotePath, mode)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP chmod 失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP chmod 失败: ${safeMsg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // SFTP 文件读写（v0.8 IDE 工作台）
  // ------------------------------------------------------------------

  /** sftp:readFile — 读取远程文件内容到字符串（10MB 上限，用于代码编辑器） */
  ipcMain.handle(
    SFTP.READ_FILE,
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.readFile(sessionId, remotePath)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP 读取文件失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP 读取文件失败: ${safeMsg}`)
      }
    }
  )

  /** sftp:writeFile — 写入字符串到远程文件（覆盖原文件，用于代码编辑器保存） */
  ipcMain.handle(
    SFTP.WRITE_FILE,
    async (
      _event,
      sessionId: string,
      remotePath: string,
      content: string
    ) => {
      try {
        return await sftpManager.writeFile(sessionId, remotePath, content)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP 写入文件失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP 写入文件失败: ${safeMsg}`)
      }
    }
  )

  /** sftp:stat — 获取文件/目录元信息（返回 SftpEntry 或 null） */
  ipcMain.handle(
    SFTP.STAT,
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.stat(sessionId, remotePath)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP stat 失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP stat 失败: ${safeMsg}`)
      }
    }
  )

  /** sftp:mkdir — 创建远程目录 */
  ipcMain.handle(
    SFTP.MKDIR,
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.mkdir(sessionId, remotePath)
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', 'SFTP mkdir 失败', { sessionId, error: safeMsg })
        throw new Error(`SFTP mkdir 失败: ${safeMsg}`)
      }
    }
  )

  // ========================================================================
  // Phase M：SSH 密钥管理（删除 / 上传 / 生成 / 列表）
  // ========================================================================
  // 设计要点：
  // - 所有密钥文件统一存放在 ~/.ssh/ 目录（os.homedir()/.ssh/）
  // - 私钥权限 600（owner read/write only），公钥 644（owner write / others read）
  // - 删除操作幂等：删除不存在的密钥返回 success=true，不抛错
  // - 上传私钥后自动 derive 公钥（ssh-keygen -y），保证密钥对完整
  // - 生成密钥默认类型 ed25519（更安全更短，性能优于 RSA）
  // - 主进程负责所有文件 I/O，渲染进程不直接访问文件系统
  // ========================================================================

  /**
   * 获取 ~/.ssh/ 目录路径，确保目录存在
   *
   * @returns ~/.ssh/ 绝对路径
   */
  function ensureSshDir(): string {
    const sshDir = path.join(os.homedir(), '.ssh')
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 })
    }
    return sshDir
  }

  /**
   * 从私钥路径推断密钥类型
   * - 名称含 ed25519 → ed25519
   * - 名称含 rsa → rsa
   * - 默认 ed25519
   */
  function inferKeyType(privateKeyPath: string): 'ed25519' | 'rsa' {
    const name = path.basename(privateKeyPath).toLowerCase()
    if (name.includes('rsa')) return 'rsa'
    return 'ed25519'
  }

  /**
   * ssh:delete-keypair — 删除指定密钥对（私钥 + 公钥 .pub）
   *
   * 幂等：删除不存在的文件返回 success=true，不抛错。
   *
   * @param keyName 密钥名称（如 id_ed25519），不含路径
   * @returns { success: boolean, error?: string }
   */
  ipcMain.handle(
    SSH.DELETE_KEYPAIR,
    async (_event, keyName: string): Promise<{ success: boolean; error?: string }> => {
      try {
        if (!keyName || typeof keyName !== 'string') {
          return { success: false, error: '密钥名称不能为空' }
        }
        // 安全检查：禁止路径分隔符（防止目录穿越）
        if (keyName.includes('/') || keyName.includes('\\') || keyName.includes('..')) {
          return { success: false, error: '密钥名称不能包含路径分隔符' }
        }
        const sshDir = path.join(os.homedir(), '.ssh')
        const privateKeyPath = path.join(sshDir, keyName)
        const publicKeyPath = `${privateKeyPath}.pub`

        // 幂等删除私钥
        try {
          if (fs.existsSync(privateKeyPath)) {
            fs.unlinkSync(privateKeyPath)
          }
        } catch (err) {
          logger.warn('SSH', '删除私钥失败', { keyName, error: redactSecrets((err as Error).message) })
        }

        // 幂等删除公钥
        try {
          if (fs.existsSync(publicKeyPath)) {
            fs.unlinkSync(publicKeyPath)
          }
        } catch (err) {
          logger.warn('SSH', '删除公钥失败', { keyName, error: redactSecrets((err as Error).message) })
        }

        logger.info('SSH', '密钥已删除', { keyName })
        return { success: true }
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        logger.error('SSH', '删除密钥失败', { keyName, error: safeMsg })
        return { success: false, error: safeMsg }
      }
    },
  )

  /**
   * ssh:upload-keypair — 上传私钥到 ~/.ssh/
   *
   * 流程：
   * 1. dialog.showOpenDialog 让用户选择私钥文件
   * 2. 复制文件到 ~/.ssh/<filename>
   * 3. chmod 600 设置私钥权限
   * 4. 调用 ssh-keygen -y -f <privateKey> derive 公钥，写入 .pub，chmod 644
   * 5. 返回 SshKeyPair 信息
   *
   * @returns { success: boolean, keyPair?: SshKeyPair, error?: string, canceled?: boolean }
   */
  ipcMain.handle(
    SSH.UPLOAD_KEYPAIR,
    async (): Promise<{
      success: boolean
      keyPair?: SshKeyPair
      error?: string
      canceled?: boolean
    }> => {
      try {
        // 1. 弹出文件选择对话框
        const result = await dialog.showOpenDialog(mainWindow, {
          title: '选择私钥文件',
          defaultPath: os.homedir(),
          properties: ['openFile'],
          filters: [
            { name: '所有文件', extensions: ['*'] },
            { name: '私钥文件', extensions: ['pem', 'key', 'id_rsa', 'id_ed25519'] },
          ],
        })

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, canceled: true }
        }

        const sourcePath = result.filePaths[0]
        const keyName = path.basename(sourcePath)
        // 安全检查：禁止路径分隔符
        if (keyName.includes('/') || keyName.includes('\\') || keyName.includes('..')) {
          return { success: false, error: '密钥文件名不合法' }
        }

        const sshDir = ensureSshDir()
        const privateKeyPath = path.join(sshDir, keyName)
        const publicKeyPath = `${privateKeyPath}.pub`

        // 2. 复制文件到 ~/.ssh/
        fs.copyFileSync(sourcePath, privateKeyPath)

        // 3. 设置私钥权限 600
        fs.chmodSync(privateKeyPath, 0o600)

        // 4. derive 公钥（ssh-keygen -y -f <privateKey>）
        const publicKeyContent = await new Promise<string>((resolve, reject) => {
          const proc = spawn('ssh-keygen', ['-y', '-f', privateKeyPath])
          let stdout = ''
          let stderr = ''
          proc.stdout.on('data', (data: Buffer) => {
            stdout += data.toString()
          })
          proc.stderr.on('data', (data: Buffer) => {
            stderr += data.toString()
          })
          proc.on('close', (code: number | null) => {
            if (code === 0) {
              resolve(stdout.trim())
            } else {
              reject(new Error(`ssh-keygen derive 公钥失败 (exit ${code}): ${stderr}`))
            }
          })
          proc.on('error', (err: Error) => {
            reject(new Error(`ssh-keygen 启动失败: ${err.message}`))
          })
        })

        // 写入公钥文件 + chmod 644
        fs.writeFileSync(publicKeyPath, publicKeyContent + '\n', { mode: 0o644 })
        fs.chmodSync(publicKeyPath, 0o644)

        const keyPair: SshKeyPair = {
          name: keyName,
          type: inferKeyType(privateKeyPath),
          privateKeyPath,
          publicKeyPath,
          publicKeyContent,
          createdAt: Date.now(),
        }

        logger.info('SSH', '私钥已上传', { keyName })
        return { success: true, keyPair }
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        // keyName 在 try 块内定义，catch 块不可访问，故仅记录 error
        logger.error('SSH', '上传私钥失败', { error: safeMsg })
        return { success: false, error: safeMsg }
      }
    },
  )

  /**
   * ssh:generate-keypair — 调用 ssh-keygen 生成新密钥对
   *
   * @param request GenerateKeyPairRequest
   * @returns GenerateKeyPairResponse
   */
  ipcMain.handle(
    SSH.GENERATE_KEYPAIR,
    async (_event, request: GenerateKeyPairRequest): Promise<GenerateKeyPairResponse> => {
      try {
        if (!request || !request.name) {
          return { success: false, error: '密钥名称不能为空' }
        }
        const keyName = request.name
        // 安全检查：禁止路径分隔符
        if (keyName.includes('/') || keyName.includes('\\') || keyName.includes('..')) {
          return { success: false, error: '密钥名称不能包含路径分隔符' }
        }
        const keyType = request.type === 'rsa' ? 'rsa' : 'ed25519'
        // rsa 时强制 4096 位（更安全）
        const passphrase = request.passphrase || ''
        const comment = request.comment || `${os.userInfo().username}@${os.hostname()}`

        const sshDir = ensureSshDir()
        const privateKeyPath = path.join(sshDir, keyName)
        const publicKeyPath = `${privateKeyPath}.pub`

        // 文件已存在则拒绝（避免覆盖现有密钥）
        if (fs.existsSync(privateKeyPath)) {
          return {
            success: false,
            error: `密钥已存在: ${keyName}（请先删除或更换名称）`,
          }
        }

        // 构造 ssh-keygen 参数
        const args: string[] = ['-t', keyType, '-f', privateKeyPath, '-N', passphrase, '-C', comment]
        if (keyType === 'rsa') {
          // -b 必须在 -t 之后
          args.splice(2, 0, '-b', '4096')
        }

        // 执行 ssh-keygen
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('ssh-keygen', args)
          let stderr = ''
          proc.stderr.on('data', (data: Buffer) => {
            stderr += data.toString()
          })
          proc.on('close', (code: number | null) => {
            if (code === 0) {
              resolve()
            } else {
              reject(new Error(`ssh-keygen 退出码 ${code}: ${stderr}`))
            }
          })
          proc.on('error', (err: Error) => {
            reject(new Error(`ssh-keygen 启动失败: ${err.message}`))
          })
        })

        // 设置权限：私钥 600，公钥 644
        fs.chmodSync(privateKeyPath, 0o600)
        fs.chmodSync(publicKeyPath, 0o644)

        // 读取公钥内容
        let publicKeyContent: string | undefined
        try {
          publicKeyContent = fs.readFileSync(publicKeyPath, 'utf-8').trim()
        } catch {
          publicKeyContent = undefined
        }

        const keyPair: SshKeyPair = {
          name: keyName,
          type: keyType,
          privateKeyPath,
          publicKeyPath,
          publicKeyContent,
          createdAt: Date.now(),
        }

        logger.info('SSH', '密钥已生成', { keyName, keyType })
        return { success: true, keyPair }
      } catch (err) {
        const safeMsg = redactSecrets((err as Error).message)
        // keyName 在 try 块内定义，catch 块不可访问，故仅记录 error
        logger.error('SSH', '生成密钥失败', { error: safeMsg })
        return { success: false, error: safeMsg }
      }
    },
  )

  /**
   * ssh:list-keypairs — 列出 ~/.ssh/ 目录下所有密钥对
   *
   * 扫描 ~/.ssh/ 目录，识别私钥文件：
   * - 排除 .pub 文件（这些是公钥）
   * - 排除 known_hosts / config / authorized_keys 等配置文件
   * - 排除目录
   * - 文件名以 . 开头或 .bak/.old 结尾的也排除
   *
   * @returns SshKeyPair[]
   */
  ipcMain.handle(
    SSH.LIST_KEYPAIRS,
    async (): Promise<SshKeyPair[]> => {
      try {
        const sshDir = path.join(os.homedir(), '.ssh')
        if (!fs.existsSync(sshDir)) {
          return []
        }

        // 排除的文件名（配置文件，不是密钥）
        const EXCLUDED_NAMES = new Set([
          'known_hosts',
          'known_hosts.old',
          'authorized_keys',
          'config',
          'environment',
        ])

        const stat = fs.statSync(sshDir)
        if (!stat.isDirectory()) {
          return []
        }

        const entries = fs.readdirSync(sshDir, { withFileTypes: true })
        const keyPairs: SshKeyPair[] = []

        for (const entry of entries) {
          if (!entry.isFile()) continue
          const name = entry.name
          // 跳过公钥文件
          if (name.endsWith('.pub')) continue
          // 跳过配置文件
          if (EXCLUDED_NAMES.has(name)) continue
          // 跳过备份文件
          if (name.endsWith('.bak') || name.endsWith('.old')) continue
          // 跳过隐藏文件
          if (name.startsWith('.')) continue

          const privateKeyPath = path.join(sshDir, name)
          const publicKeyPath = `${privateKeyPath}.pub`

          // 检查是否有对应的 .pub 文件
          let publicKeyContent: string | undefined
          try {
            if (fs.existsSync(publicKeyPath)) {
              publicKeyContent = fs.readFileSync(publicKeyPath, 'utf-8').trim()
            }
          } catch {
            publicKeyContent = undefined
          }

          // 读取私钥文件 stat 获取创建时间
          let createdAt: number | undefined
          try {
            const privateKeyStat = fs.statSync(privateKeyPath)
            createdAt = privateKeyStat.birthtimeMs || privateKeyStat.mtimeMs
          } catch {
            createdAt = undefined
          }

          keyPairs.push({
            name,
            type: inferKeyType(privateKeyPath),
            privateKeyPath,
            publicKeyPath,
            publicKeyContent,
            createdAt,
          })
        }

        return keyPairs
      } catch (err) {
        logger.error('SSH', '列出密钥失败', { error: redactSecrets((err as Error).message) })
        return []
      }
    },
  )
}
