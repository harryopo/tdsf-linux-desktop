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
// P1-8 修复：回滚命令动态生成（18 条规则 + 不可逆黑名单 + 路径解析）
import { generateRollbackCommand } from '../services/security/rollback-generator'

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
  /**
   * 可能的副作用（v0.9.3 §11 改进点 4 P2-C 新增，可选）
   *
   * 根据 risk 和 reasons 推导，告诉用户"执行后会发生什么"。
   * 例如：['该命令将删除 /var/log 下的所有日志文件', '系统将无法回溯历史日志']
   */
  sideEffects?: string[]
  /**
   * 推荐的回滚命令（v0.9.3 §11 改进点 4 P2-C 新增，可选）
   *
   * 命令执行失败或结果不符合预期时，用户可执行的回滚命令。
   * 例如：'git checkout . && git clean -fd'
   */
  rollbackCommand?: string
  /**
   * 建议的更安全替代方案（v0.9.3 §11 改进点 4 P2-C 新增，可选）
   *
   * 如果存在更安全的等价命令，给出建议。
   * 例如：'建议使用 rm -rf /var/log/old/*.log 而非 rm -rf /var/log/*'
   */
  saferAlternative?: string
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
 * 推导命令可能的副作用（v0.9.3 §11 改进点 4 P2-C 新增）
 *
 * 根据 risk 和 reasons 推导，告诉用户"执行后会发生什么"。
 * 用于审批弹窗中"为什么需要审批"区块的副作用提示。
 *
 * @param command 待执行的命令
 * @param risk 风险等级
 * @param reasons 风险原因列表
 * @returns 副作用描述列表（空数组表示无明显副作用）
 */
function deriveSideEffects(
  command: string,
  risk: CommandRiskLevel,
  reasons: string[]
): string[] {
  const effects: string[] = []

  // 高危命令的副作用
  if (risk === 'high') {
    if (/\brm\s+-rf\b/i.test(command)) {
      effects.push('将递归删除指定目录及其所有子文件，操作不可逆')
    }
    if (/chmod\s+777/i.test(command)) {
      effects.push('所有用户都将获得读写执行权限，存在安全隐患')
    }
    if (/\biptables\b/i.test(command)) {
      effects.push('将修改防火墙规则，可能导致网络连接中断')
    }
    if (/\bdd\s+if=/i.test(command)) {
      effects.push('将直接写入磁盘设备，可能覆盖现有数据')
    }
    if (/mkfs/i.test(command)) {
      effects.push('将格式化文件系统，磁盘上所有数据将丢失')
    }
    if (/\b(shutdown|reboot|halt|poweroff)\b/i.test(command)) {
      effects.push('将导致系统关机或重启，所有未保存的工作将丢失')
    }
    if (/\bkillall\b/i.test(command)) {
      effects.push('将终止所有同名进程，可能影响系统稳定性')
    }
  }

  // 中危命令的副作用
  if (risk === 'medium') {
    if (/\b(yum|apt|dnf|pip|npm|pnpm)\s+(install|remove|upgrade|purge)\b/i.test(command)) {
      effects.push('将修改系统软件包，可能影响依赖关系')
    }
    if (/\buser(add|del|mod)\b/i.test(command)) {
      effects.push('将修改用户账户，可能影响登录权限')
    }
    if (/\bsystemctl\s+(start|stop|restart|enable|disable)\b/i.test(command)) {
      effects.push('将修改服务运行状态，可能影响系统功能')
    }
    if (/\bsudo\b/i.test(command)) {
      effects.push('将以 root 权限执行，请确认命令安全性')
    }
    if (/>\s*\/etc\//i.test(command)) {
      effects.push('将修改系统配置文件，可能影响系统行为')
    }
  }

  // 如果没有具体副作用但有风险原因，使用通用提示
  if (effects.length === 0 && reasons.length > 0) {
    effects.push(`检测到 ${reasons.length} 项风险因素，请仔细确认后执行`)
  }

  return effects
}

/**
 * 推荐回滚命令（v0.9.3 §11 改进点 4 P2-C 新增）
 *
 * P1-8 修复（v2.5）：委托给 rollback-generator 模块，支持 18 条命令回滚规则 +
 * 不可逆命令黑名单 + 真实文件路径解析，替代原硬编码的 `cp /etc/xxx.bak /etc/xxx` 占位。
 *
 * @param command 待执行的命令
 * @param risk 风险等级
 * @returns 回滚命令字符串（undefined 表示无法回滚或无需回滚）
 */
function deriveRollbackCommand(
  command: string,
  risk: CommandRiskLevel
): string | undefined {
  return generateRollbackCommand(command, risk)
}

/**
 * 建议更安全的替代方案（v0.9.3 §11 改进点 4 P2-C 新增）
 *
 * 如果存在更安全的等价命令，给出建议。
 *
 * @param command 待执行的命令
 * @param risk 风险等级
 * @returns 替代方案字符串（undefined 表示无更安全方案）
 */
function deriveSaferAlternative(
  command: string,
  risk: CommandRiskLevel
): string | undefined {
  // rm -rf 根目录 → 建议精确路径
  if (/\brm\s+-rf\b/i.test(command) && /(^|\s|["'`])\/($|\s|\*|["'`])/.test(command)) {
    return '危险：rm -rf / 会删除整个文件系统。建议明确指定要删除的子目录，如 rm -rf /var/log/old/'
  }

  // rm -rf 通配符 → 建议先 ls 查看
  if (/\brm\s+-rf\b.*\*/i.test(command)) {
    return '建议先执行 ls 查看匹配的文件列表，确认后再删除'
  }

  // chmod 777 → 建议 750/755
  if (/chmod\s+777/i.test(command)) {
    return '建议使用 chmod 755（目录）或 chmod 644（文件），仅所有者可写'
  }

  // systemctl stop → 建议 mask（更彻底）
  if (/\bsystemctl\s+stop\b/i.test(command)) {
    return '若需长期禁用服务，建议使用 systemctl mask 而非 stop（防止被其他服务唤醒）'
  }

  // sudo + curl → 警告
  if (/\bsudo\b.*\bcurl\b/i.test(command) || /\bcurl\b.*\|\s*sudo\b/i.test(command)) {
    return '警告：sudo + curl 存在远程代码执行风险，建议先下载脚本审查后再执行'
  }

  // 高危命令无替代方案
  if (risk === 'high') {
    if (/mkfs/i.test(command)) return undefined
    if (/\bdd\s+if=/i.test(command)) return undefined
    if (/\b(shutdown|reboot|halt|poweroff)\b/i.test(command)) return undefined
  }

  return undefined
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
    // v0.9.3 §11 改进点 4 P2-C：推导副作用 / 回滚命令 / 更安全替代方案
    const sideEffects = deriveSideEffects(command, risk, reasons)
    const rollbackCommand = deriveRollbackCommand(command, risk)
    const saferAlternative = deriveSaferAlternative(command, risk)
    const request: SandboxApprovalRequest = {
      callId,
      sandboxId,
      command,
      risk,
      reasons,
      timestamp: Date.now(),
      sessionId,
      sideEffects,
      rollbackCommand,
      saferAlternative,
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
