/**
 * Credibility IPC Handlers（v0.9 新增 + v0.9.6 P1 扩展 + v0.9.6 P2 扩展）
 *
 * 注册 v0.9 引入的可信度算法（D-S 证据理论 + PCR5 冲突融合）相关 IPC 通道。
 * v0.9.6 P1 扩展：注册 ECE 校准器相关 IPC 通道（CalibrationTuner）。
 * v0.9.6 P2 扩展：注册 EU AI Act 审计报告导出 IPC 通道。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - credibility:assess — 评估给定证据集的可信度（返回 ConfidenceAssessment）
 * - credibility:dag    — 获取 DAG 可视化数据（返回 DagData）
 * - credibility:calibrate — 触发指定 Provider 的 Temperature Scaling 校准
 * - credibility:get-calibration — 获取指定 Provider 的当前校准状态
 * - credibility:get-calibration-state — 获取全局校准状态（持久化）
 * - credibility:reset-calibration — 重置指定 Provider 的校准
 * - credibility:compute-ece — 计算指定 Provider 的当前 ECE（不修改 T）
 * - credibility:add-calibration-sample — 记录新的校准样本（自动入库）
 * - credibility:export-audit-report — 导出 EU AI Act 合规审计报告（v0.9.6 P2）
 * - credibility:list-audit-reports — 列出已落盘的审计报告（v0.9.6 P2）
 * - credibility:load-audit-report — 加载已落盘的审计报告（v0.9.6 P2）
 *
 * 证据源输入格式（CredibilityEvidenceInput）：
 *   { sourceId: 'log', fields: { drainMatch: 0.85, sourcePrior: 0.6 } }
 *
 * 校准通道论文支撑（Guo et al. 2017, ICML, arXiv:1706.04599）：
 *   不同 LLM（DeepSeek / Claude / GPT / Ollama）应使用不同 Temperature Scaling 参数 T。
 *   校准状态按 Provider 隔离，持久化到 calibration-state.json。
 *
 * 审计报告通道法规支撑：
 *   - EU AI Act 2026 Art.11/12/13/14/15
 *   - NIST AI RMF 1.0
 *   - NIST AI 600-1 GenAI Profile
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
 *           + v0.9.6 P1 §ECE 校准器 + v0.9.6 P2 §EU AI Act 审计报告
 */

import { ipcMain } from 'electron'
import type { MassFunction } from '../core/agent/credibility/ds-theory'
import { getFusionEngine } from '../core/agent/credibility/fusion-engine'
import { generateDagData } from '../core/agent/credibility/visualizer'
import { createLogMassFunction } from '../core/agent/credibility/mass-functions/log-source'
import { createKbMassFunction } from '../core/agent/credibility/mass-functions/kb-source'
import { createAiParamMassFunction } from '../core/agent/credibility/mass-functions/ai-param-source'
import { createHumanMassFunction } from '../core/agent/credibility/mass-functions/human-source'
import { createHistoryMassFunction } from '../core/agent/credibility/mass-functions/history-source'
import { createBestPracticeMassFunction } from '../core/agent/credibility/mass-functions/best-practice-source'
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
import type {
  CredibilityEvidenceInput,
  ConfidenceAssessment,
  DagData,
  SerializableMassFunction,
} from '@shared/agent-types'
import { logger } from '../services/log/logger'

// ============================================================================
// 辅助函数：字段提取
// ============================================================================

/**
 * 从 fields 中获取必填 number 字段
 * @throws {Error} 字段缺失或类型错误时抛出
 */
function getRequiredNumber(fields: Record<string, number | boolean | number[]>, key: string): number {
  const val = fields[key]
  if (typeof val !== 'number') {
    throw new Error(`证据字段 "${key}" 缺失或类型错误（期望 number，实际 ${typeof val}）`)
  }
  return val
}

/**
 * 从 fields 中获取可选 number 字段
 */
function getOptionalNumber(
  fields: Record<string, number | boolean | number[]>,
  key: string
): number | undefined {
  const val = fields[key]
  return typeof val === 'number' ? val : undefined
}

