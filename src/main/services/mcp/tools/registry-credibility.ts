/**
 * MCP 工具注册表 - 决策域（v2.0 Phase F.3）
 *
 * 2 个决策域工具，复用现有可信度融合引擎 + 决策历史仓储：
 * 1. credibility_assess    - 多源证据融合评估（D-S + PCR5）
 * 2. decision_history      - 决策卡片历史查询（FTS5 全文检索 + LIKE 降级）
 *
 * 论文支撑：
 * - Dempster-Shafer 证据理论（Dempster 1967, Shafer 1976）
 * - PCR5 冲突融合（Smets 2007）
 */
import {
  createMassFunction,
  TRUSTED,
  UNTRUSTED,
} from '../../../core/agent/credibility/ds-theory'
import { getFusionEngine } from '../../../core/agent/credibility/fusion-engine'
import type { DatabaseManager } from '../../db/database'
import { DecisionRepository } from '../../db/decision-repo'
import type { McpToolRegistration } from './registry'
import { toMcpErrorResult, toMcpTextResult } from './registry'

/** 校验字符串非空 */
function requireNonString(value: unknown, _name: string): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** 校验数值在 [0, 1] 范围 */
function clamp01(value: unknown): number | null {
  if (typeof value !== 'number' || isNaN(value)) return null
  return Math.max(0, Math.min(1, value))
}

/**
 * 把单个证据源的 confidence 转换为二元框架 Mass 函数
 *
 * 分配策略（保守可信）：
 *   m({T})     = confidence              （直接支持"可信"）
 *   m({¬T})    = (1 - confidence) * 0.3  （部分支持"不可信"）
 *   m({T, ¬T}) = (1 - confidence) * 0.7  （剩余分给"不知道"）
 *
 * 这样设计的好处：
 * - 当 confidence=1.0 时，全部质量给 T（强支持）
 * - 当 confidence=0.5 时，T/¬T/Θ 三方分配，倾向不确定
 * - 当 confidence=0.0 时，大部分给 Θ，少量给 ¬T（弱反对）
 */
function confidenceToMass(
  sourceId: string,
  sourceName: string,
  confidence: number
): ReturnType<typeof createMassFunction> {
  const t = Math.max(0, Math.min(1, confidence))
  const notT = (1 - t) * 0.3
  const unknown = (1 - t) * 0.7
  return createMassFunction(
    sourceId,
    sourceName,
    [
      { elements: new Set<string>([TRUSTED]), mass: t },
      { elements: new Set<string>([UNTRUSTED]), mass: notT },
      { elements: new Set<string>([TRUSTED, UNTRUSTED]), mass: unknown },
    ],
    t
  )
}

/**
 * 创建决策域 2 个 MCP 工具
 *
 * @param db DatabaseManager 实例（decision_history 工具需要，无 db 时该工具返回错误）
 */
export function createCredibilityMcpTools(db: DatabaseManager | null): McpToolRegistration[] {
  return [
    // ── 1. credibility_assess ─────────────────────────────────────
    {
      meta: {
        name: 'credibility_assess',
        description:
          '多源证据融合评估可信度（D-S 证据理论 + PCR5 冲突融合）。输入证据源列表（含 confidence），返回信任区间 [Bel, Pl]、综合可信度、冲突程度。',
        inputSchema: {
          type: 'object',
          properties: {
            sources: {
              type: 'array',
              description:
                '证据源列表（必填，至少 1 个）。每项含 sourceId/sourceName/confidence',
              items: {
                type: 'object',
                properties: {
                  sourceId: { type: 'string', description: '证据源 ID（如 log/kb/ai/human/history）' },
                  sourceName: { type: 'string', description: '证据源显示名称' },
                  confidence: {
                    type: 'number',
                    description: '该证据源的可信度 [0, 1]',
                  },
                },
              },
            },
          },
          required: ['sources'],
        },
      },
      call: async (args) => {
        if (!Array.isArray(args.sources) || args.sources.length === 0) {
          return toMcpErrorResult('参数 sources 必填且至少包含一个证据源')
        }

        // 构造 Mass 函数列表
        const massFunctions = []
        for (let i = 0; i < args.sources.length; i++) {
          const src = args.sources[i] as Record<string, unknown>
          const sourceId =
            requireNonString(src.sourceId, `sources[${i}].sourceId`) ?? `source-${i}`
          const sourceName =
            requireNonString(src.sourceName, `sources[${i}].sourceName`) ?? sourceId
          const confidenceRaw = src.confidence
          const confidence = clamp01(confidenceRaw)
          if (confidence === null) {
            return toMcpErrorResult(
              `sources[${i}].confidence 必须是 [0, 1] 范围的数字（收到: ${String(confidenceRaw)}）`
            )
          }
          massFunctions.push(confidenceToMass(sourceId, sourceName, confidence))
        }

        // 调用融合引擎
        const engine = getFusionEngine()
        const assessment = engine.fuseAndAssess(massFunctions)

        return toMcpTextResult({
          belief: assessment.belief,
          plausibility: assessment.plausibility,
          confidence: assessment.confidence,
          uncertainty: assessment.uncertainty,
          conflictLevel: assessment.conflictLevel,
          ruleUsed: assessment.ruleUsed,
          sourceCount: assessment.sources.length,
          sources: assessment.sources,
          fusionSteps: assessment.fusionSteps.map((s) => ({
            step: s.step,
            ruleUsed: s.ruleUsed,
            leftSourceId: s.leftSourceId,
            rightSourceId: s.rightSourceId,
            conflict: s.conflict,
            resultBelief: s.resultBelief,
            resultPlausibility: s.resultPlausibility,
          })),
        })
      },
    },

    // ── 2. decision_history ───────────────────────────────────────
    {
      meta: {
        name: 'decision_history',
        description:
          '查询历史决策卡片（按问题/假设/修复命令全文检索，FTS5 BM25 排序 + LIKE 降级）。返回卡片精简信息列表。',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词（必填）' },
            limit: {
              type: 'number',
              description: '返回数量上限（默认 10，最大 50）',
            },
          },
          required: ['query'],
        },
      },
      call: async (args) => {
        const query = requireNonString(args.query, 'query')
        if (!query) {
          return toMcpErrorResult('参数 query 必填且为非空字符串')
        }
        if (!db) {
          return toMcpErrorResult('数据库未初始化，无法查询决策历史')
        }
        const limitRaw = typeof args.limit === 'number' ? args.limit : 10
        const limit = Math.max(1, Math.min(50, Math.floor(limitRaw)))

        const repo = new DecisionRepository(db)
        const results = repo.search(query).slice(0, limit)
        return toMcpTextResult({
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
            sessionId: c.sessionId,
          })),
        })
      },
    },
  ]
}

/** 决策域工具名清单 */
export const CREDIBILITY_TOOL_NAMES = [
  'credibility_assess',
  'decision_history',
] as const

/** 决策域工具元数据（用于 listRegisteredTools 展示） */
export const CREDIBILITY_TOOL_METAS: Array<{ name: string; description: string }> = [
  { name: 'credibility_assess', description: '多源证据融合评估可信度（D-S + PCR5）' },
  { name: 'decision_history', description: '查询历史决策卡片（FTS5 全文检索）' },
]
