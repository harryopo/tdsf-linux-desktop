/**
 * BGE embedding 模型文件的预取与字节校验（#153）
 *
 * 病根：以前把下载完全交给 transformers.js，它只校验 HTTP 状态与向量维度，
 * 不校验模型字节——镜像返回错误页、半截文件或被人替换的权重，都会被当成模型加载。
 *
 * 现在只走这一条下载路：应用自己取字节 → 比对仓库里钉死的 SHA-256 → 写进
 * transformers 的缓存目录。随后关闭它的远程下载（allowRemoteModels=false），
 * 缓存里没有的文件只会报错，不会偷偷下载未校验的字节。
 *
 * 哈希值来自 2026-10-22 从 hf-mirror 实取文件的计算结果；
 * 大文件与 HuggingFace API 的 lfs.oid 一致。
 */
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

export interface EmbeddingModelFile {
  /** 相对模型仓库根目录的路径（也是 transformers 缓存键的一部分） */
  path: string
  sha256: string
  size: number
}

export interface EmbeddingModelManifest {
  modelId: string
  files: readonly EmbeddingModelFile[]
}

/** 固定模型与固定字节数；换模型/换 revision 必须同批换这张表 */
export const BGE_SMALL_ZH_MODEL: EmbeddingModelManifest = {
  modelId: 'Xenova/bge-small-zh-v1.5',
  files: [
    {
      path: 'config.json',
      sha256: 'd4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f',
      size: 716,
    },
    {
      path: 'tokenizer.json',
      sha256: '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26',
      size: 439125,
    },
    {
      path: 'tokenizer_config.json',
      sha256: 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a',
      size: 367,
    },
    {
      path: 'special_tokens_map.json',
      sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
      size: 125,
    },
    {
      path: 'vocab.txt',
      sha256: '45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c',
      size: 109540,
    },
    {
      path: 'onnx/model_quantized.onnx',
      sha256: '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc',
      size: 24010842,
    },
  ],
}

/**
 * 下载源按顺序尝试：镜像优先，官方兜底。
 *
 * 为什么要兜底：2026-10-22 实测本机 hf-mirror 连不上（curl 21s 超时），
 * 官方源反而是通的；只有一条源时，首次使用会直接降级成"知识库不可用"。
 */
export const EMBEDDING_MODEL_BASE_URLS = [
  'https://hf-mirror.com',
  'https://huggingface.co',
] as const

/** 单文件上限：比清单值多 1MB 的余量都不给，防止镜像塞一个超大响应把内存打爆 */
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024

export interface EnsureEmbeddingModelOptions {
  manifest?: EmbeddingModelManifest
  /** 单源覆盖（测试/私有镜像用）；不传则按 EMBEDDING_MODEL_BASE_URLS 依次尝试 */
  baseUrl?: string
  /** 多源覆盖；优先于 baseUrl */
  baseUrls?: readonly string[]
  fetchImpl?: typeof fetch
  /** 每处理一个文件回调一次（下载/命中），用于日志与测试 */
  onFile?: (file: EmbeddingModelFile, action: 'hit' | 'downloaded') => void
  /**
   * 允许联网补缺失文件（默认 true）
   *
   * 设为 false 时：缓存里有且哈希对就用，缺一个字节就直接报错、一次网络都不发。
   * 聊天中的知识检索用它——那里没有"替用户下载 24MB 模型"的授权。
   */
  allowDownload?: boolean
}

async function sha256(buffer: Uint8Array): Promise<string> {
  return createHash('sha256').update(buffer).digest('hex')
}

async function readIfMatches(path: string, expected: EmbeddingModelFile): Promise<boolean> {
  try {
    const stat = await fs.stat(path)
    if (stat.size !== expected.size) return false
    return (await sha256(await fs.readFile(path))) === expected.sha256
  } catch {
    return false
  }
}

/**
 * 确保模型文件都在缓存目录里，且每个字节都与清单一致。
 *
 * 返回时所有文件均已校验；不返回任何"大概可以"的状态。
 */
export async function ensureEmbeddingModel(
  cacheDir: string,
  opts: EnsureEmbeddingModelOptions = {}
): Promise<void> {
  const manifest = opts.manifest ?? BGE_SMALL_ZH_MODEL
  const fetchImpl = opts.fetchImpl ?? fetch
  const baseUrls = opts.baseUrls ?? (opts.baseUrl ? [opts.baseUrl] : EMBEDDING_MODEL_BASE_URLS)
  const modelDir = join(cacheDir, manifest.modelId)

  for (const file of manifest.files) {
    const target = join(modelDir, file.path)
    if (await readIfMatches(target, file)) {
      opts.onFile?.(file, 'hit')
      continue
    }

    if (opts.allowDownload === false) {
      // 只读模式：不发任何网络请求。缺哪个文件就点名哪个，调用方自己决定要不要改走降级
      throw new Error(
        `模型文件还没下载：${file.path}（位置 ${target}）。需要联网取一次模型后才能用语义检索。`
      )
    }

    const relative = file.path.split('/').map(encodeURIComponent).join('/')
    const failures: string[] = []
    let buffer: Uint8Array | null = null
    for (const baseUrl of baseUrls) {
      try {
        const url = `${baseUrl}/${manifest.modelId}/resolve/main/${relative}`
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(180_000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const contentLength = Number(response.headers.get('content-length') ?? 0)
        if (contentLength > MAX_DOWNLOAD_BYTES) throw new Error('响应体过大')
        const candidate = new Uint8Array(await response.arrayBuffer())
        if (candidate.length > MAX_DOWNLOAD_BYTES) {
          throw new Error(`超过 ${MAX_DOWNLOAD_BYTES} 字节上限`)
        }
        if (candidate.length !== file.size) {
          throw new Error(`大小不符：期望 ${file.size}，实际 ${candidate.length}`)
        }
        const actual = await sha256(candidate)
        if (actual !== file.sha256) {
          throw new Error(`SHA-256 校验失败：${actual} ≠ 仓库钉死的 ${file.sha256}`)
        }
        buffer = candidate
        break
      } catch (err) {
        failures.push(`${baseUrl}：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (!buffer) {
      throw new Error(
        `模型文件缺失且下载失败：${file.path}。已试过 ${baseUrls.length} 个下载源：` +
          `${failures.join('；')}。首次使用需要联网取一次模型；已缓存的文件不会重下。`
      )
    }

    await fs.mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.part-${process.pid}-${Date.now()}`
    await fs.writeFile(tmp, buffer)
    // Windows 上 rename 不覆盖已有文件；校验失败的那份先删掉
    await fs.rm(target, { force: true })
    await fs.rename(tmp, target)
    opts.onFile?.(file, 'downloaded')
  }
}
