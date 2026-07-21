/**
 * wiki.debian.org 离线抓取器（MediaWiki API + 精选核心页）
 *
 * 教学术语：
 * - MediaWiki：维基百科同款 wiki 引擎，提供结构化 API
 * - wikitext：MediaWiki 标记语言，类似 Markdown 但更复杂
 * - backlinking：被其他页面引用的次数，可作为"页面重要性"指标
 * - 429 Too Many Requests：触发反爬限速时返回
 *
 * 数据流：
 *   1. politeFetch 拉精选 30 个核心页面（手动指定，避免全量 8000+ 页）
 *   2. 严格 20s delay（robots.txt 要求）
 *   3. 对每个页面抓 wikitext（MediaWiki API: prop=revisions&rvprop=content）
 *   4. 简单 wikitext → Markdown 转换（自写规则）
 *   5. 输出 TutorialEntry（source.kind = 'online-crawl', license = 'CC BY-SA 3.0'）
 *
 * 合规说明：
 *   - robots.txt：Crawl-delay: 20, Disallow: /action/
 *   - License：CC BY-SA 3.0（多数 Debian Wiki 页面）
 *   - 严格 20s/请求（不并发）
 *   - 30 个精选页面 × 20s = 10 分钟，符合用户预期
 *
 * 为什么是 Phase 2 P1 选择性？
 *   - 20s delay 太长，全量 8000+ 页需 44 小时
 *   - **策略**：只抓精选 30 个"运维必读"页面
 *   - 后续可按"被引用数"扩展为 Top 200
 *
 * wikitext → MD 简化规则（仅处理核心语法）：
 *   - `=== Title ===` → `# Title`（标题层级）
 *   - `== Section ==` → `## Section`
 *   - `'''bold'''` → `**bold**`
 *   - `''italic''` → `*italic*`
 *   - `[[link|text]]` → `[text](link)`
 *   - `[[link]]` → `[link](link)`
 *   - `* item` → `- item`（列表）
 *   - `{{...}}` 模板 → 移除
 *   - `<code>...</code>` → `` `...` ``
 *   - `<pre>...</pre>` → 代码块
 *   - `<ref>...</ref>` → 移除
 */

import { politeFetch, TokenBucket } from './polite-fetch'
import type { TutorialEntry, TutorialCategory, LinuxDistro } from '../types'
import type { CrawlProgress } from '@shared/crawler-types'
import { makeTutorialId } from './html-to-tutorial'

/** 来源元数据 */
const SOURCE_NAME = 'Debian Wiki'
const SOURCE_LICENSE = 'CC BY-SA 3.0'
const SOURCE_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/3.0/'
const SOURCE_KIND = 'online-crawl' as const
/** Debian Wiki API 端点 */
const DEBIAN_WIKI_API = 'https://wiki.debian.org/api.php'
/** Debian Wiki 主页 */
const DEBIAN_WIKI_BASE = 'https://wiki.debian.org'

/** Rate Limiter：严格 20s/请求（robots.txt 要求） */
const debianLimiter = new TokenBucket(1, 20_000)

/**
 * 精选 30 个 Debian Wiki 核心页面
 * 按"运维必读"优先级排序
 */
const TOPICS: Array<{ title: string; category: TutorialCategory; tags: string[] }> = [
  { title: 'DebianReleases', category: 'linux-basics', tags: ['releases', 'lifecycle'] },
  { title: 'PackageManagement', category: 'package-management', tags: ['apt', 'dpkg'] },
  { title: 'Apt', category: 'package-management', tags: ['apt'] },
  { title: 'Aptitude', category: 'package-management', tags: ['apt'] },
  { title: 'SourcesList', category: 'package-management', tags: ['apt', 'sources'] },
  { title: 'Dpkg', category: 'package-management', tags: ['dpkg'] },
  { title: 'NetworkConfiguration', category: 'networking', tags: ['network', 'config'] },
  { title: 'DNS', category: 'networking', tags: ['dns'] },
  { title: 'Firewall', category: 'security', tags: ['firewall', 'iptables'] },
  { title: 'Iptables', category: 'security', tags: ['iptables', 'firewall'] },
  { title: 'SSH', category: 'networking', tags: ['ssh'] },
  { title: 'OpenSSH', category: 'networking', tags: ['ssh'] },
  { title: 'Sudo', category: 'security', tags: ['sudo'] },
  { title: 'Root', category: 'user-management', tags: ['root'] },
  { title: 'Cron', category: 'services', tags: ['cron', 'scheduling'] },
  { title: 'Systemd', category: 'services', tags: ['systemd'] },
  { title: 'Journalctl', category: 'monitoring', tags: ['systemd', 'logs'] },
  { title: 'Logrotate', category: 'services', tags: ['logrotate'] },
  { title: 'Locale', category: 'linux-basics', tags: ['locale', 'i18n'] },
  { title: 'TimeZone', category: 'linux-basics', tags: ['timezone'] },
  { title: 'Kernel', category: 'linux-basics', tags: ['kernel'] },
  { title: 'Fdisk', category: 'storage', tags: ['partitioning'] },
  { title: 'Partition', category: 'storage', tags: ['partitioning'] },
  { title: 'LVM', category: 'storage', tags: ['lvm'] },
  { title: 'Fstab', category: 'storage', tags: ['mount'] },
  { title: 'UsersAndGroups', category: 'user-management', tags: ['users'] },
  { title: 'Permissions', category: 'security', tags: ['permissions'] },
  { title: 'Certificates', category: 'security', tags: ['ssl', 'tls'] },
  { title: 'DebianInstaller', category: 'linux-basics', tags: ['installer'] },
  { title: 'ShellScript', category: 'shell-scripting', tags: ['bash', 'scripting'] }
]

