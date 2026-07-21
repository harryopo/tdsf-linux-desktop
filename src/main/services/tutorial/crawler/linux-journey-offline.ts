/**
 * labex-labs/linuxjourney 离线抓取器（GitHub Clone 方式）
 *
 * 教学术语：
 * - Linux Journey：原 linuxjourney.com，现由 LabEx 维护的免费 Linux 教学课程
 *   - 仓库：https://github.com/labex-labs/linuxjourney
 *   - 协议：CC BY-SA 4.0
 *   - 形式：lessons/<lang>/<category>/<lesson>.md（多语言分层）
 *   - 特点：结构化 4 层次（Grasshopper/Journeyman/Networking Nomad/Sysadmin）
 *
 * 数据流：
 *   1. 浅克隆 labex-labs/linuxjourney 仓库
 *   2. 仅 sparse-checkout lessons/en/（英文原版）
 *   3. 递归扫描 lessons/en/<category>/<lesson>.md 文件
 *   4. 解析 frontmatter（YAML） + 主体
 *   5. 启发式分类（从 path 二级目录推断）
 *   6. 提取代码块中的命令
 *   7. 输出 TutorialEntry（source.kind = 'github-clone', license = 'CC BY-SA 4.0'）
 *
 * 合规说明（重要！）：
 *   - 协议：CC BY-SA 4.0
 *   - **品牌限制**：README 明文要求"不得使用 Linux Journey 名称、品牌、视觉、课程组织"
 *     制作"令人困惑地类似"的网站或服务
 *   - **必须做**：
 *     1. source.name 明确标注 "Linux Journey (via labex-labs)"
 *     2. UI 显示"内容来自 Linux Journey" + "非官方产品"
 *     3. 不使用 "Linux Journey" 作为产品名/品牌
 *   - **可以做**：
 *     1. 个人学习/参考/翻译
 *     2. 完整抓取做"AI 知识库"（BY 署名 + 不模仿品牌）
 *
 * 为什么是 Phase 2 P0？
 *   - 与 LDP 单篇 HOWTO 不同，Linux Journey 是**结构化课程**
 *   - 80+ lessons 覆盖 Linux 入门到中级，最适合"教学"路径
 *   - GitHub clone 零爬虫礼仪风险
 *   - CC BY-SA 4.0 协议清晰
 *
 * 解析策略：
 *   - 一个 lesson.md = 一个 TutorialEntry（不按章节拆分）
 *   - frontmatter 解析为 title / description / keywords
 *   - 从 path 推断 category（getting-started → linux-basics, networking → networking 等）
 *   - 移除 ## Exercise / ## Quiz 部分（不抓互动题）
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm, readdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TutorialEntry, TutorialCategory, LinuxDistro } from '../types'
import type { CrawlProgress } from '@shared/crawler-types'
import { makeTutorialId } from './html-to-tutorial'

const execFileAsync = promisify(execFile)

/** labex-labs/linuxjourney 仓库地址 */
const LJ_REPO = 'https://github.com/labex-labs/linuxjourney.git'
/** 来源元数据 */
const SOURCE_NAME = 'Linux Journey (via labex-labs)'
const SOURCE_LICENSE = 'CC BY-SA 4.0'
const SOURCE_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
const SOURCE_KIND = 'github-clone' as const
/** 仓库根路径（clone 后） */
const LJ_REPO_DIR_NAME = 'linuxjourney'
/** 英文 lessons 子目录（Phase 2 仅抓英文版） */
const LJ_LESSONS_DIR = 'lessons/en'
/** 仓库 License 文件 URL */
const LJ_LICENSE_URL = 'https://github.com/labex-labs/linuxjourney/blob/master/LICENSE'

/** 用 git clone --depth 1 --filter 浅克隆（只下 lessons/en/） */
async function cloneLjRepo(targetDir: string, onLog: (msg: string) => void): Promise<void> {
  onLog(`git clone ${LJ_REPO} -> ${targetDir}`)
  await execFileAsync(
    'git',
    [
      'clone',
      '--depth=1',
      '--filter=blob:none',
      '--sparse',
      LJ_REPO,
      LJ_REPO_DIR_NAME
    ],
    { cwd: targetDir, timeout: 180_000 }
  )
  // 稀疏检出：只拉取 lessons/en/
  onLog('git sparse-checkout set lessons/en')
  await execFileAsync(
    'git',
    ['sparse-checkout', 'set', LJ_LESSONS_DIR],
    { cwd: join(targetDir, LJ_REPO_DIR_NAME), timeout: 60_000 }
  )
}

/**
 * 解析 lesson.md 的 frontmatter（YAML）
 * 返回 { title, description, keywords }；解析失败时返回 null
 */
interface LjFrontmatter {
  title?: string
  description?: string
  keywords?: string
  category?: string
}

