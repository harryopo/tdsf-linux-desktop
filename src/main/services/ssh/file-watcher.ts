/**
 * 远程文件监听适配器（v2.0 Phase C Task C.3）
 *
 * 通过 SSH 长连接监听远程文件变更，推送到渲染层 `file:changed` 事件。
 *
 * 监听策略：
 * 1) 优先使用 inotifywait（inotify-tools）：
 *    `inotifywait -m -r --format '%w%f %e' -- <path>`
 *    实时推送 modify/create/delete/move 事件，零延迟。
 * 2) 降级轮询（inotifywait 不存在时）：
 *    **每个会话一把 5 秒定时器、一次 exec 查完该会话名下全部路径**：
 *    `find '<p1>' '<p2>' … -type f -newermt '@<ts>'`
 *    延迟 5s，CPU/网络开销低。路径必须是绝对路径，见 FileWatcherAdapter.start 的形状闸。
 *    合批不是优化而是止血：一把 SSH 连接上同时只能开 10 条通道（真靶机实测第 11、12 条
 *    直接 "(SSH) Channel open failure"），而"每个打开的标签各起一把轮询定时器"会把
 *    这个预算和监控采样、SFTP、AI 的 ssh_exec 一起抢光——同一族事故在监控那边已经
 *    炸过一次（v2.4 把 7 条采集合成 1 条 exec），监听这边当时没跟上。
 *
 * IPC 通道（4 步同步，IPC handler 在 src/main/ipc/file-watcher.ts）：
 *   - file:watch:start  invoke  返回 { watchId }
 *   - file:watch:stop   invoke  参数 { watchId }
 *   - file:changed      push     载荷 { watchId, path, event }
 */

import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { FILE_WATCH } from '@shared/ipc-channels'
import { SshConnectionManager } from './connection-manager'
import type { Client, ClientChannel } from 'ssh2'
import { assertCommandAllowed } from '../../core/command-gate'
import { assertRemotePathAbsolute } from './remote-write-guard'

/** 文件变更事件类型 */
export type FileChangeEvent = 'modify' | 'create' | 'delete' | 'move'

/** file:changed 推送载荷 */
export interface FileChangedPayload {
  watchId: string
  path: string
  event: FileChangeEvent
}

/**
 * 单个 watch 的内部状态
 *
 * 轮询的时间基准与定时器**不在这里**：它们按会话共享（见 PollBatch），
 * 一次 exec 查完该会话名下全部路径。每把 watch 各挂一个 setInterval 的旧写法
 * 会在 10 条通道的硬顶里逐个抢位（真靶机实测第 11 条起 "(SSH) Channel open failure"）。
 */
interface WatchEntry {
  watchId: string
  sessionId: string
  path: string
  stream: ClientChannel | null
  mode: 'inotify' | 'poll'
}

/** 一个会话的轮询批次：一把共享定时器 + 上一轮的时间基准（秒） */
interface PollBatch {
  timer: NodeJS.Timeout
  refSec: number
}

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 5_000
/** 每把 watch 每轮最多回多少行变更 */
const POLL_LINES_PER_WATCH = 50
/** 整批的上限（合批后 head 是全局的，不再是每条 50） */
const POLL_LINES_MAX = 1_000

/** inotifywait 事件 → FileChangeEvent 映射 */
const INOTIFY_EVENT_MAP: Record<string, FileChangeEvent> = {
  modify: 'modify',
  attrib: 'modify',
  close_write: 'modify',
  moved_to: 'move',
  moved_from: 'move',
  move: 'move',
  create: 'create',
  delete: 'delete',
  delete_self: 'delete',
}

