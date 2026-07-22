/**
 * MCP 工具注册表 - 知识域（v2.0 Phase F.2）
 *
 * 4 个知识域工具，复用现有 KnowledgeRepository（command_skill / incident_case 双轨制）：
 * 1. kb_search   - 关键词搜索知识库（Jaccard 相似度）
 * 2. kb_add      - 添加知识条目
 * 3. kb_update   - 更新知识条目（部分字段）
 * 4. kb_list     - 列出所有知识条目（按类型过滤）
 *
 * 依赖 DatabaseManager（与 tutorial_search 一致：db 不可用时返回空数组）
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseManager } from '../../db/database'
import { KnowledgeRepository } from '../../db/knowledge-repo'
import type { KnowledgeEntry, KnowledgeType } from '@shared/models'
import type { McpToolRegistration, McpToolResult } from './registry'
import { toMcpErrorResult, toMcpTextResult } from './registry'

/** 知识类型常量 */
const VALID_KB_TYPES: KnowledgeType[] = ['command_skill', 'incident_case', 'tutorial']

/** 校验是否合法的知识类型 */
function isValidKbType(value: unknown): value is KnowledgeType {
  return typeof value === 'string' && (VALID_KB_TYPES as string[]).includes(value)
}

/**
 * 创建知识域 4 个 MCP 工具
 *
 * @param db DatabaseManager 实例（必须，无 db 时返回空数组）
 */
