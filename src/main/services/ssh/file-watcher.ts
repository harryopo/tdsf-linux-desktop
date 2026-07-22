/**
 * 远程文件监听适配器（v2.0 Phase C Task C.3）
 *
 * 通过 SSH 长连接监听远程文件变更，推送到渲染层 `file:changed` 事件。
 *
 * 监听策略：
 * 1) 优先使用 inotifywait（inotify-tools）：
 *    `inotifywait -m -r --format '%w%f %e' <path>`
 *    实时推送 modify/create/delete/move 事件，零延迟。
 * 2) 降级轮询（inotifywait 不存在时）：
 *    每 5 秒执行 `find <path> -newermt '@<ts>'` 检测变更文件。
 *    延迟 5s，CPU/网络开销低。
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

/** 文件变更事件类型 */
export type FileChangeEvent = 'modify' | 'create' | 'delete' | 'move'

/** file:changed 推送载荷 */
export interface FileChangedPayload {
  watchId: string
  path: string
  event: FileChangeEvent
}

/** 单个 watch 的内部状态 */
interface WatchEntry {
  watchId: string
  sessionId: string
  path: string
  stream: ClientChannel | null
  pollTimer: NodeJS.Timeout | null
  lastPollRef: number
  mode: 'inotify' | 'poll'
}

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 5_000

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

/**
 * 远程文件监听适配器（单例）
 *
 * 通过 SshConnectionManager.getClient(sessionId) 拿到底层 Client，
 * 直接调用 client.exec 启动长连接命令（inotifywait -m）。
 */
export class FileWatcherAdapter {
  private static instance: FileWatcherAdapter | null = null
  private watches: Map<string, WatchEntry> = new Map()
  private sshManager: SshConnectionManager

  private constructor() {
    this.sshManager = SshConnectionManager.getInstance()
  }

  public static getInstance(): FileWatcherAdapter {
    if (!FileWatcherAdapter.instance) {
      FileWatcherAdapter.instance = new FileWatcherAdapter()
    }
    return FileWatcherAdapter.instance
  }

  /** 开始监听远程路径，返回 watchId */
  public async start(sessionId: string, path: string): Promise<string> {
    const watchId = randomUUID()
    const hasInotify = await this.checkInotify(sessionId)
    const entry: WatchEntry = {
      watchId,
      sessionId,
      path,
      stream: null,
      pollTimer: null,
      lastPollRef: Date.now(),
      mode: hasInotify ? 'inotify' : 'poll',
    }
    this.watches.set(watchId, entry)
    if (hasInotify) {
      await this.startInotify(entry)
    } else {
      this.startPolling(entry)
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
    if (entry.pollTimer) {
      clearInterval(entry.pollTimer)
      entry.pollTimer = null
    }
    this.watches.delete(watchId)
    return true
  }

  /** 停止所有 watch（应用退出时调用） */
  public stopAll(): void {
    for (const watchId of Array.from(this.watches.keys())) {
      this.stop(watchId)
    }
  }

  /** 检测远程主机是否安装 inotifywait */
  private async checkInotify(sessionId: string): Promise<boolean> {
    try {
      const result = await this.sshManager.exec(sessionId, 'which inotifywait')
      return result.exitCode === 0 && result.stdout.trim().length > 0
    } catch {
      return false
    }
  }

  /** inotifywait 模式：长连接 exec */
  private async startInotify(entry: WatchEntry): Promise<void> {
    const client: Client = this.sshManager.getClient(entry.sessionId)
    const safePath = `'${entry.path.replace(/'/g, `'\\''`)}'`
    const cmd = `inotifywait -m -r --format '%w%f %e' ${safePath} 2>/dev/null`
    try {
      client.exec(cmd, (err, stream) => {
        if (err) {
          entry.mode = 'poll'
          this.startPolling(entry)
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
      this.startPolling(entry)
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

  /** 轮询模式：每 5 秒 find -newermt 检测变更文件 */
  private startPolling(entry: WatchEntry): void {
    entry.pollTimer = setInterval(async () => {
      try {
        const safePath = `'${entry.path.replace(/'/g, `'\\''`)}'`
        const cmd = `find ${safePath} -type f -newermt '@${Math.floor(entry.lastPollRef / 1000)}' 2>/dev/null | head -50`
        const result = await this.sshManager.exec(entry.sessionId, cmd)
        entry.lastPollRef = Date.now()
        for (const line of result.stdout.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          this.emitChanged({
            watchId: entry.watchId,
            path: trimmed,
            event: 'modify',
          })
        }
      } catch {
        // 单次轮询失败忽略，下次继续
      }
    }, POLL_INTERVAL_MS)
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
