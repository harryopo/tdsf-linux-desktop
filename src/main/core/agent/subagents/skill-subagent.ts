/**
 * Skill Subagent（Skill 调用）
 *
 * 职责：
 * - 根据用户需求，推荐相关的运维技能包和操作步骤
 * - 通过知识库检索匹配的 command_skill 类型条目
 * - 格式化为分步操作指南
 *
 * 主要工具：KnowledgeRepository（command_skill 类型检索）
 *
 * 实现策略：
 * - 主路径：搜索知识库 command_skill 条目 → 调用 LLM 生成结构化技能指南
 * - 降级路径：LLM 不可用时直接格式化知识条目为操作步骤
 *
 * 方案书依据：v0.9 §3.1 表格第 5 行
 */
import type { ModelMessage } from 'ai'
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'
import { getSupervisor } from '../supervisor'
import { DatabaseManager } from '../../../services/db/database'
import { KnowledgeRepository } from '../../../services/db/knowledge-repo'
import type { KnowledgeEntry } from '@shared/models'

/** Skill Subagent 系统提示词 */
const SKILL_SYSTEM_PROMPT = `你是 Linux 运维技能包管理助手。根据用户需求，推荐相关的运维技能包和操作步骤。`

/**
 * Skill Subagent 输入
 */
export interface SkillSubagentInput {
  /** 用户需求描述（自然语言） */
  prompt: string
  /** 可选：技能分类过滤（如 "网络"、"存储"、"安全"） */
  category?: string
  /** 可选：返回结果数量上限（默认 5） */
  limit?: number
}

/**
 * 技能指南结构
 */
interface SkillGuide {
  /** 技能指南标题 */
  title: string
  /** 分步操作指南（Markdown 格式） */
  steps: string
  /** 匹配的技能包列表 */
  matchedSkills: SkillReference[]
  /** 相关命令列表 */
  commands: string[]
  /** 来源：llm / knowledge-base / generic */
  source: 'llm' | 'knowledge-base' | 'generic'
}

/**
 * 技能引用条目
 */
interface SkillReference {
  id: string
  title: string
  problem: string
  tags: string[]
  successRate: number
}

export class SkillSubagent extends BaseSubagent {
  readonly name = 'skill' as const
  readonly displayName = 'Skill Subagent'
  readonly description = '调用 Trae / Claude 等 skill（MCP skill 协议）'

  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()
    const input = this.parseInput(task)

