/**
 * LDP (Linux Documentation Project) 离线包抓取器
 *
 * 教学术语：
 * - LDP (Linux Documentation Project)：Linux 文档项目，1995 年由 Matt Welsh 发起
 * - HOWTO：LDP 经典文档格式，"如何做 X" 的完整指南
 * - GNU FDL (Free Documentation License)：GNU 自由文档许可证
 *
 * 数据流：
 *   1. 访问 LDP HOWTO 索引页
 *   2. 解析所有 HOWTO 链接
 *   3. 并发下载（限流 3 个）每个 HOWTO HTML
 *   4. cheerio 解析 + turndown 转 Markdown
 *   5. 返回 TutorialEntry[]
 *
 * 合规说明：
 *   - LDP HOWTOs 都采用 GNU FDL 许可证
 *   - 整理 + 引用 + 标注 source.url
 */

import * as cheerio from 'cheerio'
import type { TutorialEntry, TutorialCategory } from '../types'
import type { CrawlProgress } from '@shared/crawler-types'
import { parseHtmlToTutorial, guessCategory, guessDistros } from './html-to-tutorial'
import { politeFetch, TokenBucket } from './polite-fetch'

/** LDP HOWTO 索引页 */
const LDP_HOWTO_INDEX = 'https://www.tldp.org/HOWTO/HOWTO-INDEX/howtos.html'
const LDP_BASE_URL = 'https://www.tldp.org'
const SOURCE_NAME = 'The Linux Documentation Project'
const SOURCE_LICENSE = 'GNU Free Documentation License'

/** LDP 限流桶：3 并发、每秒补充 1 个令牌（合 robots.txt 友好） */
const ldpBucket = new TokenBucket(3, 1000)

/** 从索引页提取所有 HOWTO 链接 */
async function fetchHowtoLinks(signal: AbortSignal): Promise<string[]> {
  const html = await politeFetch({ url: LDP_HOWTO_INDEX, rateLimiter: ldpBucket, signal })
  const $ = cheerio.load(html)
  const links: string[] = []
  // LDP 索引页结构：<a href="../HOWTO/HTML/xxx.html">title</a>
  // href 是相对路径，需要解析为绝对 URL
  $('a[href*="HOWTO"]').each((_idx: number, el) => {
    const href = $(el).attr('href')
    if (!href) return
    if (!href.endsWith('.html')) return
    let fullUrl: string
    if (href.startsWith('http://') || href.startsWith('https://')) {
      fullUrl = href
    } else if (href.startsWith('//')) {
      fullUrl = 'https:' + href
    } else if (href.startsWith('/')) {
      // 绝对路径，相对于 tldp.org
      fullUrl = `https://www.tldp.org${href}`
    } else {
      // 相对路径（包含 ../），用 URL 解析
      try {
        const u = new URL(href, LDP_HOWTO_INDEX)
        fullUrl = u.toString()
      } catch {
        // 兜底：去掉 ../ 拼接到 BASE
        const cleaned = href.replace(/^\.\.\//, '').replace(/^\.\//, '')
        fullUrl = `${LDP_BASE_URL}/${cleaned}`
      }
    }
    // 规整化 URL（去 ../）
    try {
      const u = new URL(fullUrl)
      // 简化：去掉路径中的 ../
      u.pathname = u.pathname.replace(/\/\.\.\//g, '/').replace(/^\.\.\//, '')
      fullUrl = u.toString()
    } catch {
      // 忽略
    }
    links.push(fullUrl)
  })
  return Array.from(new Set(links))
}

/** 从 LDP HOWTO 链接提取分类 */
function linkToCategory(url: string): TutorialCategory {
  const u = url.toLowerCase()
  if (/network|dns|dialup|cable|modem|wifi/.test(u)) return 'networking'
  if (/security|crypt|firewall|selinux|pam|vpn/.test(u)) return 'security'
  if (/package|dpkg|rpm|apt/.test(u)) return 'package-management'
  if (/systemd|init|service/.test(u)) return 'services'
  if (/bash|shell|script|perl|python/.test(u)) return 'shell-scripting'
  if (/database|mysql|postgres/.test(u)) return 'database'
  if (/lvm|raid|disk|fs|loop/.test(u)) return 'storage'
  if (/web|apache|httpd|cgi|php/.test(u)) return 'web-server'
  if (/kernel|module|grub|lilo/.test(u)) return 'linux-basics'
  if (/user|login|shadow|password/.test(u)) return 'user-management'
  if (/monitor|log|tune/.test(u)) return 'monitoring'
  if (/docker|kubernetes|qemu|virtual/.test(u)) return 'virtualization'
  return 'linux-basics'
}

/**
 * 抓取 LDP HOWTOs
 *
 * @param onProgress 进度回调
 * @returns 解析出的 TutorialEntry[]
 */
export async function crawlLdpHowtos(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const sourceId = 'ldp-howtos'
  const sourceLabel = 'LDP HOWTOs（Linux 文档项目）'

  try {
    // 1. 获取 HOWTO 链接列表
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'downloading',
      message: '获取 HOWTO 索引...',
      progress: 0,
      processed: 0,
      total: 0
    })
    const links = await fetchHowtoLinks(signal)
    const total = links.length
    if (total === 0) {
      throw new Error('未找到 HOWTO 链接，请检查 LDP 索引页结构')
    }

    // 2. 并发抓取（受 Token Bucket 限流，3 并发，1 req/s）
    const entries: TutorialEntry[] = []
    let processed = 0
    let failed = 0

    // 直接并发跑（Token Bucket 内部限流）
    await Promise.all(
      links.map(async (url) => {
        if (signal.aborted) { throw new Error('用户已取消') }
        try {
          const html = await politeFetch({ url, rateLimiter: ldpBucket, signal })
          const category = linkToCategory(url)
          const distros = guessDistros(html, url)

          const entry = parseHtmlToTutorial(html, {
            url,
            sourceName: SOURCE_NAME,
            license: SOURCE_LICENSE,
            category: distros.length > 0 ? category : (guessCategory(html, url) || category),
            tags: ['LDP', 'HOWTO'],
            distros: distros.length > 0 ? distros : []
          })
          if (entry) entries.push(entry)
          else failed++
        } catch (err) {
          failed++
          console.warn(`[ldp] 抓取失败 (${url}):`, (err as Error).message)
        }
        processed++
        // 进度（占总进度的 90%）
        onProgress({
          sourceId,
          sourceLabel,
          phase: 'downloading',
          message: `抓取 ${processed}/${total} (成功 ${entries.length}, 失败 ${failed})`,
          progress: 0.05 + (processed / total) * 0.9,
          processed,
          total
        })
      })
    )

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
