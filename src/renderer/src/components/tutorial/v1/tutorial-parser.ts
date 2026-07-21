/**
 * TutorialEntry → 章节结构化解析器
 *
 * 输入：TutorialEntry.content（Markdown 文本）
 * 输出：ParsedTutorial 包含：
 *   - chapters: 章节列表（按 ## 二级标题拆分）
 *   - overview: 概述（## 之前的内容）
 *   - practiceLines: 实践命令代码块（"实践" 章节或第一个 shell 块）
 *   - quiz: 自动生成的知识检查题（基于 keywords + content 智能生成）
 *
 * 设计要点：
 * 1. 兼容多种章节切分方式：## 标题、# 标题、**标题**
 * 2. 代码块语法高亮：
 *    - # 开头的行 → comment 灰
 *    - 包含 $ / 提示符 → constant 蓝
 *    - 含关键指标 = 后跟数字 → parameter（暂用 text 替代）
 *    - 其他 → text 白
 * 3. 学习目标：识别 `**学习目标**` / `**目标**` 后的列表项
 * 4. 注意事项：识别 `**注意**` / `> ⚠️` / `**⚠️**` 段落
 * 5. 实践块：识别 `**实践**` / `**示例**` 后的第一个 ```shell/bash/sh 代码块
 *
 * 容错策略：
 *   - 没有 ## 章节 → 整体视为单个章节
 *   - 没有学习目标 → 从首段提取 3 条要点
 *   - 没有注意事项 → 留空
 *   - 没有实践代码块 → 从 commands 字段兜底
 */

import type { TutorialEntry } from '@shared/tutorial-types'
import type { CodeLine, QuizQuestion } from './detail-data'
import {
  CHAPTER_PARAGRAPHS,
  CODE_EXAMPLE,
  CODE_CAPTION,
  ALERT_TEXT,
  LEARNING_OBJECTIVES,
  PRACTICE_TERMINAL,
  PRACTICE_DESCRIPTION,
  QUIZ_QUESTIONS,
} from './detail-data'

/** 解析后的章节 */
export interface ParsedChapter {
  /** 章节标题（去掉 # 标记） */
  title: string
  /** 章节正文段落（不含标题、代码块、列表、引用） */
  paragraphs: string[]
  /** 章节内代码块列表 */
  codeBlocks: { lang: string; lines: CodeLine[]; caption?: string }[]
  /** 学习目标（来自章节开头列表） */
  objectives: string[]
  /** 注意事项（来自章节内引用 / 加粗） */
  alert?: string
  /** 章节内普通列表项（- 开头） */
  listItems: string[]
}

/** 解析后的教程整体 */
export interface ParsedTutorial {
  /** 概述（## 之前的内容） */
  overview: string
  /** 章节列表 */
  chapters: ParsedChapter[]
  /** 实践命令（用于 PracticeCard 终端） */
  practiceLines: CodeLine[]
  /** 实践描述（用于 PracticeCard） */
  practiceDescription: string
  /** 知识检查题（自动生成） */
  quiz: QuizQuestion[]
}

/**
 * 设计稿 mock 教程（tutorial-detail.html 1:1 兜底）
 * - 5 章节，当前第 3 章
 * - 进度 65%、已学习 1h38min、剩余 52min
 * - 第 3 章携带完整正文 / 代码块 / 目标 / 警告
 */
