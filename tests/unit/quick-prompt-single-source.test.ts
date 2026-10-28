/**
 * quick-prompt-single-source.test.ts —— 快捷提示词只许有一份正文（#253）
 *
 * 现场（2026-10-27 实测取证）：同一句「请诊断当前主机健康状态：磁盘(df -h)…」在
 * `Composer.tsx` 的 prompts 表和 `MessageList.tsx` 的欢迎态里各抄了一份；
 * 而「性能/扩容」那两条因为没人同步，已经漂成两种说法：
 *   Composer：请分析当前资源瓶颈（CPU/内存/磁盘/网络）并给出扩容建议与验证指标。
 *   MessageList：请分析当前服务器的性能瓶颈（CPU/内存/磁盘IO/网络）并给出优化建议，只读命令采集。
 * 两份抄本没有谁通知谁，改一处另一处照旧发出去——界面上就是"同一个入口，两种问法"。
 *
 * 四条判据：
 *   1. 单源 `QUICK_PROMPTS` 存在、每条非空（空表会让下面三条全部空转）
 *   2. 快捷排与欢迎态引用的每个键都能在单源里找到（找不到就点名）
 *   3. 两个消费点的源码里不许再出现单源任何一句的完整正文（抄本存在性）
 *   4. 反向对照：单源正文必须能在单源文件里被同一把尺扫到 —— 证明第 3 条不是恒真
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as mockData from '@renderer/components/workbench/mock-data'

const ROOT = path.join(__dirname, '../../src/renderer/src/components/workbench')
/** 只许在单源里写正文，这两个消费点不许留抄本 */
const CONSUMERS = ['Composer.tsx', 'MessageList.tsx']
const SOURCE_FILE = 'mock-data.ts'

const QUICK_PROMPTS = (mockData as { QUICK_PROMPTS?: Record<string, string> }).QUICK_PROMPTS
const RAIL = (mockData as { QUICK_PROMPT_TEMPLATES?: readonly string[] }).QUICK_PROMPT_TEMPLATES
const WELCOME = (mockData as {
  WELCOME_SUGGESTIONS?: ReadonlyArray<{ key: string; label: string }>
}).WELCOME_SUGGESTIONS

describe('快捷提示词单源', () => {
  it('1. 单源存在且每条都是能直接发出去的一句话', () => {
    expect(QUICK_PROMPTS, '还没有提示词单源（QUICK_PROMPTS）').toBeTypeOf('object')
    const keys = Object.keys(QUICK_PROMPTS!)
    expect(keys.length, '单源是空表，后面的判据会全部空转').toBeGreaterThanOrEqual(5)
    for (const [k, v] of Object.entries(QUICK_PROMPTS!)) {
      // 下限只管"不是一句占位"（如"待补充"），不管长短：
      // 「请帮我分析以下配置文件的含义与潜在问题：」这种 20 字的短问句是合法正文
      expect(v.trim().length, `「${k}」这句提示词是空的或只是占位`).toBeGreaterThanOrEqual(10)
    }
  })

  it('2. 快捷排与欢迎态引用的键都在单源里', () => {
    expect(QUICK_PROMPTS, '还没有提示词单源（QUICK_PROMPTS）').toBeTypeOf('object')
    const keys = Object.keys(QUICK_PROMPTS!)
    const railMissing = (RAIL ?? []).filter((k) => !keys.includes(k))
    expect(railMissing, `快捷排这些键在单源里没有正文：${railMissing.join('、')}`).toEqual([])

    const welcomeMissing = (WELCOME ?? []).filter((s) => !keys.includes(s.key)).map((s) => s.key)
    expect(welcomeMissing, `欢迎态这些行引用的键在单源里没有正文：${welcomeMissing.join('、')}`).toEqual([])
    expect((WELCOME ?? []).length, '欢迎态一条建议都没有').toBeGreaterThanOrEqual(4)
  })

  it('3. 两个消费点不许留任何一句正文的抄本', () => {
    expect(QUICK_PROMPTS, '还没有提示词单源（QUICK_PROMPTS）').toBeTypeOf('object')
    const texts = Object.values(QUICK_PROMPTS!)
    const copies: string[] = []
    for (const file of CONSUMERS) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
      for (const t of texts) {
        // 比对前缀而不是整句：有人截一半去拼字符串同样是抄本
        if (src.includes(t.slice(0, 24))) copies.push(`${file} ← ${t.slice(0, 24)}…`)
      }
    }
    expect(copies, `这些地方还自己抄了一份提示词，改了单源它不会跟着变：\n${copies.join('\n')}`).toEqual(
      [],
    )
  })

  it('4. 反向对照：同一把尺在单源文件里必须扫得到正文（否则第 3 条是恒真）', () => {
    expect(QUICK_PROMPTS, '还没有提示词单源（QUICK_PROMPTS）').toBeTypeOf('object')
    const src = fs.readFileSync(path.join(ROOT, SOURCE_FILE), 'utf8')
    const hit = Object.values(QUICK_PROMPTS!).filter((t) => src.includes(t.slice(0, 24))).length
    expect(hit, '单源文件里扫不到任何一句正文——第 3 条判据将永远为真，等于没有闸').toBe(
      Object.keys(QUICK_PROMPTS!).length,
    )
  })
})
