/**
 * HTML → TutorialEntry 通用转换器
 *
 * 教学术语：
 * - cheerio：jQuery-like 的服务端 HTML 解析库（Node.js）
 * - turndown：HTML → Markdown 转换库
 * - Reading Time (阅读时间)：基于字数估算（中文 300 字/分钟，英文 200 词/分钟）
 *
 * 设计原则：
 * 1. 不依赖具体源结构，参数化元数据提取函数
 * 2. 单篇失败不阻塞（try/catch + 警告日志）
 * 3. 主键用 URL sha256 前 16 位（确保跨源稳定）
 */

import { createHash } from 'node:crypto'
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { TutorialEntry, TutorialCategory, TutorialDifficulty, LinuxDistro } from '../types'

/** HTML 解析元数据 */
export interface HtmlMeta {
  /** 原始 URL（用于 ID 生成） */
  url: string
  /** 来源名称 */
  sourceName: string
  /** License */
  license: string
  /** License 详情页 URL（可选；留空时由 license 字符串推断） */
  licenseUrl?: string
  /** 来源类型（默认 offline-dump） */
  kind?: 'offline-dump' | 'github-clone' | 'online-crawl'
  /** 分类（必须映射到 TutorialCategory） */
  category: TutorialCategory
  /** 难度（默认 beginner） */
  difficulty?: TutorialDifficulty
  /** 自定义标签（会自动合并到 keywords） */
  tags?: string[]
  /** 关联发行版（默认空数组） */
  distros?: LinuxDistro[]
}

/** 按 License 字符串推断详情页 URL（CC BY-SA / GNU FDL / MIT） */
export function inferLicenseUrl(license: string): string | undefined {
  const norm = license.toLowerCase().replace(/\s+/g, '')
  if (/ccby-?sa/i.test(license) || /ccbysa/i.test(norm)) {
    // 匹配 CC BY-SA 4.0 / CC BY-SA 3.0 / CC BY-SA 2.5 等
    const m = license.match(/(\d)\.(\d)/)
    if (m) return `https://creativecommons.org/licenses/by-sa/${m[1]}.${m[2]}/`
    return 'https://creativecommons.org/licenses/by-sa/4.0/'
  }
  if (/ccby(?!-?sa)/i.test(license)) {
    const m = license.match(/(\d)\.(\d)/)
    if (m) return `https://creativecommons.org/licenses/by/${m[1]}.${m[2]}/`
    return 'https://creativecommons.org/licenses/by/4.0/'
  }
  if (/gnufdl|gnufree/i.test(license)) {
    return 'https://www.gnu.org/licenses/fdl-1.3.html'
  }
  if (/gpl/i.test(license)) {
    return 'https://www.gnu.org/licenses/gpl-3.0.html'
  }
  if (/^mit$|mitlicense/i.test(license)) {
    return 'https://opensource.org/licenses/MIT'
  }
  if (/apache/i.test(license)) {
    return 'https://www.apache.org/licenses/LICENSE-2.0'
  }
  if (/bsd/i.test(license)) {
    return 'https://opensource.org/licenses/BSD-3-Clause'
  }
  return undefined
}

/** turndown 全局单例（避免重复创建） */
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
    // 保留表格
    _turndown.addRule('tableCellNewline', {
      filter: 'tr',
      replacement: (content: string) => `| ${content.trim().replace(/\n+/g, ' ')} |\n`
    })
  }
  return _turndown
}

/** 从 URL 生成稳定的教程 ID */
export function makeTutorialId(url: string): string {
  return `tut-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`
}

/** 估算阅读时间（分钟） */
function estimateReadingTime(text: string): number {
  // 简单规则：英文按 200 词/分钟，中文按 300 字/分钟
  const cjkChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const enWords = (text.match(/[a-zA-Z]+/g) || []).length
  const minutes = cjkChars / 300 + enWords / 200
  return Math.max(1, Math.ceil(minutes))
}

/** 提取代码块命令（用于 commands 字段） */
function extractCommands(md: string): string[] {
  const lines = md.split('\n')
  const cmds: string[] = []
  let inCodeBlock = false
  let lang = ''
  let buf: string[] = []

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // 结束
        if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === '') {
          for (const cmd of buf) {
            const t = cmd.trim()
            // 过滤空行和注释
            if (t && !t.startsWith('#')) {
              cmds.push(t)
            }
          }
        }
        inCodeBlock = false
        lang = ''
        buf = []
      } else {
        inCodeBlock = true
        lang = line.slice(3).trim()
        buf = []
      }
      continue
    }
    if (inCodeBlock) {
      buf.push(line)
    }
  }
  return cmds
}

/** 提取关键词（基于 title + tags + 前 200 词） */
function extractKeywords(meta: HtmlMeta, title: string, md: string): string[] {
  const kws = new Set<string>()
  // 1. title 分词
  for (const w of title.split(/\s+/)) {
    if (w.length >= 2) kws.add(w.toLowerCase())
  }
  // 2. 用户提供 tags
  for (const t of meta.tags ?? []) kws.add(t.toLowerCase())
  // 3. md 前 200 个非停用词
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'and', 'or', 'not', 'this', 'that', 'it', 'its', 'you', 'your', 'can', 'will', 'use', 'used', 'using'])
  const words = md.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []
  for (const w of words.slice(0, 200)) {
    if (!stopWords.has(w)) kws.add(w)
  }
  return Array.from(kws).slice(0, 30)
}

