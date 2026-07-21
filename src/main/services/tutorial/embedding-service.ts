/**
 * Embedding 服务 - 基于 BGE-small-zh-v1.5 本地推理
 *
 * 教学背景：
 * - Embedding（嵌入向量）：把文本转换为定长数值向量，让计算机能"算"语义相似度
 * - BGE = BAAI General Embedding，智源研究院开源的中文 embedding 模型系列
 * - BGE-small-zh-v1.5：512 维向量，模型仅 24MB，适合桌面端本地推理
 *
 * 技术方案：
 * - 使用 @xenova/transformers（Transformers.js）在 Node.js 端本地推理
 * - 通过 ONNX Runtime 加速，无需 Python 环境
 * - 模型首次调用时从 HuggingFace CDN 下载，之后从本地缓存加载
 * - 国内网络环境通过 hf-mirror.com 镜像加速下载
 *
 * 关键约束：
 * - 本地优先：禁止调用任何云端 API（OpenAI/Anthropic/腾讯）
 * - 不阻塞主进程：所有方法 async/await，不 sync IO
 * - 单例模式：模型只加载一次，重复利用
 */

import { app } from 'electron'
import { join } from 'path'

/**
 * Transformers.js 模块类型（动态加载）
 *
 * 为什么用 dynamic import？
 * - @xenova/transformers 是 ESM-only 模块（package.json 中 "type": "module"）
 * - Electron 主进程虽支持 ESM，但启动时立即加载会拖慢首屏
 * - CJS bundling（如 esbuild 测试脚本）无法静态 require ESM 模块
 * - 用 dynamic import() 在首次 embed 时懒加载，CJS/ESM 都能正常工作
 *
 * 教学术语：
 * - dynamic import()：动态导入，运行时加载模块，返回 Promise<Module>
 * - ESM (ECMAScript Modules)：ES 官方模块系统，import/export 语法
 * - CJS (CommonJS)：Node.js 传统模块系统，require/module.exports
 */
type TransformersModule = {
  pipeline: (
    task: string,
    model: string,
    options?: { quantized?: boolean }
  ) => Promise<unknown>
  env: {
    allowLocalModels: boolean
    useBrowserCache: boolean
    remoteHost: string
    cacheDir?: string
  }
}

/** 懒加载的 Transformers.js 模块引用（首次调用 ensureLoaded 时填充） */
let transformersModule: TransformersModule | null = null

/**
 * BGE-small-zh-v1.5 模型 ID（Xenova 镜像版本）
 * Xenova 是 HuggingFace 上专门把 PyTorch 模型转成 ONNX 格式的作者
 */
const MODEL_ID = 'Xenova/bge-small-zh-v1.5'

/**
 * Embedding 维度
 * BGE-small-zh 系列固定输出 512 维向量
 */
export const EMBEDDING_DIM = 512

/**
 * BGE 模型的查询前缀（中文版）
 * BGE 模型要求查询和文档使用不同前缀，才能达到最佳检索效果
 */
const BGE_QUERY_PREFIX_ZH = '为这个句子生成表示以用于检索相关文章：'

/**
 * BGE 模型的查询前缀（英文版）
 */
const BGE_QUERY_PREFIX_EN = 'Represent this sentence for searching relevant passages: '

/**
 * Embedding 服务不可用错误
 * 当模型下载失败或推理失败时抛出
 */
export class EmbeddingServiceUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'EmbeddingServiceUnavailableError'
  }
}

/**
 * 动态加载 Transformers.js 模块
 *
 * 设计要点：
 * - 仅首次调用时真正执行 import()，后续直接返回缓存
 * - 用 Promise 缓存避免并发首次调用导致重复加载
 * - 模块加载失败时清空缓存，允许下次重试
 *
 * @returns Transformers.js 模块对象（含 pipeline 和 env）
 *
 * @internal
 */
