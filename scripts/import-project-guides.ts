/**
 * 导入本地项目指导文档到生产数据库
 *
 * 用途：把 knowledge/courses/项目指导文档/ 下的 Markdown 项目指导文档
 * 转换为 TutorialEntry 并 upsert 到真实生产数据库（app.getPath('userData')/tdsf.db）。
 *
 * 运行：
 *   node scripts/run-script.cjs import-project-guides
 *
 * 说明：
 * - 文档 ID 基于相对路径 sha256 前 16 位，稳定可复现
 * - 分类/难度根据文件名和项目编号推断
 * - source.kind='offline-dump'，标记为本地教材资源
 * - 默认 skipEmbedding=true（避免首次导入触发模型下载），后续用 backfill-embeddings 补齐
 */

import { app } from 'electron'
import { join, relative, sep } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { DatabaseManager } from '../src/main/services/db/database'
import { TutorialRepository } from '../src/main/services/tutorial/tutorial-repo'
import type { TutorialEntry, TutorialCategory, TutorialDifficulty, LinuxDistro } from '../src/main/services/tutorial/types'

/** 项目指导文档根目录（相对于项目根目录） */
const GUIDES_DIR = join(process.cwd(), '..', 'knowledge', 'courses', '项目指导文档')

/** 教材来源元数据 */
const SOURCE_NAME = '深圳信息职业技术大学 Linux 教学项目'
const SOURCE_LICENSE = 'Educational Use'
const SOURCE_KIND: TutorialEntry['source']['kind'] = 'offline-dump'

/** 文件名前缀 → 分类映射 */
const CATEGORY_MAP: Record<string, TutorialCategory> = {
  // 大一上学期
  '大一上学期_项目1': 'linux-basics',
  '大一上学期_项目2': 'linux-basics',
  '大一上学期_项目3': 'package-management',
  '大一上学期_项目4': 'user-management',
  '大一上学期_项目5a': 'user-management',
  '大一上学期_项目5b': 'security',
  '大一上学期_项目6': 'linux-basics',
  '大一上学期_项目7': 'networking',
  '大一上学期_项目8': 'storage',
  // 大一下学期
  '大一下学期_项目1': 'linux-basics',
  '大一下学期_项目2': 'shell-scripting',
  '大一下学期_项目3': 'networking',
  '大一下学期_项目4': 'networking',
  '大一下学期_项目5': 'services',
  '大一下学期_项目6': 'storage',
  '大一下学期_项目7': 'storage',
  '大一下学期_项目8': 'storage',
  // 项目 9-14
  '项目9': 'networking',
  '项目10': 'security',
  '项目11': 'security',
  '项目12': 'services',
  '项目13': 'monitoring',
  '项目14': 'shell-scripting',
}

/** 文件名前缀 → 难度映射 */
const DIFFICULTY_MAP: Record<string, TutorialDifficulty> = {
  '大一上学期': 'beginner',
  '大一下学期': 'intermediate',
  '项目9': 'intermediate',
  '项目10': 'intermediate',
  '项目11': 'intermediate',
  '项目12': 'intermediate',
  '项目13': 'advanced',
  '项目14': 'advanced',
}

/** 稳定的教程 ID */
function makeTutorialId(relativePath: string): string {
  return `tut-local-${createHash('sha256').update(relativePath).digest('hex').slice(0, 16)}`
}

/** 从文件名提取标题 */
function parseTitle(fileName: string, content: string): string {
  // 优先从内容第一行 h1 提取
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match) {
    return h1Match[1].trim().replace(/^\S+\s+/, '') // 去掉开头的 emoji
  }
  // 否则从文件名提取：去掉前缀和扩展名
  return fileName
    .replace(/^(.+?)[_:：]/, '')
    .replace(/\.md$/i, '')
    .replace(/实施报告\d*[：:]?/, '')
    .trim()
}

