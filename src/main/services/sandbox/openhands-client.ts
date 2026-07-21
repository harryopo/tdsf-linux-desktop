/**
 * OpenHands REST API 客户端（v0.9 新增）
 *
 * 完整实现 OpenHands App Server 的沙箱生命周期 + 沙箱内执行 + Secret 管理 API。
 *
 * 路由清单（与 sandbox_router.py 一一对应）：
 * - GET    /sandboxes/search                            → searchSandboxes
 * - GET    /sandboxes?id=xxx                            → batchGetSandbox（未实现，预留）
 * - GET    /sandboxes/{sandbox_id}                      → getSandbox
 * - POST   /sandboxes?sandbox_spec_id=xxx               → createSandbox
 * - POST   /sandboxes/{sandbox_id}/pause                → pauseSandbox
 * - POST   /sandboxes/{sandbox_id}/resume               → resumeSandbox
 * - DELETE /sandboxes/{sandbox_id}                       → deleteSandbox
 * - GET    /sandboxes/{sandbox_id}/settings/secrets     → listSecrets（X-Session-API-Key）
 * - GET    /sandboxes/{sandbox_id}/settings/secrets/{n} → getSecret（X-Session-API-Key）
 *
 * 沙箱内执行（通过 exposed_urls[AGENT_SERVER].url 转发到 agent_server）：
 * - POST   /execute                                      → executeCommand
 * - POST   /read_file                                    → readFile
 * - POST   /write_file                                   → writeFile
 *
 * 鉴权机制：
 * - 用户级：cookie / OAuth token（本地模式下默认不校验）
 * - 沙箱级：X-Session-API-Key HTTP Header（由 createSandbox 返回的 session_api_key 提供）
 *
 * 方案书依据：v0.9 §8（沙箱集成）+ 源码分析报告 §四（Sandbox REST API 路由）
 *            + §六（沙箱内 Agent Server）+ §七（Action / Observation 协议）
 */

import { logger } from '../log/logger'
import {
  AGENT_SERVER_NAME,
  DEFAULT_SANDBOX_SPEC_ID,
  OPENHANDS_DEFAULT_BASE_URL,
  type ExposedUrl,
  type OpenHandsClientConfig,
  type SandboxCommandResult,
  type SandboxInfo,
  type SandboxPage,
  type SecretNameItem,
} from './types'

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * OpenHands API 错误
 *
 * 区分网络错误 / 鉴权错误 / 资源不存在 / 服务器错误，
 * 便于上层（IPC / Tool）做差异化处理。
 */
export class OpenHandsApiError extends Error {
  /** HTTP 状态码（网络错误时为 0） */
  readonly statusCode: number
  /** 错误码（NETWORK / AUTH / NOT_FOUND / SERVER / UNKNOWN） */
  readonly code: 'NETWORK' | 'AUTH' | 'NOT_FOUND' | 'SERVER' | 'UNKNOWN'

