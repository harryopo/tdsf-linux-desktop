/**
 * Skill 中台 v1 类型定义
 *
 * 基于 SKILL.md v2.0 规范
 * 参考：docs/skill-research/03-Skill中台设计方案.md
 *
 * 设计原则：
 * - 类型 SSOT（Single Source of Truth）
 * - 零外部依赖（不引入 yaml / gray-matter）
 * - 兼容现有 SKILL.md 文件格式
 */

/** Skill 风险等级 */
export type SkillRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** Skill 分类 */
export type SkillCategory =
  | 'troubleshooting' // 故障诊断
  | 'environment-check' // 环境检查
  | 'deployment' // 部署
  | 'security' // 安全
  | 'development' // 开发
  | 'teaching' // 教学知识

/** Skill 触发条件 */
export interface SkillTrigger {
  /** 关键词触发（终端输出/用户提问匹配，大小写不敏感） */
  keywords: string[]
  /** 正则模式触发（终端输出匹配） */
  patterns: string[]
  /** 语义触发（AI 意图识别，简单词重叠匹配） */
  semantic: string[]
}

/** Skill 元数据（从 YAML frontmatter 解析） */
export interface SkillMetadata {
  /** Skill 唯一标识（kebab-case） */
  name: string
  /** Skill 描述（一句话说明用途） */
  description: string
  /** 触发条件 */
  triggers: SkillTrigger
  /** 风险等级（决定执行前是否需要人工审批） */
  riskLevel: SkillRiskLevel
  /** 分类（用于按类查询） */
  category: SkillCategory
  /** 标签（用于检索和过滤） */
  tags: string[]
}

/** 完整的 Skill 对象（元数据 + 正文） */
export interface Skill extends SkillMetadata {
  /** Markdown 正文（不含 frontmatter，包含 Steps 详解、教学说明等） */
  content: string
  /** 文件绝对路径 */
  filePath: string
  /** 是否为内置 Skill（vs 用户自定义） */
  builtin: boolean
}

/** Skill 匹配结果 */
export interface SkillMatchResult {
  /** 匹配的 Skill */
  skill: Skill
  /** 匹配分数（0-1，越高越匹配） */
  score: number
  /** 匹配原因（用于调试和 UI 展示） */
  reason: string
}