let moduleLoadPromise: Promise<TransformersModule> | null = null
function loadTransformersModule(): Promise<TransformersModule> {
  if (transformersModule) {
    return Promise.resolve(transformersModule)
  }
  if (!moduleLoadPromise) {
    moduleLoadPromise = (async () => {
      try {
        const mod = await import('@xenova/transformers')
        const transformers = mod as unknown as TransformersModule
        // 配置 Transformers.js 运行环境
        // - allowLocalModels = false：不读取本地模型文件（强制走 CDN 下载）
        // - useBrowserCache = false：Node 端没有浏览器缓存机制
        // - remoteHost：HuggingFace 国内镜像（hf-mirror.com，官方推荐）
        transformers.env.allowLocalModels = false
        transformers.env.useBrowserCache = false
        transformers.env.remoteHost = 'https://hf-mirror.com'
        transformersModule = transformers
        return transformers
      } catch (err) {
        // 加载失败时清空 promise，允许下次重试
        moduleLoadPromise = null
        throw err
      }
    })()
  }
  return moduleLoadPromise
}

/**
 * Pipeline 实例类型（feature-extraction 任务）
 *
 * 教学术语：
 * - pipeline：Transformers.js 的统一接口，封装了 tokenize → model → decode 全流程
 * - tensor：模型输出张量，data 是 Float32Array，dims 是形状（如 [1, 512]）
 * - pooling='cls'：用 [CLS] token 输出作为整句向量（BGE 推荐方式）
 * - normalize=true：L2 归一化（向量长度=1，便于余弦相似度计算）
 */
interface ExtractorInstance {
  /** 调用 pipeline 进行推理（单条或批量） */
  (
    text: string | string[],
    options?: { pooling?: 'cls' | 'mean'; normalize?: boolean }
  ): Promise<{ data: Float32Array; dims: number[] }>
  /** 释放模型内存（OOM 时主动 dispose 重试） */
  dispose?: () => void
}

/**
 * 判断文本是否包含中文
 * 用于选择 BGE 查询前缀（中文/英文）
 *
 * @param text 输入文本
 * @returns 是否包含中文字符
 */
function containsChinese(text: string): boolean {
  // 中日韩统一表意文字范围：\u4e00-\u9fa5
  return /[\u4e00-\u9fa5]/.test(text)
}

/**
 * 为查询文本添加 BGE 前缀
 *
 * BGE 模型的特殊要求：
 * - 文档（入库时）：直接用原文，不加前缀
 * - 查询（检索时）：必须加前缀，否则检索效果会显著下降
 *
 * 前缀语言根据查询文本自动选择：
 * - 含中文：用中文前缀
 * - 纯英文：用英文前缀
 *
 * @param query 用户查询文本
 * @returns 加好前缀的查询文本
 *
 * @example
 * prefixQuery('如何配置 SSH') // '为这个句子生成表示以用于检索相关文章：如何配置 SSH'
 * prefixQuery('how to config ssh') // 'Represent this sentence for searching relevant passages: how to config ssh'
 */
export function prefixQuery(query: string): string {
  const isChinese = containsChinese(query)
  return isChinese
    ? `${BGE_QUERY_PREFIX_ZH}${query}`
    : `${BGE_QUERY_PREFIX_EN}${query}`
}

/**
 * Embedding 服务（单例）
 *
 * 设计要点：
 * - 单例模式：模型加载耗时，全局只加载一次
 * - 懒加载：首次调用 embed/embedBatch 时才下载模型
 * - 进程内缓存：extractor 实例常驻内存，重复调用零成本
 * - 可释放：dispose 后可重新加载（用于内存不足场景）
 *
 * 教学要点：
 * - "嵌入向量"（Embedding）：把文本压缩成 512 维浮点数组，相似语义→相近向量
 * - "余弦相似度"：两向量夹角余弦值，越接近 1 越相似（检索时用）
 * - "pipeline"：Transformers.js 的统一接口，封装了 tokenize → model → decode 全流程
 */
export class EmbeddingService {
  private static instance: EmbeddingService | null = null

  /**
   * pipeline 实例（feature-extraction 类型）
   *
   * 类型说明：
   * - 不直接引用 @xenova/transformers 的具体类型（避免顶层 import ESM-only 模块）
   * - 用结构化类型描述 pipeline 实例的可调用接口
   */
  private extractor: ExtractorInstance | null = null

