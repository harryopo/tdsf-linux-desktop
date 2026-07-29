/**
 * SSH 命令前置环境预检（主进程侧，v2.6）
 *
 * 在 ssh_readonly 等真正执行用户/Agent 命令之前，用一次轻量远程调用
 * 确认命令行涉及的所有外部命令在目标机上存在（command -v）。
 *
 * 失败策略【fail-open】：预检自身出错（超时/连接抖动/解析不出命令名）
 * 一律放行主命令执行，绝不因预检基础设施问题阻塞正常流程。
 */
import { SshConnectionManager } from './connection-manager'
import {
  extractCommandNames,
  buildMissingCheckScript,
  parseMissingOutput,
} from '@shared/command-preflight'

/** 预检结果 */
export interface PreflightResult {
  /** 是否通过（missing 为空或预检被跳过） */
  ok: boolean
  /** 服务器上缺失的命令名 */
  missing: string[]
  /** 本次实际检查过的命令名 */
  checked: string[]
  /** 预检是否被跳过（无可检查命令 / 预检自身失败 → fail-open） */
  skipped: boolean
}

/**
 * 对一条命令行做前置环境预检
 *
 * @param sessionId SSH 会话 ID（须已连接）
 * @param command 即将执行的命令行
 */
export async function preflightCheck(sessionId: string, command: string): Promise<PreflightResult> {
  const checked = extractCommandNames(command)
  if (checked.length === 0) {
    return { ok: true, missing: [], checked, skipped: true }
  }
  try {
    const r = await SshConnectionManager.getInstance().exec(
      sessionId,
      buildMissingCheckScript(checked),
    )
    const missing = parseMissingOutput(r.stdout)
    return { ok: missing.length === 0, missing, checked, skipped: false }
  } catch {
    // fail-open：预检失败不阻塞主命令
    return { ok: true, missing: [], checked, skipped: true }
  }
}
