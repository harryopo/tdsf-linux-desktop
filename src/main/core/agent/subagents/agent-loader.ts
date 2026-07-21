/**
 * 自定义 Agent 加载器（v0.9.4 批次 4 - 任务 3）
 *
 * 借鉴 Kilo Code 的 .kilo/agent/*.md YAML frontmatter 加载机制：
 *   d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §3.3
 *
 * 用户在项目根 .tdsf/agent/ 目录下放 Markdown 文件：
 * - 文件头部 YAML frontmatter 声明 agent 元数据（name / displayName / description / tools）
 * - 正文是 system prompt 模板
 *
 * 加载流程：
 * 1. 扫描 .tdsf/agent/*.md 文件
 * 2. 解析 YAML frontmatter（用简单正则解析，不引入 gray-matter 依赖）
 * 3. 构造 CustomAgentConfig 对象
 * 4. 注册到 CustomAgentRegistry（由调用方维护）
 *
 * 文件格式示例：
 * ---
 * name: linux-expert
 * displayName: Linux 专家
 * description: Linux 运维专家，擅长故障排查
 * tools:
 *   - search
 *   - log
 *   - metric
 * ---
 * 你是 Linux 运维专家，特别擅长...
 *
 * 设计要点：
 * - YAML 解析仅支持简单 key: value 和 key:\n  - item 格式（不引入 gray-matter / yaml 依赖）
 * - 解析失败 → 返回 null + warn 日志（不影响其他 agent 加载）
 * - 加载成功 → info 日志（含 name + displayName）
 * - 热重载由调用方维护（sourceFile 字段记录来源路径）
 *
 * 方案书依据：v0.9.4 §11 第 4 类（Subagent 调度 3 项 - 任务 3）
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
// v0.9.5 P0 - 组 4：CustomAgentConfig 已迁移到 @shared/agent-types（SSOT）
import type { CustomAgentConfig } from '@shared/agent-types'
// v0.9.5 P0 - 组 4：re-export 保持 main 内部 `from './agent-loader'` 路径不变
export type { CustomAgentConfig } from '@shared/agent-types'
import { logger } from '../../../services/log/logger'

/**
 * 子日志器（自动注入加载器前缀）
 */
const log = logger.child('AGENT.SUBAGENT.LOADER')

/**
 * YAML frontmatter 正则表达式
 *
 * 匹配格式：
 * ---
 * (YAML 内容)
 * ---
 * (Markdown 正文)
 *
 * 注意：
 * - 第一个 --- 必须在文件开头（允许前面有 BOM 但不允许有其他字符）
 * - YAML 内容支持多行
 * - 第二个 --- 后必须换行
 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

/**
 * 解析 YAML frontmatter 字符串为键值对
 *
 * 支持两种格式：
 * 1. 简单 key: value（单行）
 *    name: linux-expert
 *    displayName: Linux 专家
 *
 * 2. 数组 key:\n  - item1\n  - item2
 *    tools:
 *      - search
 *      - log
 *
 * 不支持：
 * - 嵌套对象（嵌套层级 > 1）
 * - 行内数组 [a, b, c]
 * - 引号包裹的字符串（值原样保留，不去引号）
 * - YAML 高级特性（锚点 / 引用 / 多行字符串）
 *
 * @param yamlText YAML 文本（frontmatter 内容，不含 --- 分隔符）
 * @returns 解析后的键值对（值为 string 或 string[]）
 */
function parseYamlFrontmatter(yamlText: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  const lines = yamlText.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // 跳过空行和注释
    if (!line || line.trim() === '' || line.trim().startsWith('#')) {
      i++
      continue
    }

    // 匹配 key: value 格式
    const kvMatch = line.match(/^([\w-]+)\s*:\s*(.*)$/)
    if (!kvMatch) {
      i++
      continue
    }

    const key = kvMatch[1].trim()
    const value = kvMatch[2].trim()

    if (value === '') {
      // 检查下一行是否是数组项（- item）
      const arrayItems: string[] = []
      let j = i + 1
      while (j < lines.length) {
        const nextLine = lines[j]
        // 数组项格式：- item 或   - item（允许缩进）
        const arrayMatch = nextLine.match(/^\s*-\s+(.*)$/)
        if (arrayMatch) {
          arrayItems.push(arrayMatch[1].trim())
          j++
        } else if (nextLine.trim() === '') {
          // 空行允许在数组项之间
          j++
        } else {
          break
        }
      }
      if (arrayItems.length > 0) {
        result[key] = arrayItems
        i = j
      } else {
        // 空值
        result[key] = ''
        i++
      }
    } else {
      // 单行 value
      result[key] = value
      i++
    }
  }
  return result
}