  /** 懒加载 Promise（防止并发首次调用重复下载） */
  private initPromise: Promise<void> | null = null

  private constructor() {}

  /**
   * 获取单例实例
   * 全局只保留一个 EmbeddingService，模型只加载一次
   */
  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService()
    }
    return EmbeddingService.instance
  }

  /**
   * 懒加载模型（首次调用时下载）
   *
   * 设计：
   * - 用 initPromise 防止并发首次调用导致重复下载
   * - 失败后清空 initPromise，允许重试
   * - 抛出 EmbeddingServiceUnavailableError 让上层处理
   *
   * 模型大小：约 24MB（BGE-small-zh-v1.5 ONNX 量化版）
   * 首次下载时间：国内通过 hf-mirror.com 约 10-30 秒
   */
  async ensureLoaded(): Promise<void> {
    if (this.extractor) return

    if (!this.initPromise) {
      this.initPromise = this.loadModel()
    }

    try {
      await this.initPromise
    } catch (err) {
      // 失败时清空 promise，允许下次重试
      this.initPromise = null
      throw err
    }
  }

  /**
   * 实际加载模型的内部方法
   *
   * 加载流程（两阶段懒加载）：
   * 1. 动态 import() 加载 @xenova/transformers 模块本身
   * 2. 用 pipeline() 加载 BGE-small-zh-v1.5 ONNX 模型权重
   *
   * 两阶段都是首次调用时执行，后续直接用缓存。
   * 这样设计的好处：
   * - 应用启动时不加载 ONNX Runtime（首屏更快）
   * - 测试脚本中可 mock @xenova/transformers 避免真实下载
   * - CJS bundling 不会被 ESM-only 模块阻塞
   */
  private async loadModel(): Promise<void> {
    try {
      // 阶段 1：动态加载 @xenova/transformers 模块
      const transformers = await loadTransformersModule()

      // 设置模型缓存目录到 Electron userData
      // 必须在 app ready 之后调用，否则 app.getPath 会抛错
      transformers.env.cacheDir = join(app.getPath('userData'), 'models')

      // 阶段 2：创建 feature-extraction pipeline
      // - task: 'feature-extraction' 表示提取特征向量（区别于 text-classification 等）
      // - model: Xenova/bge-small-zh-v1.5（ONNX 量化版，适合 CPU 推理）
      // - quantized: true 使用量化版（更小更快，精度损失可接受）
      this.extractor = await transformers.pipeline('feature-extraction', MODEL_ID, {
        quantized: true
      }) as ExtractorInstance
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err)
      throw new EmbeddingServiceUnavailableError(
        `BGE embedding 模型加载失败（model=${MODEL_ID}）：${msg}。` +
        `请检查网络（hf-mirror.com）或磁盘空间。`,
        err
      )
    }
  }

  /**
   * 生成单条文本的 embedding
   *
   * @param text 输入文本（已含或不含 BGE 前缀均可，由调用方决定）
   * @returns 512 维 Float32Array
   *
   * 教学要点：
   * - pooling: 'cls' 表示用 [CLS] token 的输出作为整句向量（BGE 推荐方式）
   * - normalize: true 做 L2 归一化（向量长度=1，便于余弦相似度计算）
   */
  async embed(text: string): Promise<Float32Array> {
    await this.ensureLoaded()

    // 防御：空文本直接返回零向量（避免 ONNX 报错）
    if (!text || text.trim().length === 0) {
      return new Float32Array(EMBEDDING_DIM)
    }

    try {
      // 注意：ensureLoaded 已保证 extractor 非空，但 TypeScript 无法静态推断
      // 用局部变量 + 显式判空让 TS 收窄类型
      const extractor = this.extractor
      if (!extractor) {
        throw new EmbeddingServiceUnavailableError('extractor 未加载（不应到达此分支）')
      }
      const output = await extractor(text, {
        pooling: 'cls',
        normalize: true
      })
      // Transformers.js 返回 { data: Float32Array, dims: [1, dim] }
      const data = output?.data as Float32Array | undefined
      if (!data || data.length !== EMBEDDING_DIM) {
        throw new Error(
          `Embedding 维度异常：期望 ${EMBEDDING_DIM}，实际 ${data?.length ?? 0}`
        )
      }
      return data
    } catch (err) {
      // 内存不足时尝试 dispose 后重试一次
      const msg = (err as Error)?.message ?? String(err)
      if (this.isMemoryError(msg)) {
        console.warn('[EmbeddingService] 检测到内存不足，dispose 后重试一次:', msg)
        this.dispose()
        try {
          await this.ensureLoaded()
          const retryExtractor = this.extractor
          if (!retryExtractor) {
            throw new EmbeddingServiceUnavailableError('重试时 extractor 未加载')
          }
          const retry = await retryExtractor(text, {
            pooling: 'cls',
            normalize: true
          })
          const data = retry?.data as Float32Array | undefined
          if (!data || data.length !== EMBEDDING_DIM) {
            throw new Error('重试后 embedding 维度仍异常')
          }
          return data
        } catch (retryErr) {
          throw new EmbeddingServiceUnavailableError(
            `Embedding 推理失败（重试后仍失败）：${(retryErr as Error).message}`,
            retryErr
          )
        }
      }
      throw new EmbeddingServiceUnavailableError(
        `Embedding 推理失败：${msg}`,
        err
      )
    }
  }

  /**
   * 批量生成 embedding（比循环调用单条更快）
   *
   * 性能优势：
   * - 利用 ONNX Runtime 内部 batching
   * - 减少 JS↔Native 调用次数
   * - 适合教程入库场景（2578 条一次性处理）
   *
   * @param texts 文本数组
   * @param batchSize 每批大小（默认 8，过大会占用过多内存）
   * @returns 与 texts 等长的 Float32Array 数组
   */
  async embedBatch(texts: string[], batchSize = 8): Promise<Float32Array[]> {
    await this.ensureLoaded()

    if (texts.length === 0) return []

    const results: Float32Array[] = new Array(texts.length)

    // 分批处理，避免一次性把所有文本塞进 ONNX（OOM 风险）
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)

      // 防御：把空文本替换为占位符（避免 ONNX 报错），结果替换为零向量
      const placeholders: string[] = []
      const emptyIndices: number[] = []
      batch.forEach((t, j) => {
        if (!t || t.trim().length === 0) {
          placeholders.push('空')
          emptyIndices.push(i + j)
        } else {
          placeholders.push(t)
        }
      })

      try {
        const batchExtractor = this.extractor
        if (!batchExtractor) {
          throw new EmbeddingServiceUnavailableError('extractor 未加载（批量路径）')
        }
        const output = await batchExtractor(placeholders, {
          pooling: 'cls',
          normalize: true
        })
        // 批量输出形状：[batchSize, dim]
        const data = output?.data as Float32Array | undefined
        const dims = output?.dims as number[] | undefined
        if (!data || !dims || dims.length < 2) {
          throw new Error('批量 embedding 输出格式异常')
        }
        const dim = dims[dims.length - 1]
        if (dim !== EMBEDDING_DIM) {
          throw new Error(
            `批量 embedding 维度异常：期望 ${EMBEDDING_DIM}，实际 ${dim}`
          )
        }

        // 按批拆分到结果数组
        for (let j = 0; j < batch.length; j++) {
          const start = j * dim
          const slice = data.slice(start, start + dim)
          // 复制一份独立 Float32Array（避免引用同一 buffer）
          results[i + j] = new Float32Array(slice)
        }

        // 空文本位置替换为零向量
        for (const idx of emptyIndices) {
          results[idx] = new Float32Array(EMBEDDING_DIM)
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err)
        if (this.isMemoryError(msg)) {
          console.warn('[EmbeddingService] 批量推理内存不足，缩小 batch 重试:', msg)
          this.dispose()
          await this.ensureLoaded()
          // 退化为逐条调用（更慢但不会 OOM）
          for (let j = 0; j < batch.length; j++) {
            const globalIdx = i + j
            if (emptyIndices.includes(globalIdx)) {
              results[globalIdx] = new Float32Array(EMBEDDING_DIM)
            } else {
              results[globalIdx] = await this.embed(batch[j])
            }
          }
        } else {
          throw new EmbeddingServiceUnavailableError(
            `批量 embedding 推理失败（batch index=${i}）：${msg}`,
            err
          )
        }
      }
    }

    return results
  }

  /**
   * 判断模型是否已加载到内存
   *
   * 用于 IPC `tutorial:search-status` 通道返回当前 embedding 服务状态，
   * 让 UI 能展示"模型已加载 / 待加载"。
   *
   * 注意：
   * - 仅检查 extractor 实例是否存在（同步快速判断）
   * - 不触发模型下载（与 ensureLoaded 不同，不会阻塞）
   * - 返回 false 不代表模型不可用，只是尚未加载到内存
   *
   * @returns true 表示 extractor 已加载，可直接调用 embed/embedBatch
   */
  isLoaded(): boolean {
    return this.extractor !== null
  }

  /**
   * 释放模型内存
   *
   * 使用场景：
   * - 内存不足时主动释放（dispose 后重新 ensureLoaded）
   * - 应用退出时清理资源
   * - 长时间不使用时（如配置低内存模式）
   */
  dispose(): void {
    if (this.extractor) {
      try {
        // Transformers.js 的 pipeline 实例有 dispose 方法
        if (typeof this.extractor.dispose === 'function') {
          this.extractor.dispose()
        }
      } catch (err) {
        console.warn('[EmbeddingService] dispose 时出错（忽略）：', (err as Error).message)
      }
      this.extractor = null
      this.initPromise = null
    }
  }

  /**
   * 判断是否为内存相关错误
   */
  private isMemoryError(msg: string): boolean {
    const lower = msg.toLowerCase()
    return (
      lower.includes('out of memory') ||
      lower.includes('oom') ||
      lower.includes('heap') ||
      lower.includes('allocation failed')
    )
  }
}