function parseLjFrontmatter(rawMd: string): { meta: LjFrontmatter; body: string } {
  // 匹配 --- ... --- 之间的 YAML
  const m = rawMd.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return { meta: {}, body: rawMd }

  const yamlBlock = m[1]
  const body = m[2]
  const meta: LjFrontmatter = {}

  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w+):\s*"?(.+?)"?\s*$/)
    if (kv) {
      const key = kv[1] as keyof LjFrontmatter
      meta[key] = kv[2]
    }
  }
  return { meta, body }
}

/**
 * 从 lesson 路径推断分类
 *
 * lessons/en/<category>/<lesson>.md
 * - getting-started → linux-basics
 * - command-line → shell-scripting
 * - text-fu / advanced-text-fu → shell-scripting
 * - user-management → user-management
 * - permissions → security
 * - processes → linux-basics
 * - packages → package-management
 * - devices / filesystem / boot-the-system / kernel / init → linux-basics
 * - process-utilization / logging → monitoring
 * - network-* → networking
 * - security-* → security
 */
function pathToCategory(categoryDir: string): TutorialCategory {
  const c = categoryDir.toLowerCase()
  if (c.includes('network')) return 'networking'
  if (c.includes('security') || c.includes('permission')) return 'security'
  if (c.includes('user')) return 'user-management'
  if (c.includes('package') || c.includes('package-management')) return 'package-management'
  if (c.includes('process-utilization') || c.includes('logging') || c.includes('monitoring')) return 'monitoring'
  if (c.includes('web-server') || c.includes('web')) return 'web-server'
  if (c.includes('database') || c.includes('db')) return 'database'
  if (c.includes('container') || c.includes('docker')) return 'containers'
  if (c.includes('virtualization') || c.includes('kvm')) return 'virtualization'
  if (c.includes('service') || c.includes('systemd') || c.includes('init')) return 'services'
  if (c.includes('storage') || c.includes('filesystem') || c.includes('device')) return 'storage'
  if (c.includes('command-line') || c.includes('text-fu') || c.includes('shell') || c.includes('script')) return 'shell-scripting'
  if (c.includes('cloud')) return 'cloud'
  if (c.includes('troubleshoot')) return 'troubleshooting'
  return 'linux-basics'
}

/** 估算阅读时间（分钟） */
function estimateReadingTime(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const enWords = (text.match(/[a-zA-Z]+/g) || []).length
  const minutes = cjkChars / 300 + enWords / 200
  return Math.max(1, Math.ceil(minutes))
}

/**
 * 提取代码块中的命令
 *
 * lesson.md 中代码块以 ``` 包围，lang 通常是 bash/sh/console
 * 一些 quiz 答案会嵌入到代码块里 → 过滤
 */
function extractLjCommands(md: string): string[] {
  const lines = md.split('\n')
  const cmds: string[] = []
  let inCode = false
  let lang = ''
  let buf: string[] = []

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        if (/^(bash|sh|shell|console)?$/i.test(lang)) {
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
    if (inCode) {
      buf.push(line)
    }
  }
  return cmds
}

/**
 * 清理正文：
 * - 移除 `## Exercise` 之后的所有内容（互动练习非教程主体）
 * - 移除 `## Quiz Question` 之后的所有内容
 * - 保留 `## Lesson Content` + 各小节
 */