/**
 * 简单 wikitext → Markdown 转换
 *
 * 教学术语：Wikitext 是 MediaWiki 使用的标记语言
 * - 标题：`== xxx ==`（H2），`=== xxx ===`（H3）
 * - 强调：`'''bold'''`（粗体），`''italic''`（斜体）
 * - 链接：`[[Page|text]]`（内链），`[url text]`（外链）
 * - 列表：以 `*` / `#` / `:` 开头的行
 */
function wikitextToMd(wikitext: string): string {
  let md = wikitext

  // 移除 <ref>...</ref>、<references/>、<noinclude>、<includeonly>
  md = md.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  md = md.replace(/<references\s*\/>/g, '')
  md = md.replace(/<noinclude>[\s\S]*?<\/noinclude>/g, '')
  md = md.replace(/<includeonly>[\s\S]*?<\/includeonly>/g, '')

  // 移除分类（页面底部的 [[Category:xxx]]）
  md = md.replace(/\[\[Category:[^\]]+\]\]/g, '')

  // 移除模板 {{...}}（用非贪婪匹配，支持嵌套）
  let prev: string
  do {
    prev = md
    md = md.replace(/\{\{[^{}]*\}\}/g, '')
  } while (md !== prev)

  // 标题（H3 → H2, H4 → H3, H5 → H4）
  md = md.replace(/^=====\s*(.+?)\s*=====/gm, '#### $1')
  md = md.replace(/^====\s*(.+?)\s*====/gm, '### $1')
  md = md.replace(/^===\s*(.+?)\s*===/gm, '## $1')
  md = md.replace(/^==\s*(.+?)\s*==/gm, '# $1')

  // 粗体 + 斜体
  md = md.replace(/'''''(.+?)'''''/g, '***$1***')
  md = md.replace(/'''(.+?)'''/g, '**$1**')
  md = md.replace(/''(.+?)''/g, '*$1*')

  // 内链 [[Page|text]] → [text](Page) ，[[Page]] → [Page](Page)
  md = md.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '[$2]($1)')
  md = md.replace(/\[\[([^\]]+)\]\]/g, '[$1]($1)')

  // 外链 [url text]
  md = md.replace(/\[(\S+)\s+([^\]]+)\]/g, '[$2]($1)')

  // <code>...</code> → `...`
  md = md.replace(/<code>([\s\S]*?)<\/code>/g, '`' + '$1' + '`')
  // <pre>...</pre> → 围栏代码块
  md = md.replace(/<pre>([\s\S]*?)<\/pre>/g, '```\n' + '$1' + '\n```')

  // 列表项
  md = md.replace(/^\*\s+/gm, '- ')
  md = md.replace(/^#\s+/gm, '1. ')
  md = md.replace(/^:\s+/gm, '  ')

  // 移除剩余的 HTML 标签
  md = md.replace(/<\/?[a-zA-Z][^>]*>/g, '')

  return md.trim()
}

/** 估算阅读时间（英文为主） */
function estimateReadingTime(text: string): number {
  const enWords = (text.match(/[a-zA-Z]+/g) || []).length
  return Math.max(1, Math.ceil(enWords / 200))
}

/** 提取代码块中的命令 */
function extractCommands(md: string): string[] {
  const lines = md.split('\n')
  const cmds: string[] = []
  let inCode = false
  let buf: string[] = []

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        for (const cmd of buf) {
          const t = cmd.trim()
          if (t && !t.startsWith('#') && t.length > 1) cmds.push(t)
        }
        inCode = false
        buf = []
      } else {
        inCode = true
        buf = []
      }
      continue
    }
    if (inCode) buf.push(line)
  }
  return cmds
}

