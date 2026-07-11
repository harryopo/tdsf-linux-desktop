/**
 * 证据溯源校验模块单元测试
 */
import { describe, it, expect } from 'vitest'
import {
  verifyEvidence,
  verifyAllEvidences,
  type ToolCallRecord
} from '../../src/main/core/grounding'
import type { Evidence } from '../../src/shared/models'

/** 创建测试用证据的辅助函数 */
function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-test',
    source: 'log',
    sourceDetail: '/var/log/syslog',
    content: 'disk full error',
    drainMatch: 0.8,
    sourcePrior: 0.6,
    confidence: 0.5,
    timestamp: Date.now(),
    verified: false,
    ...overrides
  }
}

/** 创建测试用工具调用记录的辅助函数 */
function makeRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolName: 'cat',
    input: '/var/log/syslog',
    output: 'disk full error occurred at midnight',
    timestamp: Date.now() - 1000,
    sessionId: 'session-1',
    ...overrides
  }
}

describe('grounding — 证据溯源校验', () => {
  // ────────── verifyEvidence ──────────

  it('verifyEvidence: 证据内容在工具输出中且来源匹配时验证通过', () => {
    const evidence = makeEvidence({
      content: 'disk full error',
      sourceDetail: '/var/log/syslog',
      source: 'log',
      timestamp: Date.now()
    })
    const records = [makeRecord({
      toolName: 'cat',
      input: '/var/log/syslog',
      output: 'disk full error occurred at midnight',
      timestamp: Date.now() - 1000
    })]
    expect(verifyEvidence(evidence, records)).toBe(true)
  })

  it('verifyEvidence: 空工具调用日志返回 false', () => {
    const evidence = makeEvidence()
    expect(verifyEvidence(evidence, [])).toBe(false)
  })

  it('verifyEvidence: knowledge 类型不依赖工具调用，直接通过', () => {
    const evidence = makeEvidence({ source: 'knowledge' })
    expect(verifyEvidence(evidence, [])).toBe(true)
  })

  it('verifyEvidence: 证据内容不在工具输出中时验证失败', () => {
    const evidence = makeEvidence({ content: 'completely different content' })
    const records = [makeRecord({ output: 'disk full error' })]
    expect(verifyEvidence(evidence, records)).toBe(false)
  })

  it('verifyEvidence: 证据时间戳早于工具调用时验证失败', () => {
    const toolTime = Date.now()
    const evidence = makeEvidence({ timestamp: toolTime - 5000 })
    const records = [makeRecord({ timestamp: toolTime })]
    expect(verifyEvidence(evidence, records)).toBe(false)
  })

  it('verifyEvidence: metric 来源匹配 free 命令', () => {
    const evidence = makeEvidence({
      source: 'metric',
      content: 'MemTotal: 2048000',
      sourceDetail: 'free -m'
    })
    const records = [makeRecord({
      toolName: 'free',
      input: 'free -m',
      output: 'MemTotal: 2048000 kB'
    })]
    expect(verifyEvidence(evidence, records)).toBe(true)
  })

  // ────────── verifyAllEvidences ──────────

  it('verifyAllEvidences: 批量验证，每条证据的 verified 字段正确更新', () => {
    const evidences = [
      makeEvidence({ id: 'ev-1', content: 'disk full error', source: 'log' }),
      makeEvidence({ id: 'ev-2', content: 'not in output', source: 'log' }),
      makeEvidence({ id: 'ev-3', source: 'knowledge' })
    ]
    const records = [makeRecord({ output: 'disk full error' })]
    const result = verifyAllEvidences(evidences, records)

    expect(result).toHaveLength(3)
    expect(result[0].verified).toBe(true)   // 内容匹配 + 来源匹配
    expect(result[1].verified).toBe(false)  // 内容不匹配
    expect(result[2].verified).toBe(true)   // knowledge 直接通过
  })

  it('verifyAllEvidences: 空列表返回空列表', () => {
    expect(verifyAllEvidences([], [])).toEqual([])
  })
})
