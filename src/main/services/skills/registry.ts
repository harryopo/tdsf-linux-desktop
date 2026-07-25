/**
 * Skill 注册表
 *
 * 职责：
 * - 注册 / 注销 Skill
 * - 按关键词/正则/语义匹配 Skill（用于报错自动诊断）
 * - 按分类查询 Skill
 * - 按名称查询 Skill
 *
 * 匹配算法（多策略融合）：
 * 1. 正则模式匹配 → score = 0.9（最精确）
 * 2. 精确关键词匹配 → score = 1.0
 * 3. 包含关键词匹配 → score = 0.8
 * 4. 语义匹配（词重叠率） → score = 0.6 × overlap_ratio
 *
 * 参考：docs/skill-research/03-Skill中台设计方案.md §3 Registry 层
 */

import type { Skill, SkillMatchResult, SkillCategory } from './types'

export class SkillRegistry {
  /** name → Skill 的映射 */
  private readonly skills = new Map<string, Skill>()

  /**
   * 注册 Skill
   * @param skill Skill 对象
   * @throws 如果 name 已存在，覆盖旧值（并 warn）
   */
  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      // 静默覆盖（用户自定义 Skill 可覆盖内置 Skill）
    }
    this.skills.set(skill.name, skill)
  }

  /** 注销 Skill */
  unregister(name: string): boolean {
    return this.skills.delete(name)
  }

  /** 按名称查询 Skill */
  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /** 获取所有已注册 Skill */
  list(): Skill[] {
    return Array.from(this.skills.values())
  }

  /** 按分类查询 */
  listByCategory(category: SkillCategory): Skill[] {
    return this.list().filter((s) => s.category === category)
  }

  /** 按标签查询 */
  listByTag(tag: string): Skill[] {
    return this.list().filter((s) => s.tags.includes(tag))
  }

  /**
   * 根据输入文本匹配 Skill（核心方法）
   *
   * 用于：
   * - 报错自动诊断（终端输出 → match → 找到诊断 Skill）
   * - 用户提问路由（用户问题 → match → 找到相关 Skill）
   *
   * @param input 用户输入或终端输出
   * @param topN 返回前 N 个匹配结果（默认 3）
   * @param minScore 最低匹配分数阈值（默认 0.3，低于此分数不返回）
   * @returns 匹配结果列表（按分数降序）
   */
  match(input: string, topN = 3, minScore = 0.3): SkillMatchResult[] {
    const results: SkillMatchResult[] = []
    const inputLower = input.toLowerCase()

    for (const skill of this.skills.values()) {
      let bestScore = 0
      let bestReason = ''

      // 策略 1: 正则模式匹配（最精确，score = 0.9）
      for (const pattern of skill.triggers.patterns) {
        try {
          const regex = new RegExp(pattern, 'i')
          if (regex.test(input)) {
            if (0.9 > bestScore) {
              bestScore = 0.9
              bestReason = `正则匹配: /${pattern}/`
            }
          }
        } catch {
          // 正则编译失败（用户写的 pattern 语法错误），跳过
        }
      }

      // 策略 2: 关键词匹配
      for (const kw of skill.triggers.keywords) {
        const kwLower = kw.toLowerCase()
        if (!kwLower) continue

        if (inputLower === kwLower) {
          // 精确匹配（score = 1.0）
          if (1.0 > bestScore) {
            bestScore = 1.0
            bestReason = `关键词精确匹配: "${kw}"`
          }
        } else if (inputLower.includes(kwLower)) {
          // 包含匹配（score = 0.8）
          if (0.8 > bestScore) {
            bestScore = 0.8
            bestReason = `关键词包含匹配: "${kw}"`
          }
        }
      }

      // 策略 3: 语义匹配（简单词重叠，score = 0.6 × overlap_ratio）
      for (const sem of skill.triggers.semantic) {
        if (!sem) continue
        const semLower = sem.toLowerCase()
        const semWords = semLower.split(/\s+/).filter((w) => w.length > 1)
        if (semWords.length === 0) continue

        const overlap = semWords.filter((w) => inputLower.includes(w)).length
        if (overlap > 0) {
          const score = 0.6 * (overlap / semWords.length)
          if (score > bestScore) {
            bestScore = score
            bestReason = `语义匹配: "${sem}"（重叠 ${overlap}/${semWords.length} 词）`
          }
        }
      }

      if (bestScore >= minScore) {
        results.push({ skill, score: bestScore, reason: bestReason })
      }
    }

    // 按分数降序，取前 N 个
    return results.sort((a, b) => b.score - a.score).slice(0, topN)
  }

  /** 清空注册表 */
  clear(): void {
    this.skills.clear()
  }

  /** 已注册 Skill 数量 */
  get size(): number {
    return this.skills.size
  }
}
