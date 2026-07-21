/**
 * Explore Subagent（代码库探索 Subagent）（v0.9.4 批次 4 - 任务 2）
 *
 * 借鉴 Kilo Code 的 Explore Subagent（独立 subagent，专门用于代码库探索/调研）：
 *   d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §3.2 / §3.4
 *
 * 与 search-subagent 的区别：
 * - search-subagent：检索教程/知识库（外部资料）
 * - explore-subagent：探索当前项目代码库（内部资料）
 *
 * 实现要点：
 * - 继承 BaseSubagent，实现 doExecute 方法
 * - 接受 ExploreTaskInput，返回 ExploreResultOutput
 * - 用 fs.promises.readdir 递归扫描（最多 3 层深度）
 * - 过滤常见忽略目录（node_modules / .git / dist / out / build）
 * - maxFiles 默认 100，硬上限 500
 * - 纯只读，不修改任何文件
 *
 * 调用方式：
 * ```ts
 * import { ExploreSubagent } from './subagents'
 * import { createSubagentTask } from './subagents/base'
 *
 * const explore = new ExploreSubagent()
 * const task = createSubagentTask('explore', '探查 nginx 配置', {
 *   rootPath: '/etc/nginx',
 *   keywords: ['server', 'listen'],
 *   maxFiles: 50,
 * })
 * const result = await explore.execute(task)
 * // result.output: { files: [...], totalFiles: 50, durationMs: 123 }
 * ```
 *
 * 方案书依据：v0.9.4 §11 第 4 类（Subagent 调度 3 项 - 任务 2）
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'

/**
 * Explore 任务输入
 *
 * 由调用方（Supervisor / dispatcher）构造，传入 explore-subagent。
 */
export interface ExploreTaskInput {
  /** 探查的根目录（绝对路径） */
  rootPath: string
  /** 关键词列表（用于过滤文件，文件名包含关键词则标记，可选） */
  keywords?: string[]
  /** 最大返回文件数（默认 100，硬上限 500） */
  maxFiles?: number
}

/**
 * Explore 结果输出
 *
 * doExecute 返回的 output 字段结构。
 */
export interface ExploreResultOutput {
  /** 匹配到的文件列表 */
  files: Array<{
    /** 文件绝对路径 */
    path: string
    /** 文件行数（估算，按 \n 数量计算） */
    lines: number
    /** 命中的关键词（文件名中包含的 keywords） */
    keywords: string[]
  }>
  /** 总文件数（受 maxFiles 限制） */
  totalFiles: number
  /** 执行耗时（ms） */
  durationMs: number
  /** 是否因 maxFiles 截断（true 表示还有更多文件未返回） */
  truncated: boolean
  /** 探查的根目录 */
  rootPath: string
  /** 最大递归深度（实际达到的深度） */
  maxDepthReached: number
}

/**
 * 默认最大返回文件数
 */
const DEFAULT_MAX_FILES = 100

/**
 * 硬上限（即使用户传入更大的值也截断到此值）
 */
const HARD_MAX_FILES = 500

/**
 * 最大递归深度
 */
const MAX_DEPTH = 3

/**
 * 忽略的目录名（不进入这些目录扫描）
 *
 * 借鉴 .gitignore 常见规则 + Node.js 项目惯例。
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  'coverage',
  '.nyc_output',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'target', // Rust / Maven
  '.gradle',
  '.idea',
  '.vscode',
])

/**
 * 默认扫描的文件扩展名（空表示扫描所有文件）
 *
 * 当前实现：扫描所有非二进制文件（按扩展名过滤常见二进制格式）。
 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.tiff',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.lock',
  '.log',
])

/**
 * 估算文件行数（按 \n 数量计算，不读取文件内容以提升性能）
 *
 * 注意：仅读取文件大小，按平均行长度估算行数。
 * 真实行数需要读取文件内容，但为性能考虑采用估算。
 *
 * @param filePath 文件路径
 * @returns 估算行数（读取失败返回 0）
 */
async function estimateFileLines(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) {
      return 0
    }
    // 按平均每行 80 字符估算（粗略，仅供 UI 展示参考）
    return Math.max(1, Math.floor(stat.size / 80))
  } catch {
    return 0
  }
}

/**
 * 检查文件扩展名是否为二进制（应跳过）
 *
 * @param fileName 文件名
 * @returns true 表示是二进制文件
 */
function isBinaryFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

/**
 * 检查文件名是否命中关键词
 *
 * @param fileName 文件名
 * @param keywords 关键词列表
 * @returns 命中的关键词列表（小写匹配，返回原关键词）
 */
function matchKeywords(fileName: string, keywords: string[] | undefined): string[] {
  if (!keywords || keywords.length === 0) {
    return []
  }
  const lowerName = fileName.toLowerCase()
  return keywords.filter((kw) => lowerName.includes(kw.toLowerCase()))
}

/**
 * 递归扫描目录
 *
 * @param currentDir 当前目录
 * @param depth 当前深度（0 开始）
 * @param maxDepth 最大深度
 * @param keywords 关键词列表
 * @param files 输出文件列表（累积）
 * @param maxFiles 最大文件数（达到时停止扫描）
 * @returns 实际达到的最大深度
 */
