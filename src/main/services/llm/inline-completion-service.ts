/**
 * InlineCompletionService — 主进程内联代码补全服务（v2.0 Phase B · Task B.1）
 *
 * // @ai-session: ai-glm-20260722-phaseB-v2.0
 * // @ai-task: phaseB-inline-completion
 *
 * 职责：调用 ClaudeSdkProvider 生成补全，含 LRU 缓存(100) + 限流(5) + 5s 超时 + 取消
 * 调用链：渲染层 InlineCompletionProvider → IPC llm:inline-completion → 本服务 → ClaudeSdkProvider.generate
 */
import { createHash } from 'node:crypto'
import { ClaudeSdkProvider } from '../../core/agent/claude-sdk'
import { getProviderWithApiKey, getDefaultProviderId } from '../../core/agent/providers/provider-registry'
import { logger } from '../log/logger'
import { redactSecrets } from '../../core/agent/providers/redact'

/** 内联补全请求参数（与渲染层 InlineCompletionRequest 一致） */
export interface InlineCompletionRequest {
  filePath: string
  language: string
  content: string
  cursorLineNumber: number
  cursorColumn: number
  contextBefore?: string
  contextAfter?: string
}

/** 单条补全项（与 Monaco InlineCompletion item 结构兼容） */
export interface InlineCompletionItem {
  insertText: string
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
}

/** LRU 缓存条目 */
interface CacheEntry {
  items: InlineCompletionItem[]
  timestamp: number
}

/** 补全超时（ms） */
const COMPLETION_TIMEOUT_MS = 5_000
/** LRU 缓存上限 */
const LRU_MAX_SIZE = 100
/** 未决补全上限（限流） */
const MAX_PENDING = 5
/** 补全 prompt 模板 */
const PROMPT_TEMPLATE =
  '你是一位运维代码补全助手。根据以下代码上下文，补全光标位置后的代码。只返回补全内容，不要解释。\n\n' +
  '文件: {filePath}\n语言: {language}\n光标位置: 行{line}, 列{col}\n\n' +
  '上下文前:\n{contextBefore}\n\n上下文后:\n{contextAfter}\n\n补全内容:'

/**
 * 构造补全 prompt
 * @param req 补全请求
 */
function buildPrompt(req: InlineCompletionRequest): string {
  return PROMPT_TEMPLATE
    .replace('{filePath}', req.filePath)
    .replace('{language}', req.language)
    .replace('{line}', String(req.cursorLineNumber))
    .replace('{col}', String(req.cursorColumn))
    .replace('{contextBefore}', req.contextBefore ?? '(无)')
    .replace('{contextAfter}', req.contextAfter ?? '(无)')
}

/**
 * 计算内容哈希（用于 LRU key，避免大字符串直接作为 key）
 * @param content 文件内容
 */
function hashContent(content: string): string {
  return createHash('md5').update(content).digest('hex').slice(0, 16)
}

/**
 * InlineCompletionService — 内联补全服务单例
 *
 * 使用方式：
 * - getCompletion(req)：获取补全（含缓存 + 限流 + 超时）
 * - cancel()：取消所有进行中的请求
 */
export class InlineCompletionService {
  /** LRU 缓存（Map 保持插入顺序，超限时删除最早条目） */
  private readonly cache = new Map<string, CacheEntry>()
  /** 进行中的请求 correlationId 集合（用于限流 + 取消） */
  private readonly pending = new Set<string>()
  /** ClaudeSdkProvider 实例缓存（providerId → 实例） */
  private providerCache = new Map<string, ClaudeSdkProvider>()

  /**
   * 获取或创建 ClaudeSdkProvider 实例
   * 优先使用默认 claude-sdk 类型 Provider
   */
  private getProvider(): ClaudeSdkProvider {
    // 1. 优先复用已缓存实例
    for (const provider of this.providerCache.values()) {
      return provider
    }
    // 2. 查找默认 Provider
    const defaultId = getDefaultProviderId()
    const candidates = [defaultId, 'claude', 'claude-sdk'].filter(Boolean) as string[]
    for (const id of candidates) {
      const config = getProviderWithApiKey(id)
      if (config && config.type === 'claude-sdk' && config.apiKey) {
        const provider = new ClaudeSdkProvider(config)
        this.providerCache.set(id, provider)
        logger.info('LLM.INLINE', 'InlineCompletionService 已绑定 Provider', {
          providerId: id,
          model: config.model,
        })
        return provider
      }
    }
    throw new Error('未找到可用的 claude-sdk 类型 Provider，请在设置中配置 Anthropic API Key')
  }

