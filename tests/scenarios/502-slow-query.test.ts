/**
 * 端到端场景测试：502 慢查询场景
 *
 * 验证 6 大核心机制在 502 Bad Gateway + 慢查询故障场景下的协同工作：
 *   1. 规则引擎匹配 502 关键词
 *   2. 多证据收集（Nginx 日志 + MySQL 慢查询 + CPU 指标）
 *   3. 多证据综合置信度计算
 *   4. Ground-Check（每条证据溯源到对应工具调用）
 *   5. 风险引擎（systemctl restart php-fpm 评估为 MEDIUM）
 *   6. 决策卡片（根因分析 + 回滚方案）+ 自适应采样（置信度 < 0.7 触发重采样）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { analyzeByRules } from '../../src/main/core/rule-engine'
import {
  calculateEvidenceConfidence
} from '../../src/main/core/confidence'
import {
  verifyAllEvidences,
  type ToolCallRecord
} from '../../src/main/core/grounding'
import {
  assessRisk,
  requiresConfirmation,
  shouldBlock,
  clearAuditLog
} from '../../src/main/core/risk-engine'
import {
  generateDecisionCard,
  calculateOverallConfidence,
  validateDecision
} from '../../src/main/core/decision-engine'
import {
  shouldResample,
  resampleAndVote,
  adaptiveSample,
  RESAMPLE_COUNT
} from '../../src/main/core/sampling'
import type { Evidence } from '../../src/shared/models'

/** 模拟 Nginx 错误日志输出 */
const NGINX_ERROR_LOG =
  '2024-01-15 10:30:45 [error] 1234#1234: *5678 upstream timed out (110: Connection timed out)\n' +
  '2024-01-15 10:30:46 [error] 1234#1234: *5679 upstream timed out while reading response header'

/** 模拟 MySQL 慢查询日志输出 */
const MYSQL_SLOW_LOG =
  '# Time: 2024-01-15 10:30:44\n# Query_time: 15.2  Lock_time: 0.001 Rows_sent: 1 Rows_examined: 5000000\n' +
  'SELECT * FROM orders WHERE status = 1;'

/** 模拟 top 命令输出的 CPU 指标 */
const CPU_METRIC_OUTPUT = '%Cpu(s): 95.2 us,  3.1 sy,  0.0 ni, 1.7 id,  0.0 wa,  0.0 hi,  0.0 si'

/** 创建 Nginx 日志证据 */
function makeNginxEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-nginx-1',
    source: 'log',
    sourceDetail: 'nginx-error',
    content: 'upstream timed out (110: Connection timed out)',
    drainMatch: 0.5,
    sourcePrior: 0.6,
    confidence: 0,
    timestamp: Date.now(),
    verified: false,
    ...overrides
  }
}

/** 创建 MySQL 慢查询证据 */
function makeMysqlEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-mysql-1',
    source: 'log',
    sourceDetail: 'mysql-slow',
    content: 'Query_time: 15.2',
    drainMatch: 0.6,
    sourcePrior: 0.6,
    confidence: 0,
    timestamp: Date.now(),
    verified: false,
    ...overrides
  }
}

/** 创建 CPU 指标证据 */
function makeCpuEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-cpu-1',
    source: 'metric',
    sourceDetail: 'cpu',
    content: '%Cpu(s): 95.2 us',
    drainMatch: 0.7,
    sourcePrior: 0.8,
    confidence: 0,
    timestamp: Date.now(),
    verified: false,
    ...overrides
  }
}

/** 创建工具调用记录列表（对应三条证据来源） */
function makeToolCallRecords(): ToolCallRecord[] {
  const baseTime = Date.now() - 1000
  return [
    {
      toolName: 'tail',
      input: '/var/log/nginx/error.log',
      output: NGINX_ERROR_LOG,
      timestamp: baseTime,
      sessionId: 'session-502'
    },
    {
      toolName: 'cat',
      input: '/var/log/mysql/slow.log',
      output: MYSQL_SLOW_LOG,
      timestamp: baseTime,
      sessionId: 'session-502'
    },
    {
      toolName: 'top',
      input: 'top -bn1',
      output: CPU_METRIC_OUTPUT,
      timestamp: baseTime,
      sessionId: 'session-502'
    }
  ]
}