async function scanDirectory(
  currentDir: string,
  depth: number,
  maxDepth: number,
  keywords: string[] | undefined,
  files: ExploreResultOutput['files'],
  maxFiles: number
): Promise<number> {
  if (depth > maxDepth || files.length >= maxFiles) {
    return depth
  }

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true })
  } catch {
    // 读取目录失败（权限不足等），跳过
    return depth
  }

  let maxDepthReached = depth

  for (const entry of entries) {
    // 已达 maxFiles，停止扫描
    if (files.length >= maxFiles) {
      break
    }

    const entryPath = path.join(currentDir, entry.name)

    if (entry.isDirectory()) {
      // 跳过忽略目录
      if (IGNORED_DIRS.has(entry.name)) {
        continue
      }
      // 递归扫描子目录
      const subDepth = await scanDirectory(
        entryPath,
        depth + 1,
        maxDepth,
        keywords,
        files,
        maxFiles
      )
      if (subDepth > maxDepthReached) {
        maxDepthReached = subDepth
      }
    } else if (entry.isFile()) {
      // 跳过二进制文件
      if (isBinaryFile(entry.name)) {
        continue
      }
      // 关键词过滤（如果有 keywords，则文件名必须命中至少一个关键词）
      const matchedKws = matchKeywords(entry.name, keywords)
      if (keywords && keywords.length > 0 && matchedKws.length === 0) {
        continue
      }

      const lines = await estimateFileLines(entryPath)
      files.push({
        path: entryPath,
        lines,
        keywords: matchedKws,
      })
    }
  }

  return maxDepthReached
}

/**
 * Explore Subagent（代码库探索 Subagent）
 *
 * 借鉴 Kilo Code Explore Subagent：专门用于代码库探索、调研任务，
 * 不修改文件，仅返回调研报告（含文件路径、关键代码片段、依赖关系）。
 *
 * 行为约束：
 * - 纯只读，绝不修改任何文件
 * - 递归扫描最多 3 层深度
 * - 过滤常见忽略目录（node_modules / .git / dist 等）
 * - maxFiles 默认 100，硬上限 500
 */
export class ExploreSubagent extends BaseSubagent {
  readonly name = 'explore' as const
  readonly displayName = '探索 Subagent'
  readonly description = '代码库探索，返回关键文件路径 + 依赖关系 + 代码片段'

  /**
   * 执行代码库探查任务
   *
   * 流程：
   * 1. 解析 ExploreTaskInput
   * 2. 校验 rootPath 存在且是目录
   * 3. 规范化 maxFiles（默认 100，硬上限 500）
   * 4. 递归扫描目录（最多 3 层深度）
   * 5. 返回 ExploreResultOutput
   *
   * 异常处理：
   * - rootPath 不存在 → success=false
   * - rootPath 不是目录 → success=false
   * - 单个文件读取失败 → 跳过，不影响其他文件
   *
   * @param task 任务对象（input 必须是 ExploreTaskInput）
   * @returns SubagentResult，output 字段为 ExploreResultOutput
   */
  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()

    // 1. 解析 input
    const input = task.input as Partial<ExploreTaskInput> | undefined
    if (!input || typeof input.rootPath !== 'string' || input.rootPath.length === 0) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: 'ExploreTaskInput.rootPath 必须为非空字符串',
        durationMs: Date.now() - startTime,
      }
    }

    const rootPath = path.resolve(input.rootPath)
    const keywords = Array.isArray(input.keywords) ? input.keywords : undefined
    // 规范化 maxFiles：默认 100，硬上限 500，最小 1
    const rawMax = typeof input.maxFiles === 'number' ? input.maxFiles : DEFAULT_MAX_FILES
    const maxFiles = Math.max(1, Math.min(rawMax, HARD_MAX_FILES))

    this.log.info(`[${this.name}] 开始探查`, {
      taskId: task.id,
      rootPath,
      keywords,
      maxFiles,
    })

    // 2. 校验 rootPath 存在且是目录
    try {
      const stat = await fs.stat(rootPath)
      if (!stat.isDirectory()) {
        return {
          taskId: task.id,
          success: false,
          output: null,
          error: `rootPath 不是目录：${rootPath}`,
          durationMs: Date.now() - startTime,
        }
      }
    } catch (err) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: `rootPath 不存在或无法访问：${rootPath}（${err instanceof Error ? err.message : String(err)}）`,
        durationMs: Date.now() - startTime,
      }
    }

    // 3. 递归扫描
    const files: ExploreResultOutput['files'] = []
    let maxDepthReached = 0
    try {
      maxDepthReached = await scanDirectory(
        rootPath,
        0,
        MAX_DEPTH,
        keywords,
        files,
        maxFiles
      )
    } catch (err) {
      // scanDirectory 内部已捕获异常，此处防御性兜底
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: `扫描目录失败：${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime,
      }
    }

    // 4. 构造结果
    const truncated = files.length >= maxFiles
    const output: ExploreResultOutput = {
      files,
      totalFiles: files.length,
      durationMs: Date.now() - startTime,
      truncated,
      rootPath,
      maxDepthReached,
    }

    this.log.info(`[${this.name}] 探查完成`, {
      taskId: task.id,
      totalFiles: output.totalFiles,
      truncated,
      maxDepthReached,
      durationMs: output.durationMs,
    })

    return {
      taskId: task.id,
      success: true,
      output,
      confidence: files.length > 0 ? 0.8 : 0.3,
      durationMs: output.durationMs,
    }
  }
}
