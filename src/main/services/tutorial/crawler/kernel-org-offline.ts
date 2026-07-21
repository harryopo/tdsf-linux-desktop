/**
 * kernel.org/doc 离线抓取器（在线抓取 + 按需加载）
 *
 * 教学术语：
 * - Sphinx：Python 文档生成系统，kernel.org 文档使用 Sphinx 构建
 * - robots.txt：网站爬虫协议，kernel.org **没有 robots.txt**（= 默认允许）
 * - Polite Crawl (礼貌爬取)：保守限流 + 错误退避 + User-Agent 标识
 *
 * 数据流：
 *   1. politeFetch https://www.kernel.org/doc/html/latest/ 抓索引
 *   2. cheerio 解析 <li class="toctree-l1"> 章节链接
 *   3. 按优先级选取 6 个核心子目录
 *   4. 对每个子目录抓 index.html + 几个关键页面
 *   5. 解析 HTML → Markdown（turndown）
 *   6. 输出 TutorialEntry（source.kind = 'online-crawl', license = 'GPL-2.0'）
 *
 * 合规说明：
 *   - robots.txt 404（无 robots）→ 默认保守限流 2s/请求
 *   - License: GPL-2.0（Linux 内核文档）
 *   - 来源标注：source.url = 原始 kernel.org URL
 *   - User-Agent: 'TDSF-Linux-Desktop/0.6 (+https://github.com/tdsf; Educational)'
 *
 * 为什么是 Phase 2 P1 谨慎？
 *   - kernel.org 是关键基础设施，避免被升级封禁
 *   - 全文 5000+ 页面，全量抓需要数小时
 *   - **策略**：只抓 6 个核心子目录的 index + 关键页面（共约 30-50 篇）
 *   - 不抓完整子目录（避免给 kernel.org 造成过大负担）
 *
 * 优先级排序（最实用优先）：
 *   1. admin-guide（系统管理）— 实际运维最常用
 *   2. userspace-api（用户空间 API）— 系统调用
 *   3. process（开发流程）— 开发者向
 *   4. driver-api（驱动 API）— 驱动开发者
 *   5. core-api（内核 API）— 内核开发者
 *   6. doc-guide（文档指南）— 元信息
 */

import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { politeFetch, TokenBucket } from './polite-fetch'
import type { TutorialEntry, TutorialCategory, LinuxDistro } from '../types'
import type { CrawlProgress } from '@shared/crawler-types'
import { makeTutorialId } from './html-to-tutorial'

/** 来源元数据 */
const SOURCE_NAME = 'Linux Kernel Documentation'
const SOURCE_LICENSE = 'GPL-2.0'
const SOURCE_LICENSE_URL = 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html'
const SOURCE_KIND = 'online-crawl' as const
/** kernel.org 文档根 URL */
const KERNEL_DOC_BASE = 'https://www.kernel.org/doc/html/latest'
/** 仓库 License 上下文（GNU 通用） */
const KERNEL_LICENSE_URL = 'https://www.kernel.org/doc/html/latest/process/license-rules.html'

/** turndown 全局单例 */
let _turndown: TurndownService | null = null
function getTurndown(): TurndownService {
  if (!_turndown) {
    _turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '_'
    })
    _turndown.use(gfm)
  }
  return _turndown
}

/** Rate Limiter：kernel.org 用 2s/请求（无 robots，按业界保守限流） */
const kernelLimiter = new TokenBucket(1, 2000) // capacity=1, refillMs=2000 → 严格 2s/请求

/**
 * 抓取的子目录清单
 * 格式：dir 路径 → 抓取的几个关键页面（第一个是 index.html）
 */
