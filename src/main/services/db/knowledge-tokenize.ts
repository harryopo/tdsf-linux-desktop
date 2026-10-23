/**
 * 知识库中文检索的分词（#181）
 *
 * FTS5 的 unicode61 把一整段没有空格的中文当成**一个 token**，于是
 * 「磁盘满了怎么办」在索引里是一个词，拿「磁盘」去 MATCH 永远命中不了。
 * 这一层负责把文本按"FTS 能按空格切"的样子先切好：
 *
 *   - 入库：segmentForIndex(title + problem + keywords + commands)
 *     → "磁盘 盘满 满了 …" 写进 knowledge_entries.contentSeg；
 *     FTS 表索引这一列，unicode61 只需要按空格切。
 *   - 查询：buildFtsMatchQuery("磁盘")
 *     → '"磁盘"'；多词用 OR 连（用 AND 会要求「了怎/怎么/么办」同时出现，
 *     短文档永远不满足，召回直接归零）。
 *
 * 为什么是二元组而不是单字：单字会让 BM25 的 IDF 被"的/了/是"这类高频字稀释；
 * 为什么不引 jieba：本地产品不为一个分词器背几 MB 依赖与词典更新，
 * 二元组对"短查询命中短文档"这个场景已经够用（业界同规模 RAG 的常见取舍）。
 */

/** 中日韩统一表意文字（含扩展 A 与兼容区） */
const CJK_CHAR = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'

/** 一次扫描切出"中文连续段"或"英文/数字/下划线连续段" */
const RUN_PATTERN = new RegExp(`[${CJK_CHAR}]+|[a-z0-9_]+`, 'gi')

/** 判断一个 run 是不是中文段（配合 RUN_PATTERN 使用，非全局避免 lastIndex 干扰） */
const CJK_RUN_PATTERN = new RegExp(`^[${CJK_CHAR}]+$`)

/** 入库时一条文本最多保留多少个词（超长正文只索引前面这部分） */
export const MAX_SEGMENT_TOKENS = 256

/** 查询侧最多保留多少个词（防止一句话被切成几百个 OR 项） */
export const MAX_QUERY_TOKENS = 32

/**
 * FTS5 自己的语法关键字
 *
 * 我们给每个词都加了引号，所以它们不会被当成操作符；但把它们当检索词会污染召回
 * （每篇文档都"包含 or"）。只在查询侧过滤，入库侧照常保留。
 */
const FTS_OPERATOR_WORDS = new Set(['and', 'or', 'not', 'near'])

/**
 * 把文本切成检索词（保序去重）
 *
 * - 中文连续段：长度 1 保留该字；长度 ≥2 取全部相邻二元组
 * - 英文/数字：小写后保留长度 ≥2 的（单个字母/数字都是噪音）
 */
export function tokenizeForSearch(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (token: string): void => {
    if (seen.has(token)) return
    seen.add(token)
    out.push(token)
  }

  for (const match of text.toLowerCase().matchAll(RUN_PATTERN)) {
    const run = match[0]
    if (CJK_RUN_PATTERN.test(run)) {
      if (run.length === 1) {
        push(run)
        continue
      }
      for (let i = 0; i + 1 < run.length; i++) push(run.slice(i, i + 2))
      continue
    }
    if (run.length >= 2) push(run)
  }
  return out
}

/** 入库用：切成空格分隔的一串词，交给 FTS 的 unicode61 按空格索引 */
export function segmentForIndex(text: string): string {
  return tokenizeForSearch(text).slice(0, MAX_SEGMENT_TOKENS).join(' ')
}

/**
 * 一条知识条目的检索文本（所有写入方共用这一份口径）
 *
 * 只收"用户会拿来找它"的字段：标题、问题、关键词、标签、命令。
 * 加命令是因为运维场景里"nginx -t"这种字面量本身就是检索词。
 */
export interface ContentSegParts {
  title?: string | null
  problem?: string | null
  keywords?: string[] | null
  tags?: string[] | null
  commands?: string[] | null
}

export function buildContentSeg(parts: ContentSegParts): string {
  const joined = [
    parts.title ?? '',
    parts.problem ?? '',
    (parts.keywords ?? []).join(' '),
    (parts.tags ?? []).join(' '),
    (parts.commands ?? []).join(' '),
  ]
    .filter((part) => part.trim().length > 0)
    .join(' ')
  return segmentForIndex(joined)
}

/**
 * 查询用：把用户输入变成 FTS5 的 MATCH 表达式
 *
 * 每个词加双引号（词里不会再有引号，因为只由中文/字母/数字/下划线组成），
 * 词之间用 OR。空输入返回空串，调用方据此跳过全文检索那条腿。
 */
export function buildFtsMatchQuery(query: string): string {
  const tokens = tokenizeForSearch(query)
    .filter((t) => !FTS_OPERATOR_WORDS.has(t))
    .slice(0, MAX_QUERY_TOKENS)
  if (tokens.length === 0) return ''
  return tokens.map((t) => `"${t}"`).join(' OR ')
}
