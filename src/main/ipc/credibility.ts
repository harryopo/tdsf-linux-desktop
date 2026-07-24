/**
 * Credibility IPC Handlers（v0.9 新增 + v0.9.6 P2 扩展）
 *
 * 注册 v0.9 引入的可信度算法（D-S 证据理论 + PCR5 冲突融合）相关 IPC 通道。
 * v0.9.6 P2 扩展：注册审计报告导出 IPC 通道。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - credibility:assess — 评估给定证据集的可信度（返回 ConfidenceAssessment）
 * - credibility:dag    — 获取 DAG 可视化数据（返回 DagData）
 * - credibility:export-audit-report — 导出审计报告（v0.9.6 P2）
 * - credibility:list-audit-reports — 列出已落盘的审计报告（v0.9.6 P2）
 * - credibility:load-audit-report — 加载已落盘的审计报告（v0.9.6 P2）
 * - credibility:format-audit-report — 仅格式化审计报告（v0.9.6 P2）
 *
 * 证据源输入格式（CredibilityEvidenceInput）：
 *   { sourceId: 'log', fields: { drainMatch: 0.85, sourcePrior: 0.6 } }
 *
 * 审计报告通道法规支撑：
 *   - NIST AI RMF 1.0
 *   - NIST AI 600-1 GenAI Profile
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
 *           + v0.9.6 P2 §审计报告
 */

import { ipcMain } from 'electron'
import { getFusionEngine } from '../core/agent/credibility/fusion-engine'
// v2.4 Phase C 收尾：assess handler 透传 options 参数
import type { FuseAssessOptions } from '../core/agent/credibility/fusion-engine'
import { generateDagData } from '../core/agent/credibility/visualizer'
import type {
  CredibilityEvidenceInput,
  ConfidenceAssessment,
  DagData,
} from '@shared/agent-types'
import { logger } from '../services/log/logger'
import { ConfigStore } from '../services/storage/config-store'
// 辅助函数从 credibility-helpers.ts 导入（保持主文件 ≤500 行）
import {
  createMassFunctionsFromInputs,
  serializeMassFunction,
  applyWeightsToMassFunctions,
} from './credibility-helpers'
// v2.3.2 新增：简化导出 HTML 报告所需
import { CREDIBILITY } from '@shared/ipc-channels'
import type { DatabaseManager } from '../services/db/database'
import type { DecisionCard, EvidenceSource, RiskLevel } from '@shared/models'
import type { AuditSourceEvidence } from '../core/agent/credibility/audit/types'
// v2.4 Phase C 收尾：校准模块 import（6 个 IPC handler 所需）
import { getCalibrationTuner } from '../core/agent/credibility/calibration/calibration-tuner'
import type {
  CalibrationSample,
  CalibrationState,
  EceResult,
  OptimizeTOptions,
  ProviderCalibration,
  ProviderId,
  TemperatureScalingResult,
} from '../core/agent/credibility/calibration/types'

// ============================================================================
// v2.3.2 辅助：EvidenceSource → 6 源审计 ID 映射
// ============================================================================
/**
 * EvidenceSource（业务侧 5 类）→ AuditSourceEvidence.sourceId（审计侧 6 类）映射
 *
 * 业务侧来源（@shared/models.EvidenceSource）：
 *   log / metric / command / config / knowledge
 *
 * 审计侧 6 源 ID（EU AI Act Art.10 + 可信度算法 6 源融合）：
 *   S1-log / S2-knowledge / S3-ai-param / S4-human / S5-history / S6-best-practice
 *
 * 映射规则：
 *   - log       → S1-log（日志源直接对齐）
 *   - knowledge → S2-knowledge（知识库直接对齐）
 *   - metric    → S3-ai-param（指标作为 AI 参数化输入）
 *   - command   → S4-human（命令通常由人工触发）
 *   - config    → S6-best-practice（配置项参考最佳实践）
 *   - 缺失/未知 → 按 idx 兜底循环（含 S5-history）
 */
const EVIDENCE_SOURCE_MAP: Record<EvidenceSource, AuditSourceEvidence['sourceId']> = {
  log: 'S1-log',
  knowledge: 'S2-knowledge',
  metric: 'S3-ai-param',
  command: 'S4-human',
  config: 'S6-best-practice',
}

