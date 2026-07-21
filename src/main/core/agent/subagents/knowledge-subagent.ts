/**
 * 知识库 Subagent（Knowledge Subagent）
 *
 * 职责：
 * - RAG 检索 + 数据清洗
 * - 向量检索（sqlite-vec）+ 命令步骤抽取
 * - 知识库条目向量化 + Top-K 检索
 * - 从教程知识库中提供结构化的教学回答
 *
 * 实现策略：
 * - 主路径：搜索教程/知识库 → 调用 LLM 生成结构化教学回答（含命令示例）
 * - 降级路径：LLM 不可用时直接返回检索到的知识条目（格式化输出）
 *
 * 方案书依据：v0.9 §3.1 表格第 8 行
 */
import type { ModelMessage } from 'ai'
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'
import { getSupervisor } from '../supervisor'
import { DatabaseManager } from '../../../services/db/database'
import { KnowledgeRepository } from '../../../services/db/knowledge-repo'
import { TutorialRepository } from '../../../services/tutorial/tutorial-repo'
import { hybridSearch, type HybridSearchResult } from '../../../services/tutorial/hybrid-search'
import type { KnowledgeEntry } from '@shared/models'

/** 知识库 Subagent 系统提示词 */
const KNOWLEDGE_SYSTEM_PROMPT = `你是 Linux 教学知识专家。根据用户问题，从教程知识库中提供结构化的教学回答。`

/**
 * 知识库 Subagent 输入
 */
export interface KnowledgeSubagentInput {
  /** 用户问题（自然语言） */
  question: string
  /** 返回结果数量上限（默认 5） */
  limit?: number
  /** 是否包含命令示例（默认 true） */
  includeCommands?: boolean
}

/**
 * 教学回答结构
 */
interface EducationalResponse {
  /** 结构化教学回答文本 */
  answer: string
  /** 相关知识条目 */
  references: KnowledgeReference[]
  /** 相关命令示例 */
  commands: string[]
  /** 回答来源：llm / knowledge-base */
  source: 'llm' | 'knowledge-base'
}

/**
 * 知识引用条目
 */
interface KnowledgeReference {
  id: string
  title: string
  summary: string
  category?: string
}

export class KnowledgeSubagent extends BaseSubagent {
  readonly name = 'knowledge' as const
  readonly displayName = '知识库 Subagent'
  readonly description = 'RAG 检索 + 数据清洗（向量检索 + 命令步骤抽取）'

  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()
    const input = this.parseInput(task)