/**
 * 解析单个 agent md 文件
 *
 * 流程：
 * 1. 读取文件内容
 * 2. 用 FRONTMATTER_REGEX 提取 frontmatter + 正文
 * 3. 解析 frontmatter 为键值对
 * 4. 构造 CustomAgentConfig
 *
 * 解析失败的情况（返回 null）：
 * - 文件不存在
 * - 文件内容不匹配 frontmatter 格式（缺 --- 分隔符）
 * - 缺少必填字段（name / displayName / description）
 *
 * @param filePath 文件路径
 * @returns 配置对象，解析失败返回 null
 */
export async function loadCustomAgent(filePath: string): Promise<CustomAgentConfig | null> {
  // 1. 读取文件内容
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    log.warn('加载自定义 agent 文件失败：读取文件异常', {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }

  // 2. 提取 frontmatter + 正文
  const match = content.match(FRONTMATTER_REGEX)
  if (!match) {
    log.warn('加载自定义 agent 文件失败：未找到 YAML frontmatter', {
      filePath,
      contentLength: content.length,
    })
    return null
  }

  const [, yamlText, bodyText] = match

  // 3. 解析 frontmatter
  const parsed = parseYamlFrontmatter(yamlText)

  // 4. 校验必填字段
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  const displayName = typeof parsed.displayName === 'string' ? parsed.displayName.trim() : ''
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''

  if (!name) {
    log.warn('加载自定义 agent 文件失败：缺少 name 字段', { filePath })
    return null
  }
  if (!displayName) {
    log.warn('加载自定义 agent 文件失败：缺少 displayName 字段', { filePath, name })
    return null
  }
  if (!description) {
    log.warn('加载自定义 agent 文件失败：缺少 description 字段', { filePath, name })
    return null
  }

  // 5. 构造配置对象
  const tools = Array.isArray(parsed.tools) ? parsed.tools : []
  const systemPrompt = bodyText.trim()

  const config: CustomAgentConfig = {
    name,
    displayName,
    description,
    tools,
    systemPrompt,
    sourceFile: filePath,
  }

  log.info('自定义 agent 加载成功', {
    filePath,
    name,
    displayName,
    toolsCount: tools.length,
    systemPromptLength: systemPrompt.length,
  })

  return config
}

/**
 * 从指定目录加载所有自定义 agent 配置
 *
 * 流程：
 * 1. 读取目录下所有 .md 文件
 * 2. 对每个文件调用 loadCustomAgent
 * 3. 过滤掉 null（解析失败的文件）
 * 4. 返回成功加载的配置列表
 *
 * 异常处理：
 * - 目录不存在 → 返回空数组 + warn 日志（不抛错）
 * - 目录读取失败 → 返回空数组 + warn 日志
 * - 单个文件解析失败 → 跳过，不影响其他文件
 *
 * @param agentsDir .tdsf/agent 目录路径
 * @returns 加载到的 agent 列表（解析失败的文件跳过）
 */
export async function loadCustomAgents(agentsDir: string): Promise<CustomAgentConfig[]> {
  // 1. 读取目录
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(agentsDir, { withFileTypes: true })
  } catch (err) {
    log.warn('加载自定义 agent 目录失败：目录不存在或无法访问', {
      agentsDir,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  // 2. 过滤 .md 文件
  const mdFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md')
  )

  if (mdFiles.length === 0) {
    log.debug('自定义 agent 目录为空（无 .md 文件）', { agentsDir })
    return []
  }

  log.info('开始加载自定义 agent 文件', {
    agentsDir,
    mdFileCount: mdFiles.length,
  })

  // 3. 并行加载所有文件
  const configs = await Promise.all(
    mdFiles.map((entry) => {
      const fullPath = path.join(agentsDir, entry.name)
      return loadCustomAgent(fullPath)
    })
  )

  // 4. 过滤 null
  const validConfigs = configs.filter((c): c is CustomAgentConfig => c !== null)

  log.info('自定义 agent 加载完成', {
    agentsDir,
    totalFiles: mdFiles.length,
    loadedCount: validConfigs.length,
    failedCount: mdFiles.length - validConfigs.length,
    loadedNames: validConfigs.map((c) => c.name),
  })

  return validConfigs
}
