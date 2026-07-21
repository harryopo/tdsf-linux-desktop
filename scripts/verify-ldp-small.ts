/**
 * LDP 小批量验证脚本（限制 30 条）
 *
 * 教学术语：
 * - E2E (End-to-End)：端到端测试
 * - 限流（Rate Limiting）：通过 Token Bucket 控制请求速率，遵守 robots.txt
 *
 * 设计理由：
 * - LDP 索引页有 ~313 个 HOWTO 链接，完整抓取需 5-10 分钟
 * - 验证目的只需确认「解析链路 OK + 入库字段完整」
 * - 取前 30 条：约 10-15 秒完成；覆盖主分类（network/security/storage/services）
 *
 * 实现策略：
 * - 不复用 crawlLdpHowtos（其 Promise.all 在某些环境下会在前 3 条后退出）
 * - 直接调 politeFetch 顺序抓前 30 条（更可控）
 */
import { resolveDbPath, DatabaseManager } from '../src/main/services/db/database'
import { TutorialRepository } from '../src/main/services/tutorial/tutorial-repo'
import { politeFetch, TokenBucket } from '../src/main/services/tutorial/crawler/polite-fetch'
import { parseHtmlToTutorial, guessCategory, guessDistros } from '../src/main/services/tutorial/crawler/html-to-tutorial'
import * as cheerio from 'cheerio'
import * as os from 'node:os'
import * as path from 'node:path'
import type { TutorialCategory } from '../src/main/services/tutorial/types'

const LDP_LIMIT = 30
const LDP_HOWTO_INDEX = 'https://www.tldp.org/HOWTO/HOWTO-INDEX/howtos.html'
const LDP_BASE_URL = 'https://www.tldp.org'
const SOURCE_NAME = 'The Linux Documentation Project'
const SOURCE_LICENSE = 'GNU Free Documentation License'

const tmpDbPath = path.join(os.tmpdir(), `tdsf-ldp-small-${Date.now()}.db`)
console.log(`[LDP-Small] 临时数据库: ${tmpDbPath}`)

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

async function fetchHowtoLinks(): Promise<string[]> {
  console.log(`[LDP-Small] 获取索引页: ${LDP_HOWTO_INDEX}`)
  const html = await politeFetch({ url: LDP_HOWTO_INDEX, baseIntervalMs: 500 })
  const $ = cheerio.load(html)
  const links: string[] = []
  $('a[href*="HOWTO"]').each((_idx: number, el) => {
    const href = $(el).attr('href')
    if (!href || !href.endsWith('.html')) return
    let fullUrl: string
    if (href.startsWith('http://') || href.startsWith('https://')) {
      fullUrl = href
    } else if (href.startsWith('//')) {
      fullUrl = 'https:' + href
    } else if (href.startsWith('/')) {
      fullUrl = `https://www.tldp.org${href}`
    } else {
      try {
        fullUrl = new URL(href, LDP_HOWTO_INDEX).toString()
      } catch {
        const cleaned = href.replace(/^\.\.\//, '').replace(/^\.\//, '')
        fullUrl = `${LDP_BASE_URL}/${cleaned}`
      }
    }
    try {
      const u = new URL(fullUrl)
      u.pathname = u.pathname.replace(/\/\.\.\//g, '/').replace(/^\.\.\//, '')
      fullUrl = u.toString()
    } catch { /* ignore */ }
    links.push(fullUrl)
  })
  return Array.from(new Set(links))
}

async function main() {
  const db = DatabaseManager.getInstance(tmpDbPath)
  console.log(`[LDP-Small] DB 可用=${db.isAvailable()}`)

  const repo = new TutorialRepository(db)
  const beforeCount = repo.listAll().length
  console.log(`[LDP-Small] 抓取前教程数: ${beforeCount}`)

  const ac = new AbortController()
  setTimeout(() => ac.abort(), 120_000)  // 2 分钟总超时

  // 1. 抓索引
  const startMs = Date.now()
  const allLinks = await fetchHowtoLinks()
  console.log(`[LDP-Small] 索引共 ${allLinks.length} 条 HOWTO 链接`)

  // 2. 取前 30 条顺序抓取（1 并发，间隔 1s）
  const targets = allLinks.slice(0, LDP_LIMIT)
  console.log(`[LDP-Small] 顺序抓取前 ${targets.length} 条（每秒 1 req）...`)

  const entries = []
  let failed = 0
  for (let i = 0; i < targets.length; i++) {
    if (ac.signal.aborted) {
      console.log('[LDP-Small] 已 abort，停止抓取')
      break
    }
    const url = targets[i]
    try {
      const html = await politeFetch({
        url,
        baseIntervalMs: 1000,
        jitterMs: 200,
        signal: ac.signal
      })
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
      if (entry) {
        entries.push(entry)
        console.log(`  [${i + 1}/${targets.length}] ✓ ${entry.title.slice(0, 50)}...`)
      } else {
        failed++
        console.log(`  [${i + 1}/${targets.length}] ✗ 解析失败: ${url.slice(0, 60)}`)
      }
    } catch (err) {
      failed++
      console.log(`  [${i + 1}/${targets.length}] ✗ ${(err as Error).message}: ${url.slice(0, 60)}`)
    }
  }

  console.log(`[LDP-Small] 抓取完成: ${entries.length} 成功, ${failed} 失败`)

  // 3. 入库（直接传 TutorialEntry[]，让 toKnowledgeEntry 统一处理）
  const insertResult = repo.upsertMany(entries)
  const durationMs = Date.now() - startMs

  console.log('\n========== 结果 ==========')
  console.log(`  inserted=${insertResult.inserted} updated=${insertResult.updated} skipped=${insertResult.skipped}`)
  console.log(`  时长: ${(durationMs / 1000).toFixed(1)}s`)

  const all = repo.listAll()
  console.log(`\n[LDP-Small] 当前 DB 教程总数: ${all.length}`)
  console.log('\n========== 抽样（前 3 条）==========')
  for (const t of all.slice(0, 3)) {
    console.log(`  - [${t.source.name}] ${t.title}`)
    console.log(`    id: ${t.id}`)
    console.log(`    category: ${t.category} / ${t.difficulty}`)
    console.log(`    commands: ${t.commands.length} 条`)
    console.log(`    content 长度: ${t.content.length} 字符`)
  }

  const catSummary = repo.categorySummary()
  console.log('\n========== 分类统计 ==========')
  for (const c of catSummary) {
    if (c.count > 0) {
      console.log(`  ${c.label.padEnd(15)} ${c.count}`)
    }
  }

  console.log(`\n✅ LDP 小批量验证完成。临时 DB: ${tmpDbPath}`)
}

main().catch((err) => {
  console.error('[LDP-Small] ❌ 失败:', err)
  process.exit(1)
})