function cleanLjBody(body: string): string {
  // 移除 Exercise 及之后
  let cleaned = body.replace(/^##\s+Exercise[\s\S]*$/m, '').trim()
  // 移除 Quiz Question 及之后
  cleaned = cleaned.replace(/^##\s+Quiz\s+Question[\s\S]*$/m, '').trim()
  return cleaned
}

/**
 * 解析单个 lesson.md
 *
 * @param relPath 相对路径，如 "lessons/en/getting-started/linux-history.md"
 * @param rawMd 原始 MD 文本
 */
function ljMdToEntry(relPath: string, rawMd: string): TutorialEntry | null {
  try {
    const { meta, body } = parseLjFrontmatter(rawMd)
    const cleanedBody = cleanLjBody(body)
    if (cleanedBody.length < 200) return null // 太短，跳过

    // 解析路径：lessons/en/<category>/<lesson>.md
    const parts = relPath.replace(/\\/g, '/').split('/')
    // ["lessons", "en", "<category>", "<lesson>.md"]
    if (parts.length < 4) return null
    const categoryDir = parts[2]
    const lessonSlug = parts[3].replace(/\.md$/, '')

    const title = meta.title || lessonSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    const description = meta.description || ''
    const metaKeywords = (meta.keywords || '').split(',').map((k) => k.trim()).filter(Boolean)

    // 提取首段作为 summary
    const firstParaMatch = cleanedBody.match(/##\s+Lesson\s+Content\s*\n\n([\s\S]+?)(?=\n\n|\n###|$)/)
    let summary = description || title
    if (firstParaMatch) {
      const firstPara = firstParaMatch[1]
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('!') && !l.startsWith('|'))
        .join('')
        .replace(/[*_`]/g, '')
        .trim()
      if (firstPara) summary = firstPara.slice(0, 200)
    }

    // 提取代码命令
    const commands = extractLjCommands(cleanedBody)

    // 关键词：标题分词 + meta_keywords + 路径分类
    const keywords = new Set<string>()
    for (const w of title.split(/\s+/)) {
      if (w.length >= 3) keywords.add(w.toLowerCase())
    }
    for (const k of metaKeywords) keywords.add(k.toLowerCase())
    keywords.add('linux journey')
    keywords.add(categoryDir)

    const now = Date.now()
    return {
      id: makeTutorialId(`lj:${categoryDir}:${lessonSlug}`),
      title: `[Linux Journey] ${title}`,
      summary,
      source: {
        name: SOURCE_NAME,
        url: `https://github.com/labex-labs/linuxjourney/blob/master/${relPath}`,
        crawledAt: now,
        license: SOURCE_LICENSE,
        licenseUrl: SOURCE_LICENSE_URL,
        kind: SOURCE_KIND
      },
      category: pathToCategory(categoryDir),
      tags: ['linux-journey', 'labex', 'structured-course', categoryDir, lessonSlug],
      difficulty: 'beginner',
      readingTime: estimateReadingTime(cleanedBody),
      content: cleanedBody,
      commands,
      keywords: Array.from(keywords).slice(0, 30),
      distros: [] as LinuxDistro[],
      createdAt: now,
      updatedAt: now
    }
  } catch (err) {
    console.warn(`[linux-journey] 解析失败 (${relPath}):`, (err as Error).message)
    return null
  }
}

/**
 * 递归扫描 lessons/en/ 目录，收集所有 .md 文件路径
 */
async function collectLessonFiles(rootDir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, relBase: string): Promise<void> {
    const entries = await readdir(dir)
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      const rel = relBase ? `${relBase}/${name}` : name
      const s = await stat(full)
      if (s.isDirectory()) {
        await walk(full, rel)
      } else if (s.isFile() && name.endsWith('.md')) {
        out.push(rel)
      }
    }
  }
  await walk(rootDir, '')
  return out
}

/**
 * 抓取 labex-labs/linuxjourney
 *
 * @param onProgress 进度回调
 * @returns 解析出的 TutorialEntry[]
 */
export async function crawlLinuxJourney(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const sourceId = 'linux-journey'
  const sourceLabel = 'Linux Journey（结构化课程）'

  const tmpDir = join(tmpdir(), `tdsf-lj-${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })
  const repoDir = join(tmpDir, LJ_REPO_DIR_NAME)

  try {
    // 1. Clone
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'downloading',
      message: '浅克隆 labex-labs/linuxjourney 仓库（sparse-checkout）...',
      progress: 0,
      processed: 0,
      total: 0
    })
    await cloneLjRepo(tmpDir, (msg) => {
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

    // 2. 收集所有 lesson 文件
    const lessonsDir = join(repoDir, LJ_LESSONS_DIR)
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'parsing',
      message: `扫描 ${LJ_LESSONS_DIR}/ 课程列表...`,
      progress: 0.3,
      processed: 0,
      total: 0
    })
    const relFiles = await collectLessonFiles(lessonsDir)
    const total = relFiles.length

    // 3. 解析每个 lesson
    const entries: TutorialEntry[] = []
    let failed = 0
    for (let i = 0; i < relFiles.length; i++) {
      if (signal.aborted) { throw new Error('用户已取消') }
      const rel = relFiles[i]
      const fullPath = join(lessonsDir, rel)
      try {
        const md = (await readFile(fullPath, 'utf-8')).replace(/\r\n/g, '\n')
        const entry = ljMdToEntry(`${LJ_LESSONS_DIR}/${rel}`, md)
        if (entry) {
          entries.push(entry)
        } else {
          failed++
        }
      } catch (err) {
        failed++
        console.warn(`[linux-journey] 读取失败 (${rel}):`, (err as Error).message)
      }

      if (i % 10 === 0 || i === relFiles.length - 1) {
        onProgress({
          sourceId,
          sourceLabel,
          phase: 'parsing',
          message: `解析 ${i + 1}/${total} (成功 ${entries.length}, 失败 ${failed})`,
          progress: 0.3 + (i / total) * 0.6,
          processed: i + 1,
          total
        })
      }
    }

    onProgress({
      sourceId,
      sourceLabel,
      phase: 'done',
      message: `完成！成功 ${entries.length} 篇结构化课程，失败 ${failed} 篇。原始 License：${SOURCE_LICENSE} (${LJ_LICENSE_URL})；内容来源 Linux Journey，非官方替代品`,
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
