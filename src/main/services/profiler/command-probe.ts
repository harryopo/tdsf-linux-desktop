/**
 * 单命令探查器（Command Probe）
 *
 * 封装单条 SSH 命令的执行：
 * - 超时控制（默认 10 秒）
 * - 失败重试（默认 1 次）
 * - 错误捕获
 * - 性能计时
 *
 * 这是 SystemProfiler 的最小执行单元，被 27 个探查项共用。
 */

import { SshConnectionManager } from '../ssh/connection-manager'
import type { CommandResult } from '@shared/models'
import type { ProfilerItem, ProfilerGroupName } from './types'

/** 探查选项 */
export interface CommandProbeOptions {
  /** 超时时间（毫秒），默认 10000 */
  timeoutMs?: number
  /** 失败重试次数，默认 1（总共执行 2 次） */
  retries?: number
  /** 重试间隔（毫秒），默认 500 */
  retryDelayMs?: number
}

const DEFAULT_TIMEOUT = 10000
const DEFAULT_RETRIES = 1
const DEFAULT_RETRY_DELAY = 500

/**
 * 在 SSH 远程主机上执行单条探查命令
 *
 * @param sessionId SSH 会话 ID（来自 SshConnectionManager）
 * @param group 探查组（用于 ProfilerItem 标记）
 * @param groupLabel 探查组中文名
 * @param cmd 要执行的命令
 * @param options 超时/重试配置
 * @returns 探查结果（成功/失败均返回，不会抛异常）
 */
export async function commandProbe(
  sessionId: string,
  group: ProfilerGroupName,
  groupLabel: string,
  cmd: string,
  options: CommandProbeOptions = {}
): Promise<ProfilerItem> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const retries = options.retries ?? DEFAULT_RETRIES
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY

  const startTime = Date.now()
  let lastError: string | undefined
  let lastResult: CommandResult | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await execWithTimeout(sessionId, cmd, timeoutMs)
      lastResult = result
      // 即使 exitCode !== 0，也算命令执行成功（命令本身能跑）
      return {
        group,
        groupLabel,
        cmd,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: Date.now() - startTime,
        ok: true
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      // 最后一次重试仍失败则退出循环
      if (attempt < retries) {
        await sleep(retryDelayMs)
      }
    }
  }

  // 全部重试失败
  return {
    group,
    groupLabel,
    cmd,
    stdout: lastResult?.stdout ?? '',
    stderr: lastResult?.stderr ?? '',
    exitCode: lastResult?.exitCode ?? -1,
    durationMs: Date.now() - startTime,
    ok: false,
    error: lastError ?? 'unknown error'
  }
}

/**
 * 带超时的 SSH 命令执行
 *
 * 使用 Promise.race 实现超时控制：超时后返回 reject，
 * 但底层 exec 的回调可能仍然会触发（被忽略）。
 */
function execWithTimeout(
  sessionId: string,
  cmd: string,
  timeoutMs: number
): Promise<CommandResult> {
  const conn = SshConnectionManager.getInstance()
  const execPromise = conn.exec(sessionId, cmd)

  return new Promise<CommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`command timeout after ${timeoutMs}ms: ${cmd.slice(0, 60)}`))
    }, timeoutMs)

    execPromise
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

/** 简单 sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