describe('端到端场景：502 慢查询', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  // ────────── 1. 规则引擎匹配 502 ──────────

  it('规则引擎：从 Nginx 日志匹配 502 Bad Gateway 关键词', () => {
    const result = analyzeByRules('网站打不开，返回 502', NGINX_ERROR_LOG)
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('502')
    expect(result!.fixCommand).toContain('systemctl')
    expect(result!.confidence).toBe(0.65)
  })

  // ────────── 2. 多证据收集 ──────────

  it('证据收集：从 Nginx 日志和 MySQL 慢查询日志提取证据', () => {
    const nginxEv = makeNginxEvidence()
    const mysqlEv = makeMysqlEvidence()
    const cpuEv = makeCpuEvidence()

    // Nginx 日志证据
    expect(nginxEv.source).toBe('log')
    expect(nginxEv.content).toContain('upstream timed out')

    // MySQL 慢查询证据
    expect(mysqlEv.source).toBe('log')
    expect(mysqlEv.content).toContain('Query_time: 15.2')

    // CPU 指标证据
    expect(cpuEv.source).toBe('metric')
    expect(cpuEv.content).toContain('95.2')
  })

  // ────────── 3. 多证据置信度计算 ──────────

  it('置信度计算：综合日志+指标计算多证据置信度', () => {
    // Nginx 日志：log 先验 0.6，drainMatch 0.5 → 0.7×0.5+0.3×0.6 = 0.35+0.18 = 0.53
    const nginxComputed = calculateEvidenceConfidence(makeNginxEvidence())
    expect(nginxComputed.sourcePrior).toBe(0.6)
    expect(nginxComputed.confidence).toBeCloseTo(0.53, 5)

    // MySQL 慢查询：log 先验 0.6，drainMatch 0.6 → 0.7×0.6+0.3×0.6 = 0.42+0.18 = 0.6
    const mysqlComputed = calculateEvidenceConfidence(makeMysqlEvidence())
    expect(mysqlComputed.confidence).toBeCloseTo(0.6, 5)

    // CPU 指标：metric 先验 0.8，drainMatch 0.7 → 0.7×0.7+0.3×0.8 = 0.49+0.24 = 0.73
    const cpuComputed = calculateEvidenceConfidence(makeCpuEvidence())
    expect(cpuComputed.sourcePrior).toBe(0.8)
    expect(cpuComputed.confidence).toBeCloseTo(0.73, 5)

    // 综合置信度（全部已验证，权重 1）：(0.53+0.6+0.73)/3 ≈ 0.62
    const evidences = [nginxComputed, mysqlComputed, cpuComputed].map((e) => ({
      ...e,
      verified: true
    }))
    const overall = calculateOverallConfidence(evidences)
    expect(overall).toBeCloseTo(0.62, 2)
    expect(overall).toBeLessThan(0.7) // 低于阈值，应触发重采样
  })

  // ────────── 4. Ground-Check 证据溯源 ──────────

  it('Ground-Check：每条证据都有对应的工具调用记录', () => {
    const evidences = [
      makeNginxEvidence({ timestamp: Date.now() }),
      makeMysqlEvidence({ timestamp: Date.now() }),
      makeCpuEvidence({ timestamp: Date.now() })
    ]
    const records = makeToolCallRecords()

    const verified = verifyAllEvidences(evidences, records)
    expect(verified).toHaveLength(3)
    // Nginx 日志：content 在 tail 输出中，log 匹配 tail
    expect(verified[0].verified).toBe(true)
    // MySQL 慢查询：content 在 cat 输出中，log 匹配 cat
    expect(verified[1].verified).toBe(true)
    // CPU 指标：content 在 top 输出中，metric 匹配 top
    expect(verified[2].verified).toBe(true)
  })

  // ────────── 5. 风险引擎评估 ──────────

  it('风险引擎：systemctl restart php-fpm 评估为 MEDIUM 风险', () => {
    const assessment = assessRisk('systemctl restart php-fpm')
    expect(assessment.level).toBe('MEDIUM')
    expect(assessment.score).toBe(50)
    expect(assessment.matchedRules).toContain('重启系统服务')
    // MEDIUM 不需要人工确认（仅 HIGH/CRITICAL 需要）
    expect(assessment.requireConfirmation).toBe(false)
    expect(assessment.blocked).toBe(false)
    // requiresConfirmation 对 MEDIUM 返回 false
    expect(requiresConfirmation(assessment.level)).toBe(false)
    expect(shouldBlock(assessment.level)).toBe(false)
  })

  // ────────── 6. 决策卡片生成 ──────────

  it('决策卡片：包含根因分析、修复建议、回滚方案', () => {
    const evidences = [
      makeNginxEvidence({ verified: true }),
      makeMysqlEvidence({ verified: true }),
      makeCpuEvidence({ verified: true })
    ]
    const card = generateDecisionCard(
      '网站返回 502 Bad Gateway',
      'PHP-FPM 处理慢查询超时导致 Nginx upstream timed out',
      evidences,
      'systemctl restart php-fpm',
      '重启 PHP-FPM 服务以恢复响应',
      'systemctl status php-fpm'
    )

    expect(card.problem).toContain('502')
    expect(card.hypothesis).toContain('PHP-FPM')
    expect(card.evidences).toHaveLength(3)
    expect(card.fixCommand).toBe('systemctl restart php-fpm')
    expect(card.rollbackCommand).toBe('systemctl status php-fpm')
    expect(card.risk.level).toBe('MEDIUM')
    expect(card.risk.requireConfirmation).toBe(false)
    expect(card.status).toBe('pending')
    // 决策卡片应通过完整性验证
    const validation = validateDecision(card)
    expect(validation.valid).toBe(true)
  })

  // ────────── 7. 自适应采样 ──────────

  it('自适应采样：置信度 < 0.7 时触发 3 次重采样并取多数票', async () => {
    // 构造低置信度证据链（综合置信度 ≈ 0.62 < 0.7）
    const evidences = [
      makeNginxEvidence({ verified: true }),
      makeMysqlEvidence({ verified: true }),
      makeCpuEvidence({ verified: true })
    ]
    const overall = calculateOverallConfidence(evidences)
    expect(overall).toBeLessThan(0.7)

    // shouldResample 对低置信度返回 true
    expect(shouldResample(overall)).toBe(true)
    expect(shouldResample(0.69)).toBe(true)
    // shouldResample 对高置信度返回 false
    expect(shouldResample(0.7)).toBe(false)

    // resampleAndVote 多数票
    const votes = ['systemctl restart php-fpm', 'systemctl restart php-fpm', 'systemctl reload php-fpm']
    expect(resampleAndVote(votes)).toBe('systemctl restart php-fpm')

    // adaptiveSample 低置信度时调用 3 次 generator
    const values = ['restart', 'restart', 'reload']
    let callIndex = 0
    const generator = vi.fn().mockImplementation(async () => {
      return values[callIndex++]
    })
    const result = await adaptiveSample(overall, generator)
    expect(generator).toHaveBeenCalledTimes(RESAMPLE_COUNT)
    expect(result).toBe('restart') // 多数票获胜

    // adaptiveSample 高置信度时只调用 1 次
    const singleGen = vi.fn().mockResolvedValue('restart')
    const singleResult = await adaptiveSample(0.9, singleGen)
    expect(singleGen).toHaveBeenCalledTimes(1)
    expect(singleResult).toBe('restart')
  })
})
