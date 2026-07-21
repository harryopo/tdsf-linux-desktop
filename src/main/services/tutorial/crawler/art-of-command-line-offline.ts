/**
 * the-art-of-command-line 离线抓取器（GitHub Clone 方式）
 *
 * 教学术语：
 * - The Art of Command Line（命令行艺术）：jlevy 维护的中英双语 Linux 命令行精华
 *   - 仓库：https://github.com/jlevy/the-art-of-command-line
 *   - 协议：CC BY-SA 4.0
 *   - 形式：单 README 文件（中英两版本），Markdown
 *
 * 数据流：
 *   1. 浅克隆 jlevy/the-art-of-command-line
 *   2. 读取 README.md（英文版） + README-zh.md（中文版）
 *   3. 拆分为多个章节（按 ## 一级标题）
 *   4. 每个章节作为一个 TutorialEntry
 *   5. 返回 TutorialEntry[]
 *
 * 合规说明：
 *   - 协议：CC BY-SA 4.0
 *   - 0 爬虫礼仪风险（GitHub clone）
 *   - 标注 source.url = GitHub 原文链接
 *
 * 为什么拆分为多个 Entry？
 *   - 单 README 过长（~10 万字符），单条 TutorialEntry 不利于检索
 *   - 按 ## 章节拆分后，每条对应一个独立主题（搜索/索引更友好）
 *   - 章节级别与 Arch Wiki LDP 等的 HOWTO 颗粒度对齐
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { TutorialEntry, TutorialCategory, LinuxDistro } from '../types'
import type { CrawlProgress } from '@shared/crawler-types'
import { makeTutorialId } from './html-to-tutorial'

const execFileAsync = promisify(execFile)

/** jlevy/the-art-of-command-line 仓库地址 */
const AOC_REPO = 'https://github.com/jlevy/the-art-of-command-line.git'
/** 来源元数据 */
const SOURCE_NAME = 'The Art of Command Line'
const SOURCE_LICENSE = 'CC BY-SA 4.0'
const SOURCE_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
const SOURCE_KIND = 'github-clone' as const
/** 仓库根路径 */
const AOC_REPO_DIR_NAME = 'art-of-command-line'
/** 仓库 License URL */
const AOC_LICENSE_URL = 'https://github.com/jlevy/the-art-of-command-line/blob/master/LICENSE.md'

/** 浅克隆 */
async function cloneAocRepo(targetDir: string, onLog: (msg: string) => void): Promise<void> {
  onLog(`git clone ${AOC_REPO} -> ${targetDir}`)
  await execFileAsync(
    'git',
    ['clone', '--depth=1', AOC_REPO, AOC_REPO_DIR_NAME],
    { cwd: targetDir, timeout: 120_000 }
  )
}

