/**
 * 审计报告导出器（v0.9.6 P2 M6）
 *
 * 职责：
 * 1. 构造合规审计报告（基于 DecisionCard + 校准状态）
 * 2. 序列化（JSON / Markdown / HTML）
 * 3. 落盘（默认 ~/.tdsf-linux/audit-reports/）
 * 4. 提供给 IPC / CLI 调用的统一入口
 *
 * 设计原则：
 * - 与 DecisionCard 集成：审计报告的 sourceEvidences / fusionResult 来自可信度评估
 * - 文件组织：按日期分组（YYYY-MM-DD/decisionId.{json,md,html}）
 * - 不可覆盖：相同 reportId 已存在时拒绝（除非 force=true）
 * - 自动生成 reportId + SHA-256 指纹
 *
 * 论文 / 法规依据：
 * - EU AI Act Art.11（technical documentation 必须 machine-readable）
 * - EU AI Act Art.12（自动日志保留 6 个月）
 * - NIST AI RMF MANAGE-3（持续监测与文档化）
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §7
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import {
  buildAndFinalizeReport,
  AUDIT_REPORT_SCHEMA_VERSION,
  AUDIT_GENERATOR_VERSION,
} from './report-builder'
import { formatReport, getFileExtension } from './formatters'
import type {
  AuditFormat,
  AuditReportInput,
  ComplianceAuditReport,
} from './types'

// ============================================================================
// 常量
// ============================================================================

/** 默认导出目录（~/.tdsf-linux/audit-reports/） */
export const DEFAULT_AUDIT_DIRNAME = 'audit-reports'

/** 子目录模板：YYYY-MM-DD */
const DATE_DIR_REGEX = /^\d{4}-\d{2}-\d{2}$/

// ============================================================================
// 路径解析
// ============================================================================

/**
 * 获取默认导出目录
 *
 * 优先级：
 * 1. app.getPath('userData')/audit-reports/（Electron 生产环境）
 * 2. ~/.tdsf-linux/audit-reports/（CLI / 测试环境）
 */
export function getDefaultAuditDir(): string {
  try {
    // Electron 环境
    const userData = app.getPath('userData')
    return path.join(userData, DEFAULT_AUDIT_DIRNAME)
  } catch {
    // 非 Electron 环境（CLI / 测试）
    return path.join(os.homedir(), '.tdsf-linux', DEFAULT_AUDIT_DIRNAME)
  }
}

/**
 * 根据决策时间构造报告目录路径
 *
 * @param baseDir - 基础目录（默认 ~/.tdsf-linux/audit-reports/）
 * @param decisionTime - 决策时间（Unix 毫秒）
 * @returns YYYY-MM-DD/decisionId 子目录
 */
export function getReportDir(baseDir: string, decisionTime: number, decisionId: string): string {
  if (!Number.isFinite(decisionTime) || Number.isNaN(decisionTime)) {
    throw new Error(`无效的决策时间: ${decisionTime}（非有限数值）`)
  }
  const date = new Date(decisionTime)
  let dateDir: string
  try {
    dateDir = date.toISOString().slice(0, 10) // YYYY-MM-DD
  } catch {
    throw new Error(`无效的决策时间: ${decisionTime}（Date 转换失败）`)
  }
  if (!DATE_DIR_REGEX.test(dateDir)) {
    throw new Error(`无效的决策时间: ${decisionTime}（YYYY-MM-DD 格式不匹配）`)
  }
  return path.join(baseDir, dateDir, sanitizeFilename(decisionId))
}

/**
 * 清洗文件名（移除非法字符，避免路径注入）
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100)
}

// ============================================================================
// 落盘导出
// ============================================================================

/**
 * 导出报告到磁盘
 *
 * @param input - 报告构建输入
 * @param options - 导出选项
 * @returns 导出的文件路径列表
 */
export async function exportAuditReport(
  input: AuditReportInput,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const format = options.format ?? 'json'
  const baseDir = options.outputDir ?? getDefaultAuditDir()
  const force = options.force ?? false
  const writeAllFormats = options.writeAllFormats ?? false

  // 1. 构造报告（含 SHA-256 指纹）
  const report = buildAndFinalizeReport(input)

  // 2. 决定导出格式
  const formats: AuditFormat[] = writeAllFormats
    ? ['json', 'markdown']
    : [format]

  // 3. 落盘
  const written: ExportResult['written'] = []
  for (const fmt of formats) {
    const filepath = await writeReportFile(report, baseDir, fmt, force)
    written.push({ format: fmt, filepath, bytes: 0 }) // bytes 后续填充
  }

  // 4. 补全文件大小
  for (const w of written) {
    try {
      const stat = await fs.stat(w.filepath)
      w.bytes = stat.size
    } catch {
      w.bytes = 0
    }
  }

  return {
    reportId: report.metadata.reportId,
    decisionId: report.decisionContext.decisionId,
    fingerprint: report.metadata.fingerprint,
    schemaVersion: report.metadata.schemaVersion,
    generatorVersion: report.metadata.generatorVersion,
    formats: written.map((w) => w.format),
    written,
  }
}

/**
 * 写入单份报告到磁盘
 *
 * 文件路径：{baseDir}/{YYYY-MM-DD}/{decisionId}/{decisionId}_{format}.{ext}
 */
