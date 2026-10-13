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
import { StringDecoder } from 'node:string_decoder'
import { assertCommandAllowed } from '../../core/command-gate'
import { ConfigStore } from '../storage/config-store'
import { AuditRepo } from '../db/audit-repo'
import { DatabaseManager } from '../db/database'
import { logger } from '../log/logger'
import type {
  SshConfig,
  CommandResult,
  SshConnectionState,
  SshStateEvent,
  SshHostKeyPromptEvent,
  SshHostKeyResponseAction,
} from '@shared/models'
import { createHostVerifier } from './known-hosts'
import { SessionQueue } from './session-queue'

/**
 * 单个串行操作的预算（毫秒）
 *
 * 连接本身有 30s 超时，断开/重连是本地动作，30s 足够；
 * 有预算的意义是"卡死的一步不能把这个会话永久钉住"。
 */
const LOCK_OP_TIMEOUT_MS = 30_000

/**
 * 单条交互式 Shell 通道
 *
 * 为什么不再是"一条连接一个 shell"：IDE 用法就是同一台主机开好几个终端
 * （一个跑服务、一个看日志）。原先 `SessionEntry.shell` 是单数，第二次开终端
 * 只会拿到同一个通道，界面无法增删。
 *
 * callbacks 用 Set 而不是数组：同一通道被重复订阅时数组会叠加，
 * 一份输出就被推 N 次（2026-10-10 的终端字符翻倍缺陷就是这么来的；
 * Set 让"同一个函数挂两次"在结构上不可能）。
 */
interface ShellEntry {
  /** 通道 ID（IPC 与渲染层拿它当终端身份） */
  id: string
  /** 所属 SSH 会话 */
  sessionId: string
  /** ssh2 的 pty 通道 */
  channel: ClientChannel
  /** 输出订阅者 */
  callbacks: Set<(data: string) => void>
}

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
  /** 交互式 Shell 通道表：shellId → 通道与它的订阅者（一条连接可以开多个） */
  shells: Map<string, ShellEntry>
  /** keepAlive 心跳定时器句柄 */
  keepAliveTimer: NodeJS.Timeout | null
  /** 标记是否正在重连（防止重连期间重复触发心跳失败处理） */
  reconnecting: boolean
  /**
   * 本轮连接是否已经通知过"会话关闭"
   *
   * 远端 close 与本地 disconnect 会先后到（ssh2 的 close 事件在 client.end() 后也会来），
   * 重复通知虽不致命，但会让"清理时打印一行日志"变成噪音；连接成功后复位，
   * 于是重连成功的那一轮又能正常报一次。
   */
  closeNotified: boolean
}

/** 会话关闭的原因（回收资源时如实带出，便于日志定位是谁先动的） */
export type SessionCloseReason = 'disconnect' | 'remote-close' | 'reconnect-failed'

/**
 * 会话关闭订阅者
 *
 * 会话级资源（监控定时器、文件监听、告警去抖、主机名缓存）的所有者在这里回收自己，
 * 而不是等应用退出或指望渲染层记得点"停止"。断连入口有四处以上，
 * 逐个补 stop 迟早漏一个——那正是这轮改之前每断一次就泄漏一个永久定时器的原因。
 */
export type SessionClosedListener = (sessionId: string, reason: SessionCloseReason) => void

/** 默认连接超时（毫秒） */
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000
/** 默认命令执行超时（毫秒） */
/**
 * 单条命令的默认执行超时（毫秒）。
 * 实际取值走设置页 terminal.cmdTimeout（秒），见 resolveExecTimeoutMs；
 * 这个常量是"没配过 / 配了脏值"时的兜底。
 */
const DEFAULT_EXEC_TIMEOUT_MS = 30_000
export const EXEC_TIMEOUT_MIN_SEC = 10
export const EXEC_TIMEOUT_MAX_SEC = 600

