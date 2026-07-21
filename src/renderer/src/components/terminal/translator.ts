/**
 * 终端翻译核心算法 - Translator
 *
 * 教学术语：
 * - 词条（Dict Entry）：词典中的一条记录，包含英文、中文、词性、例句等
 * - 词典（Dict）：所有词条的集合，JSON 格式
 * - 翻译匹配（Translation Match）：根据输入文本查找对应翻译
 * - 策略链（Strategy Chain）：按优先级依次尝试的多种匹配方式
 *
 * 职责：
 * 1. 提供单词提取接口（从 xterm.js buffer 行中提取 col 位置的单词）
 * 2. 提供翻译匹配接口（7 级策略链：短语 → 路径 → 命令 → 选项 → 多词短语 → 单词 → 未命中）
 * 3. 返回结构化结果（含分词、关联课程）
 *
 * 性能要求：
 * - 单词提取 < 5ms
 * - 词典查询 < 1ms（hash lookup）
 *
 * @module terminal/translator
 */

import dictData from '../../assets/dict/linux-commands-zh.json'

// ============================================================
// 类型定义
// ============================================================

/** 词条类型 */
export type DictCategory =
  | 'command'  // 命令
  | 'option'   // 选项
  | 'error'    // 错误信息
  | 'term'     // 通用术语
  | 'phrase'   // 短语

/** 词性 */
export type PartOfSpeech = 'v.' | 'n.' | 'adj.' | 'adv.' | 'phr.'

/** 难度等级 */
export type DifficultyLevel = 'basic' | 'intermediate' | 'advanced'

/** 单条词条 */
export interface DictEntry {
  /** 中文释义（一句话） */
  zh: string
  /** 词性 */
  pos?: PartOfSpeech
  /** 例句 */
  example?: string
  /** 类别 */
  category?: DictCategory
  /** 难度 */
  level?: DifficultyLevel
  /** 关联课程章节 ID */
  courseChapter?: string
}

/** 词典结构 */
export interface Dict {
  version: string
  updatedAt?: string
  source?: string
  entries: Record<string, DictEntry>
}

/** 课程关联提示 */
export interface CourseHint {
  chapterId: string
  matchScore: number  // 0-1
}

/** 翻译结果 */
export interface TranslateResult {
  /** 原始文本 */
  raw: string
  /** 是否命中 */
  matched: boolean
  /** 主翻译（最匹配的那条） */
  primary: { word: string; entry: DictEntry } | null
  /** 分段翻译（路径等多段） */
  segments: Array<{ word: string; entry: DictEntry | null }>
  /** 关联课程 */
  courseHint?: CourseHint
  /** 匹配策略（用于调试） */
  strategy?: TranslateStrategy
}

/** 匹配策略枚举（便于测试与调试） */
export type TranslateStrategy =
  | 'exact-phrase'   // 完整短语
  | 'path'           // 路径
  | 'command'        // 命令
  | 'option'         // 选项
  | 'phrase-greedy'  // 多词短语（贪心）
  | 'word'           // 单个单词
  | 'none'           // 未命中

// ============================================================
// 常量
// ============================================================

/** 路径分隔符正则（POSIX / Windows 都支持） */
const PATH_SEP_REGEX = /[\\/]/

/**
 * 单词边界正则（命令、参数、文件名、路径等）
 * 注意：
 * - 包含 / 是为了让 `/usr/local` 整体识别为一个单词
 * - 包含 " 和 ' 是为了让带引号字符串（如 "test"）作为整体识别
 */
const WORD_REGEX = /[a-zA-Z0-9_\-./~"']+/g

/** 命令名正则（必须以字母开头） */
const COMMAND_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/

/** 选项正则（以 - 或 -- 开头） */
const OPTION_REGEX = /^-{1,2}[\w-]+$/

// ============================================================
// 词典加载（含简单 LRU 缓存）
// ============================================================

/** 翻译结果 LRU 缓存（避免重复查询） */
const translateCache = new Map<string, TranslateResult>()
const TRANSLATE_CACHE_MAX = 200

let cachedDict: Dict | null = null

/**
 * 加载词典（同步，开发期 import JSON 已热更新）
 */
export function loadDict(): Dict {
  if (cachedDict) return cachedDict
  cachedDict = dictData as Dict
  return cachedDict
}

/** 未来扩展：远程更新词典 */
export async function fetchRemoteDict(url: string): Promise<Dict | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json() as Dict
    // 验证基础结构
    if (!data || typeof data !== 'object' || !data.entries) return null
    return data
  } catch {
    return null
  }
}

// ============================================================
// 翻译匹配算法
// ============================================================

