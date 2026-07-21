/**
 * Editblock 4 级匹配（v0.9.4 批次 3 - 任务 1）
 *
 * 借鉴 Aider 的 editblock 多级匹配机制（aider/coders/editblock_coder.py:127-329）：
 * 1. exact              — 精确匹配，confidence=1.0
 * 2. whitespace-insensitive — 去空白匹配（trim + 连续空格压缩），confidence=0.9
 * 3. fuzzy              — 行级 Levenshtein 距离 ≤ tolerance
 * 4. most-similar       — 行级 dice coefficient ≥ threshold
 *
 * 设计要点：
 * - 行号统一用 0-based，与 String.split('\n') 索引对齐
 * - 失败时返回 matched=false + failureReason，不抛异常
 * - 所有函数为纯函数（无副作用），便于单元测试
 *
 * 方案书依据：v0.9.4 §11 第 3 类（edit format 多策略）
 */

/** 单个 SEARCH/REPLACE 块（解析自 LLM 输出） */
export interface EditBlock {
  /** SEARCH 文本（要查找的原始内容） */
  search: string
  /** REPLACE 文本（替换为的新内容） */
  replace: string
  /** 匹配位置（解析后填充，未匹配时为 undefined） */
  matchRange?: { startLine: number; endLine: number }
}

/** 匹配结果（4 级匹配函数的统一返回类型） */
export interface EditMatchResult {
  /** 匹配策略名称 */
  strategy: 'exact' | 'whitespace-insensitive' | 'fuzzy' | 'most-similar'
  /** 是否匹配成功 */
  matched: boolean
  /** 匹配的起始行号（0-based，未匹配时为 -1） */
  startLine: number
  /** 匹配的结束行号（0-based，未匹配时为 -1） */
  endLine: number
  /** 匹配置信度（0-1，exact=1.0，fuzzy 越高越相似） */
  confidence: number
  /** 失败原因（未匹配时填充） */
  failureReason?: string
}

// 工具函数

/**
 * 计算字符串 a → b 的 Levenshtein 编辑距离
 *
 * 经典 DP 实现，时间复杂度 O(m*n)，空间复杂度 O(min(m,n))。
 * 用于 fuzzy 匹配的行级距离计算。
 *
 * @param a 源字符串
 * @param b 目标字符串
 * @returns 编辑距离（整数，0 表示完全相同）
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // 保证 a 是较短的一方，节省空间
  if (a.length > b.length) {
    ;[a, b] = [b, a]
  }

  const m = a.length
  const n = b.length
  let prev = new Array<number>(m + 1)
  let curr = new Array<number>(m + 1)

  for (let i = 0; i <= m; i++) prev[i] = i

  for (let j = 1; j <= n; j++) {
    curr[0] = j
    const bChar = b[j - 1]
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === bChar ? 0 : 1
      curr[i] = Math.min(
        curr[i - 1] + 1, // 插入
        prev[i] + 1, // 删除
        prev[i - 1] + cost, // 替换
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[m]
}

/**
 * 计算两个字符串的 Dice Coefficient 相似度（基于 bigram）
 *
 * 公式：2 * |A ∩ B| / (|A| + |B|)，其中 A/B 是 bigram 多重集。
 * 返回 [0, 1]，1 表示完全相同。用于 most-similar 匹配。
 *
 * @param a 源字符串
 * @param b 目标字符串
 * @returns 相似度 [0, 1]
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.length < 2 || b.length < 2) return a === b ? 1.0 : 0.0

  // 构建 bigram 多重集（用 Map 计数，处理重复 bigram）
  const bigramsA = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2)
    bigramsA.set(bg, (bigramsA.get(bg) ?? 0) + 1)
  }

  const bigramsB = new Map<string, number>()
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2)
    bigramsB.set(bg, (bigramsB.get(bg) ?? 0) + 1)
  }

  // 计算交集大小（取每个 bigram 的最小计数）
  let intersection = 0
  for (const [bg, count] of bigramsA) {
    const otherCount = bigramsB.get(bg)
    if (otherCount !== undefined) {
      intersection += Math.min(count, otherCount)
    }
  }

  const total = a.length - 1 + b.length - 1
  return total === 0 ? 0.0 : (2.0 * intersection) / total
}

/** 规范化行（trim + 连续空格压缩为单个空格），用于 whitespace-insensitive 匹配 */
function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

