#!/usr/bin/env node
/**
 * jaywcjlove/linux-command 词库导入器
 *
 * 数据源：https://github.com/jaywcjlove/linux-command (MIT License)
 * 本地路径：d:/ai/linux教学一体/opensource-reference/linux-command
 *
 * 输入：
 *   - dist/data.json   预编译索引（617 条命令，3 字段 {n, p, d}）
 *   - command/*.md     Markdown 源文件（用于提取 option 词条和 example）
 *
 * 输出：
 *   - 一个临时 JSON，结构：
 *     {
 *       "<command>": {
 *         zh: string,                    // 中文描述（取自 data.json.d）
 *         category: "command",
 *         options?: Array<{flag, desc}>,  // 从 command/*.md 提取
 *         example?: string,              // 从 command/*.md 提取第一个示例
 *         detail?: string,               // 补充说明
 *         syntax?: string                // 语法
 *       }
 *     }
 *
 * 用法：
 *   node scripts/dict-import/jaywcjlove.mjs
 *
 * 设计原则：
 *   - 不修改 jaywcjlove 仓库本身（开源参考）
 *   - 输出写入 scripts/dict-import/.cache/，供 merge.mjs 合并
 *   - 容错优先：单条解析失败不中断整体
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// 路径配置
// ============================================================
const __dirname = dirname(fileURLToPath(import.meta.url))

/** 仓库根目录（tdsf-linux-desktop 的父目录） */
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

/** jaywcjlove 仓库本地路径 */
const JAY_SRC = join(REPO_ROOT, 'opensource-reference', 'linux-command')

/** 缓存输出目录 */
const CACHE_DIR = join(__dirname, '.cache')

// ============================================================
// 工具：命令行参数提取
// ============================================================

/**
 * 从 Markdown 中提取命令名（第 1 行，如 "ls"）
 * 第 1 行是命令名，第 2 行是 "===" 分隔符
 */
function extractCmdName(mdContent) {
  const lines = mdContent.split('\n')
  if (lines.length < 3) return null
  const first = lines[0].trim()
  const second = lines[1].trim()
  if (second !== '===') return null
  if (!/^[a-zA-Z0-9_.-]+$/.test(first)) return null
  return first
}

/**
 * 从 Markdown 中提取第一个描述行（第 3 行，跳过空行）
 */
function extractFirstDesc(mdContent) {
  const lines = mdContent.split('\n')
  for (let i = 2; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim()
    if (line && !line.startsWith('#') && !line.startsWith('```')) {
      return line
    }
  }
  return null
}

/**
 * 从 Markdown 的 ### 实例 代码块提取第一个示例
 *
 * 匹配规则：
 *   ###  实例
 *
 *   ```shell
 *   $ cmd ...  # 注释描述
 *   ```
 *
 * 注意：标题与代码块之间可能有空行
 */
