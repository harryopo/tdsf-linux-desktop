/**
 * Sandbox 配置与单例管理（从 sandbox.ts 抽出，保持主文件 ≤500 行）
 *
 * 包含：
 * - PersistedSandboxConfig / ErrorResponse 类型
 * - ConfigStore 读取（readSandboxConfig）
 * - docker-compose 路径解析（resolveComposeFilePath）
 * - OpenHandsRunner / OpenHandsClient 单例（getRunner / getClient）
 * - 实例重置（resetSandboxInstances）
 * - sessionKeyMap 预热（warmupSessionKeyCache）
 * - 错误转字符串工具（toErrorString）
 *
 * 详见主文件 sandbox.ts 顶部注释。
 */

import * as path from 'node:path'
import { OpenHandsRunner } from '../services/sandbox/openhands-runner'
import { OpenHandsClient } from '../services/sandbox/openhands-client'
import {
  OPENHANDS_DEFAULT_BASE_URL,
  OPENHANDS_DEFAULT_PORT,
  type OpenHandsClientConfig,
  type SandboxInfo,
} from '../services/sandbox/types'
import { logger } from '../services/log/logger'
import { sessionKeyMap } from './sandbox-approval'

/**
 * 持久化的沙箱配置（存储在 ConfigStore 中，key='sandboxConfig'）
 */
export interface PersistedSandboxConfig {
  baseUrl?: string
  port?: number
  composeFilePath?: string
  authToken?: string
  timeoutMs?: number
}

// ============================================================================
// IPC 错误响应类型
// ============================================================================

/** 失败响应（统一形态，渲染进程可直接判断 success 字段） */
export interface ErrorResponse {
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
export function getRunner(): OpenHandsRunner {
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
export function getClient(): OpenHandsClient {
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
export function toErrorString(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// 重新导出 SandboxInfo 类型（供主文件使用，避免主文件重复 import）
export type { SandboxInfo }