/** 把远端路径包成 shell 单引号字面量（内部单引号走 '\''） */
function shellQuote(input: string): string {
  return `'${String(input).replace(/'/g, `'\\''`)}'`
}

/**
 * 构造 inotifywait 长连接命令（导出给判据用，#242）
 *
 * `--` 不能省：watch 路径来自渲染层，写成 `-r / -e modify` 之类的字符串时，
 * 光靠单引号只挡住了 shell 展开，getopt 仍会把它当自己的选项——
 * 监听的目标就悄悄变了。加了 `--` 它只是一个"名字带减号的路径"。
 */
export function buildInotifyWaitCommand(remotePath: string): string {
  return `inotifywait -m -r --format '%w%f %e' -- ${shellQuote(remotePath)} 2>/dev/null`
}

/**
 * 构造轮询降级用的 find 命令（导出给判据用，#243 改成一次查完整批）
 *
 * 这里**不写** `--`：真靶机实测（2026-10-26，findutils 4.9.0）find 不认选项终止符，
 * `find -- '-delete' -type f` 与不带的写法结果一样——起点退化成当前目录，`-delete`
 * 变成对整个目录生效的动作。唯一的闸是"路径必须绝对"（在 FileWatcherAdapter.start 里装），
 * 绝对路径不可能以 `-` 开头。
 *
 * 多个起点一次给也实测过：`find '/a' '/b' -type f` 两边的文件都回；
 * 其中一个已经被删掉时，另一个照样回（这一批不会因为一条路径失效而全废）。
 */
export function buildPollFindCommand(remotePaths: string[], sinceEpochSec: number): string {
  const starts = remotePaths.map((p) => shellQuote(p)).join(' ')
  const maxLines = Math.min(POLL_LINES_MAX, POLL_LINES_PER_WATCH * Math.max(1, remotePaths.length))
  return `find ${starts} -type f -newermt '@${sinceEpochSec}' 2>/dev/null | head -${maxLines}`
}

/**
 * find 回的那一行属不属于这把 watch（导出给判据用）
 *
 * 监听的是文件就等值比，是目录就按 `/` 边界比前缀——
 * 用裸 startsWith 会把 `/var/log2/x` 算进 `/var/log` 的账里。
 */
export function lineBelongsToWatch(changedPath: string, watchedPath: string): boolean {
  if (changedPath === watchedPath) return true
  const prefix = watchedPath.endsWith('/') ? watchedPath : `${watchedPath}/`
  return changedPath.startsWith(prefix)
}

/**
 * 远程文件监听适配器（单例）
 *
 * 通过 SshConnectionManager.getClient(sessionId) 拿到底层 Client，
 * 直接调用 client.exec 启动长连接命令（inotifywait -m）。
 */
export class FileWatcherAdapter {
  private static instance: FileWatcherAdapter | null = null
  private watches: Map<string, WatchEntry> = new Map()
  /** 会话 → 共享轮询批次（一把定时器 + 一个时间基准） */
  private pollBatches: Map<string, PollBatch> = new Map()
  /** 会话 → 这台机器有没有 inotifywait（探测一次就够，装不装不会自己变） */
  private inotifyProbed: Map<string, boolean> = new Map()
  private sshManager: SshConnectionManager
  /** 取消会话关闭订阅（实例被丢弃时摘掉，别在单例上叠监听器） */
  private offSessionClosed: () => void

  private constructor() {
    this.sshManager = SshConnectionManager.getInstance()
    // 监听权属于会话：会话一断，这一路的轮询定时器/长连接就该收，
    // 而不是等应用退出。stopAll() 只在退出时跑，断一次就漏一把 5 秒定时器。
    this.offSessionClosed = this.sshManager.onSessionClosed((sessionId) => {
      void this.stopForSession(sessionId)
    })
  }

  public static getInstance(): FileWatcherAdapter {
    if (!FileWatcherAdapter.instance) {
      FileWatcherAdapter.instance = new FileWatcherAdapter()
    }
    return FileWatcherAdapter.instance
  }

  /** 当前活跃的监听（判据要看真实状态） */
  public activeWatches(): Array<{ watchId: string; sessionId: string; path: string }> {
    return Array.from(this.watches.values()).map((e) => ({
      watchId: e.watchId,
      sessionId: e.sessionId,
      path: e.path,
    }))
  }

  /**
   * 停掉某个会话名下的全部监听
   *
   * @returns 实际停掉的数量
   */
  public stopForSession(sessionId: string): number {
    const owned = Array.from(this.watches.values())
      .filter((e) => e.sessionId === sessionId)
      .map((e) => e.watchId)
    for (const watchId of owned) this.stop(watchId)
    // 会话关了，"这台机器有没有 inotifywait" 这个答案也要跟着作废：
    // 下次连上的是另一台（或重装过的同一台），缓存留着就会把轮询误判成长连接
    this.inotifyProbed.delete(sessionId)
    this.clearPollBatch(sessionId)
    return owned.length
  }

  /** 摘掉订阅并清空监听（实例真正不再使用时调用） */
  public dispose(): void {
    this.offSessionClosed()
    this.stopAll()
  }

  /** 开始监听远程路径，返回 watchId */
  public async start(sessionId: string, path: string): Promise<string> {
    // 形状闸装在唯一的入口上：inotifywait 与轮询 find 都吃这个 path，而 find 没有
    // 选项终止符语义（实测 `find -- '-delete' -type f` 照样把当前目录删干净），
    // 所以只接受绝对路径——渲染层传来的路径没有别的约束点可依赖（#242）
    assertRemotePathAbsolute('远程文件监听的路径', path)
    const watchId = randomUUID()
    const hasInotify = await this.checkInotify(sessionId)
    const entry: WatchEntry = {
      watchId,
      sessionId,
      path,
      stream: null,
      mode: hasInotify ? 'inotify' : 'poll',
    }
    this.watches.set(watchId, entry)
    if (hasInotify) {
      await this.startInotify(entry)
    } else {
      this.ensurePollBatch(sessionId)
    }
    return watchId
  }

  /** 停止指定 watch */
  public stop(watchId: string): boolean {
    const entry = this.watches.get(watchId)
    if (!entry) return false
    if (entry.stream) {
      try {
        entry.stream.end()
      } catch {
        // 忽略关闭异常
      }
      entry.stream = null
    }
    this.watches.delete(watchId)
    // 批次是会话共享的：只有这个会话名下再没有轮询中的 watch 才收定时器，
    // 否则关掉一个标签会把别的标签的监听一起停掉（那才是真·静默失效）
    if (entry.mode === 'poll') this.prunePollBatch(entry.sessionId)
    return true
  }

  /** 停止所有 watch（应用退出时调用） */
  public stopAll(): void {
    for (const watchId of Array.from(this.watches.keys())) {
      this.stop(watchId)
    }
    for (const sessionId of Array.from(this.pollBatches.keys())) this.clearPollBatch(sessionId)
    this.inotifyProbed.clear()
  }

  /** 检测远程主机是否安装 inotifywait（每个会话只探一次） */
  private async checkInotify(sessionId: string): Promise<boolean> {
    const cached = this.inotifyProbed.get(sessionId)
    if (cached !== undefined) return cached
    let installed = false
    try {
      const result = await this.sshManager.exec(sessionId, 'which inotifywait')
      installed = result.exitCode === 0 && result.stdout.trim().length > 0
    } catch {
      installed = false
    }
    this.inotifyProbed.set(sessionId, installed)
    return installed
  }

  /** inotifywait 模式：长连接 exec */
  private async startInotify(entry: WatchEntry): Promise<void> {
    const client: Client = this.sshManager.getClient(entry.sessionId)
    const cmd = buildInotifyWaitCommand(entry.path)
    // 这里绕过了 connection-manager.exec() 的出口闸（需要长连接流），故就地判一次
    assertCommandAllowed(cmd, '文件监听')
    try {
      client.exec(cmd, (err, stream) => {
        if (err) {
          entry.mode = 'poll'
          this.ensurePollBatch(entry.sessionId)
          return
        }
        entry.stream = stream
        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          for (const line of text.split('\n')) {
            this.handleInotifyLine(entry, line)
          }
        })
        stream.on('close', () => {
          entry.stream = null
        })
        stream.on('error', () => {
          entry.stream = null
        })
      })
    } catch {
      entry.mode = 'poll'
      this.ensurePollBatch(entry.sessionId)
    }
  }

  /** 解析 inotifywait 单行输出并推送 file:changed 事件 */
  private handleInotifyLine(entry: WatchEntry, line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    const lastSpace = trimmed.lastIndexOf(' ')
    if (lastSpace === -1) return
    const filePath = trimmed.slice(0, lastSpace)
    const events = trimmed.slice(lastSpace + 1).split(',')
    let event: FileChangeEvent | null = null
    for (const ev of events) {
      const mapped = INOTIFY_EVENT_MAP[ev.trim().toLowerCase()]
      if (mapped) {
        event = mapped
        break
      }
    }
    if (!event) event = 'modify'
    this.emitChanged({ watchId: entry.watchId, path: filePath, event })
  }

  /**
   * 保证该会话有一把共享轮询定时器（每个会话一把，不是每个 watch 一把）
   *
   * 时间基准取"这一刻"：新加入的 watch 不会把打开前就存在的内容当成刚被改过。
   */
  private ensurePollBatch(sessionId: string): void {
    if (this.pollBatches.has(sessionId)) return
    this.pollBatches.set(sessionId, {
      timer: setInterval(() => {
        void this.runPollBatch(sessionId)
      }, POLL_INTERVAL_MS),
      refSec: Math.floor(Date.now() / 1000),
    })
  }

  /** 一轮轮询：一条 exec 查完这个会话名下全部轮询路径 */
  private async runPollBatch(sessionId: string): Promise<void> {
    const batch = this.pollBatches.get(sessionId)
    if (!batch) return
    const entries = Array.from(this.watches.values()).filter(
      (e) => e.sessionId === sessionId && e.mode === 'poll',
    )
    if (entries.length === 0) {
      this.clearPollBatch(sessionId)
      return
    }
    // 基准用"出发时刻"而不是"回来时刻"：exec 慢的时候这段窗口不能漏
    const departedSec = Math.floor(Date.now() / 1000)
    const cmd = buildPollFindCommand(
      entries.map((e) => e.path),
      batch.refSec,
    )
    let stdout: string
    try {
      const result = await this.sshManager.exec(sessionId, cmd)
      stdout = result.stdout
    } catch {
      // 失败不当"没有变更"处理：基准原地不动，下一轮把这一窗口的变更一起补上。
      // 旧写法在这里把基准推到当前时间，等于每次失败都悄悄吞掉那一段改动。
      return
    }
    batch.refSec = departedSec
    const seen = new Set<string>()
    for (const rawLine of stdout.split('\n')) {
      const changed = rawLine.trim()
      if (!changed) continue
      for (const entry of entries) {
        if (!lineBelongsToWatch(changed, entry.path)) continue
        const key = `${entry.watchId}|${changed}`
        if (seen.has(key)) continue
        seen.add(key)
        this.emitChanged({ watchId: entry.watchId, path: changed, event: 'modify' })
      }
    }
  }

  /** 这个会话没有轮询中的 watch 了就把定时器收掉 */
  private prunePollBatch(sessionId: string): void {
    const stillPolling = Array.from(this.watches.values()).some(
      (e) => e.sessionId === sessionId && e.mode === 'poll',
    )
    if (!stillPolling) this.clearPollBatch(sessionId)
  }

  private clearPollBatch(sessionId: string): void {
    const batch = this.pollBatches.get(sessionId)
    if (!batch) return
    clearInterval(batch.timer)
    this.pollBatches.delete(sessionId)
  }

  /** 推送 file:changed 事件到所有渲染进程 */
  private emitChanged(payload: FileChangedPayload): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(FILE_WATCH.CHANGED, payload)
      }
    }
  }
}
