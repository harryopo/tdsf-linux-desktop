/**
 * MCP 工具注册表 - 决策域（v2.0 Phase F.3）
 *
 * 3 个决策域工具，复用现有可信度融合引擎 + 校准器 + 决策历史仓储：
 * 1. credibility_assess    - 多源证据融合评估（D-S + PCR5 + ECE 校准）
 * 2. credibility_calibrate - Provider 校准（基于历史样本计算最优 T）
 * 3. decision_history      - 决策卡片历史查询（FTS5 全文检索 + LIKE 降级）
 *
 * 论文支撑：
 * - Dempster-Shafer 证据理论（Dempster 1967, Shafer 1976）
 * - PCR5 冲突融合（Smets 2007）
 * - ECE + Temperature Scaling（Guo et al. 2017, arXiv:1706.04599）
 */
import {
  createMassFunction,
  TRUSTED,
  UNTRUSTED,
} from '../../../core/agent/credibility/ds-theory'
import { getFusionEngine } from '../../../core/agent/credibility/fusion-engine'
import { getCalibrationTuner } from '../../../core/agent/credibility/calibration/calibration-tuner'
import type { FuseAssessOptions } from '../../../core/agent/credibility/fusion-engine'
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
 * 创建决策域 3 个 MCP 工具
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
          '多源证据融合评估可信度（D-S 证据理论 + PCR5 冲突融合 + Temperature Scaling 校准）。输入证据源列表（含 confidence），返回信任区间 [Bel, Pl]、综合可信度、冲突程度、ECE 报告。',
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
            providerId: {
              type: 'string',
              description: 'LLM Provider ID（可选，用于按 Provider 查找 T 值）',
            },
            applyCalibration: {
              type: 'boolean',
              description: '是否应用 Temperature Scaling 校准（默认 true）',
            },
            includeEceReport: {
              type: 'boolean',
              description: '是否附加 ECE 评估报告（默认 true）',
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

        // 构造评估选项
        const options: FuseAssessOptions = {
          applyCalibration: args.applyCalibration !== false,
          includeEceReport: args.includeEceReport !== false,
        }
        if (typeof args.providerId === 'string' && args.providerId) {
          options.providerId = args.providerId
        }

        // 调用融合引擎
        const engine = getFusionEngine()
        const assessment = engine.fuseAndAssess(massFunctions, options)

        return toMcpTextResult({
          belief: assessment.belief,
          plausibility: assessment.plausibility,
          confidence: assessment.confidence,
          calibratedConfidence: assessment.calibratedConfidence,
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
          eceReport: assessment.eceReport
            ? {
                ece: assessment.eceReport.ece,
                mce: assessment.eceReport.mce,
                numBuckets: assessment.eceReport.numBuckets,
                totalSamples: assessment.eceReport.totalSamples,
                providerId: assessment.eceReport.providerId,
              }
            : undefined,
        })
      },
    },

    // ── 2. credibility_calibrate ──────────────────────────────────
    {
      meta: {
        name: 'credibility_calibrate',
        description:
          '校准指定 LLM Provider 的置信度（基于历史样本计算最优 Temperature Scaling 参数 T）。返回校准前/后 ECE、最优 T、改善幅度。也可只查询当前 ECE 不修改 T。',
        inputSchema: {
          type: 'object',
          properties: {
            providerId: {
              type: 'string',
              description: 'LLM Provider ID（如 deepseek/claude/openai/ollama）',
            },
            mode: {
              type: 'string',
              enum: ['tune', 'query'],
              description:
                'tune=触发重新校准（修改 T），query=只查询当前 ECE 不修改（默认 query）',
            },
            numBuckets: {
              type: 'number',
              description: 'ECE 分桶数（默认 10，最大 20）',
            },
          },
          required: ['providerId'],
        },
      },
      call: async (args) => {
        const providerId = requireNonString(args.providerId, 'providerId')
        if (!providerId) {
          return toMcpErrorResult('参数 providerId 必填且为非空字符串')
        }
        const mode = args.mode === 'tune' ? 'tune' : 'query'
        const numBucketsRaw = typeof args.numBuckets === 'number' ? args.numBuckets : 10
        const numBuckets = Math.max(1, Math.min(20, Math.floor(numBucketsRaw)))

        const tuner = getCalibrationTuner()
        const sampleCount = tuner.getSampleCount(providerId)
        const beforeCalibration = tuner.getProviderCalibration(providerId)

        if (mode === 'query') {
          // 查询模式：只计算当前 ECE，不修改 T
          const ece = tuner.computeEce(providerId, numBuckets)
          return toMcpTextResult({
            mode: 'query',
            providerId,
            sampleCount,
            currentT: beforeCalibration.optimalT,
            lastCalibratedAt: beforeCalibration.lastCalibratedAt || undefined,
            eceBefore: beforeCalibration.eceBefore || undefined,
            eceAfter: beforeCalibration.eceAfter || undefined,
            currentEce: {
              ece: ece.ece,
              mce: ece.mce,
              numBuckets: ece.numBuckets,
              totalSamples: ece.totalSamples,
              buckets: ece.bucketStats.map((b) => ({
                range: `[${b.bucketLower.toFixed(2)}, ${b.bucketUpper.toFixed(2)})`,
                avgConfidence: b.avgConfidence,
                accuracy: b.accuracy,
                calibrationGap: b.calibrationGap,
                count: b.count,
              })),
            },
          })
        }

        // tune 模式：触发重新校准
        if (sampleCount < 20) {
          return toMcpTextResult({
            mode: 'tune',
            providerId,
            sampleCount,
            success: false,
            message: `样本数不足（${sampleCount} < 20），无法触发重新校准`,
          })
        }

        const result = tuner.tuneProvider(providerId, { numBuckets })
        return toMcpTextResult({
          mode: 'tune',
          providerId,
          sampleCount,
          success: true,
          optimalT: result.optimalT,
          eceBefore: result.eceBefore,
          eceAfter: result.eceAfter,
          improvement: result.improvement,
          searchTrace: result.searchTrace.map((t) => ({
            t: t.t,
            ece: t.ece,
            nll: t.nll,
          })),
          calibratedAt: result.calibratedAt,
          message: `校准完成：T=${result.optimalT.toFixed(4)}, ECE ${result.eceBefore.toFixed(4)} → ${result.eceAfter.toFixed(4)} (改善 ${(result.improvement * 100).toFixed(2)}%)`,
        })
      },
    },

    // ── 3. decision_history ───────────────────────────────────────
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
  'credibility_calibrate',
  'decision_history',
] as const

/** 决策域工具元数据（用于 listRegisteredTools 展示） */
export const CREDIBILITY_TOOL_METAS: Array<{ name: string; description: string }> = [
  { name: 'credibility_assess', description: '多源证据融合评估可信度（D-S + PCR5 + ECE 校准）' },
  { name: 'credibility_calibrate', description: '校准指定 LLM Provider 的置信度（Temperature Scaling）' },
  { name: 'decision_history', description: '查询历史决策卡片（FTS5 全文检索）' },
]
