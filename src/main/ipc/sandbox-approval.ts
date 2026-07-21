/**
 * Sandbox 审批与危险度识别（从 sandbox.ts 抽出，保持主文件 ≤500 行）
 *
 * 包含：
 * - 命令危险度识别（AST + 正则兜底）
 * - 审批请求推送与等待（P-2 HC-6 强制审批）
 * - session_api_key 句柄模式缓存（P-4）
 *
 * 详见主文件 sandbox.ts 顶部注释。
 */

import type { BrowserWindow } from 'electron'
import type { SandboxInfo } from '../services/sandbox/types'
import { logger } from '../services/log/logger'
// AST 危险命令识别（tree-sitter-bash，覆盖 6 类绕过，AST 失败时降级到正则）
import { assessWithAst } from '../core/risk-engine-ast'

// ============================================================================
// P-2 + P-4 修复新增：句柄模式 + IPC 层强制审批
// ============================================================================
//
// P-4 句柄模式：session_api_key 不出主进程
// - sandboxId → sessionApiKey 映射缓存（主进程内部维护）
// - sandbox:create / sandbox:list 返回前抹除 session_api_key（设为 null）
// - sandbox:execute 不接收 sessionApiKey 参数，从 Map 中查找
// - sandbox:delete 删除后清理 Map
// - 即使渲染进程被 XSS，攻击者也无法读到 key
//
// P-2 IPC 层强制审批：sandbox:execute 始终推送审批请求
// - 不依赖 UI 层"自觉"实现审批弹窗
// - IPC 层强制 waitForSandboxApproval() 才执行命令
// - 命令危险度识别（low/medium/high）帮助 UI 展示风险等级
// - 30 秒审批超时自动拒绝
// ============================================================================

/** sandboxId → sessionApiKey 缓存（P-4：句柄模式） */
export const sessionKeyMap = new Map<string, string>()

/** 待审批的 sandbox 命令调用池（callId → Promise resolver） */
export interface PendingSandboxApproval {
  resolve: (approved: boolean) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}
export const pendingSandboxApprovals = new Map<string, PendingSandboxApproval>()

/** 审批请求推送通道（主 → 渲染，单向） */
export const SANDBOX_APPROVAL_CHANNEL = 'sandbox:approval-request'
/** 审批超时（30 秒，与 llm-tools.ts 保持一致） */
export const SANDBOX_APPROVAL_TIMEOUT_MS = 30_000

/** 命令危险度评级 */
export type CommandRiskLevel = 'low' | 'medium' | 'high'

/** 审批请求载荷（推送给渲染进程） */
export interface SandboxApprovalRequest {
  callId: string
  sandboxId: string
  command: string
  risk: CommandRiskLevel
  reasons: string[]
  timestamp: number
  /**
   * 会话 ID（v0.9.4 新增，可选）
   *
   * 主进程在 sandbox:execute 调用时生成（或使用调用方传入的 sessionId），
   * 通过审批请求推送回渲染进程，便于 UI 关联请求与响应、支持主动取消。
   */
  sessionId?: string
}

/**
 * 命令危险度识别（用于审批 UI 提示 + 审计日志）
 *
 * 改造（v0.9 自检后追加）：
 * - 优先使用 AST 解析（tree-sitter-bash），覆盖 6 类绕过
 * - AST 解析失败时降级到正则方案（assessCommandRiskRegex）
 * - 调研依据：docs/调研-Bash命令解析库选型-危险命令识别.md
 *
 * - high：高危命令（rm -rf / chmod 777 / iptables / dd / mkfs / fork bomb / shutdown 等）
 * - medium：中危命令（包管理 / 用户管理 / 服务管理 / sudo 提权等）
 * - low：低危命令（ls / cat / grep / ps 等只读操作）
 */
export async function assessCommandRisk(
  command: string
): Promise<{ risk: CommandRiskLevel; reasons: string[] }> {
  // 优先 AST 解析
  const astResult = await assessWithAst(command)
  if (astResult) {
    return { risk: astResult.risk, reasons: astResult.reasons }
  }
  // AST 失败 → 降级到正则
  return assessCommandRiskRegex(command)
}

/**
 * 正则兜底方案（原 assessCommandRisk 实现，AST 失败时调用）
 */