/**
 * 主入口：翻译一段文本
 *
 * 策略链（按优先级）：
 * 1. path           路径整体识别 + 分段翻译
 * 2. option         选项（- / -- 开头，兼容无 - 前缀的容错）
 * 3. exact-phrase   完整短语（仅 error / phrase 类别，避免与 command 冲突）
 * 4. command        命令名（以字母开头）
 * 5. phrase-greedy  多词短语（贪心匹配最长）
 * 6. word           单个单词
 * 7. none           未命中（AI 兜底由 UI 层处理）
 *
 * @param text 原始文本（已被选中的字符串）
 * @param dict 词典（默认 loadDict()）
 */
export function translate(text: string, dict: Dict = loadDict()): TranslateResult {
  const raw = text.trim()
  if (!raw) {
    return emptyResult(raw)
  }

  // 缓存命中直接返回（LRU 简易实现：Map 保持插入顺序）
  const cacheKey = raw.toLowerCase()
  const cached = translateCache.get(cacheKey)
  if (cached) {
    // 命中：刷新插入顺序（LRU）
    translateCache.delete(cacheKey)
    translateCache.set(cacheKey, cached)
    return cached
  }

  // 1. 路径识别（形态特化，最先处理以免被其他策略误匹配）
  if (isPath(raw)) {
    return cacheAndReturn(cacheKey, translatePath(raw, dict))
  }

  // 2. 选项匹配（含无 - 前缀的容错，例如用户传 "l" 也能命中 "-l"）
  const opt = matchOption(raw, dict)
  if (opt) return cacheAndReturn(cacheKey, opt)

  // 3. 短语精确匹配（仅 error / phrase 类别优先，其他由 command/word 处理）
  const phrase = matchExactPhrase(cacheKey, raw, dict)
  if (phrase) return cacheAndReturn(cacheKey, phrase)

  // 4. 命令
  if (COMMAND_REGEX.test(raw)) {
    const cmd = matchCommand(raw, cacheKey, dict)
    if (cmd) return cacheAndReturn(cacheKey, cmd)
  }

  // 5. 多词短语（贪心）
  const phraseGreedy = matchPhraseGreedy(cacheKey, dict)
  if (phraseGreedy) {
    return cacheAndReturn(cacheKey, wrapWithSegments(raw, phraseGreedy, dict))
  }

  // 6. 单词
  const word = matchWord(cacheKey, raw, dict)
  if (word) return cacheAndReturn(cacheKey, word)

  // 7. 未命中
  return cacheAndReturn(cacheKey, emptyResult(raw))
}

/** 写入缓存（带容量控制） */
function cacheAndReturn(key: string, result: TranslateResult): TranslateResult {
  if (translateCache.size >= TRANSLATE_CACHE_MAX) {
    // 删除最早插入的项
    const firstKey = translateCache.keys().next().value
    if (firstKey !== undefined) translateCache.delete(firstKey)
  }
  translateCache.set(key, result)
  return result
}

/** 清空翻译缓存（供测试或手动刷新） */
export function clearTranslateCache(): void {
  translateCache.clear()
}

// ============================================================
// 各策略实现
// ============================================================

/** 策略 1：完整短语精确匹配（仅 error / phrase 类别，避免与 command 冲突） */
function matchExactPhrase(
  lower: string,
  raw: string,
  dict: Dict
): TranslateResult | null {
  const entry = dict.entries[lower]
  if (!entry) return null
  // 仅短语 / 错误信息优先于 command/word
  // command / option / term 类别由更专门的策略处理
  if (entry.category && entry.category !== 'error' && entry.category !== 'phrase') {
    return null
  }
  return buildResult(raw, lower, entry, 'exact-phrase', [{ word: raw, entry }])
}

/** 策略 2：路径翻译 */
function translatePath(path: string, dict: Dict): TranslateResult {
  const parts = path.split(PATH_SEP_REGEX)
  const segments: Array<{ word: string; entry: DictEntry | null }> = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i === 0 && (part === '' || /^[A-Z]:$/i.test(part))) {
      // 跳过根标识（空或 Windows 盘符 C:）
      segments.push({ word: part, entry: null })
    } else {
      segments.push({ word: part, entry: dict.entries[part.toLowerCase()] ?? null })
    }
  }
  const hasAny = segments.some(s => s.entry !== null)
  return {
    raw: path,
    matched: hasAny,
    primary: hasAny
      ? {
          word: path,
          entry: {
            zh: segments.map(s => s.entry?.zh ?? s.word).join('/'),
            category: 'term',
          },
        }
      : null,
    segments,
    strategy: 'path',
  }
}

/** 策略 3：命令匹配（仅 category='command' 视为命令，避免与 term 混淆） */
function matchCommand(
  raw: string,
  lower: string,
  dict: Dict
): TranslateResult | null {
  const entry = dict.entries[lower]
  if (!entry) return null
  // 仅命令类别由 command 策略处理；term 由 word 策略处理
  if (entry.category && entry.category !== 'command') {
    return null
  }
  return buildResult(raw, lower, entry, 'command', [{ word: raw, entry }])
}

