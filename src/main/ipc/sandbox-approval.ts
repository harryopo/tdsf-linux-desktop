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
import { broadcastToWindows } from '../windows/main-window'
import type { SandboxInfo } from '../services/sandbox/types'
import { logger } from '../services/log/logger'
import { SANDBOX } from '@shared/ipc-channels'
// AST 危险命令识别（tree-sitter-bash，覆盖 6 类绕过，AST 失败时降级到正则）
import { assessWithAst } from '../core/risk-engine-ast'
// 权威风险引擎：AST 不可用时的兜底判定也走这一份规则（不再手抄第二份）
import { assessRisk } from '../core/risk-engine'
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
export const SANDBOX_APPROVAL_CHANNEL = SANDBOX.APPROVAL_REQUEST
/** 审批超时（30 秒，与 llm-tools.ts 保持一致） */
export const SANDBOX_APPROVAL_TIMEOUT_MS = 30_000

/**
 * 命令危险度评级与审批载荷的唯一声明在 @shared/approval-types：
 * 这里只转发，保持既有 `CommandRiskLevel` 调用点不变（历史上 main 与 preload 各写一份，
 * preload 那份还少了四个字段，界面因此拿不到副作用与回滚方案）。
 */
export { type SandboxApprovalRequest } from '@shared/approval-types'
export type { SandboxCommandRiskLevel as CommandRiskLevel } from '@shared/approval-types'
import type {
  SandboxApprovalRequest,
  SandboxCommandRiskLevel as CommandRiskLevel,
} from '@shared/approval-types'

/**
 * 命令危险度识别（用于审批 UI 提示 + 审计日志）
 *
 * 改造（v0.9 自检后追加）：
 * - 优先使用 AST 解析（tree-sitter-bash），覆盖 6 类绕过
 * - AST 解析失败时降级到权威风险引擎 assessRisk（assessCommandRiskFallback）
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
  // AST 失败 → 交给权威风险引擎（同一份规则，不再另立一张表）
  return assessCommandRiskFallback(command)
}

/**
 * 正则兜底方案（原 assessCommandRisk 实现，AST 失败时调用）
 */
/**
 * AST 不可用时的兜底：复用权威风险引擎 risk-engine.assessRisk，只做等级映射。
 *
 * 这里原来是一份**手抄的第二套规则表**（18 条正则），和 risk-engine 那份各自演化。
 * 实测同一批命令两边判定不一致，而且不一致的方向是审批卡更松：
 *   `rm -rf /var/log` → risk-engine HIGH，本表 low
 *   `useradd -m hacker` → 本表 medium，risk-engine LOW
 * 用户正是在这一秒决定"要不要放行"，卡片把高危标成低风险等于帮着放行。
 * 规则从此只有一份，两边不可能再分叉；等级词表不同就在此处映射。
 */
export function assessCommandRiskFallback(
  command: string
): { risk: CommandRiskLevel; reasons: string[] } {
  const a = assessRisk(command)
  const risk: CommandRiskLevel =
    a.level === 'HIGH' || a.level === 'CRITICAL' ? 'high' : a.level === 'MEDIUM' ? 'medium' : 'low'
  const reasons = a.matchedRules.length > 0 ? [...a.matchedRules] : a.description ? [a.description] : []
  return { risk, reasons }
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
  // 审批/进度类通道必须让每个应用窗口都收到：W4 起副窗口同样是工作区，
  // 只发注册时那一个窗口的话，在副窗口里点"执行"就永远等不到批复，30 秒后自动拒绝。
  // 保留 mainWindow 形参是为了不动这 6 个文件里的 40 多个调用点（清理它属于另一次重构）。
  void mainWindow
  broadcastToWindows(channel, ...args)
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
/**
 * 等待用户审批（推送 sandbox:approval-request 事件，等待 sandbox:approve invoke）
 *
 * @param mainWindow 主窗口实例
 * @param callId 审批调用 ID（与 pendingSandboxApprovals Map 中的 key 对应）
 * @param sandboxId 沙箱 ID
 * @param command 待执行的命令
 * @param sessionId 会话 ID（v0.9.4 新增，可选，附带在审批请求上回传给渲染进程）
 * @returns 是否批准
 * @throws 风险评估本身失败时抛出（调用方 sandbox:execute 已按"拒绝执行"处理）
 */
export async function waitForSandboxApproval(
  mainWindow: BrowserWindow,
  callId: string,
  sandboxId: string,
  command: string,
  sessionId?: string
): Promise<boolean> {
  // assessCommandRisk 是 async（AST 解析）。原先写在 `new Promise(async …)` 的执行体里，
  // 而 async 执行体抛错只会让它自己那个 Promise 落空——构造出来的外层 Promise
  // 既不 resolve 也不 reject，超时器又排在 await 后面根本没装上：
  // 一次 AST 失败 = 这条命令的审批框永远不出现，AI 请求原地挂死。
  // 改成"先算完再进 Promise"，异常走正常抛出，由调用方按拒绝处理（fail-closed）。
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

  return new Promise<boolean>((resolve, reject) => {
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
