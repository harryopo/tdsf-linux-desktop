/**
 * 知识包文件解析（#180）
 *
 * 把用户自己记的 Markdown 笔记 / 从别处导出的 JSON 知识包，解析成可入库的
 * KnowledgeEntry。纯函数：不读文件、不碰数据库、不联网，所以能单测。
 *
 * 为什么是这两种形状：运维笔记的实际载体就是 .md（自己写的）和 .json
 * （从别的工具导出来的），业界同类（Open WebUI / AnythingLLM / Dify）走的也是
 * "文档 → 分段 → 每段一条可检索条目"这条线，不另发明第三种格式。
 *
 * 三条不可让步的口径：
 * 1. **身份 = 文件名 + 小节标题**（不是内容哈希、更不是时间戳）：这是抄 LlamaIndex
 *    IngestionPipeline 的 doc_id → hash 两 key 设计——身份决定"改内容还是换一条"，
 *    内容只决定"要不要重写"。所以同一条笔记改完再导一次覆盖原来那条，
 *    不会越导越多；不同文件里恰好同名的小节也不会互相吃掉。
 * 2. **经验计数不外搬**：successRate / useCount 是这台机器用出来的经历，
 *    embedding 得本地模型自己算。随包带进来的这三样一律丢掉——否则别人包里的
 *    0.99 会直接变成模型嘴里的"这条经验很靠谱"，而产品对用户的承诺是
 *    "AI 说的话能证明自己做过"。
 * 3. **坏数据要留名**：被丢掉的每一条都带原因回给界面，不静默少几条。
 */

import { createHash } from 'node:crypto'
import type { KnowledgeEntry, KnowledgeType } from '@shared/models'

/** 允许导入的扩展名（单源：对话框过滤、主进程二次校验、判据都读这里） */
export const IMPORT_FILE_EXTENSIONS = ['md', 'markdown', 'txt', 'json'] as const

/** 单份文件体积上限（与服务器列表导入同一档；笔记类文本远超这个数字就不像是给人看的） */
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024

/** 一条条目正文的最大长度（超出如实截断并留标记，BGE 输入也有 512 token 上限） */
const MAX_PROBLEM_CHARS = 4000

/** 标题最大长度（一行标题正常情况下远不到这里，超了说明整段被当成标题了） */
const MAX_TITLE_CHARS = 200

/** 一条条目最多取多少行命令（防止把整个脚本粘进 commands） */
const MAX_COMMANDS = 20

/** 关键词上限（标题词 + 命令行首词，再多对检索没增益） */
const MAX_KEYWORDS = 20

/** 导入条目的类型默认值：手写的包通常不写 type，按故障案例收 */
const DEFAULT_TYPE: KnowledgeType = 'incident_case'

const KNOWLEDGE_TYPES: KnowledgeType[] = ['command_skill', 'incident_case', 'tutorial']

/** 一条被丢掉的输入（source 是能让人认出自己那条笔记的定位） */
export interface KnowledgeParseRejection {
  /** 定位：Markdown 用标题文本，JSON 用第几条 */
  source: string
  /** 拒绝原因（直接回给用户看，不写内部术语） */
  reason: string
}

export interface KnowledgeParseResult {
  entries: KnowledgeEntry[]
  rejected: KnowledgeParseRejection[]
}

/**
 * 导入条目的稳定身份
 *
 * 取 sha256(文件名 + 小节标题) 前 24 位十六进制，前缀 KBI-。
 * 键里没有正文：正文改了仍然是同一条（由导入器覆盖），换文件才算另一条。
 * 24 位（约 96 bit）在这个量级下碰撞可以忽略；留前缀是为了和内置的 KB-xxx 一眼分开。
 */
export function knowledgeIdForHeading(stem: string, title: string): string {
  const digest = createHash('sha256')
    .update(`${stem.trim().toLowerCase()}\n${title.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 24)
  return `KBI-${digest.toUpperCase()}`
}

/** 文件后缀（小写、不含点）；没有后缀回空串 */
function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i < 0 ? '' : fileName.slice(i + 1).toLowerCase()
}

/** 去掉后缀的文件名，用作无标题段落的标题与标签 */
function stemOf(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  const stem = i <= 0 ? fileName : fileName.slice(0, i)
  return stem.trim() || '导入知识'
}

/**
 * 从标题和命令行现推关键词
 *
 * 为什么非要推：importEntries 的相似度合并、FTS5 索引、Jaccard 兜底检索全都读
 * keywords 这一列。留空的话，重复导入不会被合并（Jaccard 需要公共关键词才 >0.6），
 * 中文条目在 FTS 那条腿上等于不存在。
 */
function deriveKeywords(title: string, commands: string[]): string[] {
  const out = new Set<string>()
  const normalizedTitle = title.trim().toLowerCase()
  if (normalizedTitle) out.add(normalizedTitle.slice(0, MAX_TITLE_CHARS))
  // 标题里的词块：按空白与中英标点切，保留长度>=2 的
  for (const token of normalizedTitle.split(/[\s,，。、；;:：!！?？()（）\[\]【】"'`/\\|+-]+/)) {
    if (token.length >= 2) out.add(token)
  }
  // 命令行首词就是可执行名（df / nginx / systemctl），是最有信息量的检索词
  for (const line of commands) {
    const first = line.trim().split(/\s+/)[0]
    if (first && /^[a-zA-Z][\w.-]{1,}$/.test(first)) out.add(first.toLowerCase())
  }
  return Array.from(out).slice(0, MAX_KEYWORDS)
}

