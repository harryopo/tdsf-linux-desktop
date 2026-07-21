/**
 * Microsoft Learn Linux 文档在线抓取器
 *
 * 教学术语：
 * - Microsoft Learn (learn.microsoft.com)：微软官方技术文档平台
 * - TOC (Table of Contents)：左侧导航树
 * - Hub Page：聚合页面，链接到子主题
 *
 * 数据流：
 *   1. politeFetch 抓 /en-us/linux/ 根页
 *   2. cheerio 解析 TOC 链接
 *   3. 对每个子页：抓 HTML → 提取主内容 → 转 Markdown
 *   4. 输出 TutorialEntry（source.kind = 'online-crawl', license = 'CC BY 4.0'）
 *
 * 合规说明：
 *   - License：CC BY 4.0（微软开放文档协议）
 *   - robots.txt：未明确禁止，但保守 2s delay
 *   - 重点抓 Azure/Linux/WSL 相关页面（对运维最有价值）
 *
 * 范围限定：
 *   - 仅抓 /en-us/linux/ 子树
 *   - 子树包括：azure-linux, wsl, containers, networking, security
 *   - 跳过市场/营销页面（带 "?view=" query string 视为变体）
 */

import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { politeFetch, TokenBucket } from './polite-fetch'
import type { TutorialEntry, TutorialCategory } from '../types'
import type { CrawlProgress } from '@shared/crawler-types'
import { parseHtmlToTutorial, makeTutorialId } from './html-to-tutorial'

/** 来源元数据 */
const SOURCE_NAME = 'Microsoft Learn'
const SOURCE_LICENSE = 'CC BY 4.0'
const SOURCE_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
const SOURCE_KIND = 'online-crawl' as const

/** Microsoft Learn Linux 文档根 URL */
const MS_LEARN_BASE = 'https://learn.microsoft.com'
/** 抓取入口（多个核心 hub） */
const HUB_PAGES = [
  'https://learn.microsoft.com/en-us/linux/',
  'https://learn.microsoft.com/en-us/azure/azure-linux/',
  'https://learn.microsoft.com/en-us/windows/wsl/',
  'https://learn.microsoft.com/en-us/azure/containers/'
]

/** Rate Limiter：2s/请求（无 robots 限制，保守） */
const msLearnLimiter = new TokenBucket(1, 2000)

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
 * 从 hub 页提取所有子页 URL
 */
async function extractHubLinks(hubUrl: string, signal: AbortSignal): Promise<string[]> {
  const html = await politeFetch({ url: hubUrl, rateLimiter: msLearnLimiter, signal })
  const $ = cheerio.load(html)
  const links = new Set<string>()

  // MS Learn TOC 通常在 <nav> 或 <ul class="tree"> 中
  $('a[href]').each((_idx, el) => {
    const href = $(el).attr('href')
    if (!href) return
    if (href.startsWith('#') || href.startsWith('mailto:')) return
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|pdf|zip)$/i.test(href)) return

    let fullUrl: string
    if (href.startsWith('http')) {
      // 仅保留同域
      if (!href.startsWith(MS_LEARN_BASE)) return
      fullUrl = href
    } else if (href.startsWith('/')) {
      fullUrl = MS_LEARN_BASE + href
    } else {
      return // 相对路径，无 base
    }

    // 必须是 /en-us/ 路径（避免抓到其他语言）
    if (!/\/en-us\//.test(fullUrl)) return
    // 排除 query string 变体（?view=xxx）
    if (/[?&]view=/.test(fullUrl)) {
      // 只保留第一个 view 变体（避免重复）
      fullUrl = fullUrl.replace(/[?&]view=[^&]+/, '')
    }
    // 排除 hub 自身和首页
    const path = fullUrl.split('?')[0].replace(/\/$/, '')
    if (path === hubUrl.replace(/\/$/, '') || path.endsWith('/index')) return

    links.add(fullUrl.split('?')[0]) // 去 query
  })

  return Array.from(links)
}

/**
 * 从 URL 推断 TutorialCategory
 */