async function writeReportFile(
  report: ComplianceAuditReport,
  baseDir: string,
  format: AuditFormat,
  force: boolean
): Promise<string> {
  // 1. 构造目录
  const decisionTime = report.decisionContext.decisionTime || report.metadata.generatedAt
  const reportDir = getReportDir(baseDir, decisionTime, report.decisionContext.decisionId)
  await fs.mkdir(reportDir, { recursive: true })

  // 2. 构造文件路径
  const filename = `${sanitizeFilename(report.decisionContext.decisionId)}_${sanitizeFilename(report.metadata.reportId.slice(0, 8))}.${getFileExtension(format)}`
  const filepath = path.join(reportDir, filename)

  // 3. 防止覆盖（force=false 时）
  if (!force) {
    try {
      await fs.access(filepath)
      throw new Error(
        `报告文件已存在: ${filepath}。如需覆盖请设置 force=true，或更换 decisionId。`
      )
    } catch (err) {
      // fs.access 抛错说明文件不存在，继续
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err
      }
    }
  }

  // 4. 序列化并写入
  const content = formatReport(report, format)
  await fs.writeFile(filepath, content, 'utf-8')

  return filepath
}

// ============================================================================
// 列出已落盘报告
// ============================================================================

/**
 * 列出已落盘的审计报告
 *
 * @param baseDir - 基础目录
 * @returns 报告文件列表（按时间倒序）
 */
export async function listAuditReports(
  baseDir: string = getDefaultAuditDir()
): Promise<AuditReportListItem[]> {
  const items: AuditReportListItem[] = []

  let entries: string[]
  try {
    entries = await fs.readdir(baseDir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [] // 目录不存在，返回空
    }
    throw err
  }

  for (const dateEntry of entries) {
    if (!DATE_DIR_REGEX.test(dateEntry)) continue
    const dateDir = path.join(baseDir, dateEntry)
    const decisionDirs = await fs.readdir(dateDir).catch(() => [])

    for (const decisionDir of decisionDirs) {
      const decisionPath = path.join(dateDir, decisionDir)
      const files = await fs.readdir(decisionPath).catch(() => [])

      for (const file of files) {
        if (!file.endsWith('.json')) continue // 仅基于 JSON 索引
        const filepath = path.join(decisionPath, file)
        try {
          const content = await fs.readFile(filepath, 'utf-8')
          const report = JSON.parse(content) as ComplianceAuditReport
          items.push({
            decisionId: report.decisionContext.decisionId,
            decisionTitle: report.decisionContext.decisionTitle,
            decisionTime: report.decisionContext.decisionTime,
            reportId: report.metadata.reportId,
            fingerprint: report.metadata.fingerprint,
            complianceScore: report.overallCompliance.complianceScore,
            filepath,
            dateDir: dateEntry,
          })
        } catch {
          // 跳过无法解析的文件
        }
      }
    }
  }

  // 按决策时间倒序
  items.sort((a, b) => b.decisionTime - a.decisionTime)
  return items
}

// ============================================================================
// 报告重建（仅基于已有的 JSON 文件）
// ============================================================================

/**
 * 从已落盘的 JSON 报告重建 ComplianceAuditReport 对象
 *
 * 用途：UI 展示已生成的报告、对比不同决策的报告
 */
export async function loadAuditReport(filepath: string): Promise<ComplianceAuditReport> {
  const content = await fs.readFile(filepath, 'utf-8')
  return JSON.parse(content) as ComplianceAuditReport
}

// ============================================================================
// 报告对比（差分）
// ============================================================================

/**
 * 对比两份报告的差异
 *
 * 用于：UI 展示两次校准/决策的差异、回归测试
 */
export function diffAuditReports(
  before: ComplianceAuditReport,
  after: ComplianceAuditReport
): AuditReportDiff {
  return {
    complianceScoreDelta: after.overallCompliance.complianceScore - before.overallCompliance.complianceScore,
    eceAfterDelta: after.calibration.eceAfter - before.calibration.eceAfter,
    confidenceDelta: after.fusionResult.confidence - before.fusionResult.confidence,
    optimalTDelta: after.calibration.optimalT - before.calibration.optimalT,
    mitigatedCountDelta:
      after.genaiRiskCoverage.filter((r) => r.verdict === 'mitigated').length -
      before.genaiRiskCoverage.filter((r) => r.verdict === 'mitigated').length,
    fingerprintChanged: before.metadata.fingerprint !== after.metadata.fingerprint,
  }
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 导出选项
 */
export interface ExportOptions {
  /** 输出格式（默认 'json'）*/
  format?: AuditFormat
  /** 输出目录（默认 getDefaultAuditDir()）*/
  outputDir?: string
  /** 是否覆盖已存在的文件（默认 false）*/
  force?: boolean
  /** 是否同时输出三种格式（覆盖 format 选项）*/
  writeAllFormats?: boolean
}

/**
 * 导出结果
 */
export interface ExportResult {
  /** 报告 ID（UUID v4）*/
  reportId: string
  /** 决策 ID */
  decisionId: string
  /** SHA-256 指纹（前 16 字符）*/
  fingerprint: string
  /** Schema 版本 */
  schemaVersion: string
  /** 生成器版本 */
  generatorVersion: string
  /** 已写入的格式列表 */
  formats: AuditFormat[]
  /** 每个格式的详细写入信息 */
  written: Array<{
    format: AuditFormat
    filepath: string
    bytes: number
  }>
}

/**
 * 报告列表项
 */
export interface AuditReportListItem {
  decisionId: string
  decisionTitle: string
  decisionTime: number
  reportId: string
  fingerprint: string
  complianceScore: number
  /** 报告 JSON 文件路径 */
  filepath: string
  /** YYYY-MM-DD 子目录 */
  dateDir: string
}

/**
 * 报告差异
 */
export interface AuditReportDiff {
  complianceScoreDelta: number
  eceAfterDelta: number
  confidenceDelta: number
  optimalTDelta: number
  mitigatedCountDelta: number
  fingerprintChanged: boolean
}

// ============================================================================
// 元数据导出
// ============================================================================

export { AUDIT_REPORT_SCHEMA_VERSION, AUDIT_GENERATOR_VERSION }