export const MOCK_PARSED_TUTORIAL: ParsedTutorial = {
  overview: '',
  chapters: [
    {
      title: 'Nginx 基础架构',
      paragraphs: ['本章介绍 Nginx 的进程模型与基础配置结构。'],
      listItems: [],
      objectives: ['理解 master/worker 进程模型', '熟悉 nginx.conf 基本结构'],
      codeBlocks: [],
      alert: undefined,
    },
    {
      title: 'worker_connections 调优',
      paragraphs: ['worker_connections 决定单个 worker 能同时处理的连接数，需与 worker_processes 配合。'],
      listItems: [],
      objectives: ['掌握 worker_connections 计算方法', '理解文件描述符限制'],
      codeBlocks: [],
      alert: undefined,
    },
    {
      title: '内核参数优化',
      paragraphs: CHAPTER_PARAGRAPHS,
      listItems: [],
      objectives: LEARNING_OBJECTIVES.map((o) => o.text),
      codeBlocks: [{ lang: 'bash', lines: CODE_EXAMPLE, caption: CODE_CAPTION }],
      alert: ALERT_TEXT,
    },
    {
      title: 'keepalive 配置',
      paragraphs: ['合理配置 keepalive 可减少 TCP 握手开销，提升长连接场景下的吞吐量。'],
      listItems: [],
      objectives: ['理解 keepalive_timeout 与 keepalive_requests'],
      codeBlocks: [],
      alert: undefined,
    },
    {
      title: '综合实战',
      paragraphs: ['通过一个完整案例，将前面章节的知识点串联起来进行性能调优实战。'],
      listItems: [],
      objectives: ['综合运用 worker 与内核参数调优', '使用 ab 工具验证优化效果'],
      codeBlocks: [],
      alert: undefined,
    },
  ],
  practiceLines: PRACTICE_TERMINAL,
  practiceDescription: PRACTICE_DESCRIPTION,
  quiz: QUIZ_QUESTIONS,
}

/**
 * 解析 TutorialEntry 为结构化数据
 */
export function parseTutorial(t: TutorialEntry): ParsedTutorial {
  const md = t.content ?? ''
  const sections = splitByHeaders(md)

  const overview = sections.overview
  const chapters = sections.chapters.map((c) => parseChapter(c))
  const practice = extractPractice(md, t.commands ?? [])
  const quiz = autoGenerateQuiz(t, chapters)

  return {
    overview,
    chapters,
    practiceLines: practice.lines,
    practiceDescription: practice.description,
    quiz
  }
}

/**
 * 拆分 Markdown 为 overview + chapters
 * 优先识别 ## 标题；其次 ##/###；最后整体作为单章节
 */
function splitByHeaders(md: string): {
  overview: string
  chapters: { title: string; body: string }[]
} {
  if (!md) return { overview: '', chapters: [] }
  // 标准化换行
  const text = md.replace(/\r\n/g, '\n')
  // 识别 ## 标题
  const h2Regex = /^##\s+(.+)$/gm
  const matches: { title: string; index: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = h2Regex.exec(text)) !== null) {
    matches.push({ title: m[1].trim(), index: m.index, end: m.index + m[0].length })
  }

  if (matches.length === 0) {
    // 兜底：识别 # 一级标题
    const h1Regex = /^#\s+(.+)$/gm
    while ((m = h1Regex.exec(text)) !== null) {
      matches.push({ title: m[1].trim(), index: m.index, end: m.index + m[0].length })
    }
  }

  if (matches.length === 0) {
    // 无任何标题 → 整体作为单个章节
    return {
      overview: '',
      chapters: [{ title: '教程内容', body: text.trim() }]
    }
  }

  // 概述部分：第一个 ## 之前
  const overview = text.substring(0, matches[0].index).trim()
  // 章节内容
  const chapters: { title: string; body: string }[] = []
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const next = matches[i + 1]
    const body = next ? text.substring(cur.end, next.index) : text.substring(cur.end)
    chapters.push({ title: cur.title, body: body.trim() })
  }
  return { overview, chapters }
}

/**
 * 解析单个章节：提取段落 / 代码块 / 目标 / 注意事项 / 列表
 */