/**
 * 为一批教程条目生成 embedding
 *
 * 使用场景：
 * - 教程入库时批量生成向量（2578 条 Linux 教程）
 * - 重建向量索引时
 *
 * @param entries 教程数组（只需 id + title + content）
 * @param onProgress 进度回调（0-1，可选）
 * @returns Map<id, Float32Array>，key 为教程 id
 *
 * 教学要点：
 * - 把 title + content 拼接成一段文本做 embedding（信息更完整）
 * - 文档侧不加 BGE 前缀（仅查询侧加）
 * - 进度回调让 UI 能显示"已处理 100/2578"
 */
export async function generateEmbeddings(
  entries: Array<{ id: string; title: string; content: string }>,
  onProgress?: (pct: number) => void
): Promise<Map<string, Float32Array>> {
  const result = new Map<string, Float32Array>()

  if (entries.length === 0) {
    onProgress?.(1)
    return result
  }

  const service = EmbeddingService.getInstance()
  await service.ensureLoaded()

  // 把 entry 拼成单段文本（title 重复一次以加权）
  // 拼接格式：title\n\ncontent
  // 截断 content 以避免超过 512 tokens
  const texts = entries.map((e) => {
    const titlePart = e.title ?? ''
    const contentPart = (e.content ?? '').slice(0, 1500) // 粗略截断（约 500-700 tokens）
    return `${titlePart}\n\n${contentPart}`.trim()
  })

  // 分批处理，每批处理后回调进度
  const batchSize = 8
  for (let i = 0; i < texts.length; i += batchSize) {
    const batchTexts = texts.slice(i, i + batchSize)
    const batchEntries = entries.slice(i, i + batchSize)

    const embeddings = await service.embedBatch(batchTexts, batchSize)

    for (let j = 0; j < batchEntries.length; j++) {
      result.set(batchEntries[j].id, embeddings[j])
    }

    // 进度回调
    if (onProgress) {
      const pct = Math.min(1, (i + batchSize) / texts.length)
      onProgress(pct)
    }
  }

  return result
}