function inferCategoryFromUrl(url: string): TutorialCategory {
  const u = url.toLowerCase()
  if (/network|dns|vnet|ip-|nic|load-balance/.test(u)) return 'networking'
  if (/security|firewall|policy|nsg|key-vault|crypt|secret/.test(u)) return 'security'
  if (/package|apt|dpkg|installation/.test(u)) return 'package-management'
  if (/service|systemd|init|kubelet/.test(u)) return 'services'
  if (/shell|bash|script|wsl|terminal|command/.test(u)) return 'shell-scripting'
  if (/database|sql|postgres|mysql|mariadb/.test(u)) return 'database'
  if (/disk|storage|blob|file|fs/.test(u)) return 'storage'
  if (/web|nginx|apache|http|iis|caddy/.test(u)) return 'web-server'
  if (/kernel|boot|grub/.test(u)) return 'linux-basics'
  if (/user|account|rbac|role|access/.test(u)) return 'user-management'
  if (/monitor|metric|log|insights|alert/.test(u)) return 'monitoring'
  if (/container|docker|kubernetes|aks|pod|vm/.test(u)) return 'virtualization'
  return 'linux-basics'
}

/**
 * 从 URL 提取产品标签
 */
function extractTagsFromUrl(url: string): string[] {
  const tags: string[] = []
  if (/azure-linux/.test(url)) tags.push('azure-linux')
  if (/wsl/.test(url)) tags.push('wsl')
  if (/container/.test(url)) tags.push('containers')
  if (/aks|kubernetes/.test(url)) tags.push('kubernetes')
  if (/vnet|virtual-network/.test(url)) tags.push('networking')
  if (/vmware|hyper-v|virtual-machines/.test(url)) tags.push('virtualization')
  if (tags.length === 0) tags.push('linux')
  return tags
}

/**
 * 提取 MS Learn 页面的主内容
 */
function extractMainContent(html: string): { title: string; contentHtml: string } {
  const $ = cheerio.load(html)
  // MS Learn 主内容通常在 <main> 或 .content
  let contentEl = $('main').first()
  if (contentEl.length === 0) {
    contentEl = $('[role="main"]').first()
  }
  if (contentEl.length === 0) {
    contentEl = $('.content').first()
  }
  if (contentEl.length === 0) {
    contentEl = $('body')
  }
  // 移除噪声
  contentEl.find('script, style, nav, header, footer, .nav, .breadcrumb, .toc, .sidebar').remove()

  const title = $('h1').first().text().trim() || $('title').text().trim().split(' - ')[0]

  return {
    title,
    contentHtml: contentEl.html() ?? ''
  }
}

/**
 * 抓取 Microsoft Learn Linux 文档
 */
