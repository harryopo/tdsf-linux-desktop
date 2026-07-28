/**
 * skill-router.test.ts — Skill 路由（P3）单元测试
 *
 * 覆盖两块（均不依赖 electron / DB，纯 node）：
 *   1. loadSkillsFromDir 真实加载 5 个内置诊断 skill 并正确解析 frontmatter 触发词
 *   2. SkillRouter 三层路由决策（skill-only / skill-assisted / ai-only）
 *
 * 背景：SkillRegistry / SkillRouter / builtin skill 此前是死代码，P3 把它们接进主对话。
 * 本测试锁死"skill 能被加载 + 路由决策正确"，是 P3 后端逻辑的回归门禁。
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { loadSkillsFromDir } from '../../src/main/services/skills/loader'
import { SkillRegistry } from '../../src/main/services/skills/registry'
import { SkillRouter } from '../../src/main/services/skills/router'
import type { Skill } from '../../src/main/services/skills/types'

const BUILTIN_DIR = path.join(__dirname, '../../src/main/services/skills/builtin')

/** 构造一个测试用 Skill（可控触发词，用于验证路由决策阈值） */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'test-skill',
    description: '测试技能',
    triggers: { keywords: ['oom'], patterns: [], semantic: ['memory pressure killed'] },
    riskLevel: 'low',
    category: 'troubleshooting',
    tags: [],
    content: '## 诊断步骤\n1. 查看 dmesg\n2. 分析被杀进程',
    filePath: '/virtual/test-skill.md',
    builtin: true,
    ...overrides,
  }
}

describe('内置 skill 加载（loadSkillsFromDir）', () => {
  it('从 builtin 目录加载全部 5 个诊断 skill', async () => {
    const skills = await loadSkillsFromDir(BUILTIN_DIR)
    expect(skills.length).toBe(5)
    const names = skills.map((s) => s.name).sort()
    expect(names).toEqual(
      [
        'diagnose-disk-full',
        'diagnose-network-issue',
        'diagnose-oom-killer',
        'diagnose-permission-denied',
        'diagnose-service-failure',
      ].sort(),
    )
  })

  it('正确解析 frontmatter 触发词（oom skill 含 oom 关键词 + 正文非空）', async () => {
    const skills = await loadSkillsFromDir(BUILTIN_DIR)
    const oom = skills.find((s) => s.name === 'diagnose-oom-killer')
    expect(oom).toBeTruthy()
    expect(oom!.triggers.keywords).toContain('oom')
    expect(oom!.content.length).toBeGreaterThan(100)
  })
})

describe('SkillRouter 三层路由决策', () => {
  const registry = new SkillRegistry()
  registry.register(makeSkill())
  const router = new SkillRouter(registry)

  it('高置信度（关键词包含 ≥0.8）→ skill-only，返回直接回复', () => {
    const r = router.route('oom detected in kernel log')
    expect(r.decision).toBe('skill-only')
    expect(r.reply).toBeTruthy()
    expect(r.matches[0].skill.name).toBe('test-skill')
    expect(r.estimatedTokenSavings).toBeGreaterThan(0)
  })

  it('中置信度（语义部分重叠 0.3~0.8）→ skill-assisted，返回上下文注入', () => {
    // semantic 'memory pressure killed'（3 词），输入命中 memory+pressure → 0.6×2/3=0.4
    const r = router.route('the memory pressure is very high today')
    expect(r.decision).toBe('skill-assisted')
    expect(r.contextInjection).toBeTruthy()
  })

  it('无匹配（<0.3）→ ai-only，无注入无回复', () => {
    const r = router.route('你好，今天天气怎么样')
    expect(r.decision).toBe('ai-only')
    expect(r.reply).toBeUndefined()
    expect(r.contextInjection).toBeUndefined()
    expect(r.estimatedTokenSavings).toBe(0)
  })
})