/** 计算字符串中第 offset 个字符所在的行号（0-based） */
function lineNumberOfOffset(content: string, offset: number): number {
  let line = 0
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++
  }
  return line
}

/** 移除末尾空行（LLM 常多输出一个换行），返回新数组 */
function trimTrailingEmptyLines(lines: string[]): string[] {
  const result = [...lines]
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop()
  }
  return result
}

/** 构造失败结果（统一失败路径，减少重复代码） */
function makeFailure(
  strategy: EditMatchResult['strategy'],
  reason: string,
): EditMatchResult {
  return {
    strategy,
    matched: false,
    startLine: -1,
    endLine: -1,
    confidence: 0,
    failureReason: reason,
  }
}

// 4 级匹配函数

/** 1. 精确匹配（区分大小写、空格、换行）；content.indexOf(search) */
export function matchExact(content: string, search: string): EditMatchResult {
  if (!search) return makeFailure('exact', 'search text is empty')

  const offset = content.indexOf(search)
  if (offset < 0) return makeFailure('exact', 'exact match not found')

  const startLine = lineNumberOfOffset(content, offset)
  const newlineCount = search.split('\n').length - 1
  return {
    strategy: 'exact',
    matched: true,
    startLine,
    endLine: startLine + newlineCount,
    confidence: 1.0,
  }
}

/** 2. 去空白匹配（trim + 连续空格压缩）；行级匹配，适用 LLM 弄错缩进 */
export function matchWhitespaceInsensitive(content: string, search: string): EditMatchResult {
  if (!search) return makeFailure('whitespace-insensitive', 'search text is empty')

  const contentLines = content.split('\n').map(normalizeLine)
  let searchLines = search.split('\n').map(normalizeLine)
  searchLines = trimTrailingEmptyLines(searchLines)

  if (searchLines.length === 0) {
    return makeFailure('whitespace-insensitive', 'search text is empty after normalization')
  }

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let matched = true
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j] !== searchLines[j]) {
        matched = false
        break
      }
    }
    if (matched) {
      return {
        strategy: 'whitespace-insensitive',
        matched: true,
        startLine: i,
        endLine: i + searchLines.length - 1,
        confidence: 0.9,
      }
    }
  }

  return makeFailure('whitespace-insensitive', 'whitespace-insensitive match not found')
}

/**
 * 3. 模糊匹配（行级 Levenshtein 距离 ≤ tolerance 视为匹配）
 * confidence = 1 - (平均距离 / max(tolerance, 1))。适用 LLM 少量字符错误。
 * @param tolerance 单行编辑距离容差（默认 2）
 */
export function matchFuzzy(content: string, search: string, tolerance: number = 2): EditMatchResult {
  if (!search) return makeFailure('fuzzy', 'search text is empty')

  const contentLines = content.split('\n')
  let searchLines = search.split('\n')
  searchLines = trimTrailingEmptyLines(searchLines)

  if (searchLines.length === 0) {
    return makeFailure('fuzzy', 'search text is empty after trim')
  }

  let bestStart = -1
  let bestEnd = -1
  let bestAvgDistance = Infinity

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let totalDistance = 0
    let allMatched = true
    for (let j = 0; j < searchLines.length; j++) {
      const dist = levenshtein(contentLines[i + j], searchLines[j])
      if (dist > tolerance) {
        allMatched = false
        break
      }
      totalDistance += dist
    }
    if (allMatched) {
      const avgDistance = totalDistance / searchLines.length
      if (avgDistance < bestAvgDistance) {
        bestAvgDistance = avgDistance
        bestStart = i
        bestEnd = i + searchLines.length - 1
      }
    }
  }

  if (bestStart < 0) {
    return makeFailure('fuzzy', `fuzzy match not found within tolerance=${tolerance}`)
  }

  const confidence = Math.max(0, 1 - bestAvgDistance / Math.max(tolerance, 1))
  return {
    strategy: 'fuzzy',
    matched: true,
    startLine: bestStart,
    endLine: bestEnd,
    confidence,
  }
}