/**
 * 设置页「命令执行超时秒」-> 毫秒。
 * 只认 10–600 秒，越界夹住、脏值回默认 30 秒——
 * 不能因为用户在输入框里掏了个空值就把超时变成 NaN（setTimeout(NaN) 会立刻触发）。
 */
export function resolveExecTimeoutMs(raw: unknown): number {
  const sec =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.round(raw)
      : DEFAULT_EXEC_TIMEOUT_MS / 1000
  const clamped = Math.min(EXEC_TIMEOUT_MAX_SEC, Math.max(EXEC_TIMEOUT_MIN_SEC, sec))
  return clamped * 1000
}
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
/**
 * SSH 连接事件写审计（开没开关由 AuditRepo 按 risk.auditSshConn 判）
 *
 * 只记主机 / 用户 / 会话号：口令、私钥路径、错误原文里可能带的敏感信息不进审计表。
 */
function auditSsh(
  action: string,
  config: SshConfig,
  sessionId: string,
  ok: boolean,
  error?: string,
): void {
  new AuditRepo(DatabaseManager.getInstance()).log({
    category: 'ssh_conn',
    action,
    userId: config.username,
    sessionId,
    details: {
      host: config.host,
      port: config.port,
      ok,
      // 失败原因截断，避免把对端回显的一整段 banner 写进库
      ...(error ? { error: error.slice(0, 200) } : {}),
    },
  })
}

export class SshConnectionManager {
  /** 单例实例 */
  private static instance: SshConnectionManager | null = null

  /** 会话表：sessionId → SessionEntry */
  private sessions: Map<string, SessionEntry> = new Map()

  /** 状态变更回调列表（IPC 层注册，用于推送 SshStateEvent 到渲染进程） */
  private stateChangeCallbacks: Array<(event: SshStateEvent) => void> = []

  /**
   * 会话关闭订阅者（会话级资源的所有者在这里回收）
   *
   * 与 stateChangeCallbacks 的区别：状态事件是给界面看的（可丢、可迟到），
   * 关闭事件是给资源用的（漏一次就是一把永久空转的定时器）。
   */
  private sessionClosedListeners: SessionClosedListener[] = []

  /** 会话操作串行队列（取代原先那把会被别人清零的 pendingOp 锁） */
  private readonly queue = new SessionQueue({
    opTimeoutMs: LOCK_OP_TIMEOUT_MS,
    onEvent: (key, message) => logger.warn('SSH', `会话 ${key} 队列：${message}`),
  })

  /**
   * 主机密钥确认回调（Phase L）
   *
   * IPC 层通过 setHostKeyConfirmHandler 注册，当 hostVerifier 检测到
   * 首次连接或密钥变更时调用，推送 SshHostKeyPromptEvent 到渲染进程弹窗，
   * 等待用户选择后返回 SshHostKeyResponseAction。
   */
  private hostKeyConfirmHandler:
    | ((prompt: SshHostKeyPromptEvent) => Promise<SshHostKeyResponseAction>)
    | null = null

  /** 获取单例实例 */
  public static getInstance(): SshConnectionManager {
    if (!SshConnectionManager.instance) {
      SshConnectionManager.instance = new SshConnectionManager()
    }
    return SshConnectionManager.instance
  }

  /** 私有构造，强制单例 */
  private constructor() {}