const FALLBACK_SOURCE_IDS: AuditSourceEvidence['sourceId'][] = [
  'S1-log',
  'S2-knowledge',
  'S3-ai-param',
  'S4-human',
  'S5-history',
  'S6-best-practice',
]

/**
 * 将业务侧 EvidenceSource 映射为审计侧 6 源 ID
 * @param source 业务侧证据来源（可能为 undefined）
 * @param idx 证据序号（兜底用）
 * @returns 6 源审计 ID
 */
function mapEvidenceToSourceId(
  source: EvidenceSource | undefined,
  idx: number,
): AuditSourceEvidence['sourceId'] {
  if (source && EVIDENCE_SOURCE_MAP[source]) {
    return EVIDENCE_SOURCE_MAP[source]
  }
  return FALLBACK_SOURCE_IDS[idx % FALLBACK_SOURCE_IDS.length]
}

/**
 * 判断风险等级是否为高风险（HIGH / CRITICAL）
 *
 * RiskLevel 类型为 `'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'`（大写），
 * 不能直接与字面量 `'high'` / `'critical'` 比较。
 *
 * @param level 风险等级（可能为 undefined）
 * @returns true 表示高风险
 */
function isHighRiskLevel(level: RiskLevel | undefined): boolean {
  return level === 'HIGH' || level === 'CRITICAL'
}

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册 Credibility IPC handlers
 *
 * 注册以下通道：
 * - credibility:assess — 评估给定证据集的可信度
 * - credibility:dag    — 获取 DAG 可视化数据
 * - credibility:export-decision-html — 按 decisionId 简化导出 HTML 报告（v2.3.2 新增）
 *
 * @param db 数据库管理器（v2.3.2 新增：简化导出 HTML 报告时查询 DecisionCard）
 */
