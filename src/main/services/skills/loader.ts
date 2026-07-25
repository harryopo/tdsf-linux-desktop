/**
 * SKILL.md 加载器
 *
 * 从文件系统加载 SKILL.md 文件，解析 YAML frontmatter 提取元数据。
 *
 * 设计原则（参考 agent-loader.ts）：
 * - 不引入 yaml / gray-matter 依赖，用正则解析
 * - 解析失败 → 返回 null + warn 日志（不影响其他 Skill 加载）
 * - 只提取关键字段（name/description/triggers/riskLevel/category/tags）
 * - 多行内容（teaching.principle 等）保留在 content 中，按需读取
 *
 * 支持的 YAML 格式：
 * 1. 简单 key: value
 *    name: diagnose-oom-killer
 * 2. 行内数组
 *    tags: [memory, linux, kernel]
 * 3. 缩进数组
 *    keywords:
 *      - "oom"
 *      - "killed process"
 * 4. 嵌套对象（一级嵌套）
 *    triggers:
 *      keywords:
 *        - "oom"
 *      patterns:
 *        - "Killed process \\d+"
 *
 * 不支持：
 * - 多行字符串 |（保留在 content 中，不解析）
 * - 深层嵌套（> 2 级）
 * - YAML 高级特性（锚点 / 引用）
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Skill, SkillTrigger, SkillRiskLevel, SkillCategory } from './types'
import { logger } from '../log/logger'

const log = logger.child('SKILL.LOADER')

/** YAML frontmatter 正则（匹配 --- 包裹的头部 + Markdown 正文） */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

/**
 * 从 YAML 文本中提取简单字段值
 * @param yamlText YAML 文本
 * @param key 字段名
 * @returns 字段值（trimmed），未找到返回 null
 */
function extractField(yamlText: string, key: string): string | null {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm')
  const match = yamlText.match(regex)
  return match ? match[1].trim() : null
}

/**
 * 从 YAML 文本中提取数组字段
 *
 * 支持两种格式：
 * 1. 行内数组：key: [a, b, c]
 * 2. 缩进数组：
 *    key:
 *      - "item1"
 *      - "item2"
 *
 * @param yamlText YAML 文本
 * @param key 字段名
 * @returns 字符串数组（空数组表示未找到或解析失败）
 */
function extractArray(yamlText: string, key: string): string[] {
  // 1. 尝试行内数组格式：key: [a, b, c]
  const inlineRegex = new RegExp(`^${key}:\\s*\\[(.+?)\\]`, 'm')
  const inlineMatch = yamlText.match(inlineRegex)
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  // 2. 尝试缩进数组格式：
  //    key:
  //      - item1
  //      - item2
  const blockRegex = new RegExp(`^${key}:\\s*\\n((?:[ \\t]+-\\s+.+\\r?\\n?)+)`, 'm')
  const blockMatch = yamlText.match(blockRegex)
  if (blockMatch) {
    return blockMatch[1]
      .split(/\r?\n/)
      .map((line) => {
        const itemMatch = line.match(/^\s*-\s+(.*)$/)
        return itemMatch ? itemMatch[1].trim().replace(/^["']|["']$/g, '') : null
      })
      .filter((s): s is string => s !== null && s !== '')
  }

  return []
}

/**
 * 从 YAML 文本中提取嵌套数组的子数组
 *
 * 用于提取 triggers.keywords / triggers.patterns / triggers.semantic
 * 先找到 parentKey 段落，再在段落内提取 childKey 的数组
 *
 * @param yamlText YAML 文本
 * @param parentKey 父字段名（如 "triggers"）
 * @param childKey 子字段名（如 "keywords"）
 * @returns 字符串数组
 */
function extractNestedArray(yamlText: string, parentKey: string, childKey: string): string[] {
  // 找到 parentKey: 段落（到下一个顶层字段或文件末尾）
  const parentRegex = new RegExp(`^${parentKey}:\\s*\\n([\\s\\S]*?)(?=^\\S|$(?!\\s))`, 'm')
  const parentMatch = yamlText.match(parentRegex)
  if (!parentMatch) return []

  const parentBlock = parentMatch[1]
  return extractArray(parentBlock, childKey)
}

/**
 * 验证并转换风险等级
 */
function parseRiskLevel(value: string): SkillRiskLevel {
  const valid: SkillRiskLevel[] = ['low', 'medium', 'high', 'critical']
  return valid.includes(value as SkillRiskLevel) ? (value as SkillRiskLevel) : 'low'
}

/**
 * 验证并转换分类
 */
function parseCategory(value: string): SkillCategory {
  const valid: SkillCategory[] = [
    'troubleshooting',
    'environment-check',
    'deployment',
    'security',
    'development',
    'teaching',
  ]
  return valid.includes(value as SkillCategory) ? (value as SkillCategory) : 'troubleshooting'
}

/**
 * 解析 SKILL.md 文件为 Skill 对象
 *
 * @param filePath SKILL.md 文件绝对路径
 * @returns Skill 对象，解析失败返回 null
 */
export async function loadSkill(filePath: string): Promise<Skill | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const match = raw.match(FRONTMATTER_REGEX)
    if (!match) {
      log.warn(`Skill 文件缺少 frontmatter: ${filePath}`)
      return null
    }

    const yamlText = match[1]
    const content = match[2]

    // 提取关键字段
    const name = extractField(yamlText, 'name')
    if (!name) {
      log.warn(`Skill 文件缺少 name 字段: ${filePath}`)
      return null
    }

    const description = extractField(yamlText, 'description') ?? ''
    const riskLevel = parseRiskLevel(extractField(yamlText, 'riskLevel') ?? 'low')
    const category = parseCategory(extractField(yamlText, 'category') ?? 'troubleshooting')
    const tags = extractArray(yamlText, 'tags')

    // 提取触发条件（嵌套结构）
    const triggers: SkillTrigger = {
      keywords: extractNestedArray(yamlText, 'triggers', 'keywords'),
      patterns: extractNestedArray(yamlText, 'triggers', 'patterns'),
      semantic: extractNestedArray(yamlText, 'triggers', 'semantic'),
    }

    const skill: Skill = {
      name,
      description,
      triggers,
      riskLevel,
      category,
      tags,
      content,
      filePath,
      builtin: true,
    }

    log.info(`已加载 Skill: ${name} (${triggers.keywords.length} keywords, ${triggers.patterns.length} patterns)`)
    return skill
  } catch (err) {
    log.error(`加载 Skill 文件失败: ${filePath}`, {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * 扫描目录下所有 .md 文件并加载为 Skill 数组
 *
 * @param dirPath 目录路径
 * @returns Skill 数组（解析失败的文件跳过）
 */
export async function loadSkillsFromDir(dirPath: string): Promise<Skill[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const skills: Skill[] = []

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const fullPath = path.join(dirPath, entry.name)
        const skill = await loadSkill(fullPath)
        if (skill) skills.push(skill)
      }
    }

    log.info(`从 ${dirPath} 加载了 ${skills.length} 个 Skill`)
    return skills
  } catch (err) {
    log.error(`扫描 Skill 目录失败: ${dirPath}`, {
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}
