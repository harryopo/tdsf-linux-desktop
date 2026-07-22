/**
 * MCP Legacy 工具调用处理器（v2.0 Phase F 拆分）
 *
 * 承载 server.ts handleToolCall 中 v5 注册表和 v2.0 分域工具均未覆盖的 4 个 legacy 工具：
 * 1. ssh_diagnose     - 调用 AgentWorkflow 7 步 HITL 诊断
 * 2. knowledge_query  - 查询知识库（command_skill / incident_case）
 * 3. risk_check       - 评估 Linux 命令风险等级
 * 4. history_search   - 搜索历史决策卡片
 *
 * 拆分目的：保证 server.ts 单文件 ≤ 500 行（硬约束）。
 *
 * 设计要点：
 * - 不在此处 try-catch，z.parse 抛出的异常冒泡到 server.ts handleToolCall 的 catch
 * - default 分支返回"未知工具"正常响应（非异常）
 * - 返回类型为 McpToolResult（含可选 isError），与 v5/v2 工具一致
 */
import { z } from 'zod'
import { assessRisk } from '../../../core/risk-engine'
import { AgentWorkflow } from '../../../core/agent-workflow'
import { DatabaseManager } from '../../db/database'
import { KnowledgeRepository } from '../../db/knowledge-repo'
import { DecisionRepository } from '../../db/decision-repo'
import type { KnowledgeType } from '@shared/models'
import type { McpToolResult } from './registry'

/**
 * 处理 legacy 工具调用
 *
 * @param name 工具名（ssh_diagnose / knowledge_query / risk_check / history_search）
 * @param args 工具参数
 * @returns MCP 工具调用结果；default 分支返回"未知工具"提示
 * @throws z.parse 失败时抛 ZodError（由调用方 catch）
 */
export async function handleLegacyToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'ssh_diagnose': {
      const { connId, problem } = z
        .object({ connId: z.string(), problem: z.string() })
        .parse(args)
      // 调用 Agent 工作流（简化版，不等待 confirm 步骤）
      const workflow = new AgentWorkflow()
      const card = await workflow.start({
        problem,
        logs: '',
        connId,
      })
      return {
        content: [
          {
            type: 'text',
            text: card ? JSON.stringify(card, null, 2) : '诊断失败',
          },
        ],
      }
    }

    case 'knowledge_query': {
      const { query, type, limit } = z
        .object({
          query: z.string(),
          type: z.enum(['command_skill', 'incident_case']).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .parse(args)
      const db = DatabaseManager.getInstance()
      const repo = new KnowledgeRepository(db)
      const results = repo.search(query, type as KnowledgeType | undefined, limit ?? 5)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                query,
                count: results.length,
                entries: results.map((e) => ({
                  id: e.id,
                  type: e.type,
                  title: e.title,
                  problem: e.problem,
                  rootCause: e.rootCause,
                  commands: e.commands,
                  rollbackCommands: e.rollbackCommands,
                  verification: e.verification,
                  keywords: e.keywords,
                  tags: e.tags,
                  successRate: e.successRate,
                  useCount: e.useCount,
                })),
              },
              null,
              2
            ),
          },
        ],
      }
    }

    case 'risk_check': {
      const { command } = z.object({ command: z.string() }).parse(args)
      const risk = assessRisk(command)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(risk, null, 2),
          },
        ],
      }
    }

    case 'history_search': {
      const { query, limit } = z
        .object({
          query: z.string(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .parse(args)
      const db = DatabaseManager.getInstance()
      const repo = new DecisionRepository(db)
      const results = repo.search(query).slice(0, limit ?? 10)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                query,
                count: results.length,
                cards: results.map((c) => ({
                  id: c.id,
                  problem: c.problem,
                  hypothesis: c.hypothesis,
                  confidence: c.confidence,
                  riskLevel: c.risk.level,
                  fixCommand: c.fixCommand,
                  status: c.status,
                  timestamp: c.timestamp,
                })),
              },
              null,
              2
            ),
          },
        ],
      }
    }

    default:
      return {
        content: [{ type: 'text', text: `未知工具: ${name}` }],
      }
  }
}
