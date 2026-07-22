/**
 * SSH 连接管理器
 *
 * 基于 ssh2 (mscdex) v1.17 实现 SSH 连接管理，支持：
 * - 密码认证和私钥认证（文件路径或直接内容）
 * - 跳板机（jumpHost）多跳连接（forwardOut 转发）
 * - 多会话管理（Map<sessionId, Client>）
 * - 交互式 Shell（pty=true，支持 vim/top）
 * - 命令执行（exec）
 * - 连接状态管理（connecting/connected/disconnected/error）
 * - keepAlive 心跳保活
 * - 线程安全（每会话独立连接锁）
 *
 * 单例模式：通过 SshConnectionManager.getInstance() 获取。
 * Shell 数据通过 onShellData 注册的回调推送，IPC 层负责转 webContents.send。
 * 参考：_legacy-python/src/tdsf_desktop/ssh/connection.py
 */

import { Client, ClientChannel } from 'ssh2'
import type { ConnectConfig } from 'ssh2'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SshConfig, CommandResult, SshConnectionState, SshStateEvent } from '@shared/models'

/** 单个 SSH 会话的内部条目 */
interface SessionEntry {
  /** ssh2 客户端实例 */
  client: Client
  /** 会话 ID（与 sessions Map 的 key 一致，重连时需要） */
  sessionId: string
  /** 原始连接配置（脱敏保留，用于重连） */
  config: SshConfig
  /** 当前连接状态 */
  state: SshConnectionState
  /** 创建时间戳（毫秒） */
  createdAt: number
  /** 最后活动时间戳（毫秒） */
  lastUsedAt: number
  /** 交互式 Shell 通道（startShell 后存在） */
  shell: ClientChannel | null
  /** Shell 数据回调列表 */
  shellCallbacks: Array<(data: string) => void>
  /** keepAlive 心跳定时器句柄 */
  keepAliveTimer: NodeJS.Timeout | null
  /** 连接锁：非空表示有正在进行的连接/断开操作 */
  pendingOp: Promise<unknown> | null
  /** 标记是否正在重连（防止重连期间重复触发心跳失败处理） */
  reconnecting: boolean
}

/** 默认连接超时（毫秒） */
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000
/** 默认命令执行超时（毫秒） */
const DEFAULT_EXEC_TIMEOUT_MS = 30_000
/** keepAlive 默认心跳间隔（秒），可被 SshConfig.keepAliveIntervalSec 覆盖 */
const KEEPALIVE_DEFAULT_INTERVAL_SEC = 30
/** keepAlive 最大失败次数，超过则触发重连 */
const KEEPALIVE_MAX_FAILURES = 3
/** 自动重连最大尝试次数 */
const RECONNECT_MAX_ATTEMPTS = 3
/** 自动重连基础退避（毫秒），指数退避：1s → 2s → 4s */
const RECONNECT_BASE_DELAY_MS = 1_000
/** 自动重连总时长上限（毫秒），超过则放弃 */
const RECONNECT_MAX_TOTAL_MS = 30_000

/**
 * SSH 连接管理器（单例）
 *
 * 管理所有 SSH 会话的生命周期，对外提供 connect/disconnect/exec/shell 等方法。
 */
export class SshConnectionManager {
  /** 单例实例 */
  private static instance: SshConnectionManager | null = null

  /** 会话表：sessionId → SessionEntry */
  private sessions: Map<string, SessionEntry> = new Map()

  /** 状态变更回调列表（IPC 层注册，用于推送 SshStateEvent 到渲染进程） */
  private stateChangeCallbacks: Array<(event: SshStateEvent) => void> = []

  /** 获取单例实例 */
  public static getInstance(): SshConnectionManager {
    if (!SshConnectionManager.instance) {
      SshConnectionManager.instance = new SshConnectionManager()
    }
    return SshConnectionManager.instance
  }

  /** 私有构造，强制单例 */
  private constructor() {}

  // ------------------------------------------------------------------
  // 连接 / 断开
  // ------------------------------------------------------------------

  /**
   * 建立 SSH 连接
   *
   * 流程：生成 sessionId → 校验配置 → 连接锁包裹 → 实际连接
   * 跳板机模式：先连跳板机，跳板机 ready 后用 forwardOut 转发到目标 SSH 端口，
   * 再用 ssh2 Client.connect({ sock: stream }) 完成二级连接。
   *
   * @param config SSH 连接配置
   * @returns sessionId 会话唯一标识
   * @throws 连接失败时 reject Error
   */
  public async connect(config: SshConfig): Promise<string> {
    this.validateConfig(config)
    const sessionId = randomUUID()
    const entry: SessionEntry = {
      client: new Client(),
      sessionId,
      config,
      state: 'connecting',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      shell: null,
      shellCallbacks: [],
      keepAliveTimer: null,
      pendingOp: null,
      reconnecting: false,
    }
    // 提前占位，避免后续操作找不到会话
    this.sessions.set(sessionId, entry)
    await this.runWithLock(sessionId, () => this.doConnect(entry, config))
    return sessionId
  }

