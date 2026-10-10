/**
 * 本机终端（local PTY）—— 不连 SSH 也能在同一个终端面板里敲本机命令
 *
 * 为什么要有：Linux 命令练习、跑本地构建、看本机日志，这些都不该被
 * "先连一台服务器"挡住。界面侧它和远端终端是同一种东西（一条 shellId 一路通道），
 * 差别只在"命令交给谁执行"。
 *
 * 原生模块是可选依赖：node-pty 在部分平台（如没有预编译产物的 Linux）装不上，
 * 那时这里返回明确的不可用原因，界面给出提示，而不是让整个主进程起不来。
 * 加载失败的写法沿用 services/db/database.ts 里 better-sqlite3 的那套
 * （动态 require + 把原因带回调用方，降级不能只活在控制台里）。
 *
 * 实测（2026-10-10，本机 Windows x64）：node-pty 1.1.0 随包带的预编译产物是 N-API，
 * Electron 43 直接 require 就能用，不需要 electron-rebuild；
 * 判据是 tests/e2e/local-terminal.spec.ts（真开一个 shell、真回显、真关掉）。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { logger } from '../log/logger'
import { redactSecrets } from '../../core/agent/providers/redact'

/** node-pty 的进程对象（只声明本项目用到的部分，避免把可选依赖的类型绑进编译） */
interface PtyProcess {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  dispose(): void
  onData(cb: (data: string) => void): { dispose(): void }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string
      cols: number
      rows: number
      cwd: string
      env: Record<string, string>
      useConpty?: boolean
    },
  ): PtyProcess
}

/** 一条开着的本机终端 */
interface PtyEntry {
  id: string
  proc: PtyProcess
  shellPath: string
  callbacks: Set<(data: string) => void>
  offData: { dispose(): void }
  offExit: { dispose(): void }
}

/** 终端尺寸（xterm 的 cols/rows） */
export interface PtySize {
  cols: number
  rows: number
}

/** 加载结果：模块或失败原因，二者只有一个非空 */
let ptyCache: { mod: PtyModule | null; error: string | null } | undefined

function loadNodePty(): { mod: PtyModule | null; error: string | null } {
  if (ptyCache) return ptyCache
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- 静态 import 会让 node-pty 缺失时整个主进程起不来
    ptyCache = { mod: require('node-pty') as PtyModule, error: null }
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    logger.error('LocalTerminal', 'node-pty 加载失败，本机终端不可用', { error: redactSecrets(msg) })
    ptyCache = { mod: null, error: msg }
  }
  return ptyCache
}

/**
 * 该开哪个 shell
 *
 * Windows 优先 PowerShell（对初学者比 cmd 友好，且我们给的命令示例是 bash 系，
 * 至少 PowerShell 还能看懂一部分）；POSIX 用 $SHELL，退到 bash/sh。
 * 只认存在且可执行的文件，找不到就返回 null 让界面说清楚。
 */
export function pickLocalShell(): string | null {
  if (process.platform === 'win32') {
    const candidates = ['pwsh.exe', 'powershell.exe', process.env.COMSPEC ?? 'cmd.exe']
    for (const c of candidates) {
      const found = whichOnPath(c) ?? (c.includes('\\') ? c : null)
      if (found && fs.existsSync(found)) return found
    }
    return null
  }
  const envShell = process.env.SHELL
  if (envShell && fs.existsSync(envShell)) return envShell
  for (const p of ['/bin/bash', '/bin/zsh', '/bin/sh']) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function whichOnPath(exe: string): string | null {
  const pathVar = process.env.PATH ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue
    const full = `${dir.replace(/[\\/]$/, '')}\\${exe}`
    if (fs.existsSync(full)) return full
  }
  return null
}

/** 可注入的依赖：单测靠它换掉 node-pty 与 taskkill，生产用默认实现 */
export interface LocalPtyDeps {
  /** 取 node-pty 模块；装不上时返回 null（原因由调用方从 lastError 拿） */
  loadPty: () => { mod: PtyModule | null; error: string | null }
  /** Windows 上杀整棵进程树（ConPTY 的 kill 会去 fork 一个没有控制台的子进程，那条路必崩） */
  killProcessTree: (pid: number) => void
}

const defaultDeps: LocalPtyDeps = {
  loadPty: () => loadNodePty(),
  killProcessTree: (pid) => {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true })
  },
}

/** 本机终端管理器（默认单例；测试可 new 一份注入替身） */
export class LocalPtyManager {
  constructor(private readonly deps: LocalPtyDeps = defaultDeps) {}

  private readonly shells = new Map<string, PtyEntry>()
  /** shell 退出时通知渲染层摘标签（事件由 ipc/local-terminal 挂） */
  private exitListeners = new Set<(shellId: string) => void>()