export function registerCredibilityHandlers(db?: DatabaseManager): void {
  // ------------------------------------------------------------------
  // credibility:assess — 评估给定证据集的可信度
  // ------------------------------------------------------------------
  // 参数：(inputs: CredibilityEvidenceInput[], options?: FuseAssessOptions)
  // 返回：ConfidenceAssessment（含信任区间、综合可信度、冲突程度、融合步骤）
  // v2.4 Phase C：options 透传给 fuseAndAssess，支持 Temperature Scaling 校准
  // v2.4 Phase D5：6 源权重通过 Shafer Discounting 在融合前应用（替代旧版线性调整）
  //   论文支撑：Shafer 1976, "A Mathematical Theory of Evidence", Chapter 9 §Discounting
  //   修复 P1-7：旧版在融合结果上叠加线性系数违反 D-S 公理，现改为融合前折扣
  ipcMain.handle(
    'credibility:assess',
    async (
      _event,
      inputs: CredibilityEvidenceInput[],
      options?: FuseAssessOptions
    ): Promise<ConfidenceAssessment> => {
      try {
        logger.info('IPC.CREDIBILITY', `credibility:assess 启动`, {
          sourceCount: inputs?.length ?? 0,
          sourceIds: inputs?.map((i) => i.sourceId) ?? [],
          applyCalibration: options?.applyCalibration ?? false,
          providerId: options?.providerId,
        })

        if (!inputs || inputs.length === 0) {
          throw new Error('证据源列表为空，至少需要一个证据源')
        }

        // 1. 创建 Mass 函数列表
        const massFunctions = createMassFunctionsFromInputs(inputs)

        // 2. 应用 6 源权重折扣（Shafer Discounting，融合前应用）
        //    论文支撑：Shafer 1976, "A Mathematical Theory of Evidence", Chapter 9 §Discounting
        //    读取 ConfigStore 的 decision.weights，按业务侧 ID 映射到算法侧 sourceId，
        //    对每个 Mass 函数独立折扣（w·m(A) for A≠Θ, w·m(Θ)+(1-w) for Θ）。
        //    替代旧版"在融合结果上叠加线性调整"的降级方案（P1-7 修复）。
        //    读取/应用失败时降级到无权重融合（不阻塞评估）。
        let weightedMassFunctions = massFunctions
        try {
          const weightsConfig = (ConfigStore.get('decision.weights') ?? {}) as Record<string, unknown>
          weightedMassFunctions = applyWeightsToMassFunctions(massFunctions, weightsConfig)
          if (weightedMassFunctions !== massFunctions) {
            logger.info('IPC.CREDIBILITY', `credibility:assess 应用 Shafer Discounting 权重`, {
              sourceCount: massFunctions.length,
              weightsConfigKeys: Object.keys(weightsConfig),
            })
          }
        } catch (weightErr) {
          // 权重应用失败时降级到无权重融合（不阻塞评估）
          logger.warn('IPC.CREDIBILITY', `credibility:assess 应用权重失败，降级到无权重融合`, {
            error: (weightErr as Error)?.message ?? String(weightErr),
          })
        }

        // 3. 融合并评估（v2.4 Phase C：透传 options 支持校准）
        //    使用折扣后的 Mass 函数列表作为融合输入
        const engine = getFusionEngine()
        const internalAssessment = engine.fuseAndAssess(weightedMassFunctions, options)

        // 4. 序列化为共享类型（将 Map-based MassFunction 转为 Array-based）
        //    v2.4 Phase C：透传 calibratedConfidence / eceReport（若有）
        const assessment: ConfidenceAssessment = {
          belief: internalAssessment.belief,
          plausibility: internalAssessment.plausibility,
          confidence: internalAssessment.confidence,
          uncertainty: internalAssessment.uncertainty,
          conflictLevel: internalAssessment.conflictLevel,
          ruleUsed: internalAssessment.ruleUsed,
          sources: internalAssessment.sources,
          fusionSteps: internalAssessment.fusionSteps,
          fusedMassFunction: serializeMassFunction(internalAssessment.fusedMassFunction),
          ...(internalAssessment.calibratedConfidence !== undefined
            ? { calibratedConfidence: internalAssessment.calibratedConfidence }
            : {}),
          ...(internalAssessment.eceReport !== undefined
            ? { eceReport: internalAssessment.eceReport }
            : {}),
        }

        logger.info('IPC.CREDIBILITY', `credibility:assess 完成`, {
          confidence: assessment.confidence.toFixed(4),
          belief: assessment.belief.toFixed(4),
          plausibility: assessment.plausibility.toFixed(4),
          conflictLevel: assessment.conflictLevel.toFixed(4),
          ruleUsed: assessment.ruleUsed,
          steps: assessment.fusionSteps.length,
        })

        return assessment
      } catch (err) {
        const msg = (err as Error)?.message ?? '可信度评估失败'
        logger.error('IPC.CREDIBILITY', `credibility:assess 失败: ${msg}`)
        throw new Error(`可信度评估失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:dag — 获取 DAG 可视化数据
  // ------------------------------------------------------------------
  // 参数：(inputs: CredibilityEvidenceInput[])
  // 返回：DagData（含节点和边，用于 React Flow 渲染）
  ipcMain.handle(
    'credibility:dag',
    async (_event, inputs: CredibilityEvidenceInput[]): Promise<DagData> => {
      try {
        logger.info('IPC.CREDIBILITY', `credibility:dag 启动`, {
          sourceCount: inputs?.length ?? 0,
        })

        if (!inputs || inputs.length === 0) {
          throw new Error('证据源列表为空，至少需要一个证据源')
        }

        // 1. 创建 Mass 函数列表
        const massFunctions = createMassFunctionsFromInputs(inputs)

        // 2. 融合（获取步骤追踪）
        const engine = getFusionEngine()
        const fusedResult = engine.fuse(massFunctions)
        const fusionSteps = engine.getLastFusionSteps()

        // 3. 生成 DAG 数据
        const dagData = generateDagData(massFunctions, fusedResult, fusionSteps)

        logger.info('IPC.CREDIBILITY', `credibility:dag 完成`, {
          nodes: dagData.nodes.length,
          edges: dagData.edges.length,
          fusionSteps: fusionSteps.length,
        })

        return dagData as DagData
      } catch (err) {
        const msg = (err as Error)?.message ?? 'DAG 数据生成失败'
        logger.error('IPC.CREDIBILITY', `credibility:dag 失败: ${msg}`)
        throw new Error(`DAG 数据生成失败: ${msg}`)
      }
    }
  )

  // =====================================================================
  // v2.4 Phase C 收尾：校准 IPC handlers（6 个）
  // ---------------------------------------------------------------------
  // 论文支撑：Guo et al. 2017 (ICML, arXiv:1706.04599) §3.2 Temperature Scaling
  // 设计：将 CalibrationTuner 暴露给渲染层，支持按 Provider 分类校准
  // 注意：getCalibrationTuner() 是单例懒加载，无样本时 tuneProvider 返回 T=1.0
  // =====================================================================

  // ------------------------------------------------------------------
  // credibility:calibrate — 校准指定 Provider（基于历史样本）
  // ------------------------------------------------------------------
  // 参数：(providerId: ProviderId, options?: OptimizeTOptions)
  // 返回：TemperatureScalingResult（含 optimalT / eceBefore / eceAfter / searchTrace）
  ipcMain.handle(
    CREDIBILITY.CALIBRATE,
    async (
      _event,
      providerId: ProviderId,
      options?: OptimizeTOptions
    ): Promise<TemperatureScalingResult> => {
      try {
        const tuner = getCalibrationTuner()
        const result = tuner.tuneProvider(providerId, options ?? {})
        logger.info('IPC.CREDIBILITY', `credibility:calibrate 完成`, {
          providerId,
          optimalT: result.optimalT,
          eceBefore: result.eceBefore,
          eceAfter: result.eceAfter,
        })
        return result
      } catch (err) {
        const msg = (err as Error)?.message ?? '校准失败'
        logger.error('IPC.CREDIBILITY', `credibility:calibrate 失败: ${msg}`)
        throw new Error(`校准失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:get-calibration — 获取指定 Provider 的当前校准状态
  // ------------------------------------------------------------------
  // 参数：(providerId: ProviderId)
  // 返回：ProviderCalibration（未校准时返回 defaultT=1.0 的默认状态）
  ipcMain.handle(
    CREDIBILITY.GET_CALIBRATION,
    async (_event, providerId: ProviderId): Promise<ProviderCalibration> => {
      try {
        const tuner = getCalibrationTuner()
        return tuner.getProviderCalibration(providerId)
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取校准状态失败'
        logger.error('IPC.CREDIBILITY', `credibility:get-calibration 失败: ${msg}`)
        throw new Error(`获取校准状态失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:get-calibration-state — 获取全局校准状态
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：CalibrationState（含所有 Provider 的校准状态 + defaultT + updatedAt）
  ipcMain.handle(
    CREDIBILITY.GET_CALIBRATION_STATE,
    async (): Promise<CalibrationState> => {
      try {
        const tuner = getCalibrationTuner()
        return tuner.getState()
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取全局校准状态失败'
        logger.error('IPC.CREDIBILITY', `credibility:get-calibration-state 失败: ${msg}`)
        throw new Error(`获取全局校准状态失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:reset-calibration — 重置指定 Provider 的校准（T 回到 defaultT）
  // ------------------------------------------------------------------
  // 参数：(providerId: ProviderId)
  // 返回：boolean（true 表示已重置，false 表示该 Provider 未校准过）
  ipcMain.handle(
    CREDIBILITY.RESET_CALIBRATION,
    async (_event, providerId: ProviderId): Promise<boolean> => {
      try {
        const tuner = getCalibrationTuner()
        const ok = tuner.resetProvider(providerId)
        logger.info('IPC.CREDIBILITY', `credibility:reset-calibration`, {
          providerId,
          ok,
        })
        return ok
      } catch (err) {
        const msg = (err as Error)?.message ?? '重置校准失败'
        logger.error('IPC.CREDIBILITY', `credibility:reset-calibration 失败: ${msg}`)
        throw new Error(`重置校准失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:compute-ece — 计算指定 Provider 的当前 ECE（不修改 T）
  // ------------------------------------------------------------------
  // 参数：(providerId: ProviderId, numBuckets?: number)
  // 返回：EceResult（含 ece / mce / bucketStats / totalSamples）
  ipcMain.handle(
    CREDIBILITY.COMPUTE_ECE,
    async (
      _event,
      providerId: ProviderId,
      numBuckets?: number
    ): Promise<EceResult> => {
      try {
        const tuner = getCalibrationTuner()
        return tuner.computeEce(providerId, numBuckets)
      } catch (err) {
        const msg = (err as Error)?.message ?? '计算 ECE 失败'
        logger.error('IPC.CREDIBILITY', `credibility:compute-ece 失败: ${msg}`)
        throw new Error(`计算 ECE 失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:add-calibration-sample — 记录新的校准样本（内存操作，不持久化）
  // ------------------------------------------------------------------
  // 参数：(sample: CalibrationSample)
  // 返回：boolean（始终 true，失败抛错）
  ipcMain.handle(
    CREDIBILITY.ADD_CALIBRATION_SAMPLE,
    async (_event, sample: CalibrationSample): Promise<boolean> => {
      try {
        const tuner = getCalibrationTuner()
        tuner.addSample(sample)
        logger.info('IPC.CREDIBILITY', `credibility:add-calibration-sample`, {
          decisionId: sample.decisionId,
          providerId: sample.providerId,
        })
        return true
      } catch (err) {
        const msg = (err as Error)?.message ?? '添加校准样本失败'
        logger.error('IPC.CREDIBILITY', `credibility:add-calibration-sample 失败: ${msg}`)
        throw new Error(`添加校准样本失败: ${msg}`)
      }
    }
  )

  // =====================================================================
  // v0.9.6 P2：审计报告 IPC handlers
  // ---------------------------------------------------------------------
  // 法规依据：
  //   - NIST AI RMF 1.0（AI 100-1）
  //   - NIST AI 600-1 GenAI Profile（2024-07-26）
  // 设计：将 report-builder + exporter 暴露给渲染层 + CLI
  // =====================================================================

  // ------------------------------------------------------------------
  // credibility:export-audit-report — 导出合规审计报告
  // ------------------------------------------------------------------
  // 参数：(input: AuditReportInput, options?: ExportOptions)
  // 返回：ExportResult（含 reportId / fingerprint / 文件路径 / 字节数）
  // 设计：默认 JSON 格式；支持 writeAllFormats 一次导出 JSON+MD
  ipcMain.handle(
    'credibility:export-audit-report',
    async (
      _event,
      input: import('../core/agent/credibility/audit/types').AuditReportInput,
      options?: import('../core/agent/credibility/audit/exporter').ExportOptions
    ): Promise<import('../core/agent/credibility/audit/exporter').ExportResult> => {
      try {
        logger.info('IPC.CREDIBILITY', `credibility:export-audit-report 启动`, {
          decisionId: input.decisionContext.decisionId,
          format: options?.format,
          writeAllFormats: options?.writeAllFormats,
        })
        const { exportAuditReport } = await import(
          '../core/agent/credibility/audit/exporter'
        )
        const result = await exportAuditReport(input, options ?? {})
        logger.info('IPC.CREDIBILITY', `credibility:export-audit-report 完成`, {
          reportId: result.reportId,
          fingerprint: result.fingerprint,
          formats: result.formats,
          files: result.written.map((w) => ({ format: w.format, bytes: w.bytes })),
        })
        return result
      } catch (err) {
        const msg = (err as Error)?.message ?? '审计报告导出失败'
        logger.error('IPC.CREDIBILITY', `credibility:export-audit-report 失败: ${msg}`)
        throw new Error(`审计报告导出失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:list-audit-reports — 列出已落盘的审计报告
  // ------------------------------------------------------------------
  // 参数：(outputDir?: string)
  // 返回：AuditReportListItem[]（按决策时间倒序）
  ipcMain.handle(
    'credibility:list-audit-reports',
    async (
      _event,
      outputDir?: string
    ): Promise<import('../core/agent/credibility/audit/exporter').AuditReportListItem[]> => {
      try {
        const { listAuditReports } = await import(
          '../core/agent/credibility/audit/exporter'
        )
        return await listAuditReports(outputDir)
      } catch (err) {
        const msg = (err as Error)?.message ?? '列出审计报告失败'
        logger.error('IPC.CREDIBILITY', `credibility:list-audit-reports 失败: ${msg}`)
        throw new Error(`列出审计报告失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:load-audit-report — 加载已落盘的审计报告
  // ------------------------------------------------------------------
  // 参数：(filepath: string)
  // 返回：ComplianceAuditReport（从 JSON 重建）
  ipcMain.handle(
    'credibility:load-audit-report',
    async (
      _event,
      filepath: string
    ): Promise<import('../core/agent/credibility/audit/types').ComplianceAuditReport> => {
      try {
        const { loadAuditReport } = await import(
          '../core/agent/credibility/audit/exporter'
        )
        return await loadAuditReport(filepath)
      } catch (err) {
        const msg = (err as Error)?.message ?? '加载审计报告失败'
        logger.error('IPC.CREDIBILITY', `credibility:load-audit-report 失败: ${msg}`)
        throw new Error(`加载审计报告失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:format-audit-report — 仅格式化（不落盘），用于预览
  // ------------------------------------------------------------------
  // 参数：(input: AuditReportInput, format: AuditFormat)
  // 返回：string（序列化后的报告内容）
  ipcMain.handle(
    'credibility:format-audit-report',
    async (
      _event,
      input: import('../core/agent/credibility/audit/types').AuditReportInput,
      format: import('../core/agent/credibility/audit/types').AuditFormat
    ): Promise<string> => {
      try {
        const { buildAndFinalizeReport } = await import(
          '../core/agent/credibility/audit/report-builder'
        )
        const { formatReport } = await import(
          '../core/agent/credibility/audit/formatters'
        )
        const report = buildAndFinalizeReport(input)
        return formatReport(report, format)
      } catch (err) {
        const msg = (err as Error)?.message ?? '格式化审计报告失败'
        logger.error('IPC.CREDIBILITY', `credibility:format-audit-report 失败: ${msg}`)
        throw new Error(`格式化审计报告失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:export-decision-html — 按 decisionId 简化导出 HTML 报告（v2.3.2 新增）
  // ------------------------------------------------------------------
  // 参数：(decisionId: string, format: string)
  // 返回：写入的文件路径（string）
  // 设计：从 DecisionCard 构造简化 AuditReportInput，缺失字段用默认值填充，
  //       调用现有 exportAuditReport 导出 HTML 文件
  ipcMain.handle(
    CREDIBILITY.EXPORT_DECISION_HTML,
    async (_event, decisionId: string, format: string): Promise<string> => {
      try {
        if (!db) {
          throw new Error('数据库不可用，无法导出 HTML 报告')
        }
        if (!decisionId || typeof decisionId !== 'string') {
          throw new Error('decisionId 参数无效')
        }

        // 1. 从 DecisionRepository 查询 DecisionCard
        const { DecisionRepository } = await import('../services/db/decision-repo')
        const repo = new DecisionRepository(db)
        const card: DecisionCard | null = repo.getById(decisionId)
        if (!card) {
          throw new Error(`未找到决策记录 #${decisionId}`)
        }

        // 2. 构造简化 AuditReportInput（缺失字段用默认值填充）
        const auditFormat = format === 'markdown' ? 'markdown' : format === 'json' ? 'json' : 'html'
        const { exportAuditReport } = await import(
          '../core/agent/credibility/audit/exporter'
        )
        const input = buildSimplifiedAuditInput(card)
        const result = await exportAuditReport(input, { format: auditFormat })

        // 3. 返回第一个写入的文件路径
        const firstFile = result.written[0]?.filepath ?? ''
        logger.info('IPC.CREDIBILITY', `credibility:export-decision-html 完成`, {
          decisionId,
          format: auditFormat,
          reportId: result.reportId,
          filepath: firstFile,
        })
        return firstFile
      } catch (err) {
        const msg = (err as Error)?.message ?? '简化导出 HTML 报告失败'
        logger.error('IPC.CREDIBILITY', `credibility:export-decision-html 失败: ${msg}`)
        throw new Error(`简化导出 HTML 报告失败: ${msg}`)
      }
    }
  )

  logger.info('IPC.CREDIBILITY', `Credibility IPC handlers 已注册`, {
    channels: [
      'credibility:assess',
      'credibility:dag',
      'credibility:export-audit-report',
      'credibility:list-audit-reports',
      'credibility:load-audit-report',
      'credibility:format-audit-report',
      'credibility:export-decision-html',
      // v2.4 Phase C 收尾：校准 IPC 通道（6 个）
      'credibility:calibrate',
      'credibility:get-calibration',
      'credibility:get-calibration-state',
      'credibility:reset-calibration',
      'credibility:compute-ece',
      'credibility:add-calibration-sample',
    ],
  })
}

// ============================================================================
// v2.3.2 辅助函数：从 DecisionCard 构造简化 AuditReportInput
// ============================================================================

/**
 * 从 DecisionCard 构造简化 AuditReportInput
 *
 * 缺失字段（6 源证据 / 融合步骤 / 校准状态）用默认值填充：
 * - sourceEvidences: 从 card.evidences 派生（每条证据映射为一个源）
 * - confidenceAssessment: 从 card.confidence 派生
 * - calibration: null（未校准）
 * - humanOversight: 从 card.status 派生
 * - decisionAction: 从 card.fixCommand 派生
 *
 * @param card 决策卡片
 * @returns 简化 AuditReportInput（足够生成 HTML 报告）
 */
function buildSimplifiedAuditInput(card: DecisionCard): import('../core/agent/credibility/audit/types').AuditReportInput {
  const decisionTime = card.timestamp || Date.now()
  const decisionTimeIso = new Date(decisionTime).toISOString()
  const highRisk = isHighRiskLevel(card.risk?.level)
  return {
    decisionContext: {
      decisionId: card.id,
      decisionTitle: card.problem,
      decisionTime,
      decisionTimeIso,
      provider: 'TDSF Desktop',
      modelVersion: 'v1.0',
      deployer: 'local-user',
      intendedPurpose: 'Linux 运维决策辅助',
      knownLimitations: ['基于有限证据的启发式推理', '可能存在误报'],
      deployerContact: 'local-user@tdsf.local',
      domain: 'linux-ops',
      isHighRisk: highRisk,
    },
    sourceEvidences: card.evidences.map((ev, idx) => ({
      sourceId: mapEvidenceToSourceId(ev.source, idx),
      sourceName: ev.source || `证据 ${idx + 1}`,
      focalElements: { T: ev.confidence ?? 0.5, F: 1 - (ev.confidence ?? 0.5) },
      rawConfidence: ev.confidence ?? 0.5,
      calibratedConfidence: ev.confidence ?? 0.5,
      calibrationTemperature: 1.0,
      weight: 1 / Math.max(card.evidences.length, 1),
      inputData: { content: ev.content, source: ev.source },
      dataProvenance: ev.source || 'unknown',
      dataTimestamp: decisionTime,
    })),
    confidenceAssessment: {
      belief: card.confidence,
      plausibility: Math.min(card.confidence + 0.2, 1),
      confidence: card.confidence,
      uncertainty: Math.max(1 - card.confidence, 0),
      conflictLevel: 0,
      ruleUsed: 'dempster',
      fusionSteps: [],
    },
    calibration: null,
    humanOversight: {
      oversightMode: 'human-in-the-loop',
      approvalStatus:
        card.status === 'approved' || card.status === 'executed' || card.status === 'verified'
          ? 'approved'
          : card.status === 'rejected'
          ? 'rejected'
          : 'pending',
      approver: null,
      approvedAtIso: null,
      approverComment: null,
      triggeredHighRiskInterception: highRisk,
      interceptedCommandCount: card.status === 'rejected' ? 1 : 0,
    },
    decisionAction: {
      actionType: card.fixCommand ? 'command' : 'no-op',
      description: card.fixDescription || card.problem,
      command: card.fixCommand || null,
      sandboxResult: null,
      executionResult:
        card.status === 'executed' || card.status === 'verified'
          ? 'success'
          : card.status === 'failed'
          ? 'failed'
          : 'not-executed',
      executedAtIso:
        card.status === 'executed' || card.status === 'verified' ? decisionTimeIso : null,
      affectedResources: card.serverId ? [card.serverId] : [],
      isRollbackable: Boolean(card.rollbackCommand),
    },
    deployerContact: 'local-user@tdsf.local',
    domain: 'linux-ops',
    isHighRisk: highRisk,
  }
}
