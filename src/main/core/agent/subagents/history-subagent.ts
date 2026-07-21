/**
 * 历史回溯 Subagent（History Subagent）
 *
 * 职责：
 * - 历史决策调研调用
 * - 从决策历史库（DecisionRepository / SQLite）检索相似的历史决策案例
 * - 找出相似案例，提供经验参考（复用历史成功决策 / 避免重复失败）
 *
 * 主要工具：DecisionRepository（SQLite decision_cards 表）
 *
 * 实现策略：
 * - 主路径：DecisionRepository.search 按问题/假设/命令检索相似历史决策，
 *   可选调用 LLM 对历史案例进行经验总结
 * - 降级路径：LLM 不可用时直接返回格式化的历史案例列表
 *
 * 方案书依据：v0.9 §3.1 表格第 7 行
 */
import type { ModelMessage } from 'ai'
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'
import { getSupervisor } from '../supervisor'
import { DatabaseManager } from '../../../services/db/database'
import { DecisionRepository } from '../../../services/db/decision-repo'
import type { DecisionCard } from '@shared/models'

/** 历史回溯 Subagent 系统提示词 */
const HISTORY_SYSTEM_PROMPT = `你是运维决策历史分析助手。检索历史决策记录，找出相似案例，提供经验参考。`

/** 默认返回结果数量上限 */
const DEFAULT_LIMIT = 5

/**
 * 历史回溯 Subagent 输入
 */
export interface HistorySubagentInput {
  /** 当前问题描述（用于检索相似历史决策） */
  query: string
  /** 返回结果数量上限（默认 5） */
  limit?: number
  /** 是否需要 LLM 经验总结（默认 true） */
  summarize?: boolean
}

/**
 * 历史决策案例条目（对外输出的精简结构）
 */
interface HistoryCaseItem {
  /** 决策卡片 ID */
  id: string
  /** 问题描述 */
  problem: string
  /** 根因假设 */
  hypothesis: string
  /** 修复命令 */
  fixCommand: string
  /** 综合置信度 [0, 1] */
  confidence: number
  /** 决策状态 */
  status: DecisionCard['status']
  /** 决策时间戳 */
  timestamp: number
}

export class HistorySubagent extends BaseSubagent {
  readonly name = 'history' as const
  readonly displayName = '历史回溯 Subagent'
  readonly description = '历史决策调研调用（检索相似历史案例，复用成功决策 / 避免重复失败）'

  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()
    const input = this.parseInput(task)

    if (!input.query) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: '缺少必需字段：query（当前问题描述）',
        durationMs: Date.now() - startTime,
      }
    }

    const limit = input.limit ?? DEFAULT_LIMIT

    this.log.info(`[${this.name}] 开始检索历史决策`, {
      taskId: task.id,
      query: input.query.slice(0, 100),
      limit,
    })

    // 步骤 1：检索历史决策库
    let cases: HistoryCaseItem[] = []
    try {
      cases = this.searchHistory(input.query, limit)
    } catch (err) {
      this.log.warn(`[${this.name}] 历史决策检索失败`, {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 无结果
    if (cases.length === 0) {
      return {
        taskId: task.id,
        success: true,
        output: {
          cases: [],
          summary: `未找到与「${input.query}」相似的历史决策记录。这是一次新问题，建议结合搜索 / 知识库 Subagent 进一步排查。`,
          total: 0,
        },
        confidence: 0.0,
        durationMs: Date.now() - startTime,
      }
    }

    // 步骤 2：经验总结（主路径 LLM，降级直接格式化）
    let summary = this.buildFallbackSummary(input.query, cases)
    if (input.summarize !== false) {
      try {
        summary = await this.summarizeWithLlm(input.query, cases, task)
      } catch (err) {
        this.log.warn(`[${this.name}] LLM 经验总结失败，使用基础摘要`, {
          taskId: task.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return {
      taskId: task.id,
      success: true,
      output: {
        cases,
        summary,
        total: cases.length,
      },
      // 历史案例越多、平均置信度越高，则本次回溯越可信
      confidence: this.computeConfidence(cases),
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * 从决策历史库检索相似案例
   */
  private searchHistory(query: string, limit: number): HistoryCaseItem[] {
    const db = DatabaseManager.getInstance()
    if (!db) {
      this.log.warn(`[${this.name}] DatabaseManager 未初始化`)
      return []
    }

    const repo = new DecisionRepository(db)
    const cards = repo.search(query)

    return cards.slice(0, limit).map((card) => ({
      id: card.id,
      problem: card.problem,
      hypothesis: card.hypothesis,
      fixCommand: card.fixCommand,
      confidence: card.confidence,
      status: card.status,
      timestamp: card.timestamp,
    }))
  }

  /**
   * 调用 LLM 对历史案例进行经验总结
   */
  private async summarizeWithLlm(
    query: string,
    cases: HistoryCaseItem[],
    task: SubagentTask
  ): Promise<string> {
    const supervisor = getSupervisor()

    const contextText = cases
      .map((c, i) => {
        const date = new Date(c.timestamp).toLocaleString('zh-CN')
        return `${i + 1}. 【${c.hypothesis}】问题：${c.problem}\n   修复命令：${c.fixCommand}\n   状态：${c.status} | 置信度：${c.confidence.toFixed(2)} | 时间：${date}`
      })
      .join('\n')

    const messages: ModelMessage[] = [
      { role: 'system', content: HISTORY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `当前问题：${query}\n\n检索到以下相似历史决策记录：\n${contextText}\n\n请基于历史案例给出经验参考：\n1. 指出最相似的历史案例及其根因\n2. 总结可复用的成功处置经验\n3. 提示需要避免的失败教训或风险点\n回答使用中文，命令使用代码块格式。`,
      },
    ]

    let fullText = ''
    await new Promise<void>((resolve, reject) => {
      void supervisor.chat({
        messages,
        providerId: task.providerId,
        strength: 'fast',
        correlationId: `${task.id}_history_summary`,
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
  private buildFallbackSummary(query: string, cases: HistoryCaseItem[]): string {
    const top = cases[0]
    const lines: string[] = [
      `找到 ${cases.length} 条与「${query}」相似的历史决策记录。`,
      `最相似案例：「${top.hypothesis}」— 修复命令：${top.fixCommand}（状态：${top.status}，置信度：${top.confidence.toFixed(2)}）`,
    ]
    return lines.join('\n')
  }

  /**
   * 计算本次回溯的自评置信度
   *
   * 综合考虑案例数量与平均历史置信度，上限 0.9。
   */
  private computeConfidence(cases: HistoryCaseItem[]): number {
    if (cases.length === 0) return 0.0
    const avgConfidence =
      cases.reduce((sum, c) => sum + c.confidence, 0) / cases.length
    const countFactor = Math.min(0.4, cases.length * 0.1)
    return Math.min(0.9, countFactor + avgConfidence * 0.5)
  }

  /**
   * 解析任务输入（兼容字符串和结构化对象）
   */
  private parseInput(task: SubagentTask): HistorySubagentInput {
    if (typeof task.input === 'string') {
      return { query: task.input }
    }
    if (task.input && typeof task.input === 'object') {
      const obj = task.input as Record<string, unknown>
      return {
        query:
          typeof obj.query === 'string'
            ? obj.query
            : typeof obj.problem === 'string'
              ? obj.problem
              : (task.description ?? ''),
        limit: typeof obj.limit === 'number' ? obj.limit : undefined,
        summarize: typeof obj.summarize === 'boolean' ? obj.summarize : undefined,
      }
    }
    return { query: task.description ?? '' }
  }
}