/** 从内容提取摘要（优先"项目需求"或"项目概述"） */
function parseSummary(content: string, title: string): string {
  // 尝试匹配 "### 项目需求" 下的列表
  const demandMatch = content.match(/###\s+项目需求[\s\S]*?(?=###|##\s|$)/)
  if (demandMatch) {
    const lines = demandMatch[0]
      .split('\n')
      .filter((l) => l.trim().match(/^\d+\./))
      .map((l) => l.replace(/^\s*\d+\.\s*/, '').trim())
    if (lines.length > 0) {
      return lines.slice(0, 3).join('；') + '。'
    }
  }

  // 尝试匹配 "### 项目背景"
  const bgMatch = content.match(/###\s+项目背景\s*\n+(.+?)(?=\n\s*###|\n\s*##\s|$)/)
  if (bgMatch) {
    return bgMatch[1].trim()
  }

  // 兜底：取内容前 200 字符
  return content.replace(/[#*`\s]+/g, ' ').slice(0, 200).trim() + '...'
}

/** 根据文件名推断分类 */
function inferCategory(fileName: string): TutorialCategory {
  for (const prefix of Object.keys(CATEGORY_MAP).sort((a, b) => b.length - a.length)) {
    if (fileName.startsWith(prefix)) return CATEGORY_MAP[prefix]
  }
  return 'linux-basics'
}

/** 根据文件名推断难度 */
function inferDifficulty(fileName: string): TutorialDifficulty {
  for (const prefix of Object.keys(DIFFICULTY_MAP).sort((a, b) => b.length - a.length)) {
    if (fileName.startsWith(prefix)) return DIFFICULTY_MAP[prefix]
  }
  return 'beginner'
}

/** 提取代码块中的 bash 命令 */
function extractCommands(md: string): string[] {
  const cmds: string[] = []
  const codeBlockRegex = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = codeBlockRegex.exec(md)) !== null) {
    const block = match[1]
    for (const line of block.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        cmds.push(trimmed)
      }
    }
  }
  return cmds.slice(0, 50)
}

/** 提取关键词 */
function extractKeywords(title: string, content: string): string[] {
  const kws = new Set<string>()
  // 标题分词（中文按字符/词，英文按空格）
  for (const w of title.split(/[\s_，、：:]+/)) {
    const t = w.trim()
    if (t.length >= 2) kws.add(t.toLowerCase())
  }
  // 从内容提取 Linux 命令关键词（常见命令）
  const commonCmds = [
    'ls', 'cd', 'pwd', 'cat', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'chown',
    'grep', 'sed', 'awk', 'find', 'tar', 'gzip', 'ssh', 'scp', 'rsync',
    'systemctl', 'dnf', 'yum', 'apt', 'fdisk', 'lvm', 'vgcreate', 'lvcreate',
    'selinux', 'setenforce', 'getenforce', 'firewalld', 'firewall-cmd',
    'nfs', 'samba', 'httpd', 'nginx', 'mysql', 'crontab', 'at', 'top',
    'ps', 'kill', 'vmstat', 'iostat', 'sar', 'shell', 'bash', 'script',
    'passwd', 'chroot', 'rd.break', 'fstab', 'grub', 'yum', 'repo',
  ]
  const lowerContent = content.toLowerCase()
  for (const cmd of commonCmds) {
    if (lowerContent.includes(cmd)) kws.add(cmd)
  }
  return Array.from(kws).slice(0, 30)
}

/** 估算阅读时间（分钟） */
function estimateReadingTime(md: string): number {
  const cjkChars = (md.match(/[\u4e00-\u9fa5]/g) || []).length
  const enWords = (md.match(/[a-zA-Z]+/g) || []).length
  const minutes = cjkChars / 300 + enWords / 200
  return Math.max(3, Math.ceil(minutes))
}

/** 扫描所有 .md 文件 */
function scanMdFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const st = statSync(fullPath)
    if (st.isDirectory()) {
      result.push(...scanMdFiles(fullPath))
    } else if (entry.endsWith('.md')) {
      result.push(fullPath)
    }
  }
  return result
}