export function createKnowledgeMcpTools(db: DatabaseManager | null): McpToolRegistration[] {
  if (!db) {
    // db 不可用时不注册知识域工具（与 tutorial_search 行为一致）
    return []
  }
  const repo = new KnowledgeRepository(db)

  return [
    // ── 1. kb_search ──────────────────────────────────────────────
    {
      meta: {
        name: 'kb_search',
        description:
          '从知识库中按关键词搜索（Jaccard 相似度排序）。可按类型过滤（command_skill/incident_case/tutorial）。',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '查询关键词（必填）' },
            type: {
              type: 'string',
              enum: VALID_KB_TYPES,
              description: '知识类型过滤（可选）',
            },
            limit: {
              type: 'number',
              description: '返回数量上限（默认 10，最大 50）',
            },
          },
          required: ['query'],
        },
      },
      call: async (args) => {
        const query = args.query
        if (typeof query !== 'string' || !query) {
          return toMcpErrorResult('参数 query 必填且为非空字符串')
        }
        const type = isValidKbType(args.type) ? args.type : undefined
        const limitRaw = typeof args.limit === 'number' ? args.limit : 10
        const limit = Math.max(1, Math.min(50, Math.floor(limitRaw)))

        const results = repo.search(query, type, limit)
        return toMcpTextResult({
          query,
          type: type ?? 'all',
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
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
          })),
        })
      },
    },

    // ── 2. kb_add ─────────────────────────────────────────────────
    {
      meta: {
        name: 'kb_add',
        description:
          '添加新的知识条目到知识库。type 必须是 command_skill / incident_case / tutorial 之一。',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: VALID_KB_TYPES,
              description: '知识类型（必填）',
            },
            title: { type: 'string', description: '标题（必填）' },
            problem: { type: 'string', description: '问题描述（必填）' },
            rootCause: { type: 'string', description: '根因（可选）' },
            commands: {
              type: 'array',
              items: { type: 'string' },
              description: '修复命令列表（必填）',
            },
            rollbackCommands: {
              type: 'array',
              items: { type: 'string' },
              description: '回滚命令列表（可选）',
            },
            verification: { type: 'string', description: '验证方法（可选）' },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: '关键词列表（用于检索，必填）',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: '标签列表（可选）',
            },
          },
          required: ['type', 'title', 'problem', 'commands', 'keywords'],
        },
      },
      call: async (args) => {
        if (!isValidKbType(args.type)) {
          return toMcpErrorResult(`参数 type 必须是 ${VALID_KB_TYPES.join('/')} 之一`)
        }
        const title = args.title
        const problem = args.problem
        if (typeof title !== 'string' || !title) {
          return toMcpErrorResult('参数 title 必填且为非空字符串')
        }
        if (typeof problem !== 'string' || !problem) {
          return toMcpErrorResult('参数 problem 必填且为非空字符串')
        }
        const commands = Array.isArray(args.commands)
          ? (args.commands as unknown[]).filter((s): s is string => typeof s === 'string')
          : []
        if (commands.length === 0) {
          return toMcpErrorResult('参数 commands 必填且至少包含一个命令')
        }
        const keywords = Array.isArray(args.keywords)
          ? (args.keywords as unknown[]).filter((s): s is string => typeof s === 'string')
          : []
        if (keywords.length === 0) {
          return toMcpErrorResult('参数 keywords 必填且至少包含一个关键词')
        }

        const entry: KnowledgeEntry = {
          id: randomUUID(),
          type: args.type,
          title,
          problem,
          rootCause: typeof args.rootCause === 'string' ? args.rootCause : undefined,
          commands,
          rollbackCommands: Array.isArray(args.rollbackCommands)
            ? (args.rollbackCommands as unknown[]).filter(
                (s): s is string => typeof s === 'string'
              )
            : undefined,
          verification: typeof args.verification === 'string' ? args.verification : undefined,
          keywords,
          tags: Array.isArray(args.tags)
            ? (args.tags as unknown[]).filter((s): s is string => typeof s === 'string')
            : [],
          successRate: 1.0,
          useCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        const ok = repo.add(entry)
        return toMcpTextResult({
          success: ok,
          id: entry.id,
          type: entry.type,
          title: entry.title,
          message: ok ? '添加成功' : '添加失败（ID 可能冲突或数据库错误）',
        })
      },
    },

    // ── 3. kb_update ──────────────────────────────────────────────
    {
      meta: {
        name: 'kb_update',
        description:
          '更新已有知识条目的部分字段（title/problem/commands/keywords/tags/successRate 等）。ID 不可变。',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '知识条目 ID（必填）' },
            title: { type: 'string', description: '新标题（可选）' },
            problem: { type: 'string', description: '新问题描述（可选）' },
            rootCause: { type: 'string', description: '新根因（可选）' },
            commands: {
              type: 'array',
              items: { type: 'string' },
              description: '新命令列表（可选）',
            },
            rollbackCommands: {
              type: 'array',
              items: { type: 'string' },
              description: '新回滚命令列表（可选）',
            },
            verification: { type: 'string', description: '新验证方法（可选）' },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: '新关键词列表（可选）',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: '新标签列表（可选）',
            },
            successRate: {
              type: 'number',
              description: '新成功率 [0, 1]（可选）',
            },
          },
          required: ['id'],
        },
      },
      call: async (args) => {
        const id = args.id
        if (typeof id !== 'string' || !id) {
          return toMcpErrorResult('参数 id 必填且为非空字符串')
        }
        const existing = repo.getById(id)
        if (!existing) {
          return toMcpErrorResult(`知识条目不存在: ${id}`)
        }

        const partial: Partial<KnowledgeEntry> = {}
        if (typeof args.title === 'string') partial.title = args.title
        if (typeof args.problem === 'string') partial.problem = args.problem
        if (typeof args.rootCause === 'string') partial.rootCause = args.rootCause
        if (typeof args.verification === 'string') partial.verification = args.verification
        if (Array.isArray(args.commands)) {
          partial.commands = (args.commands as unknown[]).filter(
            (s): s is string => typeof s === 'string'
          )
        }
        if (Array.isArray(args.rollbackCommands)) {
          partial.rollbackCommands = (args.rollbackCommands as unknown[]).filter(
            (s): s is string => typeof s === 'string'
          )
        }
        if (Array.isArray(args.keywords)) {
          partial.keywords = (args.keywords as unknown[]).filter(
            (s): s is string => typeof s === 'string'
          )
        }
        if (Array.isArray(args.tags)) {
          partial.tags = (args.tags as unknown[]).filter(
            (s): s is string => typeof s === 'string'
          )
        }
        if (typeof args.successRate === 'number') {
          partial.successRate = Math.max(0, Math.min(1, args.successRate))
        }

        const ok = repo.update(id, partial)
        return toMcpTextResult({
          success: ok,
          id,
          updatedFields: Object.keys(partial),
          message: ok ? '更新成功' : '更新失败',
        })
      },
    },

    // ── 4. kb_list ────────────────────────────────────────────────
    {
      meta: {
        name: 'kb_list',
        description: '列出知识库所有条目（可按类型过滤）。返回精简元数据列表，不含 commands 内容。',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: VALID_KB_TYPES,
              description: '知识类型过滤（可选）',
            },
            limit: {
              type: 'number',
              description: '返回数量上限（默认 50，最大 500）',
            },
          },
        },
      },
      call: async (args) => {
        const type = isValidKbType(args.type) ? args.type : undefined
        const limitRaw = typeof args.limit === 'number' ? args.limit : 50
        const limit = Math.max(1, Math.min(500, Math.floor(limitRaw)))

        const all = repo.exportAll(type)
        const sliced = all.slice(0, limit)
        return toMcpTextResult({
          type: type ?? 'all',
          total: all.length,
          returned: sliced.length,
          truncated: all.length > limit,
          entries: sliced.map((e) => ({
            id: e.id,
            type: e.type,
            title: e.title,
            problem: e.problem.slice(0, 200),
            keywords: e.keywords,
            tags: e.tags,
            successRate: e.successRate,
            useCount: e.useCount,
            updatedAt: e.updatedAt,
          })),
        })
      },
    },
  ]
}

/** 知识域工具名清单 */
export const KNOWLEDGE_TOOL_NAMES = ['kb_search', 'kb_add', 'kb_update', 'kb_list'] as const

/** 知识域工具元数据（用于 listRegisteredTools 展示） */
export const KNOWLEDGE_TOOL_METAS: Array<{ name: string; description: string }> = [
  { name: 'kb_search', description: '从知识库中按关键词搜索（Jaccard 相似度排序）' },
  { name: 'kb_add', description: '添加新的知识条目到知识库' },
  { name: 'kb_update', description: '更新已有知识条目的部分字段' },
  { name: 'kb_list', description: '列出知识库所有条目（可按类型过滤）' },
]

/** 占位导出，避免 TS unused 警告 */
export type { McpToolResult }
