/**
 * Skill 中台 v1 模块入口
 *
 * 导出类型、加载器、注册表
 *
 * 使用示例：
 * ```typescript
 * import { SkillRegistry, loadSkillsFromDir } from '@main/services/skills'
 *
 * const registry = new SkillRegistry()
 * const skills = await loadSkillsFromDir('src/main/services/skills/builtin')
 * skills.forEach((s) => registry.register(s))
 *
 * // 匹配 Skill（用于报错自动诊断）
 * const matches = registry.match('Out of memory: Killed process 12345')
 * if (matches.length > 0) {
 *   console.log(matches[0].skill.name) // 'diagnose-oom-killer'
 *   console.log(matches[0].reason)     // '正则匹配: /Killed process \d+ .../'
 * }
 * ```
 */

export * from './types'
export * from './loader'
export * from './registry'
export * from './router'
