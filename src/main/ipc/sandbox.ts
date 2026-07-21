/**
 * Sandbox IPC Handlers（v0.9 新增）
 *
 * 注册 OpenHands 沙箱集成相关的 IPC 通道，桥接渲染进程与沙箱服务层。
 *
 * 通道清单（与 preload/index.ts 中的 sandbox 命名空间对应）：
 * - sandbox:detect-docker — 检测 Docker Desktop 是否安装且运行
 * - sandbox:start         — 启动 OpenHands App Server 容器
 * - sandbox:stop          — 停止 OpenHands App Server 容器
 * - sandbox:status        — 获取当前沙箱集成状态（Docker + OpenHands 健康）
 * - sandbox:create        — 创建新沙箱（启动一个隔离 Docker 容器）
 * - sandbox:list          — 列出当前用户的所有沙箱
 * - sandbox:execute       — 在指定沙箱内执行 shell 命令（HC-6 始终审批）
 * - sandbox:delete        — 删除指定沙箱（不可逆）
 *
 * 配置来源：
 * - baseUrl / port 等从 ConfigStore 读取（key: 'sandboxConfig'），
 *   未配置时使用默认值（http://localhost:3000）。
 * - 不 hardcode API URL（HC：可配置化）。
 *
 * 设计风格与现有 agent-runtime.ts / deploy.ts 一致：
 * - 错误对象统一为 { success: false, error: string }
 * - 成功对象直接返回业务数据
 * - 所有调用通过 logger 记录（HC-1 网络日志可见）
 *
 * 方案书依据：v0.9 §8（沙箱集成）+ §11.2（IPC 命名规范）
 */

import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'node:path'
import { SANDBOX } from '@shared/ipc-channels'
import { detectDockerDesktop, type DockerInfo } from '../services/sandbox/docker-detector'
import { OpenHandsRunner } from '../services/sandbox/openhands-runner'
import {
  OpenHandsClient,
  OpenHandsApiError,
} from '../services/sandbox/openhands-client'
import {
  OPENHANDS_DEFAULT_BASE_URL,
  OPENHANDS_DEFAULT_PORT,
  type OpenHandsClientConfig,
  type SandboxCommandResult,
  type SandboxHealthStatus,
  type SandboxInfo,
  type SandboxPage,
} from '../services/sandbox/types'
import { logger } from '../services/log/logger'
// AST 危险命令识别（tree-sitter-bash，覆盖 6 类绕过，AST 失败时降级到正则）
import { assessWithAst } from '../core/risk-engine-ast'
// v0.9.4 新增：session-registry 集中维护 sessionId → AbortController Map，支持 abort signal + TTL 清理
import { getSessionRegistry } from '../core/agent/session-registry'

/**
 * 持久化的沙箱配置（存储在 ConfigStore 中，key='sandboxConfig'）
 */
interface PersistedSandboxConfig {
  baseUrl?: string
  port?: number
  composeFilePath?: string
  authToken?: string
  timeoutMs?: number
}

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
const sessionKeyMap = new Map<string, string>()

/** 待审批的 sandbox 命令调用池（callId → Promise resolver） */
interface PendingSandboxApproval {
  resolve: (approved: boolean) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}
const pendingSandboxApprovals = new Map<string, PendingSandboxApproval>()

/** 审批请求推送通道（主 → 渲染，单向） */
const SANDBOX_APPROVAL_CHANNEL = 'sandbox:approval-request'
/** 审批超时（30 秒，与 llm-tools.ts 保持一致） */
const SANDBOX_APPROVAL_TIMEOUT_MS = 30_000