export async function crawlMsLearn(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const entries: TutorialEntry[] = []
  const seenIds = new Set<string>()

  // 1) 收集所有 hub 链接
  onProgress({
    sourceId: 'ms-learn',
    sourceLabel: SOURCE_NAME,
    phase: 'downloading',
    message: '收集 Microsoft Learn 索引...',
    progress: 0,
    processed: 0,
    total: 0
  })

  const allLinks: string[] = []
  for (const hubUrl of HUB_PAGES) {
    if (signal.aborted) return entries
    try {
      const links = await extractHubLinks(hubUrl, signal)
      for (const link of links) {
        if (!allLinks.includes(link)) allLinks.push(link)
      }
      onProgress({
        sourceId: 'ms-learn',
        sourceLabel: SOURCE_NAME,
        phase: 'downloading',
        message: `✓ ${hubUrl.split('/').slice(-2, -1)[0]}: ${links.length} 个子页`,
        progress: 0.05,
        processed: allLinks.length,
        total: allLinks.length
      })
    } catch (err) {
      onProgress({
        sourceId: 'ms-learn',
        sourceLabel: SOURCE_NAME,
        phase: 'downloading',
        message: `⚠️ hub 失败 ${hubUrl}: ${(err as Error).message.slice(0, 50)}`,
        progress: 0.05,
        processed: allLinks.length,
        total: allLinks.length
      })
    }
  }

  if (allLinks.length === 0) {
    onProgress({
      sourceId: 'ms-learn',
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
    sourceId: 'ms-learn',
    sourceLabel: SOURCE_NAME,
    phase: 'downloading',
    message: `开始抓取 ${allLinks.length} 个子页（约 ${Math.ceil(allLinks.length * 2 / 60)} 分钟）`,
    progress: 0.1,
    processed: 0,
    total: allLinks.length
  })

  // 2) 串行抓取
  for (let i = 0; i < allLinks.length; i++) {
    if (signal.aborted) {
      onProgress({
        sourceId: 'ms-learn',
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

    const url = allLinks[i]
    try {
      const html = await politeFetch({ url, rateLimiter: msLearnLimiter, signal })
      const { title, contentHtml } = extractMainContent(html)
      if (!contentHtml.trim()) continue

      const markdown = getTurndown().turndown(contentHtml)
      if (markdown.length < 200) continue

      const id = makeTutorialId(url)
      if (seenIds.has(id)) continue
      seenIds.add(id)

      const baseEntry = parseHtmlToTutorial(contentHtml, {
        url,
        sourceName: SOURCE_NAME,
        license: SOURCE_LICENSE,
        licenseUrl: SOURCE_LICENSE_URL,
        kind: SOURCE_KIND,
        category: inferCategoryFromUrl(url),
        difficulty: 'intermediate',
        tags: ['microsoft', 'official', ...extractTagsFromUrl(url)],
        distros: ['ubuntu']
      })
      if (!baseEntry) continue

      if (title) baseEntry.title = title
      baseEntry.id = id
      baseEntry.commands = extractCommands(markdown)
      baseEntry.keywords = extractKeywords(markdown, baseEntry.title)
      baseEntry.readingTime = estimateReadingTime(markdown)

      entries.push(baseEntry)

      onProgress({
        sourceId: 'ms-learn',
        sourceLabel: SOURCE_NAME,
        phase: 'parsing',
        message: `✓ [${i + 1}/${allLinks.length}] ${baseEntry.title}（${markdown.length} 字符）`,
        progress: 0.1 + 0.85 * ((i + 1) / allLinks.length),
        processed: entries.length,
        total: allLinks.length
      })
    } catch (err) {
      onProgress({
        sourceId: 'ms-learn',
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
    sourceId: 'ms-learn',
    sourceLabel: SOURCE_NAME,
    phase: 'done',
    message: `✅ 完成：${entries.length} 篇教程`,
    progress: 1,
    processed: entries.length,
    total: allLinks.length
  })

  return entries
}

/**
 * 提取代码块中的命令
 */
function extractCommands(md: string): string[] {
  const commands: string[] = []
  const codeBlockRe = /```(?:bash|sh|shell|powershell|azurecli)?\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = codeBlockRe.exec(md)) !== null) {
    const code = match[1].trim()
    const lines = code.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    for (const line of lines.slice(0, 3)) {
      commands.push(line)
    }
  }
  return Array.from(new Set(commands)).slice(0, 20)
}

/**
 * 提取关键词
 */
function extractKeywords(md: string, title: string): string[] {
  const text = (title + ' ' + md).toLowerCase()
  const headingRe = /^#{1,3}\s+(.+)$/gm
  const headings: string[] = []
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(md)) !== null) {
    headings.push(m[1].trim())
  }
  const dict = [
    'azure', 'linux', 'wsl', 'container', 'docker', 'kubernetes', 'aks',
    'network', 'vnet', 'security', 'firewall', 'identity', 'rbac', 'policy',
    'monitor', 'log', 'metric', 'backup', 'storage', 'blob', 'keyvault',
    'service', 'cluster', 'node', 'pod', 'deployment', 'helm'
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
 * 估算阅读时间
 */
function estimateReadingTime(md: string): number {
  const cjk = (md.match(/[\u4e00-\u9fa5]/g) || []).length
  const en = (md.match(/[a-zA-Z]+/g) || []).length
  const cjkMin = cjk / 300
  const enMin = en / 200
  return Math.max(1, Math.round(cjkMin + enMin))
}
