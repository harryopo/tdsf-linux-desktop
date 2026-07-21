/**
 * Arch Wiki 离线包抓取器
 *
 * 教学术语：
 * - tar.gz (Tape Archive + Gzip)：Linux 通用压缩归档格式
 * - ZIM (Zero Internet Memory)：Kiwix 使用的离线网页格式
 * - 月度快照 (Monthly Dump)：Arch Wiki 官方每月发布的整站 HTML 压缩包
 *
 * 数据流：
 *   1. 下载 archwiki-YYYY-MM-DD.tar.gz 到临时目录
 *   2. 解压到临时目录
 *   3. 遍历所有 HTML 文件
 *   4. 用 cheerio 解析 + turndown 转 Markdown
 *   5. 元数据提取（title/category/distros）
 *   6. 返回 TutorialEntry[]
 *
 * 合规说明：
 *   - Arch Wiki 官方明确提供月度快照（ArchWiki:Archive 页面）
 *   - License: CC BY-SA 4.0（仅整理 + 引用，标注 source.url）
 *   - 零爬虫礼仪风险（不是爬 HTML，是下载官方压缩包）
 */

import { createWriteStream, createReadStream } from 'node:fs'
import { mkdir, rm, readFile, readdir } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extract } from 'tar'
import type { TutorialEntry } from '../types'
import type { CrawlProgress } from '@shared/crawler-types'
import { parseHtmlToTutorial, guessCategory, guessDistros } from './html-to-tutorial'

/** Arch Wiki 离线包官方入口（最新月度快照） */
const ARCH_WIKI_DUMP_URL = 'https://wiki.archlinux.org/static/archwiki-latest.tar.gz'
/** 备用：GitHub 源仓库克隆地址（如果 dump 链接失效） */
const ARCH_WIKI_GITHUB = 'https://github.com/archlinux/archwiki'
/** 来源元数据 */
const SOURCE_NAME = 'Arch Wiki'
const SOURCE_LICENSE = 'CC BY-SA 4.0'
/** ArchWiki 教程的固定 URL 前缀 */
const ARCH_WIKI_URL_PREFIX = 'https://wiki.archlinux.org/title/'

/** 下载文件（带进度回调） */
async function downloadFile(
  url: string,
  dest: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'TDSF-Linux-Desktop/0.6.0 (Educational; +https://github.com/tdsf)' },
    signal
  })
  if (!res.ok) {
    throw new Error(`下载失败: ${res.status} ${res.statusText} (${url})`)
  }
  const totalSize = Number(res.headers.get('content-length') || 0)
  const file = createWriteStream(dest)

  if (!res.body) {
    throw new Error('响应体为空')
  }

  // 简单流式写入（无中间进度，避免 ReadableStream API 复杂度）
  let downloaded = 0
  const reader = res.body.getReader()
  try {
    while (true) {
      if (signal.aborted) { throw new Error('用户已取消') }
      const { done, value } = await reader.read()
      if (done) break
      downloaded += value.length
      file.write(Buffer.from(value))
      if (totalSize > 0) {
        onProgress(downloaded / totalSize)
      }
    }
  } finally {
    reader.releaseLock()
  }

  await new Promise<void>((resolve, reject) => {
    file.end((err: Error | null | undefined) => (err ? reject(err) : resolve()))
  })
}

/** 递归收集目录下所有 .html 文件 */
async function collectHtmlFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await collectHtmlFiles(full)))
    } else if (e.isFile() && e.name.endsWith('.html')) {
      out.push(full)
    }
  }
  return out
}

/** 从 Arch Wiki HTML 文件路径提取 URL slug */
function pathToWikiUrl(relPath: string): string {
  // Arch Wiki dump 里的 HTML 路径形如 "ArchWiki/General_purpose_mouse.html"
  // 提取文件名作为 title slug
  const fileName = relPath.replace(/\\/g, '/').split('/').pop() || ''
  const slug = fileName.replace(/\.html$/, '').replace(/_/g, ' ')
  return `${ARCH_WIKI_URL_PREFIX}${encodeURIComponent(slug.replace(/ /g, '_'))}`
}