/** 解析单个 .md 文件为 TutorialEntry */
function parseGuideFile(filePath: string, projectRoot: string): TutorialEntry | null {
  const relPath = relative(projectRoot, filePath)
  const content = readFileSync(filePath, 'utf-8')
  if (!content.trim()) {
    console.warn(`[import] 跳过空文件: ${relPath}`)
    return null
  }

  const fileName = filePath.split(sep).pop() || ''
  const title = parseTitle(fileName, content)
  const summary = parseSummary(content, title)
  const category = inferCategory(fileName)
  const difficulty = inferDifficulty(fileName)
  const commands = extractCommands(content)
  const keywords = extractKeywords(title, content)
  const readingTime = estimateReadingTime(content)
  const now = Date.now()

  return {
    id: makeTutorialId(relPath),
    title,
    summary,
    content,
    category,
    difficulty,
    commands,
    keywords,
    readingTime,
    tags: [category, difficulty],
    distros: ['rhel', 'centos', 'rocky'] as LinuxDistro[],
    source: {
      name: SOURCE_NAME,
      url: `file://${filePath}`,
      license: SOURCE_LICENSE,
      kind: SOURCE_KIND,
      crawledAt: now,
    },
    createdAt: now,
    updatedAt: now,
  }
}

async function main(): Promise<void> {
  const dbPath = join(app.getPath('userData'), 'tdsf.db')
  console.log(`[import] 数据库路径: ${dbPath}`)

  const db = DatabaseManager.getInstance(dbPath)
  console.log(`[import] DB 可用=${db.isAvailable()} 向量扩展=${db.isVectorEnabled()}`)

  if (!db.isAvailable()) {
    console.error('[import] 数据库不可用，退出')
    process.exit(1)
  }

  const repo = new TutorialRepository(db)
  const beforeCount = repo.count()
  console.log(`[import] 导入前 tutorial 总数: ${beforeCount}`)

  // 扫描项目指导文档
  const projectRoot = process.cwd()
  const mdFiles = scanMdFiles(GUIDES_DIR)
  console.log(`[import] 扫描到 ${mdFiles.length} 个 .md 文件`)

  const entries: TutorialEntry[] = []
  for (const filePath of mdFiles) {
    try {
      const entry = parseGuideFile(filePath, projectRoot)
      if (entry) entries.push(entry)
    } catch (err) {
      console.error(`[import] 解析失败: ${filePath}`, (err as Error).message)
    }
  }

  console.log(`[import] 成功解析 ${entries.length} 条 TutorialEntry`)

  if (entries.length === 0) {
    console.log('[import] 无数据可导入，退出')
    process.exit(0)
  }

  // 导入数据库（跳过 embedding，后续回填）
  const result = await repo.upsertManyAsync(entries, { skipEmbedding: true })
  console.log(`[import] 导入结果: inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped}`)

  const afterCount = repo.count()
  console.log(`[import] 导入后 tutorial 总数: ${afterCount}`)

  // 分类统计
  const catSummary = repo.categorySummary()
  console.log('\n========== 分类统计 ==========')
  for (const c of catSummary) {
    if (c.count > 0) {
      console.log(`  ${c.label.padEnd(15)} ${c.count}`)
    }
  }

  // 待回填 embedding 数
  const pendingRow = db.prepare(
    "SELECT COUNT(*) as cnt FROM knowledge_entries WHERE type='tutorial' AND embedding IS NULL"
  ).get() as { cnt: number } | undefined
  console.log(`\n[import] 待回填 embedding 条目: ${pendingRow?.cnt ?? 0}`)
  console.log('[import] 下一步建议运行: node scripts/run-script.cjs backfill-embeddings')

  process.exit(0)
}

main().catch((err) => {
  console.error('[import] 未捕获错误:', err)
  process.exit(1)
})