  /**
   * 注册主机密钥确认回调（Phase L）
   *
   * IPC 层在 registerSshIpcHandlers 时调用，注入一个将 prompt 推送到渲染进程、
   * 等待用户响应后 resolve action 的 Promise 包装器。
   *
   * @param handler 确认回调，接收 SshHostKeyPromptEvent，返回用户选择的动作
   */
  public setHostKeyConfirmHandler(
    handler: (prompt: SshHostKeyPromptEvent) => Promise<SshHostKeyResponseAction>,
  ): void {
    this.hostKeyConfirmHandler = handler
  }

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
      shells: new Map<string, ShellEntry>(),
      keepAliveTimer: null,
      reconnecting: false,
      closeNotified: false,
    }
    // 提前占位，避免后续操作找不到会话
    this.sessions.set(sessionId, entry)
    try {
      await this.runWithLock(sessionId, () => this.doConnect(entry, config))
    } catch (err) {
      // 连不上就把这条占位清掉：留着的话 sessions 里会堆一串 state='error' 的死 entry，
      // 除了 disconnectAll（只在退出时跑）没有任何调用方能回收它们。
      this.stopKeepAlive(entry)
      try {
        entry.client.destroy()
      } catch {
        /* destroy 只是尽力而为，回收以移除 entry 为准 */
      }
      this.sessions.delete(sessionId)
      throw err
    }
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
   * @param onData 可选流式回调（v2.6）：每收到一块 stdout/stderr 立即回调，
   *               用于前端实时展示；回调异常不影响命令执行与累积结果
   * @returns 命令执行结果
   * @throws 会话不存在或未连接时 reject
   */
  public async exec(
    sessionId: string,
    command: string,
    onData?: (chunk: string, source: 'stdout' | 'stderr') => void,
  ): Promise<CommandResult> {
    const entry = this.requireSession(sessionId)
    this.requireConnected(entry)
    // 风险闸落在这里而不是各 IPC 通道：AI 工具 / MCP / 部署 / 调度都走这个出口
    assertCommandAllowed(command)
    entry.lastUsedAt = Date.now()
    const startTime = Date.now()
    // 单条命令超时走设置页 terminal.cmdTimeout（秒），脏值回 30 秒
    const execTimeoutMs = resolveExecTimeoutMs(ConfigStore.get('terminal.cmdTimeout'))
    // 审计是旁路：记不上（开关关了 / 库降级）也不影响命令本身
    const auditExec = (action: string, code: number | null): void => {
      new AuditRepo(DatabaseManager.getInstance()).log({
        category: 'cmd_exec',
        action,
        command,
        exitCode: code,
        sessionId,
      })
    }

    return new Promise<CommandResult>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let exitCode = -1
      let settled = false

      const fail = (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        auditExec('SSH 执行失败', null)
        // 单条命令失败不修改连接状态，保持会话可用
        reject(err)
      }
      const ok = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        auditExec('SSH 执行完成', exitCode)
        resolve({ exitCode, stdout, stderr, duration: Date.now() - startTime })
      }
      const timer = setTimeout(
        () => fail(new Error(`命令执行超时（${execTimeoutMs}ms）: ${command}`)),
        execTimeoutMs
      )

      try {
        entry.client.exec(command, (err, stream) => {
          if (err) {
            fail(err)
            return
          }
          // 同 shell 通道：stdout / stderr 各自一个解码器，跨包的中文不被切成乱码
          const outDecoder = new StringDecoder('utf8')
          const errDecoder = new StringDecoder('utf8')
          stream.on('data', (chunk: Buffer) => {
            const text = outDecoder.write(chunk)
            stdout += text
            if (onData) {
              try {
                onData(text, 'stdout')
              } catch {
                // 流式回调异常不影响命令执行
              }
            }
          })
          stream.stderr.on('data', (chunk: Buffer) => {
            const text = errDecoder.write(chunk)
            stderr += text
            if (onData) {
              try {
                onData(text, 'stderr')
              } catch {
                // 流式回调异常不影响命令执行
              }
            }
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
   * 打开一条新的交互式 Shell
   *
   * 走 ssh2 的 pty 通道，因此支持 vim/top/htop 等全屏程序；一条连接可以开多条
   * （IDE 用法：一个终端跑服务、另一个看日志）。
   *
   * @param sessionId 会话 ID
   * @param size 初始尺寸（省略时 80x24，与 xterm 默认一致）
   * @returns 新建通道的 shellId（渲染层拿它当终端身份，而不是 sessionId）
   */
  public async startShell(
    sessionId: string,
    size?: { cols: number; rows: number }
  ): Promise<string> {
    const entry = this.requireSession(sessionId)
    this.requireConnected(entry)
    entry.lastUsedAt = Date.now()
    const cols = size?.cols ?? 80
    const rows = size?.rows ?? 24
    const shellId = randomUUID()

    return new Promise<string>((resolve, reject) => {
      entry.client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          entry.state = 'error'
          reject(err)
          return
        }
        const shell: ShellEntry = { id: shellId, sessionId, channel: stream, callbacks: new Set() }
        entry.shells.set(shellId, shell)
        // 每条通道一个解码器：chunk.toString('utf8') 逐包转换，跨包被切断的多字节字符
        // （中文输出最常见的切法）会变成一个 U+FFFD —— journalctl、中文文件名首当其冲。
        const decoder = new StringDecoder('utf8')
        // 输出只广播给**这条通道**的订阅者：多终端互不串字靠的就是这一层隔离
        stream.on('data', (chunk: Buffer) => {
          const data = decoder.write(chunk)
          if (!data) return
          for (const cb of [...shell.callbacks]) {
            try {
              cb(data)
            } catch {
              // 单个回调异常不影响其他回调
            }
          }
        })
        // 通道自己结束（exit / 远端杀掉）也要从表里摘掉，否则关掉的标签还能被写入
        stream.on('close', () => {
          entry.shells.delete(shellId)
        })
        stream.on('error', () => {
          entry.shells.delete(shellId)
        })
        resolve(shellId)
      })
    })
  }

  /**
   * 按 shellId 找通道
   *
   * 这里扫会话而不是再建一张全局 shellId 表：两个索引迟早分叉，
   * 而会话数与每条会话的终端数都是个位数。
   */
  private findShell(shellId: string): { session: SessionEntry; shell: ShellEntry } | null {
    for (const session of this.sessions.values()) {
      const shell = session.shells.get(shellId)
      if (shell) return { session, shell }
    }
    return null
  }

  /** 拿不到通道就报错，错误里带上 shellId 方便界面上说清是哪个终端没了 */
  private requireShell(shellId: string): { session: SessionEntry; shell: ShellEntry } {
    const found = this.findShell(shellId)
    if (!found) {
      throw new Error(`终端已关闭（shellId: ${shellId}）`)
    }
    return found
  }

  /**
   * 某条 shellId 现在是否还开着
   *
   * 存在的理由：IPC 层自己有一份 shellId → 退订函数 的登记，通道被远端杀掉时
   * 只有这边会删表，那边不知道。给一个查询口让它能自己扫干净，
   * 免得留一堆指向已销毁终端的闭包。
   */
  public isShellOpen(shellId: string): boolean {
    return this.findShell(shellId) !== null
  }

  /**
   * 列出某条会话当前打开的 shellId（渲染层重连后要恢复标签列表用）
   * @param sessionId 会话 ID
   */
  public listShells(sessionId: string): string[] {
    const entry = this.sessions.get(sessionId)
    if (!entry) return []
    return [...entry.shells.keys()]
  }

  /**
   * 关闭一条 Shell 通道（关标签，不断整条 SSH 连接）
   * @param shellId 通道 ID
   * @returns 是否真的关掉了一条（已经不在表里返回 false，调用方按幂等处理）
   */
  public closeShell(shellId: string): boolean {
    const found = this.findShell(shellId)
    if (!found) return false
    found.session.shells.delete(shellId)
    try {
      found.shell.channel.end()
    } catch {
      // 忽略关闭异常
    }
    found.shell.callbacks.clear()
    found.session.lastUsedAt = Date.now()
    return true
  }

  /**
   * 向指定 Shell 写入数据（模拟键盘输入）
   * @param shellId 通道 ID
   * @param data 要写入的数据（按键或命令字符串）
   */
  public async writeShell(shellId: string, data: string): Promise<boolean> {
    const { session, shell } = this.requireShell(shellId)
    session.lastUsedAt = Date.now()
    return new Promise<boolean>((resolve) => {
      shell.channel.write(data, 'utf8', (err) => resolve(!err))
    })
  }

  /**
   * 调整 Shell 终端窗口大小（响应前端 xterm.js resize 事件）
   * @param shellId 通道 ID
   * @param cols 列数
   * @param rows 行数
   */
  public async resizeShell(
    shellId: string,
    cols: number,
    rows: number
  ): Promise<boolean> {
    const found = this.findShell(shellId)
    if (!found) {
      return false
    }
    try {
      found.shell.channel.setWindow(rows, cols, rows * 16, cols * 8)
      return true
    } catch {
      return false
    }
  }

  /**
   * 注册某条 Shell 的输出回调
   *
   * 用于 IPC 层把数据转发到对应渲染进程。
   *
   * @returns 取消注册函数。调用方**必须**持有它：回调存的是 Set，同一个函数引用挂两次
   *          不会翻倍，但**不退订就会一直往已销毁的窗口 send**，
   *          与 onStateChanged / onSessionClosed 保持同一个形状正是为了逼出退订。
   */
  public onShellData(shellId: string, callback: (data: string) => void): () => void {
    const found = this.findShell(shellId)
    if (!found) {
      throw new Error(`终端不存在或已关闭: ${shellId}`)
    }
    const { shell } = found
    shell.callbacks.add(callback)
    return () => {
      shell.callbacks.delete(callback)
    }
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
   * 订阅"某会话已关闭"
   *
   * 用法：持有会话级资源的模块（监控、文件监听、告警缓存）在自己的实例化处订阅一次，
   * 回调里按 sessionId 清干净。返回的取消函数供实例销毁时使用。
   */
  public onSessionClosed(listener: SessionClosedListener): () => void {
    this.sessionClosedListeners.push(listener)
    return () => {
      const idx = this.sessionClosedListeners.indexOf(listener)
      if (idx >= 0) {
        this.sessionClosedListeners.splice(idx, 1)
      }
    }
  }

  /**
   * 通知所有订阅者：这个会话没了
   *
   * 每个监听器单独 try/catch：一个清理逻辑抛错不能把后面的邻居一起带走，
   * 更不能让"关闭会话"这件事本身失败（旧实现里这类异常会直接冒到 IPC 层）。
   */
  private notifySessionClosed(sessionId: string, reason: SessionCloseReason): void {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      if (entry.closeNotified) return
      entry.closeNotified = true
    }
    for (const listener of [...this.sessionClosedListeners]) {
      try {
        listener(sessionId, reason)
      } catch (err) {
        logger.error('SSH', '会话关闭监听器抛错', {
          sessionId,
          reason,
          error: err instanceof Error ? err.message : String(err),
        })
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
   *
   * @internal 只允许用于 SFTP 子系统与流式订阅；**不要用返回的 Client 直接 exec 命令**，
   * 那样会绕过 exec() 里的 command-gate 出口闸。需要执行命令请调本类的 exec()/execStream()。
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
      // 这一轮用的 client 要就地定住：重连会换 entry.client，迟到的回调必须能
      // 认出"我不是当前这一条"（见 onReady 的 stale 判定）
      const client = entry.client
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        // 只 reject 不收尾的话：监听器还挂着，慢链路那一头的 ready 之后照样会跑，
        // 于是同一条主机留下两条活 SSH 会话，而第一条的 sessionId 从没交给渲染层，
        // 界面上没有任何东西能断开它。
        client.removeAllListeners('ready')
        client.removeAllListeners('error')
        try {
          client.destroy()
        } catch {
          /* 超时收尾尽力而为，主要目标是别留第二条连接 */
        }
        entry.state = 'error'
        reject(new Error(`SSH 连接超时（${DEFAULT_CONNECT_TIMEOUT_MS}ms）: ${config.host}`))
      }, DEFAULT_CONNECT_TIMEOUT_MS)
      /** 这条回调是不是还属于当前这一条会话（会话已断开或被新一轮重连换掉 client 时不算） */
      const isCurrent = (): boolean =>
        this.sessions.get(entry.sessionId) === entry && entry.client === client
      const onReady = () => {
        clearTimeout(timer)
        if (settled || !isCurrent()) {
          // 迟到的 ready：期间用户已断开或重连已换人，接管它会把 state 改回
          // connected 并给一条不在会话表里的连接新起心跳定时器（永无人回收）。
          if (!isCurrent()) {
            try {
              client.destroy()
            } catch {
              /* 已经没人管这条连接了，destroy 尽力而为 */
            }
          }
          return
        }
        settled = true
        entry.state = 'connected'
        entry.lastUsedAt = Date.now()
        // 新一轮连接：允许它再报一次"会话关闭"（上一轮已经报过了）
        entry.closeNotified = false
        this.startKeepAlive(entry)
        auditSsh('SSH 连接建立', config, entry.sessionId, true)
        resolve()
      }
      const onError = (err: Error) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        entry.state = 'error'
        auditSsh('SSH 连接失败', config, entry.sessionId, false, err.message)
        reject(err)
      }
      const targetOpts = this.buildConnectOptions(config, entry.sessionId)

      // 跳板机模式
      if (config.jumpHost) {
        const jumpClient = new Client()
        // 跳板机同样过主机密钥校验：不校验则 MITM 可落在承载最终主机流量的那一跳上。
        // 复用目标会话的 sessionId 让确认弹窗仍能路由到本会话 UI。
        const jumpOpts = this.buildConnectOptions(
          {
            ...config.jumpHost,
            id: `jump:${config.jumpHost.host}:${config.jumpHost.port ?? 22}`,
            name: '跳板机',
          } as SshConfig,
          entry.sessionId,
        )
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
          // 跳板机这条腿也要收：转发失败/目标认证失败时只 end 了目标那一侧的话，
          // 每试一次就留一条打开着的跳板机会话在远端计数里。
          try {
            jumpClient.end()
          } catch {
            /* 收尾尽力而为，主进程不因这条腿的关闭异常受影响 */
          }
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
    /** 这个 client 现在归哪条会话（重连会换 client，所以每次事件都要现查） */
    const owner = (): SessionEntry | undefined => {
      for (const e of this.sessions.values()) {
        if (e.client === client) return e
      }
      return undefined
    }
    client.once('ready', onReady)
    client.once('error', onError)
    // 握手之后的链路故障也走 error 事件。这里原来只有 once('error')：握手期那次
    // 已经把它消耗掉了，链路中途的 socket error 就没有监听者 —— Node 会把它抛成
    // 主进程未捕获异常。所以再挂一个常驻监听：还在连接阶段就交给 onError，
    // 已经连上了就按"这一条会话没了"处理。
    client.on('error', (err: Error) => {
      const entry = owner()
      if (!entry || entry.state !== 'connected') return
      entry.state = 'error'
      // 事件里的 state 只有 reconnecting/disconnected 两档（渲染层按这两档画状态），
      // 链路中途出错对用户就是"这条会话没了"，所以报 disconnected + 原因写清楚。
      this.notifyStateChanged({
        sessionId: entry.sessionId,
        serverId: entry.config.id,
        state: 'disconnected',
        reason: `连接异常：${err.message}`,
        attemptCount: 0,
      })
      this.notifySessionClosed(entry.sessionId, 'remote-close')
    })
    // close 事件在连接断开时触发，更新状态
    client.on('close', () => {
      const entry = owner()
      if (entry) {
        entry.state = 'disconnected'
        // 通道随连接一起没了：整张表清空，别让渲染层还能往死通道里写
        entry.shells.clear()
        // 远端断链也要把状态推出去：渲染层的连接状态只认 ssh:state-changed，
        // 不推的话服务器重启/拔网线之后界面还显示"已连接"，用户继续往死通道里敲。
        this.notifyStateChanged({
          sessionId: entry.sessionId,
          serverId: entry.config.id,
          state: 'disconnected',
          reason: '远端关闭了连接',
          attemptCount: 0,
        })
        // 远端断链（网络掉、服务器重启、被踢）也是一次"会话没了"：
        // 监控与文件监听必须在这里收手，否则它们的定时器会朝着死连接一直 exec，
        // 抛出的错被空 catch 吞掉，界面上还留着最后一帧指标当"实时数据"。
        this.notifySessionClosed(entry.sessionId, 'remote-close')
      }
    })
    client.connect(opts)
  }

  /** 实际断开逻辑：停心跳、关全部 Shell 通道、关 Client */
  private async doDisconnect(sessionId: string, entry: SessionEntry): Promise<void> {
    this.stopKeepAlive(entry)
    for (const shell of entry.shells.values()) {
      try {
        shell.channel.end()
      } catch {
        // 忽略关闭异常
      }
      shell.callbacks.clear()
    }
    entry.shells.clear()
    try {
      entry.client.end()
    } catch {
      // 忽略
    }
    entry.state = 'disconnected'
    this.sessions.delete(sessionId)
    // 会话表里没了这条，队列也一并丢掉：还排在后面的操作会立刻拿到"会话不存在"
    this.queue.forget(sessionId)
    this.notifySessionClosed(sessionId, 'disconnect')
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
    entry.shells.clear()
    this.notifyStateChanged({
      sessionId: entry.sessionId,
      serverId: entry.config.id,
      state: 'disconnected',
      reason: `重连 ${RECONNECT_MAX_ATTEMPTS} 次均失败（${reason}）`,
      attemptCount: RECONNECT_MAX_ATTEMPTS,
    })
    // 这是最后一条"这个会话还能用"的指望：通知资源所有者收手。
    // 不通知的话，监控/文件监听的定时器会朝着一个死连接一直 exec，
    // 抛出的错被空 catch 吞掉，界面上还留着最后一帧"实时"指标。
    this.notifySessionClosed(entry.sessionId, 'reconnect-failed')
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
   *
   * Phase L：主机密钥校验
   * - 当 config.strictHostKeyCheck === true 且已注册 hostKeyConfirmHandler 时，
   *   注入 hostVerifier 回调，首次连接弹窗确认，密钥变更弹窗警告
   * - sessionId 为目标主机与跳板机**共用**的会话 ID（两跳都注入 hostVerifier；弹窗按 serverId 区分）
   */
  private buildConnectOptions(config: SshConfig, sessionId?: string): ConnectConfig {
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

    // Phase L：主机密钥校验。目标主机与跳板机**都**走这里（调用方各传一次 sessionId），
    // 少校验任一跳，MITM 就能落在没被验的那一跳上。回归锁见 tests/unit/ssh-jump-host-key.test.ts。
    // 默认开启：未显式写 false 即校验，避免旧配置静默跳过指纹确认
    if (config.strictHostKeyCheck !== false && sessionId && this.hostKeyConfirmHandler) {
      opts.hostVerifier = createHostVerifier({
        host: config.host,
        port: config.port,
        sessionId,
        serverId: config.id,
        knownHostsPath: config.knownHostsPath,
        confirm: this.hostKeyConfirmHandler,
        onError: (err: Error) => {
          console.error(`[SSH] hostVerifier 错误 [${config.host}:${config.port}]:`, err.message)
        },
      })
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
   * 实现搬给 SessionQueue。旧写法在这里干这件事：
   *   entry.pendingOp = next.then(() => { entry.pendingOp = null })
   * 而前一个操作的 wrapper 收尾时清掉的是**别人**刚登记的队尾，
   * 于是第三个操作立刻并发跑（实测最大并发 2，串行化名存实亡）。
   * 现在队尾只由自己那一步负责，并且每步带预算，卡死的操作不会把这个会话钉住。
   */
  private runWithLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    if (!this.sessions.has(sessionId)) {
      return Promise.reject(new Error(`会话不存在: ${sessionId}`))
    }
    return this.queue.run(sessionId, fn, LOCK_OP_TIMEOUT_MS)
  }
}