/** 策略 4：选项匹配（支持 `-l` / `--all` / 容错 `l` → `-l`，category 守卫避免误匹配命令） */
function matchOption(raw: string, dict: Dict): TranslateResult | null {
  // 1. 原 key 命中（仅 category='option' 视为选项）
  const direct = dict.entries[raw]
  if (direct?.category === 'option') {
    return buildResult(raw, raw, direct, 'option', [{ word: raw, entry: direct }])
  }
  // 2. 容错：用户可能传 "l" 但词条是 "-l"
  const key = `-${raw.replace(/^-+/, '')}`
  const fallback = dict.entries[key]
  if (fallback?.category === 'option') {
    return buildResult(raw, key, fallback, 'option', [{ word: raw, entry: fallback }])
  }
  return null
}

/** 策略 5：多词短语（贪心匹配最长短语） */
function matchPhraseGreedy(
  lower: string,
  dict: Dict
): { phrase: string; entry: DictEntry; matchedWords: string[] } | null {
  const words = lower.split(/\s+/).filter(Boolean)
  if (words.length < 2) return null

  // 从长到短尝试所有连续子串
  for (let len = words.length; len >= 2; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ')
      const entry = dict.entries[phrase]
      if (entry) {
        return { phrase, entry, matchedWords: words.slice(i, i + len) }
      }
    }
  }
  return null
}

/** 包装多词短语结果（剩余词条独立翻译） */
function wrapWithSegments(
  raw: string,
  phrase: { phrase: string; entry: DictEntry; matchedWords: string[] },
  dict: Dict
): TranslateResult {
  const allWords = raw.split(/\s+/).filter(Boolean)
  const matchedSet = new Set(phrase.matchedWords)
  const restSegments = allWords
    .filter(w => !matchedSet.has(w.toLowerCase()))
    .map(w => ({
      word: w,
      entry: dict.entries[w.toLowerCase()] ?? null,
    }))
  return {
    raw,
    matched: true,
    primary: { word: phrase.phrase, entry: phrase.entry },
    segments: [{ word: phrase.phrase, entry: phrase.entry }, ...restSegments],
    strategy: 'phrase-greedy',
  }
}

/** 策略 6：单词匹配 */
function matchWord(
  lower: string,
  raw: string,
  dict: Dict
): TranslateResult | null {
  const entry = dict.entries[lower]
  if (!entry) return null
  return buildResult(raw, lower, entry, 'word', [{ word: raw, entry }])
}

// ============================================================
// 工具函数
// ============================================================

/** 是否是路径（POSIX / Windows / 用户家目录） */
function isPath(text: string): boolean {
  if (!PATH_SEP_REGEX.test(text)) return false
  if (text.startsWith('/') || text.startsWith('~')) return true
  if (/^[A-Z]:[\\/]/i.test(text)) return true
  return false
}

/** 构造统一结果（含课程关联） */
function buildResult(
  raw: string,
  word: string,
  entry: DictEntry,
  strategy: TranslateStrategy,
  segments: Array<{ word: string; entry: DictEntry | null }>
): TranslateResult {
  const result: TranslateResult = {
    raw,
    matched: true,
    primary: { word, entry },
    segments,
    strategy,
  }
  if (entry.courseChapter) {
    result.courseHint = { chapterId: entry.courseChapter, matchScore: 1.0 }
  }
  return result
}

/** 未命中结果 */
function emptyResult(raw: string): TranslateResult {
  return {
    raw,
    matched: false,
    primary: null,
    segments: [{ word: raw, entry: null }],
    strategy: 'none',
  }
}

// ============================================================
// 单词提取（从 xterm.js buffer 行中）
// ============================================================

/**
 * 从一行文本中提取 col 位置所在的"单词"
 *
 * 单词定义（按优先级）：
 * 1. 路径（含 / 或 .）：作为整体识别
 * 2. 命令（纯字母数字 + - _）：以字母开头
 * 3. 选项（- 或 -- 开头）
 * 4. 通用单词
 *
 * @param lineText 一行完整文本
 * @param col 鼠标光标列（0-based）
 * @returns 提取出的单词，未命中返回 null
 */
export function extractWordAtLine(lineText: string, col: number): string | null {
  if (!lineText) return null
  if (col < 0 || col > lineText.length) return null

  // 找到所有候选单词片段（用 [start, end) 半开区间）
  const segments: Array<{ start: number; end: number; text: string }> = []
  for (const m of lineText.matchAll(WORD_REGEX)) {
    const text = m[0]
    if (!text) continue
    segments.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + text.length,
      text,
    })
  }

  // 找到包含 col 的片段（半开区间：[start, end)）
  for (const seg of segments) {
    if (col >= seg.start && col < seg.end) {
      return seg.text
    }
  }
  return null
}

// ============================================================
// 默认导出（方便使用）
// ============================================================

export default {
  loadDict,
  fetchRemoteDict,
  translate,
  extractWordAtLine,
  clearTranslateCache,
}
