/**
 * Skill 路由器（Token 优化核心模块）
 *
 * 根据用户输入决定走 Skill 还是走 AI，实现 Token 节省。
 *
 * 路由策略（3 层）：
 * 1. 高置信度匹配（score >= 0.8）→ 直接返回 Skill 内容（0 token，省 100%）
 *    - 用户输入精确匹配关键词/正则
 *    - Skill 内容直接作为回复
 * 2. 中置信度匹配（0.3 <= score < 0.8）→ Skill 作为上下文注入 AI（省 ~50%）
 *    - 用户输入部分匹配
 *    - Skill 内容作为参考，AI 基于参考生成更精准的回复
 * 3. 无匹配（score < 0.3）→ 直接调 AI（正常消耗）
 *
 * Token 节省估算：
 * - skill-only: 节省 100%（不调 AI）
 * - skill-assisted: 节省 ~50%（AI 生成更短，因为已有参考）
 * - ai-only: 节省 0%
 *
 * 参考：docs/skill-research/04-Token节省技术方案.md §4 分层路由
 */

import type { SkillMatchResult } from './types'
import { SkillRegistry } from './registry'
import { estimateTokens } from '../../core/agent/context'

/** 路由决策类型 */
export type RouteDecision = 'skill-only' | 'skill-assisted' | 'ai-only'

/** 路由结果 */
export interface SkillRouteResult {
  /** 路由决策 */
  decision: RouteDecision
  /** 匹配的 Skill 列表（按分数降序） */
  matches: SkillMatchResult[]
  /** 直接回复内容（仅 skill-only 时有值，可直接展示给用户，无需调 AI） */
  reply?: string
  /** 注入 AI 的上下文（仅 skill-assisted 时有值，作为 system prompt 的一部分） */
  contextInjection?: string
  /** 预计节省的 token 数（相对于直接调 AI） */
  estimatedTokenSavings: number
  /** 路由原因（用于 UI 展示和调试） */
  reason: string
}

/** 高置信度阈值（>= 此值直接返回 Skill 内容） */
const HIGH_CONFIDENCE_THRESHOLD = 0.8

/** 中置信度阈值（>= 此值 Skill 作为 AI 上下文） */
const MID_CONFIDENCE_THRESHOLD = 0.3

/**
 * Skill 路由器
 *
 * 使用示例：
 * ```typescript
 * const router = new SkillRouter(registry)
 * const result = router.route('Out of memory: Killed process 12345')
 *
 * if (result.decision === 'skill-only') {
 *   // 直接展示 result.reply，不调 AI（省 100% token）
 *   showToUser(result.reply)
 * } else if (result.decision === 'skill-assisted') {
 *   // 把 result.contextInjection 注入 AI 上下文（省 ~50% token）
 *   const aiReply = await callAI(userInput, result.contextInjection)
 * } else {
 *   // 正常调 AI
 *   const aiReply = await callAI(userInput)
 * }
 * ```
 */
export class SkillRouter {
  constructor(private readonly registry: SkillRegistry) {}

  /**
   * 路由用户输入
   *
   * @param input 用户输入或终端输出
   * @returns 路由结果
   */
  route(input: string): SkillRouteResult {
    const matches = this.registry.match(input, 3, MID_CONFIDENCE_THRESHOLD)

    // 无匹配 → 直接调 AI
    if (matches.length === 0) {
      return {
        decision: 'ai-only',
        matches: [],
        estimatedTokenSavings: 0,
        reason: '无 Skill 匹配，走 AI 正常调用',
      }
    }

    const topMatch = matches[0]

    // 高置信度 → 直接返回 Skill 内容（0 token）
    if (topMatch.score >= HIGH_CONFIDENCE_THRESHOLD) {
      const reply = this.formatSkillReply(topMatch)
      const skillTokens = estimateTokens(topMatch.skill.content)
      return {
        decision: 'skill-only',
        matches,
        reply,
        estimatedTokenSavings: skillTokens,
        reason: `高置信度匹配（${topMatch.score.toFixed(2)}），直接返回 Skill 内容`,
      }
    }

    // 中置信度 → Skill 作为 AI 上下文
    const contextInjection = this.formatContextInjection(topMatch)
    const skillTokens = estimateTokens(topMatch.skill.content)
    return {
      decision: 'skill-assisted',
      matches,
      contextInjection,
      // 中置信度场景 AI 仍需调用，但有参考后生成更短，估算省 50%
      estimatedTokenSavings: Math.floor(skillTokens * 0.5),
      reason: `中置信度匹配（${topMatch.score.toFixed(2)}），Skill 作为 AI 上下文`,
    }
  }

  /**
   * 格式化 Skill 直接回复（skill-only 场景）
   */
  private formatSkillReply(match: SkillMatchResult): string {
    const { skill, reason } = match
    return [
      `## 📋 匹配到运维 Skill: ${skill.name}`,
      '',
      `**匹配原因**: ${reason}`,
      `**风险等级**: ${skill.riskLevel}`,
      `**分类**: ${skill.category}`,
      '',
      '---',
      '',
      skill.content,
    ].join('\n')
  }

  /**
   * 格式化 AI 上下文注入（skill-assisted 场景）
   *
   * 截取 Skill 内容的前 2000 字符（约 667 token），避免上下文过长
   */
  private formatContextInjection(match: SkillMatchResult): string {
    const { skill } = match
    const truncated = skill.content.length > 2000
      ? skill.content.slice(0, 2000) + '\n\n...(内容已截断，完整内容请查看 Skill 文件)'
      : skill.content
    return [
      `[参考运维 Skill: ${skill.name}]`,
      skill.description,
      '',
      '关键诊断步骤:',
      truncated,
    ].join('\n')
  }
}