  /**
   * 获取补全（含缓存 + 限流 + 超时）
   * @param req 补全请求
   * @returns 补全项列表（空数组表示无补全或超时/出错）
   */
  async getCompletion(req: InlineCompletionRequest): Promise<InlineCompletionItem[]> {
    // 1. 限流检查
    if (this.pending.size >= MAX_PENDING) {
      logger.warn('LLM.INLINE', '补全请求被限流（未决请求过多）', {
        pending: this.pending.size,
        filePath: req.filePath,
      })
      return []
    }

    // 2. LRU 缓存命中检查
    const cacheKey = `${req.filePath}::${req.cursorLineNumber}:${req.cursorColumn}::${hashContent(req.content)}`
    const cached = this.cache.get(cacheKey)
    if (cached) {
      // LRU：命中时移到末尾（最近使用）
      this.cache.delete(cacheKey)
      this.cache.set(cacheKey, cached)
      return cached.items
    }

    // 3. 构造 correlationId 并注册到 pending
    const correlationId = `ic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.pending.add(correlationId)

    try {
      const provider = this.getProvider()
      const prompt = buildPrompt(req)

      // 4. 超时控制：5 秒超时返回空数组
      const result = await Promise.race([
        provider.generate({
          prompt,
          strength: 'fast',
          correlationId,
          systemPrompt: '你是代码补全助手，只返回补全代码，不要解释、不要 markdown 代码块标记。',
          includePartialMessages: false,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('INLINE_COMPLETION_TIMEOUT')), COMPLETION_TIMEOUT_MS),
        ),
      ])

      // 5. 提取补全文本（去除可能的 markdown 代码块标记）
      const insertText = this.extractCompletion(result.text)
      if (!insertText) {
        return []
      }

      // 6. 构造补全项（range = 光标位置起，零长度插入点）
      const items: InlineCompletionItem[] = [
        {
          insertText,
          range: {
            startLineNumber: req.cursorLineNumber,
            startColumn: req.cursorColumn,
            endLineNumber: req.cursorLineNumber,
            endColumn: req.cursorColumn,
          },
        },
      ]

      // 7. 写入 LRU 缓存（超限删除最早条目）
      if (this.cache.size >= LRU_MAX_SIZE) {
        const oldestKey = this.cache.keys().next().value
        if (oldestKey) this.cache.delete(oldestKey)
      }
      this.cache.set(cacheKey, { items, timestamp: Date.now() })

      return items
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 超时和取消静默处理（返回空数组，不污染日志）
      if (!msg.includes('TIMEOUT') && !msg.includes('cancel')) {
        logger.warn('LLM.INLINE', '补全请求失败', {
          correlationId,
          error: redactSecrets(msg),
        })
      }
      return []
    } finally {
      this.pending.delete(correlationId)
    }
  }

  /**
   * 取消所有进行中的补全请求
   */
  cancel(): void {
    if (this.pending.size === 0) return
    const ids = Array.from(this.pending)
    this.pending.clear()
    for (const provider of this.providerCache.values()) {
      for (const id of ids) {
        provider.cancel(id)
      }
    }
    logger.info('LLM.INLINE', '已取消所有进行中的补全请求', { count: ids.length })
  }

  /**
   * 从 LLM 返回文本中提取补全内容
   * - 去除 markdown 代码块标记（```lang ... ```）
   * - 去除前后空白行
   */
  private extractCompletion(text: string): string {
    if (!text) return ''
    let result = text.trim()
    // 去除 markdown 代码块标记
    const codeBlockMatch = result.match(/^```[\w-]*\n([\s\S]*?)\n?```$/)
    if (codeBlockMatch) {
      result = codeBlockMatch[1]
    }
    // 去除行首 markdown 内联标记
    result = result.replace(/^`{1,3}/, '').replace(/`{1,3}$/, '')
    return result.trim()
  }
}

/** 单例（延迟初始化，避免主进程启动时即创建 Provider） */
let singleton: InlineCompletionService | null = null
export function getInlineCompletionService(): InlineCompletionService {
  if (!singleton) singleton = new InlineCompletionService()
  return singleton
}