/**
 * 从 fields 中获取必填 boolean 字段
 * @throws {Error} 字段缺失或类型错误时抛出
 */
function getRequiredBoolean(
  fields: Record<string, number | boolean | number[]>,
  key: string
): boolean {
  const val = fields[key]
  if (typeof val !== 'boolean') {
    throw new Error(`证据字段 "${key}" 缺失或类型错误（期望 boolean，实际 ${typeof val}）`)
  }
  return val
}

/**
 * 从 fields 中获取可选 number[] 字段（v0.9.6 P2 M5+ 新增）
 *
 * 用于 cotEntropyTrajectory 等序列证据。
 * 不存在返回 undefined；类型错误时抛错（区别于静默忽略）。
 */
function getOptionalNumberArray(
  fields: Record<string, number | boolean | number[]>,
  key: string
): number[] | undefined {
  const val = fields[key]
  if (val === undefined) return undefined
  if (!Array.isArray(val) || !val.every((v) => typeof v === 'number')) {
    throw new Error(
      `证据字段 "${key}" 类型错误（期望 number[]，实际 ${typeof val}）`
    )
  }
  return val
}

// ============================================================================
// 辅助函数：Mass 函数创建分发
// ============================================================================

/**
 * 根据 CredibilityEvidenceInput 创建对应的 Mass 函数
 *
 * 根据 sourceId 分发到对应的 mass function 工厂：
 * - log → createLogMassFunction
 * - kb → createKbMassFunction
 * - ai-param → createAiParamMassFunction
 * - human → createHumanMassFunction
 * - history → createHistoryMassFunction
 * - best-practice → createBestPracticeMassFunction
 *
 * @param input - 证据源输入
 * @returns 对应的 Mass 函数
 * @throws {Error} 未知 sourceId 或字段缺失时抛出
 */
function createMassFunctionFromInput(input: CredibilityEvidenceInput): MassFunction {
  const f = input.fields

  switch (input.sourceId) {
    case 'log':
      return createLogMassFunction({
        drainMatch: getRequiredNumber(f, 'drainMatch'),
        sourcePrior: getOptionalNumber(f, 'sourcePrior'),
      })

    case 'kb':
      return createKbMassFunction({
        hasResults: getRequiredBoolean(f, 'hasResults'),
        topScore: getOptionalNumber(f, 'topScore'),
        avgScore: getOptionalNumber(f, 'avgScore'),
      })

    case 'ai-param':
      return createAiParamMassFunction({
        verbalizedConfidence: getRequiredNumber(f, 'verbalizedConfidence'),
        logprobConfidence: getOptionalNumber(f, 'logprobConfidence'),
        consistency: getOptionalNumber(f, 'consistency'),
        // v0.9.6 P2 M5+：透传 CoT 熵轨迹
        cotEntropyTrajectory: getOptionalNumberArray(f, 'cotEntropyTrajectory'),
      })

    case 'human':
      return createHumanMassFunction({
        hasAnnotations: getRequiredBoolean(f, 'hasAnnotations'),
        positiveRate: getOptionalNumber(f, 'positiveRate'),
        agreement: getOptionalNumber(f, 'agreement'),
      })

    case 'history':
      return createHistoryMassFunction({
        hasCases: getRequiredBoolean(f, 'hasCases'),
        weightedSuccessRate: getOptionalNumber(f, 'weightedSuccessRate'),
      })

    case 'best-practice':
      return createBestPracticeMassFunction({
        hasMatches: getRequiredBoolean(f, 'hasMatches'),
        positiveRate: getOptionalNumber(f, 'positiveRate'),
        negativeRate: getOptionalNumber(f, 'negativeRate'),
      })

    default: {
      // 穷尽性检查（exhaustive check）
      const exhaustive: never = input.sourceId
      throw new Error(`未知的证据来源 ID: ${String(exhaustive)}`)
    }
  }
}

// ============================================================================
// 辅助函数：序列化
// ============================================================================