    if (!input.question) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: '缺少必需字段：question（用户问题）',
        durationMs: Date.now() - startTime,
      }
    }

    const limit = input.limit ?? 5

    this.log.info(`[${this.name}] 开始知识检索`, {
      taskId: task.id,
      question: input.question.slice(0, 100),
      limit,
    })

    // 步骤 1：检索知识库（教程 + 命令技能 + 故障案例）
    const { entries, hybridResults } = this.retrieveKnowledge(input.question, limit)

    if (entries.length === 0 && hybridResults.length === 0) {
      return {
        taskId: task.id,
        success: true,
        output: {
          answer: `知识库中暂无与「${input.question}」直接相关的教程或案例。建议：\n1. 尝试更具体的关键词\n2. 检查相关 Linux 发行版文档\n3. 使用搜索 Subagent 进行更广泛的检索`,
          references: [],
          commands: [],
          source: 'knowledge-base',
        },
        confidence: 0.1,
        durationMs: Date.now() - startTime,
      }
    }

    // 步骤 2：提取命令示例
    const commands = input.includeCommands !== false ? this.extractCommands(entries) : []

    // 步骤 3：构建引用列表
    const references = this.buildReferences(entries, hybridResults)

    // 步骤 4：生成教学回答（主路径 LLM，降级直接格式化）
    let response: EducationalResponse
    try {
      const answer = await this.generateEducationalAnswer(input.question, entries, commands, task)
      response = { answer, references, commands, source: 'llm' }
    } catch (err) {
      this.log.warn(`[${this.name}] LLM 生成教学回答失败，使用格式化输出`, {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      })
      const answer = this.buildFallbackAnswer(input.question, entries, commands)
      response = { answer, references, commands, source: 'knowledge-base' }
    }

    return {
      taskId: task.id,
      success: true,
      output: response,
      confidence: Math.min(0.9, 0.4 + entries.length * 0.1),
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * 检索知识库（教程优先，兼顾命令技能和故障案例）
   */
  private retrieveKnowledge(
    question: string,
    limit: number
  ): { entries: KnowledgeEntry[]; hybridResults: HybridSearchResult[] } {
    const db = DatabaseManager.getInstance()
    if (!db) {
      this.log.warn(`[${this.name}] DatabaseManager 未初始化`)
      return { entries: [], hybridResults: [] }
    }

    let hybridResults: HybridSearchResult[] = []
    let entries: KnowledgeEntry[] = []

    // 主路径：hybridSearch（FTS5 + 向量 RRF 融合）
    try {
      hybridResults = hybridSearch(db, {
        query: question,
        limit,
      })
    } catch (err) {
      this.log.warn(`[${this.name}] hybridSearch 失败`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 补充：TutorialRepository 关键词搜索（教程优先）
    try {
      const tutorialRepo = new TutorialRepository(db)
      const tutorials = tutorialRepo.search(question, limit)
      // 将教程转换为 KnowledgeEntry 格式（复用 toKnowledgeEntry）
      const tutorialEntries = tutorials
        .map((t) => tutorialRepo.toKnowledgeEntry(t))
        .filter((e) => !hybridResults.some((h) => h.id === e.id))
      entries = [...entries, ...tutorialEntries]
    } catch (err) {
      this.log.warn(`[${this.name}] 教程搜索失败`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 补充：KnowledgeRepository 关键词搜索（命令技能 + 故障案例）
    try {
      const knowledgeRepo = new KnowledgeRepository(db)
      const knowledgeEntries = knowledgeRepo.search(question, undefined, limit)
      // 去重
      const existingIds = new Set([
        ...hybridResults.map((h) => h.id),
        ...entries.map((e) => e.id),
      ])
      const newEntries = knowledgeEntries.filter((e) => !existingIds.has(e.id))
      entries = [...entries, ...newEntries]
    } catch (err) {
      this.log.warn(`[${this.name}] 知识库搜索失败`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 限制总数
    entries = entries.slice(0, limit)
    return { entries, hybridResults: hybridResults.slice(0, limit) }
  }

  /**
   * 从知识条目中提取命令示例
   */
  private extractCommands(entries: KnowledgeEntry[]): string[] {
    const commands: string[] = []
    for (const entry of entries) {
      if (entry.commands && entry.commands.length > 0) {
        for (const cmd of entry.commands) {
          if (cmd && !commands.includes(cmd)) {
            commands.push(cmd)
          }
        }
      }
    }
    return commands.slice(0, 10) // 最多 10 条命令
  }

  /**
   * 构建引用列表
   */
  private buildReferences(
    entries: KnowledgeEntry[],
    hybridResults: HybridSearchResult[]
  ): KnowledgeReference[] {
    const refs: KnowledgeReference[] = []
    const seenIds = new Set<string>()

    // 从 hybridResults 构建
    for (const h of hybridResults) {
      if (!seenIds.has(h.id)) {
        seenIds.add(h.id)
        refs.push({
          id: h.id,
          title: h.title,
          summary: h.problem,
          category: h.category,
        })
      }
    }

    // 从 entries 补充
    for (const e of entries) {
      if (!seenIds.has(e.id)) {
        seenIds.add(e.id)
        refs.push({
          id: e.id,
          title: e.title,
          summary: e.problem,
          category: e.tags?.[0],
        })
      }
    }

    return refs.slice(0, 8)
  }

  /**
   * 调用 LLM 生成结构化教学回答
   */
  private async generateEducationalAnswer(
    question: string,
    entries: KnowledgeEntry[],
    commands: string[],
    task: SubagentTask
  ): Promise<string> {
    const supervisor = getSupervisor()

    // 构造知识上下文
    const knowledgeContext = entries
      .map((e, i) => {
        const cmds = e.commands?.length ? `\n   相关命令：${e.commands.join(' | ')}` : ''
        return `${i + 1}. 【${e.title}】${e.problem}${cmds}`
      })
      .join('\n')

    const commandContext = commands.length > 0
      ? `\n\n可用命令示例：\n${commands.map((c) => `  - ${c}`).join('\n')}`
      : ''

    const messages: ModelMessage[] = [
      { role: 'system', content: KNOWLEDGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `用户问题：${question}\n\n知识库检索结果：\n${knowledgeContext}${commandContext}\n\n请基于以上知识，给出结构化的教学回答。要求：\n1. 先给出简明概念解释\n2. 再给出操作步骤（含命令示例）\n3. 最后给出注意事项或常见问题\n回答使用中文，命令使用代码块格式。`,
      },
    ]

    let fullText = ''
    await new Promise<void>((resolve, reject) => {
      void supervisor.chat({
        messages,
        providerId: task.providerId,
        strength: task.strength ?? 'standard',
        correlationId: `${task.id}_knowledge`,
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
   * 构建降级回答（LLM 不可用时直接格式化知识条目）
   */
  private buildFallbackAnswer(question: string, entries: KnowledgeEntry[], commands: string[]): string {
    const parts: string[] = []
    parts.push(`## 关于「${question}」\n`)
    parts.push(`从知识库中检索到 ${entries.length} 条相关内容：\n`)

    for (const entry of entries.slice(0, 5)) {
      parts.push(`### ${entry.title}`)
      parts.push(`${entry.problem}`)
      if (entry.commands?.length) {
        parts.push(`\n相关命令：`)
        for (const cmd of entry.commands.slice(0, 3)) {
          parts.push(`\`\`\`bash\n${cmd}\n\`\`\``)
        }
      }
      parts.push('')
    }

    if (commands.length > 0) {
      parts.push(`### 常用命令汇总\n`)
      for (const cmd of commands.slice(0, 5)) {
        parts.push(`- \`${cmd}\``)
      }
    }

    return parts.join('\n')
  }

  /**
   * 解析任务输入
   */
  private parseInput(task: SubagentTask): KnowledgeSubagentInput {
    if (typeof task.input === 'string') {
      return { question: task.input }
    }
    if (task.input && typeof task.input === 'object') {
      const obj = task.input as Record<string, unknown>
      return {
        question: typeof obj.question === 'string'
          ? obj.question
          : typeof obj.query === 'string'
            ? obj.query
            : (task.description ?? ''),
        limit: typeof obj.limit === 'number' ? obj.limit : undefined,
        includeCommands: typeof obj.includeCommands === 'boolean' ? obj.includeCommands : undefined,
      }
    }
    return { question: task.description ?? '' }
  }
}
