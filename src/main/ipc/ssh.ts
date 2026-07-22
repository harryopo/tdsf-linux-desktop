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

import { ipcMain, BrowserWindow } from 'electron'
import { SSH } from '@shared/ipc-channels'
import { SshConnectionManager } from '../services/ssh/connection-manager'
import { SftpManager } from '../services/ssh/sftp'
import type {
  SshConfig,
  SshHostKeyPromptEvent,
  SshHostKeyResponseAction,
  SshHostKeyResponsePayload,
} from '@shared/models'

/** 终端数据推送通道名 */
const TERMINAL_DATA_CHANNEL = 'terminal:data'

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
    // 调试日志：输出收到的连接配置（脱敏）
    console.log('[SSH] 收到连接请求:', {
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
      console.error('[SSH] 连接失败:', (err as Error).message)
      throw new Error(`SSH 连接失败: ${(err as Error).message}`)
    }
  })

  /** ssh:disconnect — 断开会话 */
  ipcMain.handle(SSH.DISCONNECT, async (_event, sessionId: string) => {
    try {
      return await sshManager.disconnect(sessionId)
    } catch (err) {
      throw new Error(`SSH 断开失败: ${(err as Error).message}`)
    }
  })

  /** ssh:exec — 执行命令 */
  ipcMain.handle(
    'ssh:exec',
    async (_event, sessionId: string, command: string) => {
      try {
        return await sshManager.exec(sessionId, command)
      } catch (err) {
        throw new Error(`命令执行失败: ${(err as Error).message}`)
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
      throw new Error(`启动 Shell 失败: ${(err as Error).message}`)
    }
  })

  /** ssh:shell:write — 向 shell 写入数据 */
  ipcMain.handle(
    'ssh:shell:write',
    async (_event, sessionId: string, data: string) => {
      try {
        return await sshManager.writeShell(sessionId, data)
      } catch (err) {
        throw new Error(`写入 Shell 失败: ${(err as Error).message}`)
      }
    }
  )

  /** ssh:shell:resize — 调整 shell 终端窗口大小 */
  ipcMain.handle(
    'ssh:shell:resize',
    async (_event, sessionId: string, cols: number, rows: number) => {
      try {
        return await sshManager.resizeShell(sessionId, cols, rows)
      } catch (err) {
        throw new Error(`调整 Shell 大小失败: ${(err as Error).message}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // SFTP 文件管理
  // ------------------------------------------------------------------

  /** sftp:list — 列出远程目录 */
  ipcMain.handle(
    'sftp:list',
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.list(sessionId, remotePath)
      } catch (err) {
        throw new Error(`SFTP 列目录失败: ${(err as Error).message}`)
      }
    }
  )

  /** sftp:upload — 上传文件 */
  ipcMain.handle(
    'sftp:upload',
    async (
      _event,
      sessionId: string,
      localPath: string,
      remotePath: string
    ) => {
      try {
        return await sftpManager.upload(sessionId, localPath, remotePath)
      } catch (err) {
        throw new Error(`SFTP 上传失败: ${(err as Error).message}`)
      }
    }
  )

  /** sftp:download — 下载文件 */
  ipcMain.handle(
    'sftp:download',
    async (
      _event,
      sessionId: string,
      remotePath: string,
      localPath: string
    ) => {
      try {
        return await sftpManager.download(sessionId, remotePath, localPath)
      } catch (err) {
        throw new Error(`SFTP 下载失败: ${(err as Error).message}`)
      }
    }
  )

  /** sftp:delete — 删除文件/目录 */
  ipcMain.handle(
    'sftp:delete',
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.delete(sessionId, remotePath)
      } catch (err) {
        throw new Error(`SFTP 删除失败: ${(err as Error).message}`)
      }
    }
  )

  /** sftp:rename — 重命名 */
  ipcMain.handle(
    'sftp:rename',
    async (
      _event,
      sessionId: string,
      oldPath: string,
      newPath: string
    ) => {
      try {
        return await sftpManager.rename(sessionId, oldPath, newPath)
      } catch (err) {
        throw new Error(`SFTP 重命名失败: ${(err as Error).message}`)
      }
    }
  )

  /** sftp:chmod — 修改权限 */
  ipcMain.handle(
    'sftp:chmod',
    async (_event, sessionId: string, remotePath: string, mode: number) => {
      try {
        return await sftpManager.chmod(sessionId, remotePath, mode)
      } catch (err) {
        throw new Error(`SFTP chmod 失败: ${(err as Error).message}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // SFTP 文件读写（v0.8 IDE 工作台）
  // ------------------------------------------------------------------

  /** sftp:readFile — 读取远程文件内容到字符串（10MB 上限，用于代码编辑器） */
  ipcMain.handle(
    'sftp:readFile',
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.readFile(sessionId, remotePath)
      } catch (err) {
        throw new Error(`SFTP 读取文件失败: ${(err as Error).message}`)
      }
    }
  )

  /** sftp:writeFile — 写入字符串到远程文件（覆盖原文件，用于代码编辑器保存） */
  ipcMain.handle(
    'sftp:writeFile',
    async (
      _event,
      sessionId: string,
      remotePath: string,
      content: string
    ) => {
      try {
        return await sftpManager.writeFile(sessionId, remotePath, content)
      } catch (err) {
        throw new Error(`SFTP 写入文件失败: ${(err as Error).message}`)
      }
    }
  )

  /** sftp:stat — 获取文件/目录元信息（返回 SftpEntry 或 null） */
  ipcMain.handle(
    'sftp:stat',
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.stat(sessionId, remotePath)
      } catch (err) {
        throw new Error(`SFTP stat 失败: ${(err as Error).message}`)
      }
    }
  )

  /** sftp:mkdir — 创建远程目录 */
  ipcMain.handle(
    'sftp:mkdir',
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await sftpManager.mkdir(sessionId, remotePath)
      } catch (err) {
        throw new Error(`SFTP mkdir 失败: ${(err as Error).message}`)
      }
    }
  )
}