/** 正文收尾：压掉多余空行、超长时如实截断 */
function normalizeBody(text: string): string {
  const collapsed = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (collapsed.length <= MAX_PROBLEM_CHARS) return collapsed
  // 截断要留下记号：界面和模型都得看得出这不是一条完整的笔记
  return `${collapsed.slice(0, MAX_PROBLEM_CHARS)}\n…（内容过长已截断）`
}

/** 组装一条条目（Markdown 与 JSON 两条路共用，保证四样经验计数一定被清掉） */
function buildEntry(input: {
  id: string
  title: string
  problem: string
  commands: string[]
  type: KnowledgeType
  tags: string[]
  extraKeywords?: string[]
}): KnowledgeEntry {
  const now = Date.now()
  const title = input.title.trim().slice(0, MAX_TITLE_CHARS)
  const keywords = Array.from(new Set([...deriveKeywords(title, input.commands), ...(input.extraKeywords ?? [])])).slice(
    0,
    MAX_KEYWORDS
  )
  return {
    id: input.id,
    type: input.type,
    title,
    problem: input.problem,
    commands: input.commands,
    keywords,
    tags: Array.from(new Set([...input.tags, '外部导入'])),
    // 这四样不接受外来值，见文件头第 2 条
    successRate: 0,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

// ────────── Markdown / 纯文本 ──────────

/** ATX 标题：# ~ ######，允许最多三个前导空格；行尾的 # 收尾也吃掉 */
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
/** 代码围栏开：``` 或 ~~~（允许三个前导空格），后面可跟语言名 */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/

interface MarkdownSection {
  title: string
  body: string[]
  commands: string[]
}

/**
 * 按标题切段，围栏代码行进 commands、不进正文
 *
 * 围栏内的 # 不当标题（笔记里常有 `# 注释` 这样的 shell 注释行），
 * 所以逐行走状态机，不用整体 split。
 */
function splitMarkdown(text: string): MarkdownSection[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const sections: MarkdownSection[] = []
  let current: MarkdownSection | null = null
  let inFence = false
  let fenceMarker = ''
  // 第一个标题之前的内容也要收（很多人笔记开头就是一段没有标题的说明）
  const preamble: MarkdownSection = { title: '', body: [], commands: [] }

  const push = (section: MarkdownSection | null) => {
    if (!section) return
    if (section.title.trim() === '' && section.body.join('\n').trim() === '') return
    sections.push(section)
  }

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_OPEN_RE)
    if (fenceMatch && !inFence) {
      inFence = true
      fenceMarker = fenceMatch[1][0]
      continue
    }
    if (inFence) {
      const trimmed = line.trim()
      // 围栏结束：整行只有同种标记且长度够
      if (trimmed.length >= 3 && trimmed === fenceMarker.repeat(trimmed.length)) {
        inFence = false
        fenceMarker = ''
        continue
      }
      const command = trimmed
      if (command) {
        const target = current ?? preamble
        if (target.commands.length < MAX_COMMANDS) target.commands.push(command)
      }
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      push(current)
      current = { title: heading[2].trim(), body: [], commands: [] }
      continue
    }
    const target = current ?? preamble
    target.body.push(line)
  }
  if (inFence) {
    // 文件末尾围栏没关上：不因为一个漏写的反引号就丢掉整段
    inFence = false
  }
  push(current)

  const out: MarkdownSection[] = []
  const preambleBody = preamble.body.join('\n').trim()
  if (preambleBody) {
    out.push({ ...preamble, body: [preambleBody] })
  }
  for (const section of sections) {
    const title = section.title.trim()
    const body = section.body.join('\n')
    if (!title && body.trim() === '') continue
    out.push({ ...section, body: [body] })
  }
  return out
}

/**
 * 一份文件内的 id 分配器
 *
 * 身份是"文件名 + 标题"（包自己带 id 就用它的），所以同一份文件里写了两遍同名小节时，
 * 第二条会撞上第一条。撞上就按出现次序加后缀：宁可两条分开，
 * 也不能让后一条静默把前一条吃掉。
 */
function createIdAllocator(stem: string): (title: string, providedId?: string | null) => string {
  const used = new Set<string>()
  return (title, providedId) => {
    const base = providedId?.trim() || knowledgeIdForHeading(stem, title)
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    let n = 2
    while (used.has(`${base}-${n}`)) n++
    const withSuffix = `${base}-${n}`
    used.add(withSuffix)
    return withSuffix
  }
}

