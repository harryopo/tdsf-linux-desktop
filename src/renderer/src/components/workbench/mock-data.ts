/**
 * mock-data — Workbench AI 共享类型与快捷模板
 *
 * v2.3.6 修复：彻底移除 MOCK_CHAT_MESSAGES（设计稿示例消息）和 MOCK_COMPOSER_CHIPS 名称。
 * - 移除 MOCK_CHAT_MESSAGES：不再给用户"假数据"错觉
 * - MOCK_COMPOSER_CHIPS → QUICK_PROMPT_TEMPLATES：澄清为"快捷模板"而非 mock 数据
 * - 保留 ChatMessage / AIToolPanel / ChatBlock 类型（MessageRow 等组件依赖）
 *
 * R15 清理：移除了 10 个死代码导出（文件树/编辑器标签/终端输出/状态栏/Token 曲线）
 * 及关联的 7 个死类型定义。仅保留 AI 面板相关类型和常量。
 */

// ============================================================
// 1. AI 对话消息类型（MessageRow / LiveMessageRow 依赖）
// ============================================================

/** 消息类型（内部使用，外部通过 ChatMessage 引用） */
type ChatRole = 'user' | 'ai'

/** AI 工具面板类型（内部使用，外部通过 AIToolPanel 引用） */
type AIToolType =
  | 'thought'
  | 'skill'
  | 'knowledge'
  | 'web'
  | 'methodology'
  | 'command'
  | 'metric'
  | 'evidence'
  | 'summary'
  | 'summary-card'
  | 'progress'
  | 'rollback'
  | 'pause'

/** 工具面板内容（简化结构，渲染时由组件决定样式） */
export interface AIToolPanel {
  type: AIToolType
  title: string
  /** 状态徽章文本（如"分析完成"、"v1.2"、"3条匹配"） */
  badge?: string
  /** 状态徽章颜色 key */
  badgeVariant?: 'brand' | 'success' | 'warning' | 'error' | 'neutral' | 'violet'
  /** 耗时（秒） */
  duration?: number
  /** 是否默认展开 */
  defaultOpen?: boolean
  /** 子步骤列表（如思考步骤、执行步骤） */
  steps?: Array<{ label: string; description?: string; status?: 'success' | 'active' | 'pending'; duration?: number; hint?: string }>
  /** 关联命令（command 类型用） */
  command?: { prompt: string; cmd: string; translation?: string; output?: string[]; success?: boolean }
  /** 指标对比表（metric 类型用） */
  metrics?: Array<{ label: string; before: string; after: string; delta: string; beforeColor?: string; deltaColor?: string }>
  /** 证据来源（evidence 类型用） */
  evidences?: Array<{ label: string; percent: number; color?: string }>
  /** 知识库结果（knowledge 类型用） */
  kbResults?: Array<{ id: string; title: string; percent: number; color?: string; desc?: string; cited?: boolean }>
  /** 联网搜索结果（web 类型用） */
  webResults?: Array<{ title: string; source: string; percent: number; highMatch?: boolean }>
  /** SRE 黄金信号（methodology 类型用） */
  signals?: Array<{ label: string; value: string; color: string; statusColor?: string }>
  /** 汇总卡片完成项（summary-card 类型用） */
  summaryItems?: string[]
  /** 回滚面板（rollback 类型用） */
  rollback?: { cmd: string; reason: string; status: string; time?: string }
  /** 暂停面板（pause 类型用） */
  pause?: { description: string; pausedFor: string }
  /** Skill 元信息（skill 类型用，显示输入/输出参数） */
  skillMeta?: { name: string; version: string; scope: string; input: string; output: string }
}

/** AI 消息内容块（表格、洞察、操作按钮等富文本） */
export type ChatBlock =
  | { type: 'paragraph'; text: string }
  | {
      type: 'table'
      headers: string[]
      rows: Array<{ cells: string[]; cellColors?: (string | undefined)[] }>
    }
  | { type: 'insight'; title: string; text: string }
  | { type: 'actions'; buttons: Array<{ label: string; primary?: boolean; navigate: string }> }

/** 一条对话消息（MessageRow 依赖，描述历史回放/未走真实流的 UI 元素） */
export interface ChatMessage {
  id: string
  role: ChatRole
  /** 用户消息文本 */
  text?: string
  /** 用户消息时间戳 */
  time?: string
  /** AI 消息包含的工具面板序列 */
  panels?: AIToolPanel[]
  /** AI 文字摘要 */
  summary?: string
  /** 摘要样式变体：plain=纯文本（如 Msg 2），checked=带 check-circle 图标（如 Msg 5） */
  summaryVariant?: 'plain' | 'checked'
  /** AI 富文本内容块 */
  blocks?: ChatBlock[]
  /** Token 使用量 */
  tokens?: number
  /** 耗时（秒） */
  duration?: number
}

// ============================================================
// 2. Composer 快捷提示词模板
// ============================================================

/**
 * Composer 快捷提示词模板（运维场景）
 *
 * v2.3.6 重命名：MOCK_COMPOSER_CHIPS → QUICK_PROMPT_TEMPLATES
 * 澄清语义：这是"快捷提示词模板"（点击填入输入框），不是 mock 数据。
 *
 * 用途：点击后把对应的运维提示词一键填入输入框（不是直接发送），由用户审阅后再发送。
 */
export const QUICK_PROMPT_TEMPLATES = ['诊断', '部署', '巡检', '回滚', '扩容'] as const

export type QuickPromptTemplate = (typeof QUICK_PROMPT_TEMPLATES)[number]
