/**
 * 编程 Subagent（Coding Subagent）
 *
 * 职责：
 * - 代码生成、修改、重构
 * - 通过 SFTP 读取/写入远程文件
 * - 与 Monaco diff 联动展示修改前后对比
 *
 * 主要工具：sftpReadFile / sftpWriteFile / Monaco diff
 *
 * 实现策略：
 * - 主路径：调用 Supervisor.chat（LLM）生成 bash 脚本/命令
 * - 降级路径：LLM 不可用时使用规则引擎（analyzeByRules）给出基础命令建议
 *
 * 方案书依据：v0.9 §3.1 表格第 1 行
 */
import type { ModelMessage } from 'ai'
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'
import { getSupervisor } from '../supervisor'
import { analyzeByRules } from '../../rule-engine'

/** 编程 Subagent 系统提示词 */
const CODING_SYSTEM_PROMPT = `你是 Linux 运维代码专家。用户会描述一个运维任务，你生成对应的 bash 脚本或命令。只输出代码块，附带简短注释。`

/**
 * 编程 Subagent 输入
 */
export interface CodingSubagentInput {
  /** 用户描述的运维任务（自然语言） */
  prompt: string
  /** 可选：目标操作系统/发行版（如 "CentOS 7"、"Ubuntu 22.04"） */
  targetOs?: string
  /** 可选：额外上下文（如当前服务器状态、已有脚本片段） */
  context?: string
}

export class CodingSubagent extends BaseSubagent {
  readonly name = 'coding' as const
  readonly displayName = '编程 Subagent'
  readonly description = '代码生成、修改、重构（通过 SFTP 读写远程文件 + Monaco diff 联动）'

  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()
    const input = this.parseInput(task)

    if (!input.prompt) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: '缺少必需字段：prompt（运维任务描述）',
        durationMs: Date.now() - startTime,
      }
    }

    this.log.info(`[${this.name}] 开始生成代码`, {
      taskId: task.id,
      prompt: input.prompt.slice(0, 100),
      targetOs: input.targetOs,
    })

    // 主路径：调用 LLM 生成代码
    try {
      const code = await this.generateWithLlm(input, task)
      return {
        taskId: task.id,
        success: true,
        output: {
          code,
          source: 'llm',
          prompt: input.prompt,
        },
        confidence: 0.85,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.warn(`[${this.name}] LLM 调用失败，降级到规则引擎`, {
        taskId: task.id,
        error: errorMsg,
      })
    }

    // 降级路径：规则引擎
    try {
      const ruleResult = analyzeByRules(input.prompt, input.context ?? '')
      if (ruleResult) {
        return {
          taskId: task.id,
          success: true,
          output: {
            code: `#!/bin/bash\n# ${ruleResult.hypothesis}\n${ruleResult.fixCommand}`,
            source: 'rule-engine',
            hypothesis: ruleResult.hypothesis,
            prompt: input.prompt,
          },
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
      error: 'LLM 不可用且规则引擎无匹配结果，无法生成代码。请配置 LLM Provider 后重试。',
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * 通过 Supervisor.chat 调用 LLM 生成代码
   */
  private async generateWithLlm(input: CodingSubagentInput, task: SubagentTask): Promise<string> {
    const supervisor = getSupervisor()

    // 构造用户消息
    let userContent = input.prompt
    if (input.targetOs) {
      userContent = `目标系统：${input.targetOs}\n\n${userContent}`
    }
    if (input.context) {
      userContent = `${userContent}\n\n补充上下文：\n${input.context}`
    }

    const messages: ModelMessage[] = [
      { role: 'system', content: CODING_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ]

    // 收集完整 LLM 响应
    let fullText = ''
    await new Promise<void>((resolve, reject) => {
      void supervisor.chat({
        messages,
        providerId: task.providerId,
        strength: task.strength ?? 'standard',
        correlationId: `${task.id}_coding`,
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
  private parseInput(task: SubagentTask): CodingSubagentInput {
    if (typeof task.input === 'string') {
      return { prompt: task.input }
    }
    if (task.input && typeof task.input === 'object') {
      const obj = task.input as Record<string, unknown>
      return {
        prompt: typeof obj.prompt === 'string' ? obj.prompt : (task.description ?? ''),
        targetOs: typeof obj.targetOs === 'string' ? obj.targetOs : undefined,
        context: typeof obj.context === 'string' ? obj.context : undefined,
      }
    }
    return { prompt: task.description ?? '' }
  }
}