  constructor(
    message: string,
    statusCode: number,
    code: 'NETWORK' | 'AUTH' | 'NOT_FOUND' | 'SERVER' | 'UNKNOWN'
  ) {
    super(message)
    this.name = 'OpenHandsApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

/**
 * OpenHands REST API 客户端
 *
 * 使用方式：
 * ```ts
 * const client = new OpenHandsClient({ baseUrl: 'http://localhost:3000' })
 * const sandbox = await client.createSandbox()
 * const result = await client.executeCommand(sandbox.id, 'ls -la', sandbox.session_api_key!)
 * ```
 */
export class OpenHandsClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly authToken?: string

  /**
   * @param configOrBaseUrl 配置对象或基地址字符串（字符串形式保留以兼容文档示例）
   */
  constructor(configOrBaseUrl?: OpenHandsClientConfig | string) {
    if (typeof configOrBaseUrl === 'string') {
      this.baseUrl = configOrBaseUrl
      this.timeoutMs = DEFAULT_TIMEOUT_MS
    } else {
      this.baseUrl = configOrBaseUrl?.baseUrl ?? OPENHANDS_DEFAULT_BASE_URL
      this.timeoutMs = configOrBaseUrl?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      this.authToken = configOrBaseUrl?.authToken
    }
  }

  // ========================================================================
  // 沙箱生命周期
  // ========================================================================

  /**
   * 创建（启动）新沙箱
   *
   * 对应：POST /sandboxes?sandbox_spec_id=xxx
   *
   * @param sandboxSpecId 沙箱规格 ID（不传用 OpenHands 默认规格）
   * @returns SandboxInfo（status 通常为 STARTING，需轮询等待 RUNNING）
   */
  async createSandbox(sandboxSpecId?: string): Promise<SandboxInfo> {
    const url = new URL('/sandboxes', this.baseUrl)
    if (sandboxSpecId) {
      url.searchParams.set('sandbox_spec_id', sandboxSpecId)
    }
    const body = await this.request<SandboxInfo>('POST', url, {
      search: sandboxSpecId ? { sandbox_spec_id: sandboxSpecId } : undefined,
    })
    logger.info('IPC.SANDBOX', '沙箱已创建', {
      sandboxId: body.id,
      status: body.status,
      specId: sandboxSpecId ?? DEFAULT_SANDBOX_SPEC_ID,
    })
    return body
  }

  /**
   * 获取单个沙箱信息
   *
   * 对应：GET /sandboxes/{sandbox_id}
   *
   * @param sandboxId 沙箱 ID
   * @returns SandboxInfo 或 null（不存在时）
   */
  async getSandbox(sandboxId: string): Promise<SandboxInfo | null> {
    try {
      const url = new URL(`/sandboxes/${encodeURIComponent(sandboxId)}`, this.baseUrl)
      return await this.request<SandboxInfo>('GET', url)
    } catch (err) {
      if (err instanceof OpenHandsApiError && err.code === 'NOT_FOUND') {
        return null
      }
      throw err
    }
  }

  /**
   * 暂停沙箱
   *
   * 对应：POST /sandboxes/{sandbox_id}/pause
   *
   * @param sandboxId 沙箱 ID
   */
  async pauseSandbox(sandboxId: string): Promise<void> {
    const url = new URL(
      `/sandboxes/${encodeURIComponent(sandboxId)}/pause`,
      this.baseUrl
    )
    await this.request('POST', url)
    logger.info('IPC.SANDBOX', '沙箱已暂停', { sandboxId })
  }

  /**
   * 恢复沙箱
   *
   * 对应：POST /sandboxes/{sandbox_id}/resume
   *
   * @param sandboxId 沙箱 ID
   */
  async resumeSandbox(sandboxId: string): Promise<void> {
    const url = new URL(
      `/sandboxes/${encodeURIComponent(sandboxId)}/resume`,
      this.baseUrl
    )
    await this.request('POST', url)
    logger.info('IPC.SANDBOX', '沙箱已恢复', { sandboxId })
  }

  /**
   * 删除沙箱
   *
   * 对应：DELETE /sandboxes/{sandbox_id}
   *
   * 注意：删除是不可逆操作，工作区数据将丢失（除非已归档）。
   *
   * @param sandboxId 沙箱 ID
   */
  async deleteSandbox(sandboxId: string): Promise<void> {
    const url = new URL(
      `/sandboxes/${encodeURIComponent(sandboxId)}`,
      this.baseUrl
    )
    await this.request('DELETE', url)
    logger.info('IPC.SANDBOX', '沙箱已删除', { sandboxId })
  }

  /**
   * 列出当前用户的沙箱（分页）
   *
   * 对应：GET /sandboxes/search?page_id=xxx&limit=100
   *
   * @param limit 每页数量（1-100，默认 100）
   * @returns SandboxPage（含 items + next_page_id）
   */
  async searchSandboxes(limit: number = 100): Promise<SandboxPage> {
    const url = new URL('/sandboxes/search', this.baseUrl)
    url.searchParams.set('limit', String(limit))
    return await this.request<SandboxPage>('GET', url)
  }

  // ========================================================================
  // 沙箱内执行（通过 agent_server）
  // ========================================================================

  /**
   * 在沙箱内执行 shell 命令
   *
   * 流程：
   * 1. 通过 getSandbox 获取沙箱信息
   * 2. 从 exposed_urls 中找 AGENT_SERVER 的 URL
   * 3. POST {agentServerUrl}/execute，带 X-Session-API-Key Header
   *
   * @param sandboxId 沙箱 ID
   * @param command 要执行的 shell 命令
   * @param sessionApiKey 沙箱访问 Key（createSandbox 返回的 session_api_key）
   * @returns SandboxCommandResult（stdout / stderr / exitCode）
   */
  async executeCommand(
    sandboxId: string,
    command: string,
    sessionApiKey: string
  ): Promise<SandboxCommandResult> {
    const agentServerUrl = await this.resolveAgentServerUrl(sandboxId)
    const url = new URL('/execute', agentServerUrl)

    logger.info('IPC.SANDBOX', '执行沙箱命令', {
      sandboxId,
      commandPreview: command.slice(0, 100),
      agentServerUrl,
    })

    const startTs = Date.now()
    const raw = await this.request<{
      output?: string
      stdout?: string
      stderr?: string
      exit_code?: number
      exitCode?: number
      content?: string
      success?: boolean
    }>('POST', url, {
      body: { command },
      sessionApiKey,
    })

    const durationMs = Date.now() - startTs
    const result: SandboxCommandResult = {
      stdout: raw.stdout ?? raw.output ?? raw.content ?? '',
      stderr: raw.stderr ?? '',
      exitCode: raw.exit_code ?? raw.exitCode ?? (raw.success === false ? 1 : 0),
      durationMs,
    }

    logger.info('IPC.SANDBOX', '沙箱命令执行完成', {
      sandboxId,
      exitCode: result.exitCode,
      durationMs,
    })
    return result
  }

  /**
   * 读取沙箱内文件内容
   *
   * 对应：POST {agentServerUrl}/read_file
   *
   * @param sandboxId 沙箱 ID
   * @param filePath 文件绝对路径（沙箱内）
   * @param sessionApiKey 沙箱访问 Key
   * @returns 文件内容（UTF-8 字符串）
   */
  async readFile(
    sandboxId: string,
    filePath: string,
    sessionApiKey: string
  ): Promise<string> {
    const agentServerUrl = await this.resolveAgentServerUrl(sandboxId)
    const url = new URL('/read_file', agentServerUrl)

    logger.debug('IPC.SANDBOX', '读取沙箱文件', { sandboxId, filePath })

    const raw = await this.request<{
      content?: string
      file_text?: string
      output?: string
    }>('POST', url, {
      body: { path: filePath, file_path: filePath },
      sessionApiKey,
    })

    return raw.content ?? raw.file_text ?? raw.output ?? ''
  }

  /**
   * 写入沙箱内文件
   *
   * 对应：POST {agentServerUrl}/write_file
   *
   * @param sandboxId 沙箱 ID
   * @param filePath 文件绝对路径（沙箱内）
   * @param content 文件内容（UTF-8 字符串）
   * @param sessionApiKey 沙箱访问 Key
   */
  async writeFile(
    sandboxId: string,
    filePath: string,
    content: string,
    sessionApiKey: string
  ): Promise<void> {
    const agentServerUrl = await this.resolveAgentServerUrl(sandboxId)
    const url = new URL('/write_file', agentServerUrl)

    logger.debug('IPC.SANDBOX', '写入沙箱文件', {
      sandboxId,
      filePath,
      sizeBytes: content.length,
    })

    await this.request('POST', url, {
      body: { path: filePath, file_path: filePath, content, file_text: content },
      sessionApiKey,
    })
  }

  // ========================================================================
  // Secret 管理
  // ========================================================================

  /**
   * 列出沙箱可用的 Secret 名称
   *
   * 对应：GET /sandboxes/{sandbox_id}/settings/secrets
   *
   * 注意：仅返回名称与描述，**不含值**（HC-6 敏感文件 redact）。
   *
   * @param sandboxId 沙箱 ID
   * @param sessionApiKey 沙箱访问 Key
   * @returns SecretNameItem[]（仅名称，不含值）
   */
  async listSecrets(
    sandboxId: string,
    sessionApiKey: string
  ): Promise<SecretNameItem[]> {
    const url = new URL(
      `/sandboxes/${encodeURIComponent(sandboxId)}/settings/secrets`,
      this.baseUrl
    )
    const resp = await this.request<{ secrets: SecretNameItem[] }>('GET', url, {
      sessionApiKey,
    })
    return resp.secrets ?? []
  }

  /**
   * 获取单个 Secret 的值
   *
   * 对应：GET /sandboxes/{sandbox_id}/settings/secrets/{secret_name}
   *
   * 响应为 text/plain，直接返回原始字符串。
   * 注意：调用方需自行确保不把返回值传给 LLM（HC-6）。
   *
   * @param sandboxId 沙箱 ID
   * @param secretName Secret 名称
   * @param sessionApiKey 沙箱访问 Key
   * @returns Secret 值（明文字符串）
   */
  async getSecret(
    sandboxId: string,
    secretName: string,
    sessionApiKey: string
  ): Promise<string> {
    const url = new URL(
      `/sandboxes/${encodeURIComponent(sandboxId)}/settings/secrets/${encodeURIComponent(secretName)}`,
      this.baseUrl
    )
    return await this.requestRawText('GET', url, { sessionApiKey })
  }

  // ========================================================================
  // 健康检查
  // ========================================================================

  /**
   * 健康检查
   *
   * 调用 GET /alive，200 响应视为健康。
   * 用于 OpenHandsRunner.waitForReady + UI 状态展示。
   *
   * @returns true = 健康，false = 不可达
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = new URL('/alive', this.baseUrl)
      const resp = await this.doFetch('GET', url, { timeoutMs: 3_000 })
      return resp.ok
    } catch (err) {
      logger.debug('IPC.SANDBOX', 'healthCheck 失败', {
        error: (err as Error).message,
        baseUrl: this.baseUrl,
      })
      return false
    }
  }

  // ========================================================================
  // 私有方法
  // ========================================================================

  /**
   * 解析沙箱的 AGENT_SERVER URL
   *
   * 1. getSandbox 获取 exposed_urls
   * 2. 找 name === 'AGENT_SERVER' 的项
   * 3. 未找到则抛错（沙箱未就绪或异常状态）
   */
  private async resolveAgentServerUrl(sandboxId: string): Promise<string> {
    const sandbox = await this.getSandbox(sandboxId)
    if (!sandbox) {
      throw new OpenHandsApiError(
        `沙箱不存在：${sandboxId}`,
        404,
        'NOT_FOUND'
      )
    }
    if (sandbox.status !== 'RUNNING') {
      throw new OpenHandsApiError(
        `沙箱未就绪（当前状态：${sandbox.status}），请等待 RUNNING 后再执行`,
        409,
        'SERVER'
      )
    }
    const agentServer = (sandbox.exposed_urls ?? []).find(
      (u: ExposedUrl) => u.name === AGENT_SERVER_NAME
    )
    if (!agentServer) {
      throw new OpenHandsApiError(
        `沙箱未暴露 AGENT_SERVER（exposed_urls 为空或缺失），无法执行命令`,
        409,
        'SERVER'
      )
    }
    return agentServer.url
  }

  /**
   * 统一的 JSON 请求方法
   *
   * @param method HTTP 方法
   * @param url 完整 URL
   * @param options 请求选项（body / sessionApiKey / search / timeoutMs）
   * @returns 解析后的 JSON 响应
   * @throws OpenHandsApiError
   */
  private async request<T>(
    method: string,
    url: URL,
    options?: {
      body?: unknown
      sessionApiKey?: string
      search?: Record<string, string>
      timeoutMs?: number
    }
  ): Promise<T> {
    // 合并 query 参数
    if (options?.search) {
      for (const [k, v] of Object.entries(options.search)) {
        url.searchParams.set(k, v)
      }
    }

    const resp = await this.doFetch(method, url, options)
    if (!resp.ok) {
      await this.throwHttpError(resp)
    }

    // 处理空响应（DELETE / POST 可能返回空 body）
    const text = await resp.text()
    if (!text) {
      return undefined as unknown as T
    }
    try {
      return JSON.parse(text) as T
    } catch {
      // 非 JSON 响应，原样返回字符串
      return text as unknown as T
    }
  }

  /**
   * 请求并返回原始文本（用于 text/plain 响应，如 getSecret）
   */
  private async requestRawText(
    method: string,
    url: URL,
    options?: { sessionApiKey?: string; timeoutMs?: number }
  ): Promise<string> {
    const resp = await this.doFetch(method, url, options)
    if (!resp.ok) {
      await this.throwHttpError(resp)
    }
    return await resp.text()
  }

  /**
   * 底层 fetch 封装（统一超时 + Header + 错误转换）
   */
  private async doFetch(
    method: string,
    url: URL,
    options?: { body?: unknown; sessionApiKey?: string; timeoutMs?: number }
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
    }
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }
    if (options?.sessionApiKey) {
      headers['X-Session-API-Key'] = options.sessionApiKey
    }