/**
 * 4. 最相似匹配（行级 dice coefficient 相似度 ≥ threshold 视为匹配）
 * 取平均相似度最高者；confidence = 平均相似度。适用 LLM 重写代码（变量改名）。
 * @param threshold 单行相似度阈值（默认 0.7）
 */
export function matchMostSimilar(
  content: string,
  search: string,
  threshold: number = 0.7,
): EditMatchResult {
  if (!search) return makeFailure('most-similar', 'search text is empty')

  const contentLines = content.split('\n')
  let searchLines = search.split('\n')
  searchLines = trimTrailingEmptyLines(searchLines)

  if (searchLines.length === 0) {
    return makeFailure('most-similar', 'search text is empty after trim')
  }

  let bestStart = -1
  let bestEnd = -1
  let bestAvgSimilarity = 0

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let totalSim = 0
    let allAbove = true
    for (let j = 0; j < searchLines.length; j++) {
      const sim = diceCoefficient(contentLines[i + j], searchLines[j])
      if (sim < threshold) {
        allAbove = false
        break
      }
      totalSim += sim
    }
    if (allAbove) {
      const avgSim = totalSim / searchLines.length
      if (avgSim > bestAvgSimilarity) {
        bestAvgSimilarity = avgSim
        bestStart = i
        bestEnd = i + searchLines.length - 1
      }
    }
  }

  if (bestStart < 0) {
    return makeFailure('most-similar', `most-similar match not found above threshold=${threshold}`)
  }

  return {
    strategy: 'most-similar',
    matched: true,
    startLine: bestStart,
    endLine: bestEnd,
    confidence: bestAvgSimilarity,
  }
}

// 解析函数

/**
 * SEARCH/REPLACE 块标记正则（借鉴 Aider editblock_coder.py:386-388）
 *
 * - HEAD:    ^<{5,9}\s*(SEARCH)?\s*$  （5-9 个 < 开头，可选 SEARCH 后缀）
 * - DIVIDER: ^={5,9}\s*$               （5-9 个 =）
 * - UPDATED: ^>{5,9}\s*(REPLACE)?\s*$  （5-9 个 > 开头，可选 REPLACE 后缀）
 *
 * 兼容标准格式（<<<<<<< SEARCH）和宽松格式（<<<<<<<）
 */
const SEARCH_HEAD_RE = /^<{5,9}\s*(SEARCH)?\s*$/
const DIVIDER_RE = /^={5,9}\s*$/
const REPLACE_TAIL_RE = /^>{5,9}\s*(REPLACE)?\s*$/

/**
 * 从 LLM 输出文本中解析 SEARCH/REPLACE 块（Aider 标准格式）
 *
 * 格式：`<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`
 * 容错：兼容宽松格式（不带后缀）、跳过空块、跳过未闭合块、支持多块。
 *
 * @param text LLM 输出文本
 * @returns 解析出的 EditBlock 数组（可能为空）
 */