/** 命令危险度评级 */
type CommandRiskLevel = 'low' | 'medium' | 'high'

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
async function assessCommandRisk(
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
function assessCommandRiskRegex(
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
function safeSend(mainWindow: BrowserWindow, channel: string, ...args: unknown[]): void {
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
function waitForSandboxApproval(
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
function cacheAndRedactSessionKey(info: SandboxInfo): SandboxInfo {
  if (info.session_api_key) {
    sessionKeyMap.set(info.id, info.session_api_key)
    logger.debug('IPC.SANDBOX', 'session_api_key 已缓存到主进程（不暴露给渲染进程）', {
      sandboxId: info.id,
    })
  }
  return { ...info, session_api_key: null }
}

// ============================================================================
// 模块级单例（避免每次 IPC 调用都重建 client/runner）
// ============================================================================

let cachedRunner: OpenHandsRunner | null = null
let cachedClient: OpenHandsClient | null = null

/**
 * 从 ConfigStore 读取沙箱配置（key='sandboxConfig'）
 *
 * 注意：ConfigStore 必须在 app.ready 后使用，
 *      本函数只在 IPC handler 内调用（IPC 注册在 whenReady 之后），安全。
 */
function readSandboxConfig(): PersistedSandboxConfig {
  try {
    // 动态 require 避免顶层依赖 ConfigStore（ConfigStore 必须在 app.ready 后使用）
    // 这里使用动态 import 的等价形式：直接 require
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ConfigStore } = require('../services/storage/config-store') as {
      ConfigStore: { get: (key: string) => unknown }
    }
    const cfg = ConfigStore.get('sandboxConfig') as PersistedSandboxConfig | undefined
    return cfg ?? {}
  } catch (err) {
    logger.warn('IPC.SANDBOX', '读取 sandboxConfig 失败，使用默认值', {
      error: (err as Error).message,
    })
    return {}
  }
}

/**
 * 解析 docker-compose.yml 路径
 *
 * 开发环境：src/main/resources/sandbox/openhands/docker-compose.yml
 * 生产环境：process.resourcesPath/sandbox/openhands/docker-compose.yml
 */
function resolveComposeFilePath(configured?: string): string {
  if (configured) return configured
  // 生产环境：electron-builder 会把 resources/ 目录打包到 process.resourcesPath
  if (process.env.NODE_ENV === 'production' && process.resourcesPath) {
    return path.join(process.resourcesPath, 'sandbox', 'openhands', 'docker-compose.yml')
  }
  // 开发环境：从源码目录解析
  // __dirname 在编译后为 out/main/ipc，需要回退 4 层到 src/main
  return path.resolve(__dirname, '..', '..', 'resources', 'sandbox', 'openhands', 'docker-compose.yml')
}

/**
 * 获取（惰性初始化）OpenHandsRunner 单例
 */
function getRunner(): OpenHandsRunner {
  if (cachedRunner) return cachedRunner
  const cfg = readSandboxConfig()
  cachedRunner = new OpenHandsRunner({
    composeFilePath: resolveComposeFilePath(cfg.composeFilePath),
    port: cfg.port ?? OPENHANDS_DEFAULT_PORT,
    baseUrl: cfg.baseUrl ?? OPENHANDS_DEFAULT_BASE_URL,
  })
  return cachedRunner
}

/**
 * 获取（惰性初始化）OpenHandsClient 单例
 */
function getClient(): OpenHandsClient {
  if (cachedClient) return cachedClient
  const cfg = readSandboxConfig()
  const clientConfig: OpenHandsClientConfig = {
    baseUrl: cfg.baseUrl ?? OPENHANDS_DEFAULT_BASE_URL,
    timeoutMs: cfg.timeoutMs,
    authToken: cfg.authToken,
  }
  cachedClient = new OpenHandsClient(clientConfig)
  return cachedClient
}

/**
 * 重置缓存的 client/runner（配置变更时调用）
 *
 * 预留：后续如增加 sandbox:saveConfig 通道，可在保存后调用此函数。
 */
export function resetSandboxInstances(): void {
  cachedRunner = null
  cachedClient = null
  logger.info('IPC.SANDBOX', '已重置 OpenHands runner/client 实例（下次调用时重建）')
}

/**
 * 预热 sessionKeyMap 缓存（P-4 恢复方案 A）
 *
 * 主进程启动时调用，遍历 OpenHands 中所有 RUNNING 状态的沙箱，
 * 把 session_api_key 重新填入 sessionKeyMap，避免主进程重启后缓存丢失导致
 * sandbox:execute 返回 SESSION_KEY_MISSING。
 *
 * 调用时机：
 * 1. app.whenReady 之后、IPC 注册之前（最佳）
 * 2. 或 sandbox:status 健康检查通过之后（懒触发）
 *
 * 失败处理：
 * - OpenHands 未启动 / 健康检查失败 → 静默跳过（不阻塞应用启动）
 * - 部分沙箱 session_api_key 为 null（STARTING/PAUSED）→ 跳过该沙箱
 *
 * 调研依据：OpenHands 官方文档 + 源码确认
 * - Docker 模式：session_api_key 存储在容器 env OH_SESSION_API_KEYS_0，每次 search 都实时读取
 * - Remote 模式：DB 只存 hash，明文 key 由 runtime API 实时返回
 * - 详见调研报告：docs/OpenHands-list沙箱-session_api_key-调研报告.md
 */
export async function warmupSessionKeyCache(): Promise<void> {
  try {
    const client = getClient()
    // 拉取所有沙箱（limit=100 足够覆盖常见场景）
    const page = await client.searchSandboxes(100)
    let warmed = 0
    for (const item of page.items) {
      // 只缓存 RUNNING 状态且 key 非空的沙箱
      if (item.status === 'RUNNING' && item.session_api_key) {
        sessionKeyMap.set(item.id, item.session_api_key)
        warmed++
      }
    }
    if (warmed > 0) {
      logger.info('IPC.SANDBOX', `sessionKeyMap 预热完成（恢复 ${warmed} 个沙箱的 session_api_key）`, {
        totalSandboxes: page.items.length,
        warmed,
      })
    } else {
      logger.debug('IPC.SANDBOX', 'sessionKeyMap 预热完成（无 RUNNING 状态沙箱需恢复）')
    }
  } catch (err) {
    // OpenHands 未启动 / 健康检查失败 → 静默跳过（不阻塞应用启动）
    logger.warn('IPC.SANDBOX', 'sessionKeyMap 预热失败（OpenHands 可能未启动，跳过恢复）', {
      error: toErrorString(err),
    })
  }
}

/**
 * 统一错误转字符串（避免把 Error 对象直接序列化丢失 message）
 */
function toErrorString(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// ============================================================================
// IPC 错误响应类型
// ============================================================================

/** 失败响应（统一形态，渲染进程可直接判断 success 字段） */
interface ErrorResponse {
  success: false
  error: string
  code?: string
  /**
   * 会话 ID（v0.9.4 新增，可选）
   *
   * 主进程在 sandbox:execute 失败时回传 sessionId，便于渲染进程关联请求与失败响应。
   * 成功路径不携带 sessionId（SandboxCommandResult 不变，保持与 OpenHands API 一致）。
   */
  sessionId?: string
}

/**
 * 注册沙箱集成 IPC handlers
 *
 * 由 registerAllIpcHandlers 调用，在 app.whenReady 后注册一次。
 *
 * @param mainWindow 主窗口实例，用于推送审批请求到渲染进程（P-2：HC-6 强制审批）
 */
export function registerSandboxIpcHandlers(mainWindow: BrowserWindow): void {
  // ------------------------------------------------------------------
  // sandbox:approve — 用户审批响应（P-2：HC-6 强制审批）
  // ------------------------------------------------------------------
  // 参数：(callId: string, approved: boolean)
  // 返回：boolean（是否成功处理审批响应）
  ipcMain.handle(
    'sandbox:approve',
    async (_event, callId: string, approved: boolean): Promise<boolean> => {
      const pending = pendingSandboxApprovals.get(callId)
      if (!pending) {
        logger.warn('IPC.SANDBOX', 'sandbox:approve 收到未知 callId', { callId })
        return false
      }
      clearTimeout(pending.timeout)
      pendingSandboxApprovals.delete(callId)
      pending.resolve(approved)
      logger.info('IPC.SANDBOX', `sandbox:approve 用户${approved ? '批准' : '拒绝'}`, { callId })
      return true
    }
  )

  // ------------------------------------------------------------------
  // sandbox:detect-docker — 检测 Docker Desktop
  // ------------------------------------------------------------------
  ipcMain.handle(SANDBOX.DETECT_DOCKER, async (): Promise<DockerInfo> => {
    logger.info('IPC.SANDBOX', 'sandbox:detect-docker 调用')
    try {
      const info = await detectDockerDesktop()
      return info
    } catch (err) {
      logger.error('IPC.SANDBOX', 'sandbox:detect-docker 异常', {
        error: toErrorString(err),
      })
      return {
        installed: false,
        version: null,
        running: false,
        error: `检测异常：${toErrorString(err)}`,
      }
    }
  })

  // ------------------------------------------------------------------
  // sandbox:start — 启动 OpenHands App Server 容器
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sandbox:start',
    async (): Promise<{ success: true } | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:start 调用')
      try {
        const runner = getRunner()
        await runner.start()
        return { success: true }
      } catch (err) {
        logger.error('IPC.SANDBOX', 'sandbox:start 失败', {
          error: toErrorString(err),
        })
        return { success: false, error: toErrorString(err) }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:stop — 停止 OpenHands App Server 容器
  // ------------------------------------------------------------------
  ipcMain.handle(
    'sandbox:stop',
    async (): Promise<{ success: true } | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:stop 调用')
      try {
        const runner = getRunner()
        await runner.stop()
        return { success: true }
      } catch (err) {
        logger.error('IPC.SANDBOX', 'sandbox:stop 失败', {
          error: toErrorString(err),
        })
        return { success: false, error: toErrorString(err) }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:status — 获取沙箱集成状态
  // ------------------------------------------------------------------
  // 返回：{ dockerReady, dockerVersion, openhandsRunning, error? }
  ipcMain.handle(
    'sandbox:status',
    async (): Promise<SandboxHealthStatus> => {
      logger.debug('IPC.SANDBOX', 'sandbox:status 调用')

      // 1. 检测 Docker
      const docker = await detectDockerDesktop()
      if (!docker.running) {
        return {
          dockerReady: false,
          dockerVersion: docker.version,
          openhandsRunning: false,
          error: docker.error ?? 'Docker 未运行',
        }
      }

      // 2. 检测 OpenHands App Server
      try {
        const client = getClient()
        const openhandsRunning = await client.healthCheck()
        return {
          dockerReady: true,
          dockerVersion: docker.version,
          openhandsRunning,
          error: openhandsRunning ? undefined : 'OpenHands App Server 未运行',
        }
      } catch (err) {
        return {
          dockerReady: true,
          dockerVersion: docker.version,
          openhandsRunning: false,
          error: `OpenHands 健康检查异常：${toErrorString(err)}`,
        }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:create — 创建新沙箱
  // ------------------------------------------------------------------
  // 参数：(sandboxSpecId?: string)
  // 返回：SandboxInfo | ErrorResponse
  // 注意（P-4）：返回前抹除 session_api_key（设为 null），key 缓存在主进程 Map 中
  ipcMain.handle(
    'sandbox:create',
    async (_event, sandboxSpecId?: string): Promise<SandboxInfo | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:create 调用', { sandboxSpecId })
      try {
        const client = getClient()
        const info = await client.createSandbox(sandboxSpecId)
        // P-4 句柄模式：缓存 session_api_key 到主进程，抹除返回值中的 key
        return cacheAndRedactSessionKey(info)
      } catch (err) {
        const code = err instanceof OpenHandsApiError ? err.code : undefined
        logger.error('IPC.SANDBOX', 'sandbox:create 失败', {
          error: toErrorString(err),
          code,
        })
        return { success: false, error: toErrorString(err), code }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:list — 列出当前用户的所有沙箱
  // ------------------------------------------------------------------
  // 参数：(limit?: number)
  // 返回：SandboxPage | ErrorResponse
  // 注意（P-4）：返回前抹除所有 SandboxInfo 的 session_api_key
  ipcMain.handle(
    'sandbox:list',
    async (_event, limit?: number): Promise<SandboxPage | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:list 调用', { limit })
      try {
        const client = getClient()
        const page = await client.searchSandboxes(limit ?? 100)
        // P-4 句柄模式：缓存所有 session_api_key，抹除返回值
        const redactedItems = page.items.map(cacheAndRedactSessionKey)
        return { ...page, items: redactedItems }
      } catch (err) {
        const code = err instanceof OpenHandsApiError ? err.code : undefined
        logger.error('IPC.SANDBOX', 'sandbox:list 失败', {
          error: toErrorString(err),
          code,
        })
        return { success: false, error: toErrorString(err), code }
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:execute — 在沙箱内执行命令（P-2：HC-6 IPC 层强制审批）
  // ------------------------------------------------------------------
  // 参数：(sandboxId: string, command: string, sessionId?: string)
  //      - v0.9.4 新增第 3 个参数 sessionId（可选，未提供时主进程自动生成）
  //      - sessionApiKey 从主进程 sessionKeyMap 查找（P-4 句柄模式，不出主进程）
  // 返回：SandboxCommandResult | ErrorResponse
  //      - v0.9.4：ErrorResponse 携带 sessionId 字段（用于关联失败响应）
  //      - SandboxApprovalRequest 推送时携带 sessionId（UI 可显示并支持取消）
  //
  // 安全说明（P-2 修复）：
  // - HC-6 沙箱命令始终审批：本通道在 IPC 层强制 waitForSandboxApproval()
  // - 不依赖 UI 层"自觉"实现审批弹窗（避免 XSS 绕过）
  // - 命令危险度识别（low/medium/high）随审批请求推送，辅助 UI 展示
  // - 30 秒超时自动拒绝
  ipcMain.handle(
    'sandbox:execute',
    async (
      _event,
      sandboxId: string,
      command: string,
      sessionId?: string
    ): Promise<SandboxCommandResult | ErrorResponse> => {
      // v0.9.4：注册到 session-registry（如未提供 sessionId，registry 自动生成）
      // 用于追踪 sandbox:execute 会话状态，支持后续通过 sessionId 取消（如审批 pending 时主动取消）
      const registry = getSessionRegistry()
      const callId = `sbx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const resolvedSessionId = registry.register({
        sessionId,
        correlationId: callId,
        kind: 'sandbox:execute',
      })

      logger.info('IPC.SANDBOX', 'sandbox:execute 调用', {
        sandboxId,
        sessionId: resolvedSessionId,
        commandPreview: command.slice(0, 100),
      })
      try {
        if (!sandboxId || !command) {
          return {
            success: false,
            error: '参数缺失：sandboxId / command 均为必填',
            sessionId: resolvedSessionId,
          }
        }

        // P-4 句柄模式：从主进程 Map 查找 sessionApiKey
        const sessionApiKey = sessionKeyMap.get(sandboxId)
        if (!sessionApiKey) {
          logger.warn('IPC.SANDBOX', 'session_api_key 未在主进程缓存中找到', { sandboxId })
          return {
            success: false,
            error: 'session_api_key 未找到：沙箱可能已过期或主进程已重启，请重新调用 sandbox:create 或 sandbox:list 刷新缓存',
            code: 'SESSION_KEY_MISSING',
            sessionId: resolvedSessionId,
          }
        }

        // P-2 HC-6 强制审批：IPC 层推送审批请求，等待用户响应
        // v0.9.4：把 sessionId 附带在审批请求上，UI 可关联请求与响应、支持主动取消
        let approved: boolean
        try {
          approved = await waitForSandboxApproval(
            mainWindow,
            callId,
            sandboxId,
            command,
            resolvedSessionId
          )
        } catch (approvalErr) {
          // 审批超时或异常 → 拒绝执行
          logger.warn('IPC.SANDBOX', 'sandbox:execute 审批被拒绝/超时', {
            sandboxId,
            callId,
            sessionId: resolvedSessionId,
            error: (approvalErr as Error).message,
          })
          return {
            success: false,
            error: `命令执行被拒绝：${(approvalErr as Error).message}`,
            code: 'APPROVAL_DENIED',
            sessionId: resolvedSessionId,
          }
        }

        if (!approved) {
          logger.info('IPC.SANDBOX', '用户拒绝执行命令', { sandboxId, callId, sessionId: resolvedSessionId })
          return {
            success: false,
            error: '用户拒绝执行该命令',
            code: 'APPROVAL_DENIED',
            sessionId: resolvedSessionId,
          }
        }

        // 审批通过 → 执行命令
        const client = getClient()
        const result = await client.executeCommand(sandboxId, command, sessionApiKey)
        return result
      } catch (err) {
        const code = err instanceof OpenHandsApiError ? err.code : undefined
        logger.error('IPC.SANDBOX', 'sandbox:execute 失败', {
          sandboxId,
          sessionId: resolvedSessionId,
          error: toErrorString(err),
          code,
        })
        return { success: false, error: toErrorString(err), code, sessionId: resolvedSessionId }
      } finally {
        // sandbox:execute 是同步阻塞调用，结束时清理 session-registry
        registry.remove(resolvedSessionId)
      }
    }
  )

  // ------------------------------------------------------------------
  // sandbox:delete — 删除沙箱（P-4：清理 session_api_key 缓存）
  // ------------------------------------------------------------------
  // 参数：(sandboxId: string)
  // 返回：{ success: true } | ErrorResponse
  ipcMain.handle(
    'sandbox:delete',
    async (_event, sandboxId: string): Promise<{ success: true } | ErrorResponse> => {
      logger.info('IPC.SANDBOX', 'sandbox:delete 调用', { sandboxId })
      try {
        if (!sandboxId) {
          return { success: false, error: '参数缺失：sandboxId 为必填' }
        }
        const client = getClient()
        await client.deleteSandbox(sandboxId)
        // P-4 句柄模式：清理主进程 session_api_key 缓存
        sessionKeyMap.delete(sandboxId)
        logger.debug('IPC.SANDBOX', 'session_api_key 缓存已清理', { sandboxId })
        return { success: true }
      } catch (err) {
        const code = err instanceof OpenHandsApiError ? err.code : undefined
        logger.error('IPC.SANDBOX', 'sandbox:delete 失败', {
          sandboxId,
          error: toErrorString(err),
          code,
        })
        return { success: false, error: toErrorString(err), code }
      }
    }
  )

  logger.info('IPC.SANDBOX', 'Sandbox IPC handlers 已注册', {
    channels: [
      'sandbox:approve',
      'sandbox:approval-request',
      'sandbox:detect-docker',
      'sandbox:start',
      'sandbox:stop',
      'sandbox:status',
      'sandbox:create',
      'sandbox:list',
      'sandbox:execute',
      'sandbox:delete',
    ],
  })
}