function parseChapter(raw: { title: string; body: string }): ParsedChapter {
  const body = raw.body
  const paragraphs: string[] = []
  const codeBlocks: { lang: string; lines: CodeLine[]; caption?: string }[] = []
  const listItems: string[] = []
  let objectives: string[] = []
  let alert: string | undefined

  // 1) 提取代码块
  const codeRegex = /```(\w*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  const codeRanges: { start: number; end: number; lang: string; body: string }[] = []
  while ((m = codeRegex.exec(body)) !== null) {
    codeRanges.push({
      start: m.index,
      end: m.index + m[0].length,
      lang: m[1] || 'text',
      body: m[2]
    })
  }

  // 2) 提取学习目标（识别 "学习目标" / "目标" 后面的列表）
  const objMatch = body.match(/\*\*(?:学习目标|目标|Objectives?)\*\*\s*[:：]?\s*([\s\S]*?)(?=\n\n|\n\*\*|```|$)/i)
  if (objMatch) {
    objectives = extractListItems(objMatch[1])
  }

  // 3) 提取注意事项（识别 "注意" / "⚠️" 引用或加粗段）
  const alertPatterns = [
    />\s*⚠️\s*(.+)/i,
    />\s*\*\*注意[：:]\*\*\s*(.+)/i,
    /\*\*⚠️\s*注意[：:]?\*\*\s*(.+)/i,
    /\*\*注意[：:]\*\*\s*(.+)/i
  ]
  for (const pat of alertPatterns) {
    const am = body.match(pat)
    if (am) {
      alert = am[1].trim()
      break
    }
  }
  if (!alert) {
    // 兜底：> 开头引用块（如果整段都是）
    const blockquoteMatch = body.match(/^>\s*(.+?)(?=\n\n|\n[^>]|$)/ms)
    if (blockquoteMatch && /注意|⚠|warning|warn|caution/i.test(blockquoteMatch[1])) {
      alert = blockquoteMatch[1].replace(/^>\s*/, '').trim()
    }
  }

  // 4) 遍历 body，提取段落 + 列表（排除代码块、目标、注意事项）
  let cursor = 0
  // 合并代码块区间
  const codeSet = new Set(codeRanges.map((c) => `${c.start}-${c.end}`))
  // 找出已处理区间（目标 + 注意事项 + 代码块）
  const skipRanges: { start: number; end: number }[] = [...codeRanges]
  if (objMatch) {
    skipRanges.push({ start: objMatch.index ?? 0, end: (objMatch.index ?? 0) + objMatch[0].length })
  }
  if (alert) {
    const alertIdx = body.indexOf(alert)
    if (alertIdx >= 0) {
      skipRanges.push({ start: Math.max(0, alertIdx - 30), end: alertIdx + alert.length + 30 })
    }
  }

  const lines = body.split('\n')
  let i = 0
  let currentParagraph: string[] = []
  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const p = currentParagraph.join(' ').trim()
      if (p) paragraphs.push(p)
      currentParagraph = []
    }
  }
  while (i < lines.length) {
    const line = lines[i]
    const lineStart = cursor
    const lineEnd = cursor + line.length
    // 判断该行是否在 skip 区间内
    const inSkip = skipRanges.some((r) => lineStart >= r.start && lineEnd <= r.end)
    if (inSkip) {
      flushParagraph()
      i++
      cursor = lineEnd + 1
      continue
    }
    // 列表项
    const listMatch = line.match(/^[-*]\s+(.+)/)
    if (listMatch) {
      flushParagraph()
      // 只收集未在目标/注意事项中的列表
      const inObj = objMatch && (lineStart >= (objMatch.index ?? 0)) && (lineEnd <= (objMatch.index ?? 0) + objMatch[0].length)
      if (!inObj) listItems.push(listMatch[1].trim())
      i++
      cursor = lineEnd + 1
      continue
    }
    // 标题（### 跳过）
    if (/^#{2,}\s+/.test(line)) {
      flushParagraph()
      i++
      cursor = lineEnd + 1
      continue
    }
    // 空行
    if (line.trim() === '') {
      flushParagraph()
      i++
      cursor = lineEnd + 1
      continue
    }
    // 加粗行（如 **总结**：xxx）
    currentParagraph.push(line.trim())
    i++
    cursor = lineEnd + 1
  }
  flushParagraph()

  // 5) 把代码块转换为 CodeLine[]
  for (const c of codeRanges) {
    codeBlocks.push({
      lang: c.lang,
      lines: markdownToCodeLines(c.body),
      caption: undefined
    })
  }

  // 6) 如果没有目标，尝试从首段提取
  if (objectives.length === 0 && paragraphs.length > 0) {
    const firstP = paragraphs[0]
    const sentences = firstP.split(/[。！？.!?]/).filter((s) => s.trim().length > 0)
    if (sentences.length >= 3) {
      objectives = sentences.slice(0, 3).map((s) => s.trim())
    }
  }

  return {
    title: raw.title,
    paragraphs,
    codeBlocks,
    objectives,
    alert,
    listItems
  }
}

/**
 * 提取列表项（- 开头）
 */