/**
 * 通过 MediaWiki API 拿单个页面的 wikitext
 *
 * URL 模式：
 * https://wiki.debian.org/api.php?action=query&prop=revisions&titles=PageName&rvprop=content&format=json&rvslots=main
 */
async function fetchDebianPage(title: string, userAgent: string, signal: AbortSignal): Promise<{ wikitext: string; pageid: number } | null> {
  const apiUrl = `${DEBIAN_WIKI_API}?action=query&prop=revisions&titles=${encodeURIComponent(title)}&rvprop=content&format=json&rvslots=main&formatversion=2`
  const json = await politeFetch({
    url: apiUrl,
    rateLimiter: debianLimiter,
    userAgent,
    timeoutMs: 30_000,
    signal
  })
  try {
    const data = JSON.parse(json)
    const pages = data?.query?.pages
    if (!Array.isArray(pages) || pages.length === 0) return null
    const page = pages[0]
    if (!page || page.missing) return null
    const content = page.revisions?.[0]?.slots?.main?.content || page.revisions?.[0]?.['*']
    if (!content) return null
    return { wikitext: content, pageid: page.pageid }
  } catch (err) {
    console.warn(`[wiki.debian] 解析 JSON 失败 (${title}):`, (err as Error).message)
    return null
  }
}

/**
 * 抓取 wiki.debian.org 精选 30 个核心页面
 *
 * 20s/请求，预计耗时 10 分钟
 */
export async function crawlDebianWiki(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const sourceId = 'wiki-debian'
  const sourceLabel = 'Debian Wiki（精选 30 页）'
  const userAgent = 'TDSF-Linux-Desktop/0.6.0 (Educational; +https://github.com/tdsf; +mailto:crawler@tdsf.app)'

  try {
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'downloading',
      message: `礼貌抓取 Debian Wiki 30 个核心页（20s/请求，预计 10 分钟）...`,
      progress: 0,
      processed: 0,
      total: TOPICS.length
    })

    const entries: TutorialEntry[] = []
    const now = Date.now()
    let failed = 0

    for (let i = 0; i < TOPICS.length; i++) {
      if (signal.aborted) { throw new Error('用户已取消') }
      const topic = TOPICS[i]
      try {
        const result = await fetchDebianPage(topic.title, userAgent, signal)
        if (!result) {
          failed++
        } else {
          const md = wikitextToMd(result.wikitext)
          if (md.length < 200) {
            failed++
          } else {
            // 提取首段（找第一个无序列表之前的段落）
            const firstPara = md
              .split('\n')
              .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('-') && !l.startsWith('|') && !l.startsWith('!'))
              .slice(0, 3)
              .join('')
              .replace(/[*_`]/g, '')
              .trim()
              .slice(0, 200)

            const url = `${DEBIAN_WIKI_BASE}/${encodeURIComponent(topic.title)}`
            const commands = extractCommands(md)
            const keywords = [
              topic.title.toLowerCase(),
              'debian',
              'debian-wiki',
              ...topic.tags
            ]

            entries.push({
              id: makeTutorialId(`debian-wiki:${topic.title}`),
              title: `[Debian Wiki] ${topic.title}`,
              summary: firstPara || topic.title,
              source: {
                name: SOURCE_NAME,
                url,
                crawledAt: now,
                license: SOURCE_LICENSE,
                licenseUrl: SOURCE_LICENSE_URL,
                kind: SOURCE_KIND
              },
              category: topic.category,
              tags: ['debian-wiki', 'debian', ...topic.tags],
              difficulty: 'intermediate',
              readingTime: estimateReadingTime(md),
              content: md,
              commands,
              keywords,
              distros: ['debian'] as LinuxDistro[],
              createdAt: now,
              updatedAt: now
            })
          }
        }
      } catch (err) {
        failed++
        console.warn(`[wiki.debian] 抓取失败 (${topic.title}):`, (err as Error).message)
      }
      onProgress({
        sourceId,
        sourceLabel,
        phase: 'parsing',
        message: `解析 ${i + 1}/${TOPICS.length} (成功 ${entries.length}, 失败 ${failed})`,
        progress: (i + 1) / TOPICS.length,
        processed: i + 1,
        total: TOPICS.length
      })
    }

    onProgress({
      sourceId,
      sourceLabel,
      phase: 'done',
      message: `完成！成功 ${entries.length} 篇 Debian Wiki 精选页，失败 ${failed} 篇。License：${SOURCE_LICENSE} (${SOURCE_LICENSE_URL})`,
      progress: 1.0,
      processed: TOPICS.length,
      total: TOPICS.length
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
