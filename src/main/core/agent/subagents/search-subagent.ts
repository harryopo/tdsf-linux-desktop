/**
 * 搜索 Subagent（Search Subagent）
 *
 * 职责：
 * - 从本地知识库中检索相关信息
 * - 支持关键词搜索（Jaccard）和混合检索（FTS5 + 向量 RRF 融合）
 * - 对检索结果进行摘要总结
 *
 * 实现策略：
 * - 主路径：使用 hybridSearch（FTS5 BM25 + 向量 KNN + RRF 融合）
 * - 降级路径：hybridSearch 无结果时使用 KnowledgeRepository.search（Jaccard 关键词）
 * - 可选：调用 LLM 对检索结果进行总结
 *
 * 方案书依据：v0.9 §3.1 表格第 4 行
 */
import type { ModelMessage } from 'ai'
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'
import { getSupervisor } from '../supervisor'
import { DatabaseManager } from '../../../services/db/database'
import { KnowledgeRepository } from '../../../services/db/knowledge-repo'
import { hybridSearch, type HybridSearchResult } from '../../../services/tutorial/hybrid-search'
import type { KnowledgeType } from '@shared/models'

/** 搜索 Subagent 系统提示词 */
const SEARCH_SYSTEM_PROMPT = `你是 Linux 知识搜索助手。根据用户查询，从知识库中检索相关信息并总结。`

/**
 * 搜索 Subagent 输入
 */
export interface SearchSubagentInput {
  /** 用户查询字符串 */
  query: string
  /** 知识类型过滤（可选：command_skill / incident_case / tutorial） */
  type?: KnowledgeType
  /** 返回结果数量上限（默认 5） */
  limit?: number
  /** 是否需要 LLM 总结（默认 true） */
  summarize?: boolean
}

/**
 * 搜索结果条目
 */
interface SearchResultItem {
  id: string
  title: string
  problem: string
  score: number
  source: string
}

export class SearchSubagent extends BaseSubagent {
  readonly name = 'search' as const
  readonly displayName = '搜索 Subagent'
  readonly description = '联网搜索、文档抓取（WebSearch + WebFetch + agent-reach skill）'

  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()
    const input = this.parseInput(task)

    if (!input.query) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: '缺少必需字段：query（搜索查询）',
        durationMs: Date.now() - startTime,
      }
    }

    const limit = input.limit ?? 5

    this.log.info(`[${this.name}] 开始搜索`, {
      taskId: task.id,
      query: input.query.slice(0, 100),
      type: input.type,
      limit,
    })

    // 执行检索
    let results: SearchResultItem[] = []
    try {
      results = this.searchKnowledgeBase(input.query, input.type, limit)
    } catch (err) {
      this.log.warn(`[${this.name}] 知识库检索失败`, {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 无结果
    if (results.length === 0) {
      return {
        taskId: task.id,
        success: true,
        output: {
          results: [],
          summary: `未找到与「${input.query}」相关的知识库条目。请尝试更换关键词或扩大搜索范围。`,
          total: 0,
        },
        confidence: 0.0,
        durationMs: Date.now() - startTime,
      }
    }

    // 可选：LLM 总结
    let summary = this.buildFallbackSummary(results)
    if (input.summarize !== false) {
      try {
        summary = await this.summarizeWithLlm(input.query, results, task)
      } catch (err) {
        this.log.warn(`[${this.name}] LLM 总结失败，使用基础摘要`, {
          taskId: task.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return {
      taskId: task.id,
      success: true,
      output: {
        results,
        summary,
        total: results.length,
      },
      confidence: Math.min(0.9, 0.5 + results.length * 0.1),
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * 从知识库检索（主路径 hybridSearch，降级 Jaccard）
   */
  private searchKnowledgeBase(query: string, type?: KnowledgeType, limit = 5): SearchResultItem[] {
    const db = DatabaseManager.getInstance()
    if (!db) {
      this.log.warn(`[${this.name}] DatabaseManager 未初始化`)
      return []
    }

    // 主路径：hybridSearch（FTS5 + 向量 RRF 融合）
    try {
      const hybridResults: HybridSearchResult[] = hybridSearch(db, {
        query,
        type,
        limit,
      })
      if (hybridResults.length > 0) {
        return hybridResults.map((r) => ({
          id: r.id,
          title: r.title,
          problem: r.problem,
          score: r.rrfScore,
          source: r.source,
        }))
      }
    } catch (err) {
      this.log.warn(`[${this.name}] hybridSearch 失败，降级到 Jaccard`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 降级路径：KnowledgeRepository.search（Jaccard 关键词）
    try {
      const repo = new KnowledgeRepository(db)
      const entries = repo.search(query, type, limit)
      return entries.map((e, idx) => ({
        id: e.id,
        title: e.title,
        problem: e.problem,
        score: 1 - idx * 0.1, // 按排序位置赋分
        source: 'jaccard',
      }))
    } catch (err) {
      this.log.warn(`[${this.name}] Jaccard 搜索也失败`, {
        error: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  }

  /**
   * 调用 LLM 对检索结果进行总结
   */
  private async summarizeWithLlm(
    query: string,
    results: SearchResultItem[],
    task: SubagentTask
  ): Promise<string> {
    const supervisor = getSupervisor()

    const contextText = results
      .map((r, i) => `${i + 1}. 【${r.title}】${r.problem}`)
      .join('\n')

    const messages: ModelMessage[] = [
      { role: 'system', content: SEARCH_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `用户查询：${query}\n\n检索到以下知识库条目：\n${contextText}\n\n请用 2-3 句话总结这些结果与用户查询的关联，并指出最相关的条目。`,
      },
    ]

    let fullText = ''
    await new Promise<void>((resolve, reject) => {
      void supervisor.chat({
        messages,
        providerId: task.providerId,
        strength: 'fast',
        correlationId: `${task.id}_search_summary`,
        onToken: (delta) => {
          fullText += delta
        },
        onDone: () => resolve(),
        onError: (err) => reject(err),
      })
    })

    if (!fullText.trim()) {
      throw new Error('LLM 返回空内容')
    }
    return fullText.trim()
  }

  /**
   * 构建基础摘要（LLM 不可用时的降级）
   */
  private buildFallbackSummary(results: SearchResultItem[]): string {
    const top = results[0]
    return `找到 ${results.length} 条相关结果。最相关：「${top.title}」— ${top.problem}`
  }

  /**
   * 解析任务输入
   */
  private parseInput(task: SubagentTask): SearchSubagentInput {
    if (typeof task.input === 'string') {
      return { query: task.input }
    }
    if (task.input && typeof task.input === 'object') {
      const obj = task.input as Record<string, unknown>
      return {
        query: typeof obj.query === 'string' ? obj.query : (task.description ?? ''),
        type: typeof obj.type === 'string' ? (obj.type as KnowledgeType) : undefined,
        limit: typeof obj.limit === 'number' ? obj.limit : undefined,
        summarize: typeof obj.summarize === 'boolean' ? obj.summarize : undefined,
      }
    }
    return { query: task.description ?? '' }
  }
}
