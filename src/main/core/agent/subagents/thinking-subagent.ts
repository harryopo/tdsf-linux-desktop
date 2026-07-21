/**
 * 思考 Subagent（Thinking Subagent）
 *
 * 职责：
 * - 推理、规划、方案设计
 * - 对复杂 Linux 运维问题进行多步推理（Chain-of-Thought）
 * - 分析因果关系，给出结构化的诊断思路
 *
 * 主要工具：LLM chain-of-thought prompting
 *
 * 实现策略：
 * - 主路径：调用 Supervisor.chat（LLM）以思维链提示词进行多步推理，
 *   返回结构化的诊断分析（现象 → 因果推理 → 根因假设 → 验证步骤 → 处置建议）
 * - 降级路径：LLM 不可用时使用规则引擎（analyzeByRules）给出基础诊断假设
 *
 * 方案书依据：v0.9 §3.1 表格第 2 行 + §6 思考强度
 */
import type { ModelMessage } from 'ai'
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'
import { getSupervisor } from '../supervisor'
import { analyzeByRules } from '../../rule-engine'

/** 思考 Subagent 系统提示词 */
const THINKING_SYSTEM_PROMPT = `你是 Linux 系统深度分析专家。对复杂问题进行多步推理，分析因果关系，给出结构化的诊断思路。`

/**
 * 思考 Subagent 输入
 */
export interface ThinkingSubagentInput {
  /** 待分析的复杂问题（自然语言） */
  prompt: string
  /** 可选：额外上下文（如日志片段、系统状态、监控指标） */
  context?: string
  /** 可选：目标操作系统/发行版（如 "CentOS 7"、"Ubuntu 22.04"） */
  targetOs?: string
}

/**
 * 结构化诊断分析输出
 */
interface ThinkingAnalysisOutput {
  /** 完整的思维链分析文本（LLM 原始输出） */
  analysis: string
  /** 分析来源：llm / rule-engine */
  source: 'llm' | 'rule-engine'
  /** 原始问题 */
  prompt: string
  /** 规则引擎降级时的根因假设（仅 source=rule-engine 时有值） */
  hypothesis?: string
}

export class ThinkingSubagent extends BaseSubagent {
  readonly name = 'thinking' as const
  readonly displayName = '思考 Subagent'
  readonly description = '推理、规划、方案设计（Chain-of-Thought 多步推理 + 因果分析）'

  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()
    const input = this.parseInput(task)

    if (!input.prompt) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: '缺少必需字段：prompt（待分析的复杂问题）',
        durationMs: Date.now() - startTime,
      }
    }

    this.log.info(`[${this.name}] 开始深度推理`, {
      taskId: task.id,
      prompt: input.prompt.slice(0, 100),
      targetOs: input.targetOs,
      hasContext: Boolean(input.context),
    })

    // 主路径：调用 LLM 进行思维链多步推理
    try {
      const analysis = await this.reasonWithLlm(input, task)
      return {
        taskId: task.id,
        success: true,
        output: {
          analysis,
          source: 'llm',
          prompt: input.prompt,
        } satisfies ThinkingAnalysisOutput,
        confidence: 0.8,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.warn(`[${this.name}] LLM 调用失败，降级到规则引擎`, {
        taskId: task.id,
        error: errorMsg,
      })
    }

    // 降级路径：规则引擎给出基础诊断假设
    try {
      const ruleResult = analyzeByRules(input.prompt, input.context ?? '')
      if (ruleResult) {
        const analysis = [
          `## 问题现象`,
          input.prompt,
          ``,
          `## 根因假设`,
          ruleResult.hypothesis,
          ``,
          `## 建议验证命令`,
          '```bash',
          ruleResult.fixCommand,
          '```',
          ``,
          `> 说明：LLM 不可用，本结果由规则引擎降级生成，建议配置 LLM Provider 后获取完整多步推理。`,
        ].join('\n')
        return {
          taskId: task.id,
          success: true,
          output: {
            analysis,
            source: 'rule-engine',
            prompt: input.prompt,
            hypothesis: ruleResult.hypothesis,
          } satisfies ThinkingAnalysisOutput,
          confidence: ruleResult.confidence,
          durationMs: Date.now() - startTime,
        }
      }
    } catch (err) {
      this.log.warn(`[${this.name}] 规则引擎也失败`, {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 全部失败
    return {
      taskId: task.id,
      success: false,
      output: null,
      error: 'LLM 不可用且规则引擎无匹配结果，无法完成深度推理。请配置 LLM Provider 后重试。',
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * 通过 Supervisor.chat 调用 LLM 进行思维链多步推理
   */
  private async reasonWithLlm(input: ThinkingSubagentInput, task: SubagentTask): Promise<string> {
    const supervisor = getSupervisor()

    // 构造用户消息（思维链提示词，引导结构化输出）
    const sections: string[] = [`待分析问题：${input.prompt}`]
    if (input.targetOs) {
      sections.push(`目标系统：${input.targetOs}`)
    }
    if (input.context) {
      sections.push(`补充上下文（日志 / 系统状态）：\n${input.context}`)
    }
    sections.push(
      [
        `请按以下结构进行多步推理并输出：`,
        `1. 【问题拆解】将复杂问题拆分为若干可独立排查的子问题`,
        `2. 【因果推理】逐步分析可能的因果关系链（Chain-of-Thought）`,
        `3. 【根因假设】给出最可能的根因假设（按可能性排序）`,
        `4. 【验证步骤】针对每个假设给出可执行的验证命令或检查点`,
        `5. 【处置建议】给出修复建议与回滚方案，并标注风险等级`,
        `回答使用中文，命令使用代码块格式。`,
      ].join('\n')
    )

    const messages: ModelMessage[] = [
      { role: 'system', content: THINKING_SYSTEM_PROMPT },
      { role: 'user', content: sections.join('\n\n') },
    ]

    // 收集完整 LLM 响应
    let fullText = ''
    await new Promise<void>((resolve, reject) => {
      void supervisor.chat({
        messages,
        providerId: task.providerId,
        // 深度推理默认使用 standard 强度；调用方可通过 task.strength 覆盖
        strength: task.strength ?? 'standard',
        correlationId: `${task.id}_thinking`,
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
   * 解析任务输入（兼容字符串和结构化对象）
   */
  private parseInput(task: SubagentTask): ThinkingSubagentInput {
    if (typeof task.input === 'string') {
      return { prompt: task.input }
    }
    if (task.input && typeof task.input === 'object') {
      const obj = task.input as Record<string, unknown>
      return {
        prompt:
          typeof obj.prompt === 'string'
            ? obj.prompt
            : typeof obj.question === 'string'
              ? obj.question
              : (task.description ?? ''),
        context: typeof obj.context === 'string' ? obj.context : undefined,
        targetOs: typeof obj.targetOs === 'string' ? obj.targetOs : undefined,
      }
    }
    return { prompt: task.description ?? '' }
  }
}