function extractListItems(text: string): string[] {
  const items: string[] = []
  const lines = text.split('\n')
  for (const line of lines) {
    const m = line.match(/^[-*]\s+(.+)/)
    if (m) items.push(m[1].trim())
  }
  return items
}

/**
 * Markdown 代码块 → CodeLine[]（带简单语法着色）
 *
 * 着色规则：
 *   - # 开头 → comment（说明）
 *   - 含 $ 或 提示符 → constant（用户输入前缀）
 *   - 含 = 且后跟数字 → constant（指标输出）
 *   - 其他 → text
 */
export function markdownToCodeLines(code: string): CodeLine[] {
  const lines = code.split('\n')
  return lines
    .filter((l) => l.length > 0 || lines.length === 1)
    .map((l) => {
      if (l.trim().startsWith('#')) {
        return { type: 'comment' as const, content: l }
      }
      // 含 $ 但不在字符串内
      if (/(?:^|\s)\$\s/.test(l) || /\$\s/.test(l)) {
        return { type: 'constant' as const, content: l }
      }
      // 提示符前缀（user@host:~$ / root@...#）
      if (/^[a-z0-9_-]+@[a-z0-9_.-]+[:\s~#$]/.test(l)) {
        return { type: 'constant' as const, content: l }
      }
      // 指标输出（key = value 且 value 是数字）
      if (/^\s*[a-zA-Z0-9_.]+\s*=\s*[\d.]+/.test(l)) {
        return { type: 'constant' as const, content: l }
      }
      return { type: 'text' as const, content: l }
    })
}

/**
 * 提取实践块
 *
 * 优先级：
 *   1. 章节中标题含"实践" / "示例" / "Practice" 的代码块
 *   2. 整个教程第一个 shell/bash 代码块
 *   3. 兜底用 commands 字段
 */
function extractPractice(md: string, fallbackCommands: string[]): {
  lines: CodeLine[]
  description: string
} {
  // 1) 找 "## 实践" / "## 示例" 章节
  const practiceMatch = md.match(/^##\s*(?:实践|示例|Practice|Exercise|Demo).*?\n([\s\S]*?)(?=^##\s|\Z)/im)
  let body = practiceMatch ? practiceMatch[1] : ''
  if (!body) {
    // 2) 整个教程第一个 shell/bash/sh 代码块
    const codeMatch = md.match(/```(?:shell|bash|sh|console)?\n([\s\S]*?)```/)
    body = codeMatch ? codeMatch[1] : ''
  }
  let lines: CodeLine[] = []
  if (body) {
    lines = markdownToCodeLines(body)
  } else if (fallbackCommands.length > 0) {
    // 3) 兜底
    lines = fallbackCommands.map((c) => ({ type: 'text' as const, content: c }))
  }

  // 描述
  let description = '在沙箱环境中动手实践本章节命令'
  const descMatch = md.match(/\*\*(?:实践目标|任务|目标)\*\*\s*[:：]?\s*(.+)/i)
  if (descMatch) description = descMatch[1].trim()
  if (lines.length > 0) {
    description += '（共 ' + lines.length + ' 条命令）'
  }

  return { lines, description }
}

/**
 * 自动生成知识检查题
 *
 * 策略：
 *  1. 优先使用第一条 chapter 包含 3+ 个 objective
 *  2. 否则从 keywords + commands 组合生成 3 道题
 *  3. 每道题 4 选项，1 个正确（基于真实数据）
 *
 * 由于真实爬虫数据未带预定义题目，这是合理的兜底方案。
 */
function autoGenerateQuiz(t: TutorialEntry, chapters: ParsedChapter[]): QuizQuestion[] {
  // 收集所有 objectives
  const allObjectives: string[] = []
  for (const ch of chapters) {
    allObjectives.push(...ch.objectives)
  }
  const keywords = (t.keywords ?? []).filter((k) => k && k.length > 0)
  const commands = (t.commands ?? []).slice(0, 6)
  const category = t.category

  const questions: QuizQuestion[] = []

  // Q1：来源/分类题（从 tutorial 元数据派生）
  if (category && t.title) {
    const wrongCats: string[] = [
      '虚拟化', '容器编排', '桌面应用', '游戏开发', '移动开发'
    ].filter((c) => c !== categoryLabel(category))
    if (wrongCats.length >= 3) {
      questions.push({
        id: 'Q1',
        question: `本教程《${truncate(t.title, 30)}》属于哪个知识领域？`,
        options: [
          { key: 'A', text: categoryLabel(category), correct: true },
          { key: 'B', text: wrongCats[0] },
          { key: 'C', text: wrongCats[1] },
          { key: 'D', text: wrongCats[2] }
        ]
      })
    }
  }

  // Q2：命令/关键词题
  if (commands.length > 0) {
    const cmd = commands[0]
    const wrongCmds = commands.slice(1, 4).concat(['shutdown -h now', 'rm -rf /', 'kill -9 1'])
    const opts = [cmd, ...wrongCmds.slice(0, 3)]
    shuffle(opts)
    questions.push({
      id: 'Q2',
      question: '下列哪个命令是本教程中实际演示的关键命令？',
      options: opts.map((o, i) => ({
        key: String.fromCharCode(65 + i),
        text: truncate(o, 50),
        correct: o === cmd
      }))
    })
  } else if (keywords.length >= 4) {
    // 关键词题
    const correct = keywords[0]
    const wrongs = keywords.slice(1, 4)
    const opts = [correct, ...wrongs]
    shuffle(opts)
    questions.push({
      id: 'Q2',
      question: '下列哪个关键词是本教程的核心概念？',
      options: opts.map((o, i) => ({
        key: String.fromCharCode(65 + i),
        text: o,
        correct: o === correct
      }))
    })
  }

  // Q3：难度/学习目标题
  if (allObjectives.length > 0) {
    const obj = allObjectives[0]
    questions.push({
      id: 'Q3',
      question: `完成本教程后，你将掌握："${truncate(obj, 40)}" ——这个描述是否正确？`,
      options: [
        { key: 'A', text: '是，这是核心目标', correct: true },
        { key: 'B', text: '不是，这只是次要目标' },
        { key: 'C', text: '教程不涉及此内容' },
        { key: 'D', text: '仅高级用户需掌握' }
      ]
    })
  } else if (keywords.length >= 2) {
    questions.push({
      id: 'Q3',
      question: '本教程适合哪个技术水平的读者？',
      options: [
        { key: 'A', text: difficultyLabel(t.difficulty), correct: true },
        { key: 'B', text: '仅适合资深架构师' },
        { key: 'C', text: '仅适合零基础新手' },
        { key: 'D', text: '仅适合学术研究者' }
      ]
    })
  }

  // 兜底：确保 3 道题
  while (questions.length < 3) {
    const idx = questions.length + 1
    questions.push({
      id: `Q${idx}`,
      question: `本教程的预估阅读时长是 ${t.readingTime ?? 5} 分钟，是否合理？`,
      options: [
        { key: 'A', text: '合理，符合内容深度', correct: true },
        { key: 'B', text: '太短，应该 30 分钟' },
        { key: 'C', text: '太长，只需 1 分钟' },
        { key: 'D', text: '无法判断' }
      ]
    })
  }

  return questions.slice(0, 3)
}

/** 截断字符串（带 ...） */
function truncate(s: string, max: number): string {
  if (!s) return ''
  if (s.length <= max) return s
  return s.substring(0, max - 1) + '…'
}

/** 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** TutorialCategory → 中文（精简版） */
function categoryLabel(c: string): string {
  const map: Record<string, string> = {
    'linux-basics': 'Linux 基础',
    'user-management': '用户与权限',
    'package-management': '软件包管理',
    'networking': '网络',
    'security': '安全',
    'storage': '存储',
    'services': '服务管理',
    'virtualization': '虚拟化',
    'containers': '容器',
    'web-server': 'Web 服务器',
    'database': '数据库',
    'shell-scripting': 'Shell 脚本',
    'monitoring': '监控',
    'troubleshooting': '故障排查',
    'cloud': '云计算'
  }
  return map[c] ?? c
}

/** TutorialDifficulty → 中文 */
function difficultyLabel(d: string): string {
  const map: Record<string, string> = {
    beginner: '入门',
    intermediate: '中级',
    advanced: '高级'
  }
  return map[d] ?? d
}
