/**
 * tests/unit/decision-provenance-honest.test.ts —— 决策证据的出处不许掺假（#102）
 *
 * 真机实测：这台机器上一个模型口令都没配，而两条链路（ipc/agent.ts 与
 * loop-engineering-subagent）都把证据写成 sourceDetail: 'LLM 分析'。
 * analyze() 在没有口令时走的是内置 rule-engine —— 于是界面上"AI 给的根因"
 * 其实是内置规则给的。决策卡是本产品的第三个卖点，凭证不能这么写。
 *
 * 顺带把"没配口令整条 loop 直接报错"钉住：那条的端到端判据在
 * tests/e2e/ 与真机探针里（本文件只量得动纯函数与结构）。
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { LlmClient } from '../../src/main/services/llm/client'
import { getSourcePrior } from '../../src/main/core/confidence'
import {
  classifyLlmError,
  llmErrorLabel,
} from '../../src/main/core/agent/providers/llm-error'
import type { LlmConfig } from '../../src/shared/models'

const ROOT = resolve(__dirname, '../..')

/** 一个字段齐全但**没有口令**的配置：这就是验收那台机器的真实状态 */
function noKeyConfig(): LlmConfig {
  return {
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: '',
    model: 'not-configured',
    temperature: 0,
    maxTokens: 64,
    timeout: 3000,
  }
}

describe('analyze() 自己说清是谁给的结论', () => {
  it('没有口令 → provenance=rules，并且确实给出了可用的假设与命令', async () => {
    const client = new LlmClient(noKeyConfig())
    expect(client.isAvailable()).toBe(false)
    const r = await client.analyze('磁盘空间不足，服务写入失败', [])
    expect(r.provenance).toBe('rules')
    expect(r.hypothesis.length).toBeGreaterThan(0)
    expect(r.fixCommand.length).toBeGreaterThan(0)
  })

  it('正向对照：规则表命中时给的是规则里那条真命令（不是兜底的怪话）', async () => {
    const r = await new LlmClient(noKeyConfig()).analyze('进程被 OOM Killer 杀掉了', [])
    expect(r.provenance).toBe('rules')
    expect(r.fixCommand).toContain('ps aux --sort=-%mem')
    expect(r.confidence).toBeGreaterThan(0.2)
  })

  it('规则也没命中时不许留空，provenance 仍是 rules', async () => {
    const r = await new LlmClient(noKeyConfig()).analyze('一句完全不在规则表里的怪话', [])
    expect(r.provenance).toBe('rules')
    expect(r.confidence).toBeLessThan(0.5)
  })
})

describe('降级说明文本里不许带口令痕迹（真机实测到厂商回显 "Your api key: ****7eea"）', () => {
  it('llmErrorLabel 只给分类名，不给上游原文', () => {
    const err = Object.assign(new Error('401 Authentication Fails'), {
      status: 401,
      code: 'invalid_api_key',
    })
    expect(llmErrorLabel(err)).toBe('API Key 无效或已过期')
    // 反向对照：整条 classify 出来的 message 是带原文的（所以日志里有，卡面上不能有）
    expect(classifyLlmError(err).message).toContain('Authentication Fails')
  })

  it('analyze() 走降级时，假设文本里没有 request_id、没有 api key 片段', async () => {
    const cfg: LlmConfig = { ...noKeyConfig(), apiKey: 'sk-' + 'aB3dEf6gHi7jKl8mNo9pQr0s' }
    const r = await new LlmClient(cfg).analyze('磁盘空间不足', [])
    expect(r.provenance).toBe('rules')
    expect(r.hypothesis).toContain('已降级到内置规则')
    expect(r.hypothesis).not.toMatch(/request_id/i)
    expect(r.hypothesis).not.toMatch(/api key/i)
    expect(r.hypothesis).not.toContain('aB3dEf6g')
  }, 20000)
})

describe('结构闸：证据出处必须由 provenance 决定', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (name.endsWith('.ts')) out.push(full)
    }
    return out
  }
  const files = walk(resolve(ROOT, 'src/main'))

  it('阳性对照：确实扫到了写证据出处的文件（扫到 0 个就是量具坏了）', () => {
    const withDetail = files.filter((f) => readFileSync(f, 'utf8').includes('sourceDetail'))
    expect(withDetail.length, '一个 sourceDetail 都没找到 = 扫描面错了').toBeGreaterThan(1)
  })

  it('凡出现 "LLM 分析" 字样的文件，必须先按 provenance 判过', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!src.includes("'LLM 分析'")) continue
      if (!/provenance\s*===\s*'llm'/.test(src)) offenders.push(relative(ROOT, f))
    }
    expect(offenders, `这些文件无条件把证据写成"LLM 分析"：${offenders.join(', ')}`).toEqual([])
  })

  it('knowledge 证据的先验一律取自先验表，不再各处写死 0.7', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!/source:\s*'knowledge'/.test(src)) continue
      if (/sourcePrior:\s*0\.7/.test(src)) offenders.push(relative(ROOT, f))
    }
    expect(offenders, `写死了 sourcePrior 0.7，绕开了先验表：${offenders.join(', ')}`).toEqual([])
    // 判据的承重位：表里的 knowledge 确实是 0.5，所以 0.7 是个凭空主张
    expect(getSourcePrior('knowledge')).toBe(0.5)
  })
})