/** 按一级标题（## ）拆分 Markdown */
function splitMarkdownBySections(md: string): Array<{ title: string; body: string; slug: string }> {
  const lines = md.split('\n')
  const sections: Array<{ title: string; body: string; slug: string }> = []
  let current: { title: string; body: string; lines: string[] } | null = null

  for (const line of lines) {
    if (line.match(/^##\s+(.+)$/)) {
      // 遇到新的一级标题，先保存上一节
      if (current) {
        sections.push({
          title: current.title,
          body: current.lines.join('\n').trim(),
          slug: slugify(current.title)
        })
      }
      const title = line.replace(/^##\s+/, '').trim()
      current = { title, body: '', lines: [] }
    } else {
      // 跳过 # 标题（项目主标题）和元信息头
      if (line.match(/^#\s+/) && !current) {
        continue
      }
      if (current) {
        current.lines.push(line)
      }
    }
  }
  // 最后一节
  if (current) {
    sections.push({
      title: current.title,
      body: current.lines.join('\n').trim(),
      slug: slugify(current.title)
    })
  }

  // 过滤空 body
  return sections.filter((s) => s.body.length > 50)
}

/** 英文标题 → URL slug */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

/** 从章节标题启发式分类 */
function sectionToCategory(title: string): TutorialCategory {
  const t = title.toLowerCase()
  if (/meta|前言|intro|overview|总览|学习|learn/.test(t)) return 'linux-basics'
  if (/基础|basics|basic|getting started/.test(t)) return 'linux-basics'
  if (/日常|everyday|daily/.test(t)) return 'shell-scripting'
  if (/文件|file|files|处理|processing|text|text-fu/.test(t)) return 'shell-scripting'
  if (/系统|system|系统监控|monitoring|性能|performance/.test(t)) return 'monitoring'
  if (/网络|network|networking|ssh|curl/.test(t)) return 'networking'
  if (/调试|debug|troubleshoot/.test(t)) return 'troubleshooting'
  if (/单行|one-liner|snippet|oneliners/.test(t)) return 'shell-scripting'
  if (/冷门|obscure|niche/.test(t)) return 'shell-scripting'
  if (/mac|osx|macos/.test(t)) return 'linux-basics'
  return 'shell-scripting'
}

/** 提取代码块中的命令 */
function extractAocCommands(md: string): string[] {
  const lines = md.split('\n')
  const cmds: string[] = []
  let inCode = false
  let lang = ''
  let buf: string[] = []

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === '' || lang === 'console') {
          for (const cmd of buf) {
            const t = cmd.trim()
            if (t && !t.startsWith('#') && t.length > 1) {
              cmds.push(t)
            }
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

/** 把单个章节转成 TutorialEntry */
function sectionToEntry(
  lang: 'en' | 'zh',
  section: { title: string; body: string; slug: string }
): TutorialEntry {
  const now = Date.now()
  const url =
    lang === 'en'
      ? `https://github.com/jlevy/the-art-of-command-line/blob/master/README.md#${section.slug}`
      : `https://github.com/jlevy/the-art-of-command-line/blob/master/README-zh.md#${section.slug}`

  const commands = extractAocCommands(section.body)
  const category = sectionToCategory(section.title)
  const distros: LinuxDistro[] = section.body.toLowerCase().includes('mac') ? [] : []

  // 提取首段作为 summary
  const firstPara = section.body.split('\n\n').find((p) => p.trim() && !p.startsWith('!') && !p.startsWith('|'))
  const summary = firstPara ? firstPara.replace(/[*_`]/g, '').trim().slice(0, 200) : section.title

  // 关键词：标题分词 + 命令数
  const keywords = [
    ...section.title.split(/\s+/).filter((w) => w.length >= 2),
    '命令行',
    'command line',
    'aoc',
    `aoc-${lang}`
  ]

  return {
    id: makeTutorialId(`aoc:${lang}:${section.slug}`),
    title: lang === 'en' ? `[AOC] ${section.title}` : `[命令行艺术] ${section.title}`,
    summary,
    source: {
      name: `${SOURCE_NAME}（${lang === 'en' ? '英文' : '中文'}）`,
      url,
      crawledAt: now,
      license: SOURCE_LICENSE,
      licenseUrl: SOURCE_LICENSE_URL,
      kind: SOURCE_KIND
    },
    category,
    tags: ['命令行艺术', 'Art of Command Line', lang === 'en' ? 'en' : 'zh', 'aoc'],
    difficulty: 'intermediate',
    readingTime: Math.max(2, Math.ceil(section.body.length / 1500)),
    content: section.body,
    commands,
    keywords,
    distros,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 抓取 The Art of Command Line
 *
 * @param onProgress 进度回调
 * @returns 解析出的 TutorialEntry[]（同时包含英文 + 中文，每节 2 条）
 */
export async function crawlArtOfCommandLine(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const sourceId = 'art-of-command-line'
  const sourceLabel = 'The Art of Command Line（命令行艺术）'

  const tmpDir = join(tmpdir(), `tdsf-aoc-${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })
  const repoDir = join(tmpDir, AOC_REPO_DIR_NAME)

  try {
    // 1. Clone
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'downloading',
      message: '浅克隆 jlevy/the-art-of-command-line...',
      progress: 0,
      processed: 0,
      total: 0
    })
    await cloneAocRepo(tmpDir, (msg) => {
      onProgress({
        sourceId,
        sourceLabel,
        phase: 'downloading',
        message: msg,
        progress: 0.1,
        processed: 0,
        total: 0
      })
    })

    // 2. 读取 README.md（英文）
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'parsing',
      message: '解析 README.md（英文）...',
      progress: 0.3,
      processed: 0,
      total: 0
    })
    const enMd = await readFile(join(repoDir, 'README.md'), 'utf-8')
    const enSections = splitMarkdownBySections(enMd)
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'parsing',
      message: `英文版拆分为 ${enSections.length} 个章节`,
      progress: 0.5,
      processed: 0,
      total: enSections.length
    })

    // 3. 读取 README-zh.md（中文）
    let zhSections: Array<{ title: string; body: string; slug: string }> = []
    try {
      const zhMd = (await readFile(join(repoDir, 'README-zh.md'), 'utf-8')).replace(/\r\n/g, '\n')
      zhSections = splitMarkdownBySections(zhMd)
      onProgress({
        sourceId,
        sourceLabel,
        phase: 'parsing',
        message: `中文版拆分为 ${zhSections.length} 个章节`,
        progress: 0.7,
        processed: 0,
        total: zhSections.length
      })
    } catch {
      // 中文版可能不存在，忽略
      console.warn('[aoc] README-zh.md 不存在，跳过中文版')
    }

    // 4. 转换为 TutorialEntry
    const entries: TutorialEntry[] = []
    for (let i = 0; i < enSections.length; i++) {
      if (signal.aborted) { throw new Error('用户已取消') }
      entries.push(sectionToEntry('en', enSections[i]))
    }
    for (let i = 0; i < zhSections.length; i++) {
      if (signal.aborted) { throw new Error('用户已取消') }
      entries.push(sectionToEntry('zh', zhSections[i]))
    }
    const total = entries.length

    onProgress({
      sourceId,
      sourceLabel,
      phase: 'done',
      message: `完成！英文 ${enSections.length} 节 + 中文 ${zhSections.length} 节 = ${total} 条教程。License：${SOURCE_LICENSE} (${AOC_LICENSE_URL})`,
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
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}