  /** 是否可用 + 不可用的原因（界面用它决定按钮点了是开终端还是给提示） */
  getStatus(): { available: boolean; reason: string | null; shellPath: string | null } {
    const { mod, error } = this.deps.loadPty()
    const shellPath = pickLocalShell()
    if (!mod) return { available: false, reason: error ?? 'node-pty 未安装', shellPath }
    if (!shellPath) return { available: false, reason: '找不到可用的本机 Shell', shellPath }
    return { available: true, reason: null, shellPath }
  }

  /**
   * 开一条本机终端，返回 shellId
   *
   * 身份与远端终端一致（uuid + 一张表），所以渲染层那套 shellId 分发原样能用。
   */
  startShell(size?: PtySize): { shellId: string } | { error: string } {
    const { mod, error } = this.deps.loadPty()
    if (!mod) return { error: error ?? 'node-pty 未安装' }
    const shellPath = pickLocalShell()
    if (!shellPath) return { error: '找不到可用的本机 Shell' }

    const id = randomUUID()
    try {
      const proc = mod.spawn(shellPath, [], {
        name: 'xterm-256color',
        cols: size?.cols ?? 80,
        rows: size?.rows ?? 24,
        cwd: os.homedir(),
        env: { ...process.env } as Record<string, string>,
      })
      const entry: PtyEntry = {
        id,
        proc,
        shellPath,
        callbacks: new Set(),
        offData: { dispose: () => {} },
        offExit: { dispose: () => {} },
      }
      entry.offData = proc.onData((data) => {
        for (const cb of [...entry.callbacks]) cb(data)
      })
      entry.offExit = proc.onExit(({ exitCode }) => {
        logger.info('LocalTerminal', '本机终端进程退出', { shellId: id, exitCode })
        this.remove(id)
        // 退出通知：渲染层据此摘掉标签，不留点不动的死终端
        for (const cb of [...this.exitListeners]) cb(id)
      })
      this.shells.set(id, entry)
      logger.info('LocalTerminal', '本机终端已打开', { shellId: id, pid: proc.pid })
      return { shellId: id }
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err)
      logger.error('LocalTerminal', '本机终端启动失败', { error: redactSecrets(msg) })
      return { error: msg }
    }
  }

  listShells(): string[] {
    return [...this.shells.keys()]
  }

  isShellOpen(shellId: string): boolean {
    return this.shells.has(shellId)
  }

  writeShell(shellId: string, data: string): void {
    const entry = this.require(shellId)
    entry.proc.write(data)
  }

  resizeShell(shellId: string, cols: number, rows: number): void {
    const entry = this.require(shellId)
    try {
      entry.proc.resize(cols, rows)
    } catch {
      // 进程刚好退出时 resize 会抛，忽略即可
    }
  }

  onShellData(shellId: string, cb: (data: string) => void): () => void {
    const entry = this.shells.get(shellId)
    if (!entry) throw new Error('终端不存在或已关闭')
    entry.callbacks.add(cb)
    return () => {
      entry.callbacks.delete(cb)
    }
  }

  /** 进程退出事件（返回退订，注册方必须能撤销） */
  onShellExit(cb: (shellId: string) => void): () => void {
    this.exitListeners.add(cb)
    return () => {
      this.exitListeners.delete(cb)
    }
  }

  /**
   * 关掉一条本机终端
   *
   * Windows 上不能只 proc.kill()：ConPTY 那条路径会顺手 fork 一个
   * conpty_console_list_agent 子进程去枚举控制台里的进程，而 Electron 起的
   * 子进程没有控制台，那个 fork 直接 AttachConsole failed 崩掉，
   * 结果是"枚举失败 → 子进程没被杀 → 命令还在后台跑"。
   * 所以这里自己用 taskkill /T 把整棵进程树端掉，再 dispose 掉 PTY 句柄。
   */
  closeShell(shellId: string): boolean {
    const entry = this.shells.get(shellId)
    if (!entry) return false
    const pid = entry.proc.pid
    if (process.platform === 'win32') {
      try {
        this.deps.killProcessTree(pid)
      } catch (err) {
        logger.warn('LocalTerminal', '杀进程树失败', {
          shellId,
          error: redactSecrets((err as Error).message),
        })
      }
    } else {
      try {
        entry.proc.kill()
      } catch {
        // 已经退出的进程再 kill 会抛，忽略
      }
    }
    this.remove(shellId)
    return true
  }

  /** 主进程退出前收摊：不留孤儿 shell */
  closeAll(): void {
    for (const id of [...this.shells.keys()]) this.closeShell(id)
  }

  private remove(shellId: string): void {
    const entry = this.shells.get(shellId)
    if (!entry) return
    this.shells.delete(shellId)
    entry.offData.dispose()
    entry.offExit.dispose()
    entry.callbacks.clear()
    try {
      entry.proc.dispose()
    } catch {
      // dispose 对已退出的进程可能抛，忽略
    }
  }

  private require(shellId: string): PtyEntry {
    const entry = this.shells.get(shellId)
    if (!entry) throw new Error('终端不存在或已关闭')
    return entry
  }
}

/** 本机终端管理器单例 */
export const localPtyManager = new LocalPtyManager()
