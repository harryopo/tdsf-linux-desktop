/**
 * Ubuntu Help 在线抓取器（Ubuntu Server Guide 官方文档）
 *
 * 教学术语：
 * - Ubuntu Server Guide (服务器指南)：Ubuntu 官方维护的运维文档，覆盖 20.04/22.04/24.04 LTS
 * - robots.txt 协议：help.ubuntu.com 规定 Crawl-delay: 5s
 * - TOC (Table of Contents)：文档目录树，sitemaps 是其 XML 形式
 *
 * 数据流：
 *   1. politeFetch 抓 /server/docs/ 索引页
 *   2. cheerio 解析 <a> 链接 → 章节 URL 列表
 *   3. 对每个章节：抓 HTML → 解析主内容区 → 转 Markdown
 *   4. 输出 TutorialEntry（source.kind = 'online-crawl', license = 'CC BY-SA 4.0'）
 *
 * 合规说明：
 *   - robots.txt：Crawl-delay: 5（必须严格遵守）
 *   - License：CC BY-SA 4.0（Canonical/Ubuntu 官方文档）
 *   - User-Agent：'TDSF-Linux-Desktop/0.7 (+https://github.com/tdsf; Educational)'
 *   - 串行抓取（5s 间隔），不并发
 *   - 限定 20.04/22.04/24.04 LTS 三个版本，避免误抓废弃版本
 *
 * 为什么是 Phase 1 补完？
 *   - Ubuntu 是国内生产环境主流发行版（占比 60%+）
 *   - Server Guide 是 Canonical 官方维护，最权威
 *   - 与已有 Arch Wiki（社区维护）形成"双标准"
 */

import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { politeFetch, TokenBucket } from './polite-fetch'
import type { TutorialEntry, TutorialCategory } from '../types'
import type { CrawlProgress } from '@shared/crawler-types'
import { parseHtmlToTutorial, makeTutorialId } from './html-to-tutorial'

/** 来源元数据 */
const SOURCE_NAME = 'Ubuntu Help'
const SOURCE_LICENSE = 'CC BY-SA 4.0'
const SOURCE_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
const SOURCE_KIND = 'online-crawl' as const

/** Server Guide 索引（仅 LTS 版本，按时间倒序） */
const SERVER_GUIDE_INDEXES = [
  'https://help.ubuntu.com/24.04/serverguide/',
  'https://help.ubuntu.com/22.04/serverguide/',
  'https://help.ubuntu.com/20.04/serverguide/'
]

/** Rate Limiter：5s/请求（严格遵守 robots.txt） */
const ubuntuLimiter = new TokenBucket(1, 5000)

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

/**
 * 从索引页提取所有 server guide 子页 URL
 *
 * 索引页结构示例：
 *   <div class="contents">
 *     <ul>
 *       <li><a href="networking.html">Networking</a></li>
 *       <li><a href="firewall.html">Firewall</a></li>
 *     </ul>
 *   </div>
 */
async function extractGuideLinks(
  indexUrl: string,
  signal: AbortSignal
): Promise<string[]> {
  const html = await politeFetch({ url: indexUrl, rateLimiter: ubuntuLimiter, signal })
  const $ = cheerio.load(html)
  const links = new Set<string>()

  // 抓所有内部链接（server guide 子页）
  $('a[href]').each((_idx, el) => {
    const href = $(el).attr('href')
    if (!href) return
    // 过滤条件：
    // 1. 相对路径或同域
    // 2. 必须是 HTML 页面（去掉 #fragment 和 .css/.js）
    // 3. 必须在当前索引下（同版本）
    if (href.startsWith('#') || href.startsWith('mailto:')) return
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|pdf)$/i.test(href)) return
    // 完整 URL 处理
    let fullUrl: string
    if (href.startsWith('http')) {
      if (!href.startsWith(indexUrl)) return // 跨域
      fullUrl = href
    } else {
      // 相对路径 → 拼上索引页 base
      const base = indexUrl.endsWith('/') ? indexUrl : indexUrl.replace(/\/[^/]*$/, '/')
      fullUrl = base + href.replace(/^\//, '')
    }
    // 仅保留 server guide 子页（不含索引自身和上级目录）
    if (fullUrl !== indexUrl && fullUrl.endsWith('.html')) {
      links.add(fullUrl)
    }
  })

  return Array.from(links)
}

/**
 * 从 URL 推断 TutorialCategory
 *
 * 规则基于 URL 路径关键词匹配
 */