    let body: string | undefined
    if (options?.body !== undefined) {
      body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      headers['Content-Type'] = 'application/json'
    }

    const timeout = options?.timeoutMs ?? this.timeoutMs

    try {
      const resp = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeout),
      })
      return resp
    } catch (err) {
      const e = err as Error
      // 网络错误 / 超时 / DNS 解析失败
      const isTimeout = e.name === 'TimeoutError' || e.name === 'AbortError'
      throw new OpenHandsApiError(
        isTimeout
          ? `OpenHands API 请求超时（${timeout}ms）：${url.toString()}`
          : `OpenHands API 网络错误：${e.message}`,
        0,
        'NETWORK'
      )
    }
  }

  /**
   * 从 HTTP 响应构造错误并抛出
   */
  private async throwHttpError(resp: Response): Promise<never> {
    let detail = ''
    try {
      const text = await resp.text()
      try {
        const json = JSON.parse(text)
        detail = json.detail ?? json.message ?? text
      } catch {
        detail = text
      }
    } catch {
      detail = resp.statusText
    }
    detail = (detail || '').slice(0, 300)

    let code: 'AUTH' | 'NOT_FOUND' | 'SERVER' | 'UNKNOWN'
    if (resp.status === 401 || resp.status === 403) {
      code = 'AUTH'
    } else if (resp.status === 404) {
      code = 'NOT_FOUND'
    } else if (resp.status >= 500) {
      code = 'SERVER'
    } else {
      code = 'UNKNOWN'
    }

    throw new OpenHandsApiError(
      `OpenHands API [${resp.status}] ${detail}`,
      resp.status,
      code
    )
  }
}

/**
 * 默认 Client 实例
 *
 * 使用 http://localhost:3000 作为基地址。
 * 应用启动时如需从配置覆盖，应在 IPC 层重新 new 一个实例。
 */
export const defaultOpenHandsClient = new OpenHandsClient()
