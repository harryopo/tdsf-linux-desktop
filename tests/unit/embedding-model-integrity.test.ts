/**
 * embedding 模型字节校验（#153）
 *
 * 判据三半：命中缓存不联网；坏字节/错大小/错哈希都拒绝写入；校验通过后才落盘。
 * 这里用注入的 fetch 与测试清单，不访问真实镜像。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ensureEmbeddingModel, type EmbeddingModelManifest } from '@main/services/tutorial/embedding-model'

const GOOD_A = Buffer.from('config-bytes-stable')
const GOOD_B = Buffer.from('weights-bytes-stable')
const BYTES: Record<string, Buffer> = {
  'config.json': GOOD_A,
  'onnx/model_quantized.onnx': GOOD_B,
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

const MANIFEST: EmbeddingModelManifest = {
  modelId: 'test/model',
  files: [
    { path: 'config.json', sha256: sha(GOOD_A), size: GOOD_A.length },
    { path: 'onnx/model_quantized.onnx', sha256: sha(GOOD_B), size: GOOD_B.length },
  ],
}

let dir = ''

function fakeFetch(map: Record<string, Buffer>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL | Request) => {
    const key = [...Object.keys(map)].find((k) => String(url).endsWith(k))
    if (!key) return new Response('missing', { status: 404 })
    const body = map[key]
    return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })
  })
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'tdsf-embed-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('ensureEmbeddingModel', () => {
  it('缓存齐全且哈希对：一次网络都不发', async () => {
    const fetchImpl = fakeFetch({ 'config.json': GOOD_A, 'onnx/model_quantized.onnx': GOOD_B })
    await ensureEmbeddingModel(dir, { manifest: MANIFEST, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await ensureEmbeddingModel(dir, { manifest: MANIFEST, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl, '第二轮应全部命中缓存').toHaveBeenCalledTimes(2)
  })

  it('缺文件时下载并写入正确位置', async () => {
    const fetchImpl = fakeFetch({
      'config.json': GOOD_A,
      'onnx/model_quantized.onnx': GOOD_B,
    })
    await ensureEmbeddingModel(dir, { manifest: MANIFEST, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await fs.readFile(join(dir, 'test/model/config.json'))).toEqual(GOOD_A)
    expect(await fs.readFile(join(dir, 'test/model/onnx/model_quantized.onnx'))).toEqual(GOOD_B)
  })

  it('缓存里是同样长度的坏字节：重下并覆盖', async () => {
    const bad = Buffer.alloc(GOOD_A.length, 0x78)
    await fs.mkdir(join(dir, 'test/model'), { recursive: true })
    await fs.writeFile(join(dir, 'test/model/config.json'), bad)
    const fetchImpl = fakeFetch({ 'config.json': GOOD_A, 'onnx/model_quantized.onnx': GOOD_B })

    await ensureEmbeddingModel(dir, { manifest: MANIFEST, fetchImpl: fetchImpl as unknown as typeof fetch })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(await fs.readFile(join(dir, 'test/model/config.json'))).toEqual(GOOD_A)
  })

  it('下载到的字节哈希不符：报校验失败且不落盘', async () => {
    const tampered = Buffer.alloc(GOOD_A.length, 0x7a)
    const fetchImpl = fakeFetch({ 'config.json': tampered, 'onnx/model_quantized.onnx': GOOD_B })
    await expect(
      ensureEmbeddingModel(dir, { manifest: MANIFEST, fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow(/校验失败/)
    await expect(fs.access(join(dir, 'test/model/config.json'))).rejects.toThrow()
  })

  it('大小不符直接拒绝（不先算哈希）', async () => {
    const shortened = GOOD_A.subarray(0, 4)
    const fetchImpl = fakeFetch({ 'config.json': shortened, 'onnx/model_quantized.onnx': GOOD_B })
    await expect(
      ensureEmbeddingModel(dir, { manifest: MANIFEST, fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow(/大小不符/)
  })

  it('HTTP 非 200：说明是离线/下载失败，而不是“模型坏了”', async () => {
    const fetchImpl = fakeFetch({})
    await expect(
      ensureEmbeddingModel(dir, { manifest: MANIFEST, fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow(/下载失败/)
  })

  it('首个源不可用时换下一个源，成功即止', async () => {
    const asked: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const s = String(url)
      asked.push(s)
      if (s.startsWith('https://bad.invalid')) return new Response('boom', { status: 503 })
      const key = [...Object.keys(BYTES)].find((k) => s.endsWith(k))
      if (!key) return new Response('missing', { status: 404 })
      return new Response(BYTES[key], { status: 200 })
    })
    await ensureEmbeddingModel(dir, {
      manifest: MANIFEST,
      baseUrls: ['https://bad.invalid', 'https://good.invalid'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await fs.readFile(join(dir, 'test/model/config.json'))).toEqual(GOOD_A)
    expect(asked.filter((u) => u.startsWith('https://bad.invalid'))).toHaveLength(2)
    expect(asked.filter((u) => u.startsWith('https://good.invalid'))).toHaveLength(2)
  })

  it('首个源字节哈希不对也会换源，坏字节不落盘', async () => {
    const tampered = Buffer.alloc(GOOD_A.length, 0x7a)
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const s = String(url)
      const key = [...Object.keys(BYTES)].find((k) => s.endsWith(k))
      if (!key) return new Response('missing', { status: 404 })
      const body = s.startsWith('https://bad.invalid') && key === 'config.json' ? tampered : BYTES[key]
      return new Response(body, { status: 200 })
    })
    await ensureEmbeddingModel(dir, {
      manifest: MANIFEST,
      baseUrls: ['https://bad.invalid', 'https://good.invalid'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await fs.readFile(join(dir, 'test/model/config.json'))).toEqual(GOOD_A)
  })

  it('所有源都失败：错误里逐个列出源，不谎报“没网”', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 }))
    await expect(
      ensureEmbeddingModel(dir, {
        manifest: MANIFEST,
        baseUrls: ['https://a.invalid', 'https://b.invalid'],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/a\.invalid[\s\S]*b\.invalid[\s\S]*下载失败|下载失败[\s\S]*a\.invalid[\s\S]*b\.invalid/)
  })
})