/**
 * 将内部 Mass 函数（Map-based）序列化为可 IPC 传输的形式（Array-based）
 *
 * @param mf - 内部 Mass 函数
 * @returns 序列化后的 Mass 函数
 */
function serializeMassFunction(mf: MassFunction): SerializableMassFunction {
  return {
    sourceId: mf.sourceId,
    sourceName: mf.sourceName,
    confidence: mf.confidence,
    focalElements: Array.from(mf.focalElements.entries())
      .map(([elements, mass]) => ({ elements, mass }))
      .sort((a, b) => b.mass - a.mass), // 按质量降序
  }
}

/**
 * 将证据源输入列表转换为 Mass 函数列表
 *
 * @param inputs - 证据源输入列表
 * @returns Mass 函数列表
 */
function createMassFunctionsFromInputs(inputs: CredibilityEvidenceInput[]): MassFunction[] {
  return inputs.map((input) => createMassFunctionFromInput(input))
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
 */
export function registerCredibilityHandlers(): void {
  // ------------------------------------------------------------------
  // credibility:assess — 评估给定证据集的可信度
  // ------------------------------------------------------------------
  // 参数：(inputs: CredibilityEvidenceInput[])
  // 返回：ConfidenceAssessment（含信任区间、综合可信度、冲突程度、融合步骤）
  ipcMain.handle(
    'credibility:assess',
    async (_event, inputs: CredibilityEvidenceInput[]): Promise<ConfidenceAssessment> => {
      try {
        logger.info('IPC.CREDIBILITY', `credibility:assess 启动`, {
          sourceCount: inputs?.length ?? 0,
          sourceIds: inputs?.map((i) => i.sourceId) ?? [],
        })

        if (!inputs || inputs.length === 0) {
          throw new Error('证据源列表为空，至少需要一个证据源')
        }

        // 1. 创建 Mass 函数列表
        const massFunctions = createMassFunctionsFromInputs(inputs)

        // 2. 融合并评估
        const engine = getFusionEngine()
        const internalAssessment = engine.fuseAndAssess(massFunctions)

        // 3. 序列化为共享类型（将 Map-based MassFunction 转为 Array-based）
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
  // v0.9.6 P1：ECE 校准器 IPC handlers
  // ---------------------------------------------------------------------
  // 论文支撑：Guo, Pleiss, Sun, Weinberger 2017, "On Calibration of Modern
  //   Neural Networks", ICML, arXiv:1706.04599 §3.1
  //   不同 LLM（DeepSeek / Claude / GPT / Ollama）应使用不同 T 值。
  // =====================================================================

  // ------------------------------------------------------------------
  // credibility:calibrate — 触发指定 Provider 的重新校准
  // ------------------------------------------------------------------
  // 参数：(providerId: string, options?: OptimizeTOptions)
  // 返回：TemperatureScalingResult（最优 T、ECE 改善、searchTrace 等）
  // 设计：基于当前已收集的 CalibrationSample 网格搜索最优 T
  ipcMain.handle(
    'credibility:calibrate',
    async (
      _event,
      providerId: ProviderId,
      options?: OptimizeTOptions
    ): Promise<TemperatureScalingResult> => {
      try {
        logger.info('IPC.CREDIBILITY', `credibility:calibrate 启动`, {
          providerId,
          options,
        })
        const tuner = getCalibrationTuner()
        const result = tuner.tuneProvider(providerId, options ?? {})
        logger.info('IPC.CREDIBILITY', `credibility:calibrate 完成`, {
          providerId,
          optimalT: result.optimalT.toFixed(4),
          eceBefore: result.eceBefore.toFixed(4),
          eceAfter: result.eceAfter.toFixed(4),
          sampleCount: result.sampleCount,
        })
        return result
      } catch (err) {
        const msg = (err as Error)?.message ?? '校准失败'
        logger.error('IPC.CREDIBILITY', `credibility:calibrate 失败: ${msg}`)
        throw new Error(`可信度校准失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // credibility:get-calibration — 获取指定 Provider 的当前校准状态
  // ------------------------------------------------------------------
  // 参数：(providerId: string)
  // 返回：ProviderCalibration（optimalT / lastCalibratedAt / sampleCount / ece）
  // 设计：未校准过的 Provider 返回 optimalT = defaultT = 1.0
  ipcMain.handle(
    'credibility:get-calibration',
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
  // credibility:get-calibration-state — 获取全局校准状态（持久化）
  // ------------------------------------------------------------------
  // 参数：()
  // 返回：CalibrationState（含所有 Provider 校准表 + defaultT）
  ipcMain.handle(
    'credibility:get-calibration-state',
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
  // credibility:reset-calibration — 重置指定 Provider 的校准
  // ------------------------------------------------------------------
  // 参数：(providerId: string)
  // 返回：boolean（是否成功重置）
  ipcMain.handle(
    'credibility:reset-calibration',
    async (_event, providerId: ProviderId): Promise<boolean> => {
      try {
        logger.info('IPC.CREDIBILITY', `credibility:reset-calibration 启动`, { providerId })
        const tuner = getCalibrationTuner()
        const ok = tuner.resetProvider(providerId)
        logger.info('IPC.CREDIBILITY', `credibility:reset-calibration 完成`, {
          providerId,
          reset: ok,
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
  // 参数：(providerId: string, numBuckets?: number)
  // 返回：EceResult（ECE / MCE / 各桶统计 / 总样本数）
  // 设计：用于 UI 实时展示校准质量，不触发重新校准
  ipcMain.handle(
    'credibility:compute-ece',
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
  // credibility:add-calibration-sample — 记录新的校准样本
  // ------------------------------------------------------------------
  // 参数：(sample: CalibrationSample)
  // 返回：boolean（是否成功入库）
  // 设计：UI 决策卡状态变为 'verified' 时回灌，触发 ECE/T 更新
  ipcMain.handle(
    'credibility:add-calibration-sample',
    async (_event, sample: CalibrationSample): Promise<boolean> => {
      try {
        logger.info('IPC.CREDIBILITY', `credibility:add-calibration-sample 启动`, {
          decisionId: sample.decisionId,
          providerId: sample.providerId,
          reportedConfidence: sample.reportedConfidence,
          wasCorrect: sample.wasCorrect,
        })
        const tuner = getCalibrationTuner()
        tuner.addSample(sample)
        return true
      } catch (err) {
        const msg = (err as Error)?.message ?? '记录校准样本失败'
        logger.error('IPC.CREDIBILITY', `credibility:add-calibration-sample 失败: ${msg}`)
        throw new Error(`记录校准样本失败: ${msg}`)
      }
    }
  )

  // =====================================================================
  // v0.9.6 P2：EU AI Act 合规审计报告 IPC handlers
  // ---------------------------------------------------------------------
  // 法规依据：
  //   - EU AI Act 2026（Regulation 2024/1689）Art.11/12/13/14/15/19
  //   - NIST AI RMF 1.0（AI 100-1）
  //   - NIST AI 600-1 GenAI Profile（2024-07-26）
  // 设计：将 report-builder + exporter 暴露给渲染层 + CLI
  // =====================================================================

  // ------------------------------------------------------------------
  // credibility:export-audit-report — 导出合规审计报告
  // ------------------------------------------------------------------
  // 参数：(input: AuditReportInput, options?: ExportOptions)
  // 返回：ExportResult（含 reportId / fingerprint / 文件路径 / 字节数）
  // 设计：默认 JSON 格式；支持 writeAllFormats 一次导出 JSON+MD+HTML
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

  logger.info('IPC.CREDIBILITY', `Credibility IPC handlers 已注册`, {
    channels: [
      'credibility:assess',
      'credibility:dag',
      'credibility:calibrate',
      'credibility:get-calibration',
      'credibility:get-calibration-state',
      'credibility:reset-calibration',
      'credibility:compute-ece',
      'credibility:add-calibration-sample',
      'credibility:export-audit-report',
      'credibility:list-audit-reports',
      'credibility:load-audit-report',
      'credibility:format-audit-report',
    ],
  })
}