const TARGET_DIRS: Array<{
  dir: string
  label: string
  category: TutorialCategory
  /** 相对路径下额外要抓的几个关键页面（不含 index） */
  extraPages: string[]
}> = [
  {
    dir: 'admin-guide',
    label: 'Administration Guide',
    category: 'linux-basics',
    extraPages: [
      'admin-guide/reporting-issues.html',
      'admin-guide/sysctl/index.html',
      'admin-guide/sysctl/kernel.html',
      'admin-guide/sysctl/vm.html',
      'admin-guide/cgroup-v2.html',
      'admin-guide/boot-options.html'
    ]
  },
  {
    dir: 'userspace-api',
    label: 'Userspace API',
    category: 'linux-basics',
    extraPages: [
      'userspace-api/index.html',
      'userspace-api/ioctl.html',
      'userspace-api/netlink.html',
      'userspace-api/landlock.html'
    ]
  },
  {
    dir: 'process',
    label: 'Development Process',
    category: 'linux-basics',
    extraPages: [
      'process/development-process.html',
      'process/submitting-patches.html',
      'process/code-of-conduct.html',
      'process/license-rules.html'
    ]
  },
  {
    dir: 'driver-api',
    label: 'Driver APIs',
    category: 'linux-basics',
    extraPages: [
      'driver-api/index.html',
      'driver-api/basics.html'
    ]
  },
  {
    dir: 'core-api',
    label: 'Core API',
    category: 'linux-basics',
    extraPages: [
      'core-api/index.html',
      'core-api/mm.html',
      'core-api/kernel-api.html'
    ]
  },
  {
    dir: 'doc-guide',
    label: 'Writing Documentation',
    category: 'linux-basics',
    extraPages: [
      'doc-guide/index.html',
      'doc-guide/kernel-doc.html'
    ]
  }
]

/** 把 HTML 转为 Markdown */
function htmlToMd(html: string): string {
  const $ = cheerio.load(html)
  // 移除导航、页脚、搜索框
  $('script, style, nav, header, footer, aside, .navigation, .breadcrumb, .headerlink, .related, .sphinxsidebar, .footer').remove()
  const bodyHtml = $('div[role="main"]').html() ||
    $('main').html() ||
    $('.body').html() ||
    $('article').html() ||
    $('body').html() ||
    ''
  if (!bodyHtml || bodyHtml.length < 100) return ''
  return getTurndown().turndown(bodyHtml)
}

/** 提取代码块命令 */
function extractCommands(md: string): string[] {
  const lines = md.split('\n')
  const cmds: string[] = []
  let inCode = false
  let lang = ''
  let buf: string[] = []

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        if (/^(bash|sh|shell|console|c)?$/i.test(lang)) {
          for (const cmd of buf) {
            const t = cmd.trim()
            if (t && !t.startsWith('#') && t.length > 1) cmds.push(t)
          }
        }
        inCode = false
        lang = ''
        buf = []
      } else {
        inCode = true
        lang = line.slice(3).trim()
        buf = []
      }
      continue
    }
    if (inCode) buf.push(line)
  }
  return cmds
}

/** 估算阅读时间 */
function estimateReadingTime(text: string): number {
  const enWords = (text.match(/[a-zA-Z]+/g) || []).length
  return Math.max(1, Math.ceil(enWords / 200))
}

/** 解析单页 HTML → TutorialEntry */
function kernelHtmlToEntry(
  url: string,
  rawHtml: string,
  meta: { dir: string; label: string; category: TutorialCategory }
): TutorialEntry | null {
  try {
    if (!rawHtml || rawHtml.length < 500) return null
    const $ = cheerio.load(rawHtml)
    const title =
      $('h1').first().text().trim() ||
      $('title').first().text().trim().split('—')[0].trim() ||
      url.split('/').pop()?.replace(/\.html$/, '') ||
      'Untitled'

    const md = htmlToMd(rawHtml)
    if (!md || md.length < 200) return null

    // 提取首段
    const summary = $('div[role="main"] p').first().text().trim().slice(0, 200) ||
      $('main p').first().text().trim().slice(0, 200) ||
      title

    const commands = extractCommands(md)

    // 关键词：标题分词 + dir 名
    const keywords = new Set<string>()
    for (const w of title.split(/\s+/)) {
      if (w.length >= 3) keywords.add(w.toLowerCase())
    }
    keywords.add('kernel')
    keywords.add('linux-kernel')
    keywords.add(meta.dir)

    const now = Date.now()
    return {
      id: makeTutorialId(url),
      title: `[Kernel] ${title}`,
      summary,
      source: {
        name: SOURCE_NAME,
        url,
        crawledAt: now,
        license: SOURCE_LICENSE,
        licenseUrl: SOURCE_LICENSE_URL,
        kind: SOURCE_KIND
      },
      category: meta.category,
      tags: ['linux-kernel', 'kernel-doc', meta.dir, ...title.split(/\s+/).filter((w) => w.length >= 3).slice(0, 3)],
      difficulty: 'advanced',
      readingTime: estimateReadingTime(md),
      content: md,
      commands,
      keywords: Array.from(keywords).slice(0, 30),
      distros: [] as LinuxDistro[],
      createdAt: now,
      updatedAt: now
    }
  } catch (err) {
    console.warn(`[kernel.org] 解析失败 (${url}):`, (err as Error).message)
    return null
  }
}