function parseMarkdown(fileName: string, text: string): KnowledgeParseResult {
  const stem = stemOf(fileName)
  const nextId = createIdAllocator(stem)
  const entries: KnowledgeEntry[] = []
  const rejected: KnowledgeParseRejection[] = []
  for (const section of splitMarkdown(text)) {
    const title = (section.title || stem).slice(0, MAX_TITLE_CHARS)
    const problem = normalizeBody(section.body.join('\n'))
    const source = section.title || stem
    if (!title || !problem) {
      rejected.push({ source, reason: '这一节只有标题没有内容（或只有内容没有标题），无法作为一条知识' })
      continue
    }
    entries.push(
      buildEntry({
        id: nextId(title),
        title,
        problem,
        commands: section.commands,
        type: DEFAULT_TYPE,
        tags: [stem],
      })
    )
  }
  return { entries, rejected }
}

// ────────── JSON 知识包 ──────────

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.some((v) => typeof v !== 'string')) return null
  return value.map((v) => (v as string).trim()).filter((v) => v.length > 0)
}

/**
 * 解析一条 JSON 条目
 *
 * 严格但不苛刻：必填只有标题与问题，其余给默认值；
 * 一旦给了形状不对的可选字段就整条拒掉（半条数据写进库比不写更糟）。
 */
function parseJsonEntry(
  raw: unknown,
  index: number,
  claimId: (title: string, providedId?: string | null) => string
): { entry?: KnowledgeEntry; rejection?: KnowledgeParseRejection } {
  const source = `第 ${index + 1} 条`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { rejection: { source, reason: '不是一条对象数据' } }
  }
  const obj = raw as Record<string, unknown>

  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  if (!title) return { rejection: { source, reason: '缺少标题（title 要是非空字符串）' } }
  const problemRaw = typeof obj.problem === 'string' ? obj.problem.trim() : ''
  if (!problemRaw) return { rejection: { source, reason: '缺少问题描述（problem 要是非空字符串）' } }

  let type = DEFAULT_TYPE
  if (obj.type !== undefined) {
    if (typeof obj.type !== 'string' || !KNOWLEDGE_TYPES.includes(obj.type as KnowledgeType)) {
      return { rejection: { source, reason: `type 不认识（只能是 ${KNOWLEDGE_TYPES.join(' / ')}）` } }
    }
    type = obj.type as KnowledgeType
  }

  const commands = asStringArray(obj.commands ?? [])
  if (commands === null) return { rejection: { source, reason: 'commands 要是字符串数组' } }

  const keywords = asStringArray(obj.keywords ?? [])
  if (keywords === null) return { rejection: { source, reason: 'keywords 要是字符串数组' } }

  const tags = asStringArray(obj.tags ?? [])
  if (tags === null) return { rejection: { source, reason: 'tags 要是字符串数组' } }

  const rollback = obj.rollbackCommands === undefined ? [] : asStringArray(obj.rollbackCommands)
  if (rollback === null) return { rejection: { source, reason: 'rollbackCommands 要是字符串数组' } }

  // 包里有自己的 id 时保留它（同一包再导一次仍然对上同一条），但格式必须可控；
  // 没有就按"文件名 + 标题"给一个稳定身份。
  const providedId =
    typeof obj.id === 'string' && /^[\w:.-]{1,120}$/.test(obj.id.trim()) ? obj.id.trim() : null
  const entry = buildEntry({
    id: claimId(title, providedId),
    title,
    problem: normalizeBody(problemRaw),
    commands: commands.slice(0, MAX_COMMANDS),
    type,
    tags,
    extraKeywords: keywords,
  })
  if (typeof obj.rootCause === 'string' && obj.rootCause.trim()) entry.rootCause = obj.rootCause.trim()
  if (typeof obj.verification === 'string' && obj.verification.trim()) entry.verification = obj.verification.trim()
  if (rollback.length > 0) entry.rollbackCommands = rollback
  return { entry }
}

function parseJson(fileName: string, text: string): KnowledgeParseResult {
  const stem = stemOf(fileName)
  const source = stem
  const claimId = createIdAllocator(stem)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return {
      entries: [],
      rejected: [{ source, reason: `JSON 读不出来：${err instanceof Error ? err.message : String(err)}` }],
    }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { entries?: unknown[] }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : null
  if (!list) {
    return { entries: [], rejected: [{ source, reason: '顶层要是一条数组，或是 { "entries": [...] }' }] }
  }

  const entries: KnowledgeEntry[] = []
  const rejected: KnowledgeParseRejection[] = []
  list.forEach((raw, index) => {
    const { entry, rejection } = parseJsonEntry(raw, index, claimId)
    if (entry) entries.push(entry)
    else if (rejection) rejected.push(rejection)
  })
  return { entries, rejected }
}

/**
 * 解析一份知识文件
 *
 * @param fileName 文件名（只用来取后缀、标题与标签，不读盘）
 * @param text 文件正文
 */
export function parseKnowledgeFile(fileName: string, text: string): KnowledgeParseResult {
  const ext = extOf(fileName)
  if (!(IMPORT_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      entries: [],
      rejected: [{ source: fileName, reason: `不支持的文件类型 .${ext || '?'}（只能导 ${IMPORT_FILE_EXTENSIONS.map((e) => `.${e}`).join(' / ')}）` }],
    }
  }
  if (ext === 'json') return parseJson(fileName, text)
  return parseMarkdown(fileName, text)
}