  /**
   * 断开指定会话
   *
   * 关闭 Shell 通道、停止心跳、关闭 Client，最后从会话表移除。
   *
   * @param sessionId 会话 ID
   * @returns 是否成功断开（会话不存在返回 false）
   */
  public async disconnect(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      return false
    }
    await this.runWithLock(sessionId, () => this.doDisconnect(sessionId, entry))
    return true
  }

  /** 断开所有会话（应用退出时调用） */
  public async disconnectAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys())
    await Promise.allSettled(ids.map((id) => this.disconnect(id)))
  }

  // ------------------------------------------------------------------
  // 命令执行
  // ------------------------------------------------------------------

  /**
   * 在指定会话上执行 SSH 命令
   *
   * 使用 ssh2 的 exec 接口，等待 exit 事件后返回 stdout/stderr/exitCode。
   * 通过 stream.on('data'/'stderr') 累积输出，避免大输出截断。
   *
   * @param sessionId 会话 ID
   * @param command 要执行的 shell 命令
   * @returns 命令执行结果
   * @throws 会话不存在或未连接时 reject
   */
  public async exec(sessionId: string, command: string): Promise<CommandResult> {
    const entry = this.requireSession(sessionId)
    this.requireConnected(entry)
    entry.lastUsedAt = Date.now()
    const startTime = Date.now()

    return new Promise<CommandResult>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let exitCode = -1
      let settled = false

      const fail = (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // 单条命令失败不修改连接状态，保持会话可用
        reject(err)
      }
      const ok = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ exitCode, stdout, stderr, duration: Date.now() - startTime })
      }
      const timer = setTimeout(
        () => fail(new Error(`命令执行超时（${DEFAULT_EXEC_TIMEOUT_MS}ms）: ${command}`)),
        DEFAULT_EXEC_TIMEOUT_MS
      )

      try {
        entry.client.exec(command, (err, stream) => {
          if (err) {
            fail(err)
            return
          }
          stream.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8')
          })
          stream.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8')
          })
          stream.on('exit', (code: number | null) => {
            exitCode = code ?? 0
          })
          stream.on('close', ok)
          stream.on('error', fail)
        })
      } catch (err) {
        fail(err as Error)
      }
    })
  }

  // ------------------------------------------------------------------
  // 交互式 Shell
  // ------------------------------------------------------------------

  /**
   * 启动交互式 Shell
   *
   * 使用 pty（伪终端）开启 Shell，支持 vim/top/htop 等全屏交互程序。
   * Shell 数据通过 onShellData 注册的回调推送。
   *
   * @param sessionId 会话 ID
   * @returns 是否成功启动（已存在 Shell 视为成功）
   */
  public async startShell(sessionId: string): Promise<boolean> {
    const entry = this.requireSession(sessionId)
    this.requireConnected(entry)
    entry.lastUsedAt = Date.now()
    if (entry.shell) {
      return true
    }
    return new Promise<boolean>((resolve, reject) => {
      entry.client.shell(
        { term: 'xterm-256color', cols: 80, rows: 24 },
        (err, stream) => {
          if (err) {
            entry.state = 'error'
            reject(err)
            return
          }
          entry.shell = stream
          // Shell 输出广播给所有注册的回调
          stream.on('data', (chunk: Buffer) => {
            const data = chunk.toString('utf8')
            for (const cb of entry.shellCallbacks) {
              try {
                cb(data)
              } catch {
                // 单个回调异常不影响其他回调
              }
            }
          })
          stream.on('close', () => {
            entry.shell = null
          })
          stream.on('error', () => {
            entry.shell = null
          })
          resolve(true)
        }
      )
    })
  }

  /**
   * 向 Shell 写入数据（模拟键盘输入）
   * @param sessionId 会话 ID
   * @param data 要写入的数据（按键或命令字符串）
   */
  public async writeShell(sessionId: string, data: string): Promise<boolean> {
    const entry = this.requireSession(sessionId)
    if (!entry.shell) {
      throw new Error(`会话 ${sessionId} 未启动 Shell`)
    }
    return new Promise<boolean>((resolve) => {
      entry.shell!.write(data, 'utf8', (err) => resolve(!err))
    })
  }

  /**
   * 调整 Shell 终端窗口大小（响应前端 xterm.js resize 事件）
   * @param sessionId 会话 ID
   * @param cols 列数
   * @param rows 行数
   */
  public async resizeShell(
    sessionId: string,
    cols: number,
    rows: number
  ): Promise<boolean> {
    const entry = this.requireSession(sessionId)
    if (!entry.shell) {
      return false
    }
    try {
      entry.shell.setWindow(rows, cols, rows * 16, cols * 8)
      return true
    } catch {
      return false
    }
  }

  /**
   * 注册 Shell 数据回调
   *
   * 一个会话可注册多个回调，所有 Shell 输出会广播给所有回调。
   * 用于 IPC 层把数据转发到对应渲染进程。
   */
  public onShellData(sessionId: string, callback: (data: string) => void): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      throw new Error(`会话不存在: ${sessionId}`)
    }
    entry.shellCallbacks.push(callback)
  }

  // ------------------------------------------------------------------
  // 状态查询
  // ------------------------------------------------------------------

  /**
   * 注册心跳保活状态变更回调
   *
   * 心跳失败触发重连、重连成功/失败时，通过此回调通知调用方（IPC 层）。
   * IPC 层注册后，回调内通过 mainWindow.webContents.send 推送 SshStateEvent 到渲染进程。
   *
   * @param callback 回调函数，接收 SshStateEvent
   * @returns 取消注册函数
   */
  public onStateChanged(callback: (event: SshStateEvent) => void): () => void {
    this.stateChangeCallbacks.push(callback)
    return () => {
      const idx = this.stateChangeCallbacks.indexOf(callback)
      if (idx >= 0) {
        this.stateChangeCallbacks.splice(idx, 1)
      }
    }
  }

  /**
   * 获取会话连接状态
   * @param sessionId 会话 ID
   * @returns 连接状态（会话不存在返回 'disconnected'）
   */
  public getConnectionState(sessionId: string): SshConnectionState {
    const entry = this.sessions.get(sessionId)
    return entry ? entry.state : 'disconnected'
  }

  /**
   * 获取会话对应的 ssh2 Client（供 SftpManager 等内部模块使用）
   * @internal
   */
  public getClient(sessionId: string): Client {
    const entry = this.requireSession(sessionId)
    this.requireConnected(entry)
    entry.lastUsedAt = Date.now()
    return entry.client
  }

  /**
   * 检查是否有活动 SSH 连接
   *
   * 用于循环工程等场景的预检查：在调用 exec/startShell 之前
   * 先同步判断是否存在 status === 'connected' 的会话，避免依赖
   * requireConnected 抛错兜底，提供更早的 UI 提示。
   *
   * @returns true 表示至少有一个活动连接，false 表示无连接
   */
  public hasActiveConnection(): boolean {
    for (const entry of this.sessions.values()) {
      if (entry.state === 'connected') {
        return true
      }
    }
    return false
  }

  // ------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------

  /**
   * 实际连接逻辑
   *
   * 跳板机策略：先连跳板机，跳板机 ready 后用 forwardOut 把目标 SSH 端口
   * 转发成一个本地 stream，再用 Client.connect({ sock: stream }) 完成二级连接。
   */
  private doConnect(entry: SessionEntry, config: SshConfig): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SSH 连接超时（${DEFAULT_CONNECT_TIMEOUT_MS}ms）: ${config.host}`))
      }, DEFAULT_CONNECT_TIMEOUT_MS)
      const onReady = () => {
        clearTimeout(timer)
        entry.state = 'connected'
        entry.lastUsedAt = Date.now()
        this.startKeepAlive(entry)
        resolve()
      }
      const onError = (err: Error) => {
        clearTimeout(timer)
        entry.state = 'error'
        reject(err)
      }
      const targetOpts = this.buildConnectOptions(config)

      // 跳板机模式
      if (config.jumpHost) {
        const jumpClient = new Client()
        const jumpOpts = this.buildConnectOptions({
          ...config.jumpHost,
          id: 'jump',
          name: 'jump',
        } as SshConfig)
        jumpClient.on('ready', () => {
          // 通过跳板机转发到目标主机的 SSH 端口
          jumpClient.forwardOut(
            '127.0.0.1',
            0,
            config.host,
            config.port,
            (err, stream) => {
              if (err) {
                onError(new Error(`跳板机转发失败: ${err.message}`))
                jumpClient.end()
                return
              }
              // 用转发出来的 stream 作为底层 socket 连接目标
              targetOpts.sock = stream
              this.wireClient(entry.client, targetOpts, onReady, onError)
            }
          )
        })
        jumpClient.on('error', (err) => {
          onError(new Error(`跳板机连接失败: ${err.message}`))
        })
        jumpClient.connect(jumpOpts)
      } else {
        // 直连模式
        this.wireClient(entry.client, targetOpts, onReady, onError)
      }
    })
  }

  /** 把 ssh2 Client 绑定到指定连接选项，并注册 ready/error/close 监听 */
  private wireClient(
    client: Client,
    opts: ConnectConfig,
    onReady: () => void,
    onError: (err: Error) => void
  ): void {
    client.once('ready', onReady)
    client.once('error', onError)
    // close 事件在连接断开时触发，更新状态
    client.on('close', () => {
      for (const entry of this.sessions.values()) {
        if (entry.client === client) {
          entry.state = 'disconnected'
          entry.shell = null
          break
        }
      }
    })
    client.connect(opts)
  }

  /** 实际断开逻辑：停心跳、关 Shell、关 Client */
  private async doDisconnect(sessionId: string, entry: SessionEntry): Promise<void> {
    this.stopKeepAlive(entry)
    if (entry.shell) {
      try {
        entry.shell.end()
      } catch {
        // 忽略关闭异常
      }
      entry.shell = null
    }
    entry.shellCallbacks.length = 0
    try {
      entry.client.end()
    } catch {
      // 忽略
    }
    entry.state = 'disconnected'
    this.sessions.delete(sessionId)
  }

  /**
   * 启动 keepAlive 心跳
   *
   * 用定时器执行无副作用命令检测连接是否存活，
   * 连续失败超过阈值则触发自动重连（指数退避，最多 3 次），
   * 重连全部失败后标记 disconnected 并通过 onStateChanged 回调通知 UI。
   *
   * 心跳间隔从 SshConfig.keepAliveIntervalSec 读取（秒），默认 30s。
   */
  private startKeepAlive(entry: SessionEntry): void {
    if (!entry.config.keepAlive) {
      return
    }
    this.stopKeepAlive(entry)
    const intervalMs =
      (entry.config.keepAliveIntervalSec ?? KEEPALIVE_DEFAULT_INTERVAL_SEC) * 1000
    let failures = 0
    entry.keepAliveTimer = setInterval(() => {
      if (entry.state !== 'connected' || entry.reconnecting) {
        this.stopKeepAlive(entry)
        return
      }
      entry.client.exec('echo ping', (err, stream) => {
        if (err || !stream) {
          failures++
          if (failures >= KEEPALIVE_MAX_FAILURES) {
            this.stopKeepAlive(entry)
            // 异步触发重连，不阻塞 setInterval 回调
            void this.handleKeepAliveFailure(entry, failures)
          }
          return
        }
        failures = 0
        stream.on('close', () => {
          // 心跳完成
        })
      })
    }, intervalMs)
  }

  /** 停止心跳 */
  private stopKeepAlive(entry: SessionEntry): void {
    if (entry.keepAliveTimer) {
      clearInterval(entry.keepAliveTimer)
      entry.keepAliveTimer = null
    }
  }

  /**
   * 心跳失败处理：先尝试自动重连，全部失败后标记 disconnected
   *
   * 流程：
   * 1. 标记 reconnecting=true，推送 'reconnecting' 事件
   * 2. 指数退避重连（1s → 2s → 4s，最多 3 次，总时长不超 30s）
   * 3. 重连成功：doConnect 的 onReady 会重启心跳并设 state='connected'
   * 4. 重连失败：标记 disconnected，推送 'disconnected' 事件
   */
  private async handleKeepAliveFailure(
    entry: SessionEntry,
    failureCount: number
  ): Promise<void> {
    if (entry.reconnecting) {
      return // 已在重连中，避免重复触发
    }
    entry.reconnecting = true
    entry.state = 'connecting'
    const reason = `心跳连续失败 ${failureCount} 次`
    this.notifyStateChanged({
      sessionId: entry.sessionId,
      serverId: entry.config.id,
      state: 'reconnecting',
      reason,
      attemptCount: 0,
    })

    const success = await this.attemptReconnect(entry)
    if (success) {
      // doConnect 的 onReady 已设置 state='connected' 并重启心跳
      entry.reconnecting = false
      return
    }

    // 重连全部失败：标记最终断开
    entry.reconnecting = false
    entry.state = 'disconnected'
    entry.shell = null
    this.notifyStateChanged({
      sessionId: entry.sessionId,
      serverId: entry.config.id,
      state: 'disconnected',
      reason: `重连 ${RECONNECT_MAX_ATTEMPTS} 次均失败（${reason}）`,
      attemptCount: RECONNECT_MAX_ATTEMPTS,
    })
  }

  /**
   * 指数退避自动重连
   *
   * 每次尝试创建新的 ssh2 Client（旧的已断开），调用 doConnect。
   * 成功后 doConnect 的 onReady 回调会设置 state='connected' 并 startKeepAlive。
   *
   * @returns true 表示重连成功
   */
  private async attemptReconnect(entry: SessionEntry): Promise<boolean> {
    let totalDelay = 0
    for (let attempt = 1; attempt <= RECONNECT_MAX_ATTEMPTS; attempt++) {
      const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1)
      if (totalDelay + delay > RECONNECT_MAX_TOTAL_MS) {
        break
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
      totalDelay += delay

      // 会话可能在重连期间被用户主动断开
      if (!this.sessions.has(entry.sessionId)) {
        return false
      }
      // 旧 client 已断开，创建新 client 重连
      try {
        entry.client = new Client()
        await this.runWithLock(entry.sessionId, () =>
          this.doConnect(entry, entry.config)
        )
        return true
      } catch {
        // 本次重连失败，继续下一次尝试
      }
    }
    return false
  }

  /** 通知所有注册的状态变更回调（IPC 层据此推送渲染进程） */
  private notifyStateChanged(event: SshStateEvent): void {
    for (const cb of this.stateChangeCallbacks) {
      try {
        cb(event)
      } catch {
        // 单个回调异常不影响其他回调
      }
    }
  }

  /**
   * 把 SshConfig 转换为 ssh2 的 ConnectConfig
   *
   * 认证处理：
   * - password: 直接传 password
   * - privateKey: 优先用 config.privateKey 内容，否则读 privateKeyPath 文件
   * - passphrase 私钥口令
   */
  private buildConnectOptions(config: SshConfig): ConnectConfig {
    const opts: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
      keepaliveInterval: config.keepAlive
        ? (config.keepAliveIntervalSec ?? KEEPALIVE_DEFAULT_INTERVAL_SEC) * 1000
        : undefined,
    }
    if (config.authType === 'password') {
      opts.password = config.password
    } else if (config.authType === 'privateKey') {
      if (config.privateKey) {
        opts.privateKey = config.privateKey
      } else if (config.privateKeyPath) {
        try {
          opts.privateKey = fs.readFileSync(
            path.resolve(config.privateKeyPath),
            'utf8'
          )
        } catch (err) {
          throw new Error(
            `读取私钥文件失败: ${config.privateKeyPath} - ${(err as Error).message}`
          )
        }
      }
      if (config.passphrase) {
        opts.passphrase = config.passphrase
      }
    }
    return opts
  }

  /** 校验 SshConfig 合法性 */
  private validateConfig(config: SshConfig): void {
    if (!config.host) throw new Error('SSH 配置缺少 host')
    if (!config.username) throw new Error('SSH 配置缺少 username')
    if (config.port <= 0 || config.port > 65535) {
      throw new Error(`SSH 端口非法: ${config.port}`)
    }
    if (config.authType === 'password' && !config.password) {
      throw new Error('密码认证需要提供 password')
    }
    if (
      config.authType === 'privateKey' &&
      !config.privateKey &&
      !config.privateKeyPath
    ) {
      throw new Error('私钥认证需要提供 privateKey 或 privateKeyPath')
    }
  }

  /** 获取会话条目（不存在抛错） */
  private requireSession(sessionId: string): SessionEntry {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      throw new Error(`会话不存在: ${sessionId}`)
    }
    return entry
  }

  /** 断言会话已连接 */
  private requireConnected(entry: SessionEntry): void {
    if (entry.state !== 'connected') {
      throw new Error(`会话未连接（当前状态: ${entry.state}）`)
    }
  }

  /**
   * 连接锁：确保对同一会话的连接/断开操作串行
   *
   * 把待执行操作挂在前一个 pendingOp 之后。即使前一个操作失败，
   * 后续操作仍会执行。
   */
  private runWithLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      return Promise.reject(new Error(`会话不存在: ${sessionId}`))
    }
    const prev = entry.pendingOp ?? Promise.resolve()
    const next = prev.then(() => fn(), () => fn())
    entry.pendingOp = next.then(
      () => {
        entry.pendingOp = null
      },
      () => {
        entry.pendingOp = null
      }
    )
    return next
  }
}