/**
 * 将 HTML 字符串解析为 TutorialEntry
 *
 * @param html 完整 HTML 字符串
 * @param meta 元数据（必须由调用方根据源类型填充）
 * @returns 成功返回 TutorialEntry，失败返回 null
 */
export function parseHtmlToTutorial(html: string, meta: HtmlMeta): TutorialEntry | null {
  try {
    if (!html || !meta.url) return null

    // Phase 1-c 强制 source 标注：必填字段校验
    if (!meta.sourceName || !meta.license) {
      console.warn(
        `[html-to-tutorial] 跳过：source 必填字段缺失 (url=${meta.url}, name=${meta.sourceName || 'EMPTY'}, license=${meta.license || 'EMPTY'})`
      )
      return null
    }

    const $ = cheerio.load(html)
    // 移除 script/style/nav/header/footer
    $('script, style, nav, header, footer, aside, .navigation, #mw-navigation, .mw-jump-link, .printfooter').remove()

    // 提取正文（Arch Wiki 的 #mw-content-text，LDP 通常是 body）
    let bodyHtml = $('#mw-content-text').html() || $('#content').html() || $('body').html() || ''
    if (!bodyHtml || bodyHtml.length < 100) return null

    // HTML → Markdown
    const turndown = getTurndown()
    let md = turndown.turndown(bodyHtml)

    // 提取标题
    const title =
      $('h1').first().text().trim() ||
      $('title').first().text().trim() ||
      meta.url.split('/').pop()?.replace(/-/g, ' ') ||
      'Untitled'

    // 提取首段作为 summary
    const summary = $('p').first().text().trim().slice(0, 200) || title

    // 提取 commands
    const commands = extractCommands(md)

    // 提取 keywords
    const keywords = extractKeywords(meta, title, md)

    // 估算阅读时间
    const readingTime = estimateReadingTime(md)

    const now = Date.now()
    return {
      id: makeTutorialId(meta.url),
      title,
      summary,
      source: {
        name: meta.sourceName,
        url: meta.url,
        crawledAt: now,
        license: meta.license,
        licenseUrl: meta.licenseUrl || inferLicenseUrl(meta.license),
        kind: meta.kind ?? 'offline-dump'
      },
      category: meta.category,
      tags: meta.tags ?? [],
      difficulty: meta.difficulty ?? 'beginner',
      readingTime,
      content: md,
      commands,
      keywords,
      distros: meta.distros ?? [],
      createdAt: now,
      updatedAt: now
    }
  } catch (err) {
    console.warn(`[html-to-tutorial] 解析失败 (${meta.url}):`, (err as Error).message)
    return null
  }
}

/** 从 HTML 提取分类（基于关键词启发式） */
export function guessCategory(html: string, filePath: string): TutorialCategory {
  const text = html.toLowerCase()
  const path = filePath.toLowerCase()

  // 路径优先
  if (/network|wifi|ipv4|ipv6|dns|netplan|firewall/.test(path)) return 'networking'
  if (/security|ssh|selinux|crypt|pam|firewall|audit/.test(path)) return 'security'
  if (/package|pacman|apt|dnf|yum|nix/.test(path)) return 'package-management'
  if (/systemd|service|init|journal/.test(path)) return 'services'
  if (/container|docker|podman|kubernetes|k8s/.test(path)) return 'containers'
  if (/virtual|qemu|kvm|libvirt|virtualbox/.test(path)) return 'virtualization'
  if (/web|nginx|apache|httpd|cgi|php/.test(path)) return 'web-server'
  if (/database|mysql|postgres|mariadb|sqlite/.test(path)) return 'database'
  if (/storage|lvm|raid|fs|mount|fdisk/.test(path)) return 'storage'
  if (/shell|bash|script|zsh|fish/.test(path)) return 'shell-scripting'
  if (/monitor|log|performance|tuning/.test(path)) return 'monitoring'
  if (/troubleshoot|debug|recovery|rescue/.test(path)) return 'troubleshooting'
  if (/cloud|aws|azure|gcp|openstack/.test(path)) return 'cloud'
  if (/user|permission|sudo|group|acl/.test(path)) return 'user-management'

  // 内容次之
  if (/netplan|networkmanager|systemd-networkd/.test(text)) return 'networking'
  if (/firewalld|iptables|nftables/.test(text)) return 'security'
  if (/systemctl|journalctl|systemd/.test(text)) return 'services'
  if (/docker|podman|containerd/.test(text)) return 'containers'

  return 'linux-basics'
}

/** 从 HTML/路径提取关联发行版 */
export function guessDistros(html: string, filePath: string): LinuxDistro[] {
  const text = (html + ' ' + filePath).toLowerCase()
  const distros: LinuxDistro[] = []
  if (/arch/.test(text)) distros.push('arch')
  if (/ubuntu|debian/.test(text)) distros.push('ubuntu')
  if (/rhel|centos|red hat|fedora|rocky|alma/.test(text)) distros.push('rhel')
  if (/opensuse|suse/.test(text)) distros.push('opensuse')
  return distros
}