/**
 * 抓取 Arch Wiki 离线包
 *
 * @param onProgress 进度回调
 * @returns 解析出的 TutorialEntry[]
 */
export async function crawlArchWikiOffline(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const sourceId = 'arch-wiki'
  const sourceLabel = 'Arch Wiki（官方月度快照）'

  const tmpDir = join(tmpdir(), `tdsf-archwiki-${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })
  const tarPath = join(tmpDir, 'archwiki.tar.gz')
  const extractDir = join(tmpDir, 'extracted')

  try {
    // 1. 下载
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'downloading',
      message: '下载 Arch Wiki 月度快照（~500MB，请耐心等待）...',
      progress: 0,
      processed: 0,
      total: 0
    })

    try {
      await downloadFile(ARCH_WIKI_DUMP_URL, tarPath, (pct) => {
        onProgress({
          sourceId,
          sourceLabel,
          phase: 'downloading',
          message: `下载中... ${(pct * 100).toFixed(0)}%`,
          progress: pct * 0.4,
          processed: 0,
          total: 0
        })
      }, signal)
    } catch (downloadErr) {
      // 回退到提示
      throw new Error(
        `Arch Wiki 快照下载失败: ${(downloadErr as Error).message}\n` +
        `可访问 ${ARCH_WIKI_GITHUB} 手动克隆，或检查网络`
      )
    }

    // 2. 解压
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'extracting',
      message: '解压 tar.gz...',
      progress: 0.4,
      processed: 0,
      total: 0
    })
    await mkdir(extractDir, { recursive: true })
    await pipeline(
      createReadStream(tarPath),
      extract({ cwd: extractDir })
    )
    await rm(tarPath, { force: true })

    // 3. 解析 HTML
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'parsing',
      message: '解析 HTML 文件...',
      progress: 0.5,
      processed: 0,
      total: 0
    })
    const htmlFiles = await collectHtmlFiles(extractDir)
    const total = htmlFiles.length

    const entries: TutorialEntry[] = []
    let failed = 0

    for (let i = 0; i < htmlFiles.length; i++) {
      if (signal.aborted) { throw new Error('用户已取消') }
      const file = htmlFiles[i]
      try {
        const html = await readFile(file, 'utf-8')
        const url = pathToWikiUrl(file)
        const relPath = file.replace(extractDir, '').replace(/\\/g, '/')
        const category = guessCategory(html, relPath)
        const distros = guessDistros(html, relPath)

        const entry = parseHtmlToTutorial(html, {
          url,
          sourceName: SOURCE_NAME,
          license: SOURCE_LICENSE,
          category,
          tags: ['Arch Wiki'],
          distros: distros.length > 0 ? distros : ['arch']
        })
        if (entry) {
          entries.push(entry)
        } else {
          failed++
        }
      } catch (err) {
        failed++
        console.warn(`[arch-wiki] 解析失败 (${file}):`, (err as Error).message)
      }

      // 每 50 个文件回报一次进度
      if (i % 50 === 0 || i === htmlFiles.length - 1) {
        onProgress({
          sourceId,
          sourceLabel,
          phase: 'parsing',
          message: `解析 ${i + 1}/${total} (成功 ${entries.length}, 失败 ${failed})`,
          progress: 0.5 + (i / total) * 0.45,
          processed: i + 1,
          total
        })
      }
    }

    onProgress({
      sourceId,
      sourceLabel,
      phase: 'done',
      message: `完成！成功 ${entries.length} 篇，失败 ${failed} 篇`,
      progress: 1.0,
      processed: total,
      total
    })

    return entries
  } finally {
    // 清理临时目录
    await rm(tmpDir, { recursive: true, force: true })
  }
}