function inferCategoryFromUrl(url: string): TutorialCategory {
  const u = url.toLowerCase()
  if (/network|dns|ip|route|interface|ethernet|wifi|vpn/.test(u)) return 'networking'
  if (/security|firewall|apparmor|ufw|crypt|ssl|tls|cert|ssh/.test(u)) return 'security'
  if (/package|apt|dpkg|snap/.test(u)) return 'package-management'
  if (/systemd|service|init|upstart|cron/.test(u)) return 'services'
  if (/shell|bash|script|command-line|terminal/.test(u)) return 'shell-scripting'
  if (/database|mysql|postgres|mongo|redis/.test(u)) return 'database'
  if (/lvm|disk|fs|partition|raid|storage/.test(u)) return 'storage'
  if (/web|apache|nginx|http|cgi|php|squid/.test(u)) return 'web-server'
  if (/kernel|boot|grub|module/.test(u)) return 'linux-basics'
  if (/user|account|group|permission|sudo/.test(u)) return 'user-management'
  if (/monitor|log|logging|audit|syslog/.test(u)) return 'monitoring'
  if (/cloud|openstack|juju|maas|docker|kubernetes|lxd|lxc|virtual/.test(u)) return 'virtualization'
  return 'linux-basics'
}

/**
 * 从 HTML 提取主内容
 *
 * Ubuntu Help 页面通常结构：
 *   <div class="body" role="main">
 *     <div class="section" id="...">
 *       <h1>...</h1>
 *       <p>...</p>
 *     </div>
 *   </div>
 *
 * 我们提取 <div class="body"> 或 fallback 到 <body>
 */
function extractMainContent(html: string): { title: string; contentHtml: string } {
  const $ = cheerio.load(html)
  // 优先取 <div class="body" role="main">
  let contentEl = $('div.body[role="main"]').first()
  if (contentEl.length === 0) {
    contentEl = $('div.body').first()
  }
  if (contentEl.length === 0) {
    contentEl = $('main').first()
  }
  if (contentEl.length === 0) {
    contentEl = $('body')
  }
  // 移除噪声元素
  contentEl.find('script, style, nav, .nav, .breadcrumb, header, footer, #footer').remove()

  // 提取标题
  const title = $('h1').first().text().trim() || $('title').text().trim()

  return {
    title,
    contentHtml: contentEl.html() ?? ''
  }
}

/**
 * 抓取 Ubuntu Help Server Guide
 *
 * @param onProgress 进度回调
 * @param signal 取消信号
 * @returns TutorialEntry[]
 */