export function parseEditBlocks(text: string): EditBlock[] {
  const blocks: EditBlock[] = []
  const lines = text.split('\n')

  let i = 0
  while (i < lines.length) {
    // 找 SEARCH 头
    if (!SEARCH_HEAD_RE.test(lines[i])) {
      i++
      continue
    }

    // 收集 SEARCH 内容直到 DIVIDER
    const searchLines: string[] = []
    i++
    while (i < lines.length && !DIVIDER_RE.test(lines[i])) {
      // 如果遇到 REPLACE 头，说明格式错误，跳过当前块
      if (REPLACE_TAIL_RE.test(lines[i])) {
        i++
        searchLines.length = 0
        break
      }
      searchLines.push(lines[i])
      i++
    }

    // 跳过 DIVIDER
    if (i < lines.length && DIVIDER_RE.test(lines[i])) {
      i++
    } else {
      // 未找到 DIVIDER，块不完整
      continue
    }

    // 收集 REPLACE 内容直到 REPLACE 尾
    const replaceLines: string[] = []
    while (i < lines.length && !REPLACE_TAIL_RE.test(lines[i])) {
      replaceLines.push(lines[i])
      i++
    }

    // 跳过 REPLACE 尾
    if (i < lines.length && REPLACE_TAIL_RE.test(lines[i])) {
      i++
    } else {
      // 未找到 REPLACE 尾，块不完整
      continue
    }

    const search = searchLines.join('\n')
    const replace = replaceLines.join('\n')

    // 跳过空块
    if (search === '' && replace === '') {
      continue
    }

    blocks.push({ search, replace })
  }

  return blocks
}

// 主入口

/**
 * 应用单个 EditBlock（4 级匹配主入口）
 *
 * 按 4 级顺序尝试：exact → whitespace → fuzzy → most-similar
 * 第一个匹配成功即返回，应用 REPLACE 替换。
 * 4 级都失败时返回原 content + matched=false + failureReason。
 *
 * @param content 文件原始内容
 * @param block EditBlock（含 search + replace）
 * @returns { newContent, result } 新内容 + 匹配结果
 */
export function applyEditBlock(
  content: string,
  block: EditBlock,
): { newContent: string; result: EditMatchResult } {
  // 1. exact
  const exactResult = matchExact(content, block.search)
  if (exactResult.matched) {
    const newContent = applyReplaceByString(content, block.search, block.replace)
    return { newContent, result: exactResult }
  }

  // 2. whitespace-insensitive
  const wsResult = matchWhitespaceInsensitive(content, block.search)
  if (wsResult.matched) {
    const newContent = applyReplaceByLineRange(content, block, wsResult)
    return { newContent, result: wsResult }
  }

  // 3. fuzzy
  const fuzzyResult = matchFuzzy(content, block.search)
  if (fuzzyResult.matched) {
    const newContent = applyReplaceByLineRange(content, block, fuzzyResult)
    return { newContent, result: fuzzyResult }
  }

  // 4. most-similar
  const msResult = matchMostSimilar(content, block.search)
  if (msResult.matched) {
    const newContent = applyReplaceByLineRange(content, block, msResult)
    return { newContent, result: msResult }
  }

  // 全部失败
  return {
    newContent: content,
    result: makeFailure(
      'most-similar',
      'all 4 strategies failed: exact, whitespace-insensitive, fuzzy, most-similar',
    ),
  }
}

/** 按 search 文本精确替换（用于 exact 匹配）；仅替换第一个出现位置 */
function applyReplaceByString(content: string, search: string, replace: string): string {
  const idx = content.indexOf(search)
  if (idx < 0) return content
  return content.slice(0, idx) + replace + content.slice(idx + search.length)
}

/** 按行号范围替换（用于 whitespace / fuzzy / most-similar 匹配） */
function applyReplaceByLineRange(
  content: string,
  block: EditBlock,
  result: EditMatchResult,
): string {
  const lines = content.split('\n')
  const before = lines.slice(0, result.startLine)
  const after = lines.slice(result.endLine + 1)
  const replaceLines = block.replace.split('\n')
  const newLines = [...before, ...replaceLines, ...after]
  // 回填 EditBlock.matchRange（block 是引用传递，调用方可读取）
  block.matchRange = { startLine: result.startLine, endLine: result.endLine }
  return newLines.join('\n')
}
