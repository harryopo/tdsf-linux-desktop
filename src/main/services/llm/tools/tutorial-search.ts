/**
 * Tutorial Search 工具
 *
 * 从教程知识库中按关键词搜索官方权威教程。
 * 复用 tutorialRepo 的搜索能力。
 *
 * 风险等级：low（只读搜索，无副作用）
 */
import { z } from 'zod'
import type { ToolDefinition, ToolCallResult, ToolRiskLevel } from '@shared/llm-tool-types'
import { TOOL_IDS } from '@shared/llm-tool-types'
import type { TutorialEntry, TutorialCategory } from '@shared/tutorial-types'
import { TUTORIAL_CATEGORY_LABELS } from '@shared/tutorial-types'
import type { DatabaseManager } from '../../db/database'
import { TutorialRepository } from '../../tutorial/tutorial-repo'

/** tutorial_search 参数 schema */
export const tutorialSearchArgsSchema = z.object({
  query: z.string().min(1).describe('搜索关键词（中英文均可）'),
  category: z.nativeEnum(
    Object.fromEntries(Object.entries(TUTORIAL_CATEGORY_LABELS).map(([k, v]) => [k, v])) as Record<TutorialCategory, string>
  ).optional().describe('教程分类（可选，用于过滤）'),
  limit: z.number().int().min(1).max(10).default(3)
    .describe('返回结果数量（默认 3，上限 10）'),
})

export type TutorialSearchArgs = z.infer<typeof tutorialSearchArgsSchema>

/** tutorial_search 返回数据（精简版，去掉 content 字段以减小 token 消耗） */
export interface TutorialSearchData {
  query: string
  total: number
  results: Array<{
    id: string
    title: string
    summary: string
    category: string
    categoryLabel: string
    difficulty: string
    sourceName: string
    tags: string[]
    readingTime: number
    relevanceScore?: number
  }>
}

/**
 * 教程搜索执行函数
 *
 * 复用 TutorialRepository.search()
 * 错误处理：返回 ToolCallResult
 */
export async function executeTutorialSearch(
  args: TutorialSearchArgs,
  db: DatabaseManager
): Promise<ToolCallResult<TutorialSearchData>> {
  const start = Date.now()
  const { query, category, limit } = args

  try {
    const repo = new TutorialRepository(db)
    const entries: TutorialEntry[] = await repo.search(query, limit)

    // 分类过滤（在内存中，因为 SQLite 全文搜索暂不支持 enum 过滤）
    const filtered = category ? entries.filter((e) => e.category === category) : entries

    // 精简为 LLM 友好的格式
    const results = filtered.map((e) => ({
      id: e.id,
      title: e.title,
      summary: e.summary,
      category: e.category,
      categoryLabel: TUTORIAL_CATEGORY_LABELS[e.category] ?? e.category,
      difficulty: e.difficulty,
      sourceName: e.source.name,
      tags: e.tags,
      readingTime: e.readingTime,
    }))

    return {
      toolId: TOOL_IDS.TUTORIAL_SEARCH,
      success: true,
      data: {
        query,
        total: results.length,
        results,
      },
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  } catch (err) {
    return {
      toolId: TOOL_IDS.TUTORIAL_SEARCH,
      success: false,
      error: `教程搜索失败: ${(err as Error).message}`,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  }
}

/** tutorial_search 工具定义 */
export function createTutorialSearchTool(db: DatabaseManager): ToolDefinition {
  return {
    name: TOOL_IDS.TUTORIAL_SEARCH,
    description: '从官方权威教程库中搜索 Linux 教程。返回匹配教程的标题、摘要、分类、来源等元数据。',
    parameters: tutorialSearchArgsSchema,
    execute: async (args: unknown) => {
      const parsed = tutorialSearchArgsSchema.safeParse(args)
      if (!parsed.success) {
        return {
          toolId: TOOL_IDS.TUTORIAL_SEARCH,
          success: false,
          error: `参数校验失败: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          durationMs: 0,
          timestamp: Date.now(),
        } satisfies ToolCallResult
      }
      return await executeTutorialSearch(parsed.data, db)
    },
  }
}

/** tutorial_search 工具元数据 */
export const TUTORIAL_SEARCH_META = {
  id: TOOL_IDS.TUTORIAL_SEARCH,
  label: '教程搜索',
  emoji: '📚',
  description: '搜索官方权威 Linux 教程知识库',
  risk: 'low' as ToolRiskLevel,
  requiresApproval: false,
} as const