export async function crawlUbuntuHelp(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const entries: TutorialEntry[] = []
  const seenIds = new Set<string>()

  // 1) 收集所有子页 URL
  onProgress({
    sourceId: 'ubuntu-help',
    sourceLabel: SOURCE_NAME,
    phase: 'downloading',
    message: '收集 Server Guide 索引...',
    progress: 0,
    processed: 0,
    total: 0
  })

  const allLinks: Array<{ url: string; version: string }> = []
  for (const indexUrl of SERVER_GUIDE_INDEXES) {
    if (signal.aborted) return entries
    try {
      const links = await extractGuideLinks(indexUrl, signal)
      const version = indexUrl.match(/\/(\d+\.\d+)\//)?.[1] ?? 'unknown'
      for (const link of links) {
        allLinks.push({ url: link, version })
      }
      onProgress({
        sourceId: 'ubuntu-help',
        sourceLabel: SOURCE_NAME,
        phase: 'downloading',
        message: `✓ ${version} 索引：${links.length} 个子页`,
        progress: 0.05,
        processed: allLinks.length,
        total: allLinks.length
      })
    } catch (err) {
      onProgress({
        sourceId: 'ubuntu-help',
        sourceLabel: SOURCE_NAME,
        phase: 'downloading',
        message: `⚠️ 索引失败 ${indexUrl}: ${(err as Error).message}`,
        progress: 0.05,
        processed: allLinks.length,
        total: allLinks.length
      })
    }
  }

  if (allLinks.length === 0) {
    onProgress({
      sourceId: 'ubuntu-help',
      sourceLabel: SOURCE_NAME,
      phase: 'error',
      message: '❌ 未找到任何子页 URL',
      progress: 1,
      processed: 0,
      total: 0,
      error: 'empty'
    })
    return entries
  }

  onProgress({
    sourceId: 'ubuntu-help',
    sourceLabel: SOURCE_NAME,
    phase: 'downloading',
    message: `开始抓取 ${allLinks.length} 个子页（约 ${Math.ceil(allLinks.length * 5 / 60)} 分钟）`,
    progress: 0.1,
    processed: 0,
    total: allLinks.length
  })

  // 2) 串行抓取每个子页
  for (let i = 0; i < allLinks.length; i++) {
    if (signal.aborted) {
      onProgress({
        sourceId: 'ubuntu-help',
        sourceLabel: SOURCE_NAME,
        phase: 'error',
        message: `⏹️ 已取消（已抓 ${entries.length}/${allLinks.length}）`,
        progress: (i + 1) / allLinks.length,
        processed: entries.length,
        total: allLinks.length,
        error: '用户已取消'
      })
      break
    }

    const { url, version } = allLinks[i]
    try {
      const html = await politeFetch({ url, rateLimiter: ubuntuLimiter, signal })
      const { title, contentHtml } = extractMainContent(html)
      if (!contentHtml.trim()) continue

      // 转 Markdown
      const markdown = getTurndown().turndown(contentHtml)
      if (markdown.length < 200) continue // 过滤短内容

      const id = makeTutorialId(url)
      if (seenIds.has(id)) continue // 同 URL 跨版本重复
      seenIds.add(id)

      const baseEntry = parseHtmlToTutorial(contentHtml, {
        url,
        sourceName: `${SOURCE_NAME} (${version} LTS)`,
        license: SOURCE_LICENSE,
        licenseUrl: SOURCE_LICENSE_URL,
        kind: SOURCE_KIND,
        category: inferCategoryFromUrl(url),
        difficulty: 'intermediate',
        tags: ['ubuntu', version, 'server-guide', 'official'],
        distros: ['ubuntu']
      })
      if (!baseEntry) continue

      // 保留我们解析的 title（更准确）
      if (title) baseEntry.title = title
      baseEntry.id = id
      baseEntry.commands = extractCommands(markdown)
      baseEntry.keywords = extractKeywords(markdown, baseEntry.title)
      baseEntry.readingTime = estimateReadingTime(markdown)
      baseEntry.distros = ['ubuntu']

      entries.push(baseEntry)

      onProgress({
        sourceId: 'ubuntu-help',
        sourceLabel: SOURCE_NAME,
        phase: 'parsing',
        message: `✓ [${i + 1}/${allLinks.length}] ${baseEntry.title}（${markdown.length} 字符）`,
        progress: 0.1 + 0.85 * ((i + 1) / allLinks.length),
        processed: entries.length,
        total: allLinks.length
      })
    } catch (err) {
      onProgress({
        sourceId: 'ubuntu-help',
        sourceLabel: SOURCE_NAME,
        phase: 'parsing',
        message: `⚠️ [${i + 1}/${allLinks.length}] 失败: ${(err as Error).message.slice(0, 50)}`,
        progress: 0.1 + 0.85 * ((i + 1) / allLinks.length),
        processed: entries.length,
        total: allLinks.length
      })
    }
  }

  onProgress({
    sourceId: 'ubuntu-help',
    sourceLabel: SOURCE_NAME,
    phase: 'done',
    message: `✅ 完成：${entries.length} 篇教程（${SERVER_GUIDE_INDEXES.length} 个版本）`,
    progress: 1,
    processed: entries.length,
    total: allLinks.length
  })

  return entries
}

/**
 * 从 Markdown 提取代码块中的命令
 */
function extractCommands(md: string): string[] {
  const commands: string[] = []
  const codeBlockRe = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = codeBlockRe.exec(md)) !== null) {
    const code = match[1].trim()
    // 取首行非注释命令
    const lines = code.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    for (const line of lines.slice(0, 3)) {
      commands.push(line)
    }
  }
  return Array.from(new Set(commands)).slice(0, 20)
}

/**
 * 从 Markdown 提取关键词
 */
function extractKeywords(md: string, title: string): string[] {
  const text = (title + ' ' + md).toLowerCase()
  // 提取 H1/H2/H3 标题作为关键词
  const headingRe = /^#{1,3}\s+(.+)$/gm
  const headings: string[] = []
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(md)) !== null) {
    headings.push(m[1].trim())
  }
  // 合并：标题 + 关键词词典
  const dict = [
    'ubuntu', 'server', 'install', 'configure', 'security', 'network',
    'firewall', 'service', 'package', 'kernel', 'boot', 'ssh', 'lvm',
    'raid', 'cloud', 'docker', 'monitor', 'log', 'web', 'apache',
    'nginx', 'mysql', 'database', 'backup', 'restore', 'mail', 'dns'
  ]
  const found = new Set<string>()
  for (const k of dict) {
    if (text.includes(k)) found.add(k)
  }
  for (const h of headings.slice(0, 5)) {
    const words = h.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    for (const w of words) found.add(w)
  }
  return Array.from(found).slice(0, 15)
}

/**
 * 估算阅读时间（中文 300 字/分钟，英文 200 词/分钟）
 */
function estimateReadingTime(md: string): number {
  const cjk = (md.match(/[\u4e00-\u9fa5]/g) || []).length
  const en = (md.match(/[a-zA-Z]+/g) || []).length
  const cjkMin = cjk / 300
  const enMin = en / 200
  return Math.max(1, Math.round(cjkMin + enMin))
}