export function assessCommandRiskRegex(
  command: string
): { risk: CommandRiskLevel; reasons: string[] } {
  const reasons: string[] = []
  // 高危：rm -rf 根目录 / chmod 777 / iptables / dd / mkfs / fork bomb / shutdown
  if (/\brm\s+-rf\b/i.test(command) && /(^|\s|["'`])\/($|\s|\*|["'`])/.test(command)) {
    reasons.push('rm -rf 根目录递归删除')
  }
  if (/chmod\s+777/i.test(command)) reasons.push('chmod 777 全权限开放')
  if (/\biptables\b/i.test(command)) reasons.push('iptables 防火墙规则修改')
  if (/\bdd\s+if=/i.test(command)) reasons.push('dd 磁盘镜像写入')
  if (/mkfs/i.test(command)) reasons.push('mkfs 文件系统格式化')
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;:/.test(command)) reasons.push('fork bomb')
  if (/\b(shutdown|reboot|halt|poweroff)\b/i.test(command)) reasons.push('关机/重启命令')
  if (/>\s*\/dev\/sd[a-z]/i.test(command)) reasons.push('直接写入磁盘设备')
  if (/\bkillall\b/i.test(command)) reasons.push('killall 批量终止进程')
  if (reasons.length > 0) return { risk: 'high', reasons }

  // 中危：包管理 / 用户管理 / 服务管理 / 网络 / sudo
  if (/\b(yum|apt|dnf|pip|npm|pnpm)\s+(install|remove|upgrade|purge)\b/i.test(command)) {
    reasons.push('包管理操作')
  }
  if (/\buser(add|del|mod)\b/i.test(command)) reasons.push('用户管理')
  if (/\bgroup(add|del|mod)\b/i.test(command)) reasons.push('用户组管理')
  if (/\bsystemctl\s+(start|stop|restart|enable|disable)\b/i.test(command)) reasons.push('服务管理')
  if (/\bservice\s+\w+\s+(start|stop|restart)/i.test(command)) reasons.push('SysV 服务管理')
  if (/\bsudo\b/i.test(command)) reasons.push('sudo 提权')
  if (/>\s*\/etc\//i.test(command)) reasons.push('修改 /etc 系统配置')
  if (/\bcrontab\b/i.test(command)) reasons.push('定时任务修改')
  if (/\b(passwd|chpasswd)\b/i.test(command)) reasons.push('密码修改')
  if (reasons.length > 0) return { risk: 'medium', reasons }

  return { risk: 'low', reasons: [] }
}

/**
 * 安全推送事件到渲染进程（窗口已销毁时跳过）
 */
export function safeSend(mainWindow: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

/**
 * 等待用户审批（推送 sandbox:approval-request 事件，等待 sandbox:approve invoke）
 *
 * @param mainWindow 主窗口实例
 * @param callId 审批调用 ID（与 pendingSandboxApprovals Map 中的 key 对应）
 * @param sandboxId 沙箱 ID
 * @param command 待执行的命令
 * @param sessionId 会话 ID（v0.9.4 新增，可选，附带在审批请求上回传给渲染进程）
 * @returns 是否批准
 */
export function waitForSandboxApproval(
  mainWindow: BrowserWindow,
  callId: string,
  sandboxId: string,
  command: string,
  sessionId?: string
): Promise<boolean> {
  return new Promise<boolean>(async (resolve, reject) => {
    // assessCommandRisk 改为 async（AST 解析），在 Promise 内 await
    const { risk, reasons } = await assessCommandRisk(command)
    const request: SandboxApprovalRequest = {
      callId,
      sandboxId,
      command,
      risk,
      reasons,
      timestamp: Date.now(),
      sessionId,
    }
    safeSend(mainWindow, SANDBOX_APPROVAL_CHANNEL, request)

    const timeout = setTimeout(() => {
      pendingSandboxApprovals.delete(callId)
      reject(new Error('用户审批超时（30秒），自动拒绝'))
    }, SANDBOX_APPROVAL_TIMEOUT_MS)

    pendingSandboxApprovals.set(callId, { resolve, reject, timeout })
  })
}

/**
 * 抹除 SandboxInfo 中的 session_api_key，缓存到主进程 Map
 *
 * P-4 句柄模式：避免 session_api_key 暴露到渲染进程内存
 *
 * @param info 原始 SandboxInfo（含 session_api_key）
 * @returns 处理后的 SandboxInfo（session_api_key 已设为 null）
 */
export function cacheAndRedactSessionKey(info: SandboxInfo): SandboxInfo {
  if (info.session_api_key) {
    sessionKeyMap.set(info.id, info.session_api_key)
    logger.debug('IPC.SANDBOX', 'session_api_key 已缓存到主进程（不暴露给渲染进程）', {
      sandboxId: info.id,
    })
  }
  return { ...info, session_api_key: null }
}