/**
 * 抓取 kernel.org/doc
 *
 * 策略：每个子目录抓 index.html + 几个关键页面，共约 30-40 篇
 * 2s/请求，预计耗时 60-90 秒
 */
export async function crawlKernelOrg(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const sourceId = 'kernel-org'
  const sourceLabel = 'Linux Kernel Documentation'

  try {
    // 1. 抓首页索引（验证可达）
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'downloading',
      message: `礼貌抓取 kernel.org/doc 索引（限流 2s/请求）...`,
      progress: 0,
      processed: 0,
      total: 0
    })
    const indexUrl = `${KERNEL_DOC_BASE}/index.html`
    // 先抓一次索引验证可达（结果本身不用，因为直接走硬编码的子目录清单）
    await politeFetch({
      url: indexUrl,
      rateLimiter: kernelLimiter,
      userAgent: 'TDSF-Linux-Desktop/0.6 (+https://github.com/tdsf; Educational)',
      timeoutMs: 30_000,
      signal
    })

    // 2. 抓每个目标子目录
    const totalPages = TARGET_DIRS.reduce((acc, t) => acc + 1 + t.extraPages.length, 0)
    let processed = 0
    const entries: TutorialEntry[] = []
    let failed = 0

    for (const target of TARGET_DIRS) {
      if (signal.aborted) { throw new Error('用户已取消') }
      // 2.1 抓子目录 index
      processed++
      const subIndexUrl = `${KERNEL_DOC_BASE}/${target.dir}/index.html`
      try {
        const html = await politeFetch({
          url: subIndexUrl,
          rateLimiter: kernelLimiter,
          userAgent: 'TDSF-Research/0.6',
          timeoutMs: 30_000,
          signal
        })
        const entry = kernelHtmlToEntry(subIndexUrl, html, {
          dir: target.dir,
          label: target.label,
          category: target.category
        })
        if (entry) {
          entry.title = `[Kernel: ${target.label}] ${entry.title.replace('[Kernel] ', '')}`
          entries.push(entry)
        } else {
          failed++
        }
      } catch (err) {
        failed++
        console.warn(`[kernel.org] 抓取失败 (${subIndexUrl}):`, (err as Error).message)
      }
      onProgress({
        sourceId,
        sourceLabel,
        phase: 'parsing',
        message: `解析 ${processed}/${totalPages} (成功 ${entries.length}, 失败 ${failed})`,
        progress: processed / totalPages,
        processed,
        total: totalPages
      })

      // 2.2 抓额外关键页面
      for (const page of target.extraPages) {
        if (signal.aborted) { throw new Error('用户已取消') }
        processed++
        const pageUrl = `${KERNEL_DOC_BASE}/${page}`
        try {
          const html = await politeFetch({
            url: pageUrl,
            rateLimiter: kernelLimiter,
            userAgent: 'TDSF-Research/0.6',
            timeoutMs: 30_000,
            signal
          })
          const entry = kernelHtmlToEntry(pageUrl, html, {
            dir: target.dir,
            label: target.label,
            category: target.category
          })
          if (entry) {
            entries.push(entry)
          } else {
            failed++
          }
        } catch (err) {
          failed++
          console.warn(`[kernel.org] 抓取失败 (${pageUrl}):`, (err as Error).message)
        }
        onProgress({
          sourceId,
          sourceLabel,
          phase: 'parsing',
          message: `解析 ${processed}/${totalPages} (成功 ${entries.length}, 失败 ${failed})`,
          progress: processed / totalPages,
          processed,
          total: totalPages
        })
      }
    }

    onProgress({
      sourceId,
      sourceLabel,
      phase: 'done',
      message: `完成！成功 ${entries.length} 篇内核文档，失败 ${failed} 篇。License：${SOURCE_LICENSE} (${KERNEL_LICENSE_URL})`,
      progress: 1.0,
      processed: totalPages,
      total: totalPages
    })

    return entries
  } catch (err) {
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'error',
      message: '抓取失败',
      progress: 0,
      processed: 0,
      total: 0,
      error: (err as Error).message
    })
    throw err
  }
}
