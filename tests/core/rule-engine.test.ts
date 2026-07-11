/**
 * 规则引擎模块单元测试
 */
import { describe, it, expect } from 'vitest'
import { analyzeByRules } from '../../src/main/core/rule-engine'

describe('rule-engine — 规则引擎（LLM 降级）', () => {
  // ────────── OOM 场景 ──────────

  it('analyzeByRules: 匹配 OOM 关键词', () => {
    const result = analyzeByRules('进程被杀死', 'Out of memory: Kill process 1234 (nginx)')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('OOM')
    expect(result!.fixCommand).toContain('free')
    expect(result!.confidence).toBe(0.7)
  })

  it('analyzeByRules: 匹配 oom-killer 关键词', () => {
    const result = analyzeByRules('系统不稳定', 'oom-killer invoked')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('内存')
  })

  // ────────── 磁盘满场景 ──────────

  it('analyzeByRules: 匹配磁盘满（英文）', () => {
    const result = analyzeByRules('写入失败', 'No space left on device')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('磁盘')
    expect(result!.fixCommand).toContain('df')
  })

  it('analyzeByRules: 匹配磁盘满（中文）', () => {
    const result = analyzeByRules('磁盘满', '日志写入失败')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('磁盘')
  })

  // ────────── 502 场景 ──────────

  it('analyzeByRules: 匹配 502 Bad Gateway', () => {
    const result = analyzeByRules('网站打不开', 'nginx: 502 Bad Gateway')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('502')
    expect(result!.fixCommand).toContain('systemctl')
  })

  // ────────── CPU 负载高 ──────────

  it('analyzeByRules: 匹配 CPU 负载高', () => {
    const result = analyzeByRules('CPU 负载高', 'load average: 8.5, 7.2, 6.1')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('CPU')
    expect(result!.fixCommand).toContain('ps aux')
  })

  // ────────── 权限拒绝 ──────────

  it('analyzeByRules: 匹配权限拒绝', () => {
    const result = analyzeByRules('无法访问文件', 'Permission denied: /etc/shadow')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('权限')
    expect(result!.fixCommand).toBe('ls -la')
  })

  // ────────── 连接拒绝 ──────────

  it('analyzeByRules: 匹配连接拒绝', () => {
    const result = analyzeByRules('服务连不上', 'Connection refused on port 3306')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('端口')
    expect(result!.fixCommand).toContain('ss')
  })

  // ────────── 无匹配 / 边界情况 ──────────

  it('analyzeByRules: 无匹配关键词返回 null', () => {
    const result = analyzeByRules('天气怎么样', '今天天气不错')
    expect(result).toBeNull()
  })

  it('analyzeByRules: 空输入返回 null', () => {
    expect(analyzeByRules('', '')).toBeNull()
  })

  it('analyzeByRules: 仅问题有匹配关键词也能命中', () => {
    const result = analyzeByRules('内存不足', '')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('内存')
  })

  it('analyzeByRules: 仅日志有匹配关键词也能命中', () => {
    const result = analyzeByRules('', 'disk full: /dev/sda1')
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('磁盘')
  })

  it('analyzeByRules: 返回结果包含完整字段', () => {
    const result = analyzeByRules('OOM', 'out of memory')
    expect(result).not.toBeNull()
    expect(result).toHaveProperty('hypothesis')
    expect(result).toHaveProperty('fixCommand')
    expect(result).toHaveProperty('confidence')
    expect(typeof result!.confidence).toBe('number')
    expect(result!.confidence).toBeGreaterThan(0)
    expect(result!.confidence).toBeLessThanOrEqual(1)
  })
})