function extractExample(mdContent) {
  // 用 split 拆段，避免跨段匹配
  const sections = mdContent.split(/\n###\s+/)
  for (const s of sections) {
    if (s.startsWith('实例')) {
      // 找段内第一个代码块
      const m = s.match(/```(?:shell|bash)?\s*\n([\s\S]*?)```/)
      if (!m) continue
      const codeBlock = m[1].trim()
      const lines = codeBlock.split('\n').map(l => l.trim()).filter(Boolean)
      for (const line of lines) {
        const cleaned = line.replace(/^\$\s*/, '').replace(/^#.*$/, '').trim()
        if (cleaned && !cleaned.startsWith('#')) {
          return cleaned.slice(0, 100)
        }
      }
    }
  }
  return null
}

/**
 * 从 Markdown 的 ## 补充说明 段落提取 detail
 */
function extractDetail(mdContent) {
  const match = mdContent.match(/##\s*补充说明\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/)
  if (!match) return null
  // 去掉 Markdown 强调符号
  return match[1]
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
    .slice(0, 200)
}

/**
 * 从 Markdown 的 选项 代码块提取选项（支持 ## 选项 / ### 选项 两种标题）
 *
 * jaywcjlove 格式：每行 "-{short}     # 描述" 或 "-{short}, --{long}  # 描述"
 * 提取短选项（如 -l, --all, -R, -1）
 *
 * 注意：
 * - Git 在 Windows 检出时可能用 CRLF，需去掉行尾 \r
 * - 正则需要 multiline 标志 (m) 才能让 $ 匹配行末
 */
function extractOptions(mdContent) {
  // 同时按 ## 和 ### 切分
  const sections = mdContent.split(/\n##+/)
  const options = []
  for (const s of sections) {
    // 章节标题可能是 "选项" 或 " 选项" 或 " 选项 "
    if (!/^\s*选项/.test(s) && !s.startsWith('选项')) continue
    // 找段内第一个代码块
    const m = s.match(/```(?:shell|bash)?\s*\n([\s\S]*?)```/)
    if (!m) continue
    const codeBlock = m[1]
    const lines = codeBlock.split('\n')
    for (const line of lines) {
      // 去除行尾的 \r（CRLF → LF）
      const cleanLine = line.replace(/\r$/, '').trim()
      if (!cleanLine) continue
      // 匹配: -X, --yyy：描述  或 -X --yyy: 描述
      // 支持半角/全角冒号
      const m2 = cleanLine.match(/^(-{1,2}[a-zA-Z0-9][a-zA-Z0-9_-]*)(?:\s*,\s*--([a-zA-Z0-9_-]+))?\s*[:：]\s*(.+)$/)
      if (m2) {
        const flag = m2[1]
        const desc = m2[3].trim()
        if (desc.length > 3 && desc.length < 100) {
          options.push({ flag, desc })
        }
      }
    }
    if (options.length > 0) break
  }
  return options.slice(0, 12) // 限制每命令最多 12 个选项
}

/**
 * 从 Markdown 的 ### 语法 提取 syntax
 */
function extractSyntax(mdContent) {
  const match = mdContent.match(/###\s*语法[\s\S]*?```(?:shell|bash)?\n([\s\S]*?)```/)
  if (!match) return null
  return match[1].trim().split('\n')[0].slice(0, 200) || null
}

// ============================================================
// 主流程
// ============================================================

function main() {
  console.log('[jaywcjlove] 开始解析...')
  if (!existsSync(JAY_SRC)) {
    console.error(`[jaywcjlove] 仓库不存在: ${JAY_SRC}`)
    process.exit(1)
  }

  // 1. 读取 dist/data.json
  const dataPath = join(JAY_SRC, 'dist', 'data.json')
  const dataJson = JSON.parse(readFileSync(dataPath, 'utf-8'))
  const commandNames = Object.keys(dataJson)
  console.log(`[jaywcjlove] data.json 总条数: ${commandNames.length}`)

  // 2. 解析每个 command/*.md 提取额外字段
  const cmdDir = join(JAY_SRC, 'command')
  const mdFiles = existsSync(cmdDir) ? readdirSync(cmdDir).filter(f => f.endsWith('.md')) : []
  console.log(`[jaywcjlove] command/*.md 文件数: ${mdFiles.length}`)

  const result = {}
  let mdHit = 0
  let optCount = 0
  let exCount = 0

  for (const name of commandNames) {
    const entry = dataJson[name]
    const item = {
      zh: entry.d, // 中文描述（一句话）
      category: 'command',
    }
    item._sources = ['jaywcjlove']

    // 尝试从 command/{name}.md 提取更多
    const mdFile = join(cmdDir, `${name}.md`)
    if (existsSync(mdFile)) {
      try {
        const mdContent = readFileSync(mdFile, 'utf-8')
        const cmdName = extractCmdName(mdContent)
        if (cmdName === name) {
          mdHit++
          const ex = extractExample(mdContent)
          if (ex) {
            item.example = ex
            exCount++
          }
          const syn = extractSyntax(mdContent)
          if (syn) item.syntax = syn
          const det = extractDetail(mdContent)
          if (det) item.detail = det
          const opts = extractOptions(mdContent)
          if (opts.length > 0) {
            item._options = opts
            optCount += opts.length
          }
        }
      } catch (err) {
        // 单条失败不影响整体
        console.warn(`[jaywcjlove] 解析 ${name}.md 失败:`, err.message)
      }
    }

    result[name] = item
  }

  // 3. 输出到缓存
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
  const outPath = join(CACHE_DIR, 'jaywcjlove.json')
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`[jaywcjlove] 完成: ${commandNames.length} 命令, ${mdHit} MD命中, ${optCount} 选项提取, ${exCount} 示例提取`)
  console.log(`[jaywcjlove] 输出: ${outPath}`)
}

main()
