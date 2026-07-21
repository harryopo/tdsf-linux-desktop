/**
 * Ollama 模型自动检测（v0.9.4 批次 2 - 任务 1）
 *
 * 职责：
 * - 通过 Ollama `/api/tags` 接口自动检测本地可用模型列表
 * - 用户配置 Ollama Provider 时，无需手动输入模型名，自动从 `/api/tags` 拉取列表
 *
 * 设计要点：
 * - 默认 baseURL `http://localhost:11434`（Ollama 官方默认端口）
 * - 请求 `/api/tags` 接口，解析返回的 `models[].name`
 * - 超时 3 秒（本地服务，快速失败），失败返回空数组（不抛错，让 UI 显示"未检测到"）
 * - 使用原生 `fetch`（Electron 30 / Node 20+ 支持），不引入 axios 减少依赖
 *
 * 借鉴：ContinueDev `ollamaAutodetect` 实现（P0-24）
 * - 源码分析：`idea-to-dev-output/30-源码分析-ContinueDev-多模型调度与代码库索引.md`
 * - ContinueDev 通过相同接口实现自动检测，配置 Ollama Provider 时自动拉取模型列表
 *
 * 方案书依据：v0.9.3 §11 第 2 类（Provider 工厂增强）
 */
import { logger } from '../../../services/log/logger'

/**
 * Ollama 默认 baseURL（官方端口 11434）
 */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

/**
 * 自动检测请求超时（毫秒）
 *
 * 本地服务应快速响应，3 秒已足够；超时通常意味着 Ollama 未启动。
 */
const AUTODETECT_TIMEOUT_MS = 3000

/**
 * Ollama `/api/tags` 接口返回结构（最小子集）
 *
 * 完整结构包含 digest/size/modified_at 等字段，本函数仅需 name。
 */
interface OllamaTagsResponse {
  models?: Array<{ name: string }>
}

/**
 * 从 baseURL 提取根路径（去除可能的 `/v1` 后缀）
 *
 * Provider 配置中 baseURL 通常是 `http://localhost:11434/v1`（OpenAI 兼容端点），
 * 但 `/api/tags` 是 Ollama 原生端点，需要在根路径下访问。
 *
 * @param baseURL Provider 配置的 baseURL
 * @returns 根路径（如 `http://localhost:11434`）
 */
function normalizeBaseURL(baseURL: string): string {
  // 去除末尾斜杠
  let url = baseURL.trim().replace(/\/+$/, '')
  // 去除 /v1 /v2 等版本后缀
  url = url.replace(/\/v\d+$/, '')
  return url
}

/**
 * 自动检测本地 Ollama 可用模型列表
 *
 * 调用 `GET <baseURL>/api/tags`，解析返回的 `models[].name`。
 *
 * 行为约定：
 * - 成功：返回模型名数组（按 Ollama 返回顺序，去重）
 * - 失败（网络/超时/解析错误）：返回空数组 `[]`，不抛错
 * - baseURL 为空：使用默认 `http://localhost:11434`
 *
 * 日志策略：
 * - 成功：debug 级别（含 count + baseURL）
 * - 失败：warn 级别（含错误信息 + baseURL），便于用户诊断
 *
 * @param baseURL Ollama 服务地址（可选，默认 `http://localhost:11434`）
 * @returns 模型名数组，失败时返回空数组
 *
 * @example
 * ```ts
 * const models = await autodetectOllamaModels()
 * if (models.length === 0) {
 *   console.log('未检测到 Ollama 模型（服务未启动或无模型）')
 * } else {
 *   console.log('可用模型：', models) // ['qwen3:32b', 'llama3.3:70b', ...]
 * }
 * ```
 */
export async function autodetectOllamaModels(baseURL?: string): Promise<string[]> {
  const rawURL = baseURL && baseURL.trim().length > 0 ? baseURL : DEFAULT_OLLAMA_BASE_URL
  const rootURL = normalizeBaseURL(rawURL)
  const tagsURL = `${rootURL}/api/tags`

  try {
    // 使用 AbortController 实现 3 秒超时（fetch 原生不支持 timeout 参数）
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), AUTODETECT_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(tagsURL, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      logger.warn(
        'AGENT.PROVIDER',
        'Ollama AUTODETECT HTTP 错误',
        {
          baseURL: rootURL,
          status: response.status,
          statusText: response.statusText,
        }
      )
      return []
    }

    const data = (await response.json()) as OllamaTagsResponse
    const models = Array.isArray(data?.models) ? data.models : []

    // 提取 name 字段，过滤无效条目，去重
    const names: string[] = []
    const seen = new Set<string>()
    for (const m of models) {
      if (typeof m?.name === 'string' && m.name.length > 0 && !seen.has(m.name)) {
        seen.add(m.name)
        names.push(m.name)
      }
    }

    logger.debug(
      'AGENT.PROVIDER',
      'Ollama AUTODETECT',
      {
        count: names.length,
        baseURL: rootURL,
      }
    )

    return names
  } catch (err) {
    // 失败原因通常是：Ollama 未启动 / 端口占用 / 网络隔离
    // 不抛错，让 UI 显示"未检测到"
    const errObj = err as Error
    logger.warn(
      'AGENT.PROVIDER',
      'Ollama AUTODETECT 失败',
      {
        baseURL: rootURL,
        error: errObj?.message ?? String(err),
        // AbortError 时给出更友好的提示
        aborted: errObj?.name === 'AbortError',
      }
    )
    return []
  }
}
