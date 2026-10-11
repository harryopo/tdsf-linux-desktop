/**
 * 外部命令统一执行入口（P1-9）
 *
 * 为什么要有这一层：`child_process` 的 execFile/spawn **默认不限时**，
 * 外部命令一阻塞，调用它的 IPC handler 就永久 pending、渲染层 loading 永不结束。
 * 实测到的真实入口是 ssh-keygen：`ssh-keygen -y -f <key>` 遇到带口令的私钥、
 * `ssh-keygen -t ... ` 遇到"文件已存在，是否覆盖 (y/n)?"，都会停下来等输入 ——
 * 而没有终端可答，于是永远等下去。
 *
 * 这一层强制三件事：必带超时、必带输出上限、错误信息只带 label 与退出码
 * （argv 里可能有私钥路径，不进错误文本也不进日志）。
 */
import { spawn } from 'node:child_process'

/** 普通外部命令：95% 在几秒内完成 */
export const DEFAULT_TIMEOUT_MS = 10_000
/** 生成密钥这类带熵采集的命令 */
export const HEAVY_TIMEOUT_MS = 60_000
/** 输出上限：防一条命令把主进程内存吃光 */
export const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024

export interface RunCommandOptions {
  /** 超时毫秒，默认 10s；到点 SIGKILL 整条进程 */
  timeoutMs?: number
  /** stdout+stderr 合计上限，超出即杀进程并报错 */
  maxBufferBytes?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** 写进日志与错误信息的语义名（默认用可执行文件名）；绝不写 argv */
  label?: string
}

export interface RunCommandResult {
  stdout: string
  stderr: string
  /** 退出码；被信号终止时不是这个，而是抛错 */
  code: number
  durationMs: number
}

/** 三类失败分开，调用方才能分别处置（超时≠命令本身报错） */
export class CommandTimeoutError extends Error {
  readonly code = 'E_COMMAND_TIMEOUT' as const
  constructor(readonly label: string, readonly timeoutMs: number) {
    super(`${label} 超过 ${timeoutMs}ms 未结束，已终止`)
    this.name = 'CommandTimeoutError'
  }
}

export class CommandOutputTooLargeError extends Error {
  readonly code = 'E_COMMAND_OUTPUT_TOO_LARGE' as const
  constructor(readonly label: string, readonly limitBytes: number) {
    super(`${label} 输出超过 ${limitBytes} 字节上限，已终止`)
    this.name = 'CommandOutputTooLargeError'
  }
}

export class CommandFailedError extends Error {
  readonly code: 'E_COMMAND_EXIT' | 'E_COMMAND_SPAWN'
  constructor(label: string, kind: 'exit' | 'spawn', detail: string) {
    super(`${label} 失败：${detail}`)
    this.name = 'CommandFailedError'
    this.code = kind === 'exit' ? 'E_COMMAND_EXIT' : 'E_COMMAND_SPAWN'
  }
}

/**
 * 跑一条会自己结束的外部命令。非零退出码抛 CommandFailedError——
 * 需要自己判 code 的调用方（比如"有改动就拒绝"）请改用 try/catch 读 e.code。
 */
export function runCommand(
  file: string,
  args: readonly string[],
  options: RunCommandOptions = {}
): Promise<RunCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const limit = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER
  const label = options.label ?? file
  const startedAt = Date.now()

  return new Promise<RunCommandResult>((resolve, reject) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      // 不给 stdin：任何"等输入"的命令都会直接读到 EOF，而不是把主进程挂住
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let out = ''
    let err = ''
    let bytes = 0
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const bail = (e: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      child.kill('SIGKILL')
      reject(e)
    }

    const collect = (chunk: Buffer, sink: 'out' | 'err'): void => {
      bytes += chunk.length
      if (bytes > limit) {
        bail(new CommandOutputTooLargeError(label, limit))
        return
      }
      if (sink === 'out') out += chunk.toString('utf8')
      else err += chunk.toString('utf8')
    }

    child.stdout.on('data', (c: Buffer) => collect(c, 'out'))
    child.stderr.on('data', (c: Buffer) => collect(c, 'err'))
    // 命令不存在之类：ENOENT 只报 label，不把 argv（可能含私钥路径）带进错误文本
    child.on('error', (e: Error) => bail(new CommandFailedError(label, 'spawn', e.message)))
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout: out, stderr: err, code, durationMs: Date.now() - startedAt })
        return
      }
      // 这里不能再走 bail：上面已把 settled 置位，bail 会直接 return，
      // promise 就永不 reject（第一版就是这么挂住的，被"非零退出"那条测试抓到）
      reject(
        new CommandFailedError(
          label,
          'exit',
          `退出码 ${code ?? `信号 ${signal ?? '未知'}`}${err ? `：${err.slice(0, 2000)}` : ''}`
        )
      )
    })

    timer = setTimeout(() => bail(new CommandTimeoutError(label, timeoutMs)), timeoutMs)
    // 这条定时器不该把进程活着的原因扛在自己身上
    timer.unref?.()
  })
}
