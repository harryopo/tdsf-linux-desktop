#!/usr/bin/env node
/**
 * tldr-pages/tldr 词库导入器（中文版）
 *
 * 数据源：https://github.com/tldr-pages/tldr (CC BY 4.0)
 * 本地路径：d:/ai/linux教学一体/opensource-reference/tldr-pages/pages.zh
 *
 * 输入：
 *   - pages.zh/{common,linux,osx,android,windows,freebsd,...}/*.md
 *     每个文件 1 条命令，格式：
 *       # <command>
 *       > <中文描述 1>
 *       > <中文描述 2>（可选）
 *       > 更多信息：<URL>。
 *
 *       - <示例描述>：
 *       `<command> <options> {{占位符}}`
 *       - <示例描述>：
 *       ...
 *
 * 输出：
 *   - 临时 JSON，结构：
 *     {
 *       "<command>": {
 *         zh: string,                    // 中文描述
 *         category: "command",
 *         example?: string,              // 第一个示例（去掉占位符）
 *         platform?: string              // common/linux/osx/...
 *       }
 *     }
 *
 * 用法：
 *   node scripts/dict-import/tldr.mjs
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const TLDR_SRC = join(REPO_ROOT, 'opensource-reference', 'tldr-pages', 'pages.zh')
const CACHE_DIR = join(__dirname, '.cache')

// ============================================================
// Markdown 解析
// ============================================================

/**
 * 解析 tldr Markdown 文件
 * @param {string} content Markdown 内容
 * @returns {{title: string, descriptions: string[], examples: Array<{desc: string, code: string}>}|null}
 */
function parseTldrMarkdown(content) {
  const lines = content.split('\n')
  if (lines.length < 3) return null

  // 1. 标题：第 1 行 "# xxx"
  const titleMatch = lines[0].match(/^#\s+(.+)$/)
  if (!titleMatch) return null
  const title = titleMatch[1].trim()

  // 2. 描述：所有 `> xxx` 行
  const descriptions = []
  for (const line of lines.slice(1)) {
    const descMatch = line.match(/^>\s+(.+)$/)
    if (descMatch) {
      const text = descMatch[1].trim()
      // 跳过 "更多信息：<url>"，但保留前两句描述
      if (text.startsWith('更多信息')) continue
      descriptions.push(text)
      if (descriptions.length >= 2) break // 最多取 2 句
    } else if (descriptions.length > 0) {
      break // 描述段结束
    }
  }
  if (descriptions.length === 0) return null

  // 3. 示例：所有 "- desc:" 块，下方 1-3 行内必有代码块
  const examples = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const exDescMatch = line.match(/^-\s+(.+?)\s*:?\s*$/)
    if (!exDescMatch) continue
    const desc = exDescMatch[1].trim()
    // 跳过 help/version 等低优先级（这些通常是最后两个示例）
    // 但保留所有，因为 description 信息有价值
    // 找后续 1-3 行内的代码块（允许空行隔开）
    for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) {
      const codeLine = lines[j].trim()
      const codeMatch = codeLine.match(/^`([^`]+)`$/)
      if (codeMatch) {
        examples.push({ desc, code: codeMatch[1].trim() })
        break
      }
      // 遇到非空非代码行则停止搜索
      if (codeLine && !codeMatch) break
    }
  }

  return { title, descriptions, examples }
}

/**
 * 把 tldr 的 `{{[-lh|-l --human-readable]}}` 占位符替换为可读文本
 */
function cleanExampleCode(code) {
  return code
    // {{[-lh|-l --human-readable]}} → -lh / -l --human-readable
    .replace(/\{\{([^}]+)\}\}/g, (_m, p1) => {
      return p1.replace(/\[|\]/g, '').replace(/\|/g, ' / ')
    })
    .replace(/\s+/g, ' ')
    .trim()
}

// ============================================================
// 主流程
// ============================================================

function main() {
  console.log('[tldr-zh] 开始解析...')
  if (!existsSync(TLDR_SRC)) {
    console.error(`[tldr-zh] 仓库不存在: ${TLDR_SRC}`)
    process.exit(1)
  }

  const platforms = readdirSync(TLDR_SRC).filter(name => {
    const p = join(TLDR_SRC, name)
    return statSync(p).isDirectory()
  })
  console.log(`[tldr-zh] 平台目录: ${platforms.join(', ')}`)

  // 优先级：common > linux > osx > android > windows > 其他
  const PLATFORM_PRIORITY = ['common', 'linux', 'osx', 'android', 'windows', 'freebsd', 'openbsd', 'netbsd', 'sunos', 'dos']
  platforms.sort((a, b) => {
    const ia = PLATFORM_PRIORITY.indexOf(a)
    const ib = PLATFORM_PRIORITY.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  /** 平台：是否跨平台（用 common > 平台） */
  const result = {} // cmd -> { zh, examples[], platform, _platforms: Set }
  let totalFiles = 0
  let parsed = 0
  let exampleCount = 0

  for (const platform of platforms) {
    const dir = join(TLDR_SRC, platform)
    const files = readdirSync(dir).filter(f => f.endsWith('.md'))
    totalFiles += files.length
    for (const f of files) {
      const cmd = f.replace(/\.md$/, '')
      // 文件名含 `!`、`.` 等特殊字符的命令通常很冷门，跳过以减小词典
      if (cmd.length > 40) continue
      const content = readFileSync(join(dir, f), 'utf-8')
      const parsed2 = parseTldrMarkdown(content)
      if (!parsed2) continue
      parsed++

      if (!result[cmd]) {
        result[cmd] = {
          zh: parsed2.descriptions[0], // 主描述
          category: 'command',
          _sources: ['tldr-zh'],
          _platform: platform,
          _examples: parsed2.examples.slice(0, 4).map(e => ({
            desc: e.desc,
            code: cleanExampleCode(e.code),
          })),
        }
        exampleCount += result[cmd]._examples.length
      } else {
        // 跨平台命令：合并 examples，去重
        const existingCodes = new Set(result[cmd]._examples.map(e => e.code))
        for (const e of parsed2.examples) {
          const code = cleanExampleCode(e.code)
          if (!existingCodes.has(code)) {
            result[cmd]._examples.push({ desc: e.desc, code })
            existingCodes.add(code)
            if (result[cmd]._examples.length >= 4) break
          }
        }
        // 升级 platform 标签：common > 平台
        if (platform === 'common') {
          result[cmd]._platform = 'common'
        }
      }
    }
  }

  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
  const outPath = join(CACHE_DIR, 'tldr-zh.json')
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`[tldr-zh] 完成: ${totalFiles} 文件扫描, ${parsed} 解析成功, ${Object.keys(result).length} 唯一命令, ${exampleCount} 示例累计`)
  console.log(`[tldr-zh] 输出: ${outPath}`)
}

main()