    if (!input.prompt) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: '缺少必需字段：prompt（用户需求描述）',
        durationMs: Date.now() - startTime,
      }
    }

    const limit = input.limit ?? 5

    this.log.info(`[${this.name}] 开始检索技能包`, {
      taskId: task.id,
      prompt: input.prompt.slice(0, 100),
      category: input.category,
    })

    // 步骤 1：搜索知识库中的 command_skill 条目
    const entries = this.searchSkills(input.prompt, input.category, limit)

    if (entries.length === 0) {
      // 降级：返回通用指导
      this.log.info(`[${this.name}] 未找到匹配技能包，返回通用指导`, {
        taskId: task.id,
      })
      return {
        taskId: task.id,
        success: true,
        output: this.buildGenericGuide(input.prompt),
        confidence: 0.2,
        durationMs: Date.now() - startTime,
      }
    }

    // 步骤 2：提取命令列表
    const commands = this.extractCommands(entries)

    // 步骤 3：构建技能引用
    const matchedSkills = this.buildSkillReferences(entries)

    // 步骤 4：生成结构化技能指南（主路径 LLM，降级格式化输出）
    let guide: SkillGuide
    try {
      const steps = await this.generateSkillGuide(input.prompt, entries, commands, task)
      guide = {
        title: `运维技能指南：${input.prompt.slice(0, 30)}`,
        steps,
        matchedSkills,
        commands,
        source: 'llm',
      }
    } catch (err) {
      this.log.warn(`[${this.name}] LLM 生成技能指南失败，使用格式化输出`, {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      })
      const steps = this.buildFallbackSteps(input.prompt, entries, commands)
      guide = {
        title: `运维技能指南：${input.prompt.slice(0, 30)}`,
        steps,
        matchedSkills,
        commands,
        source: 'knowledge-base',
      }
    }

    return {
      taskId: task.id,
      success: true,
      output: guide,
      confidence: Math.min(0.9, 0.4 + entries.length * 0.1),
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * 搜索知识库中的 command_skill 条目
   */
  private searchSkills(prompt: string, category: string | undefined, limit: number): KnowledgeEntry[] {
    try {
      const db = DatabaseManager.getInstance()
      if (!db) {
        this.log.warn(`[${this.name}] DatabaseManager 未初始化`)
        return []
      }

      const repo = new KnowledgeRepository(db)

      // 搜索 command_skill 类型
      const query = category ? `${prompt} ${category}` : prompt
      const entries = repo.search(query, 'command_skill', limit)

      // 如果 command_skill 结果不足，补充搜索全部类型
      if (entries.length < 2) {
        const allEntries = repo.search(query, undefined, limit)
        const existingIds = new Set(entries.map((e) => e.id))
        const extra = allEntries.filter((e) => !existingIds.has(e.id))
        return [...entries, ...extra].slice(0, limit)
      }

      return entries
    } catch (err) {
      this.log.warn(`[${this.name}] 知识库搜索失败`, {
        error: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  }

  /**
   * 从知识条目中提取命令列表
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
    return commands.slice(0, 10)
  }

  /**
   * 构建技能引用列表
   */
  private buildSkillReferences(entries: KnowledgeEntry[]): SkillReference[] {
    return entries.slice(0, 5).map((e) => ({
      id: e.id,
      title: e.title,
      problem: e.problem,
      tags: e.tags ?? [],
      successRate: e.successRate,
    }))
  }

  /**
   * 调用 LLM 生成结构化技能指南
   */
  private async generateSkillGuide(
    prompt: string,
    entries: KnowledgeEntry[],
    commands: string[],
    task: SubagentTask
  ): Promise<string> {
    const supervisor = getSupervisor()

    // 构造技能上下文
    const skillContext = entries
      .map((e, i) => {
        const cmds = e.commands?.length ? `\n   命令：${e.commands.join(' | ')}` : ''
        const tags = e.tags?.length ? `\n   标签：${e.tags.join(', ')}` : ''
        return `${i + 1}. 【${e.title}】${e.problem}${cmds}${tags}`
      })
      .join('\n')

    const commandContext = commands.length > 0
      ? `\n\n可用命令：\n${commands.map((c) => `  - ${c}`).join('\n')}`
      : ''

    const messages: ModelMessage[] = [
      { role: 'system', content: SKILL_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `用户需求：${prompt}\n\n匹配的技能包：\n${skillContext}${commandContext}\n\n请基于以上技能包，生成分步操作指南。要求：\n1. 给出操作前提条件（权限、环境要求）\n2. 分步骤列出操作流程（每步含具体命令）\n3. 给出验证方法（如何确认操作成功）\n4. 列出回滚方案（操作失败时如何恢复）\n回答使用中文，命令使用代码块格式。`,
      },
    ]

    let fullText = ''
    await new Promise<void>((resolve, reject) => {
      void supervisor.chat({
        messages,
        providerId: task.providerId,
        strength: task.strength ?? 'standard',
        correlationId: `${task.id}_skill`,
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
   * 构建降级操作步骤（LLM 不可用时直接格式化知识条目）
   */
  private buildFallbackSteps(prompt: string, entries: KnowledgeEntry[], commands: string[]): string {
    const parts: string[] = []
    parts.push(`## 运维技能指南：${prompt}\n`)
    parts.push(`从技能库中匹配到 ${entries.length} 个相关技能包：\n`)

    // 前提条件
    parts.push(`### 前提条件`)
    parts.push(`- 具备目标服务器的 SSH 访问权限`)
    parts.push(`- 确认操作环境（发行版、内核版本）`)
    parts.push('')

    // 操作步骤
    parts.push(`### 操作步骤\n`)
    for (const entry of entries.slice(0, 5)) {
      parts.push(`#### ${entry.title}`)
      parts.push(`${entry.problem}`)
      if (entry.commands?.length) {
        parts.push(`\n执行命令：`)
        for (const cmd of entry.commands.slice(0, 3)) {
          parts.push(`\`\`\`bash\n${cmd}\n\`\`\``)
        }
      }
      if (entry.verification) {
        parts.push(`\n验证：${entry.verification}`)
      }
      parts.push('')
    }

    // 命令汇总
    if (commands.length > 0) {
      parts.push(`### 命令汇总\n`)
      for (const cmd of commands.slice(0, 8)) {
        parts.push(`- \`${cmd}\``)
      }
      parts.push('')
    }

    // 回滚方案
    parts.push(`### 回滚方案`)
    parts.push(`- 执行变更前先备份相关配置/数据`)
    parts.push(`- 如操作失败，参考各技能包的回滚命令`)
    parts.push(`- 必要时联系系统管理员协助恢复`)

    return parts.join('\n')
  }

  /**
   * 构建通用指导（无匹配技能包时的降级）
   */
  private buildGenericGuide(prompt: string): SkillGuide {
    const steps = [
      `## 运维操作通用指导：${prompt}\n`,
      `知识库中暂无与此需求直接匹配的技能包。以下为通用操作建议：\n`,
      `### 操作步骤`,
      `1. **明确目标**：确认要完成的具体运维任务`,
      `2. **环境检查**：确认操作系统版本、已安装工具、当前状态`,
      `3. **方案制定**：查阅官方文档或 man 手册，确定操作命令`,
      `4. **备份准备**：执行变更前备份相关配置和数据`,
      `5. **执行操作**：按步骤执行命令，观察每步输出`,
      `6. **验证结果**：确认操作达到预期效果`,
      `7. **记录归档**：记录操作过程和结果，便于后续参考\n`,
      `### 建议`,
      `- 使用 \`man <命令>\` 查看命令详细用法`,
      `- 使用 \`--help\` 参数查看命令选项`,
      `- 复杂操作建议先在测试环境验证`,
      `- 高风险操作（删除、格式化等）务必三思而后行`,
    ].join('\n')

    return {
      title: `运维操作通用指导：${prompt.slice(0, 30)}`,
      steps,
      matchedSkills: [],
      commands: [],
      source: 'generic',
    }
  }

  /**
   * 解析任务输入（兼容字符串和结构化对象）
   */
  private parseInput(task: SubagentTask): SkillSubagentInput {
    if (typeof task.input === 'string') {
      return { prompt: task.input }
    }
    if (task.input && typeof task.input === 'object') {
      const obj = task.input as Record<string, unknown>
      return {
        prompt: typeof obj.prompt === 'string'
          ? obj.prompt
          : typeof obj.query === 'string'
            ? obj.query
            : (task.description ?? ''),
        category: typeof obj.category === 'string' ? obj.category : undefined,
        limit: typeof obj.limit === 'number' ? obj.limit : undefined,
      }
    }
    return { prompt: task.description ?? '' }
  }
}
