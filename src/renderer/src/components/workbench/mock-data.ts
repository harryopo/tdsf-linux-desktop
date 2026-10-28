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
 * 快捷提示词的**唯一正文来源**（#253）。
 *
 * 为什么要有这一份：同一句「请诊断当前主机健康状态…」以前在 Composer 的 prompts 表和
 * MessageList 的欢迎态里各抄了一份；而「性能 / 扩容」那两条因为没人同步，
 * 已经漂成两种说法——界面上就是"两个入口，两种问法"，改一处另一处照旧发出去。
 * 现在正文只写在这里，快捷排与欢迎态都只引用键。判据：
 * `tests/unit/quick-prompt-single-source.test.ts`（含"消费点不许留抄本"与它的反向对照）。
 *
 * 「扩容」与「性能」是**故意**分开的两条：一个问要不要加资源，一个问现在哪里在拖慢。
 */
export const QUICK_PROMPTS = {
  诊断:
    '请诊断当前主机健康状态：磁盘(df -h)、内存(free -m)、负载(uptime)、关键服务(systemctl --failed)。只读命令，给出结论与建议。',
  部署:
    '请给出 Nginx 反向代理部署检查清单：配置语法、端口监听、上游健康、证书与 reload 风险点。',
  巡检:
    '请做一次只读巡检：磁盘使用率、inode、内存与 swap、失败的 systemd 单元、最近 journal 错误摘要。',
  回滚:
    '若最近一次配置变更导致服务异常，请给出安全的回滚步骤与验证命令（先读后写，写操作需人工确认）。',
  扩容: '请分析当前资源瓶颈（CPU/内存/磁盘/网络）并给出扩容建议与验证指标。',
  性能: '请分析当前服务器的性能瓶颈（CPU/内存/磁盘IO/网络）并给出优化建议，只读命令采集。',
  失败命令: '我刚才这条命令失败了，请解释报错原因并推荐安全的下一步：',
  配置文件: '请帮我分析以下配置文件的含义与潜在问题：',
} as const satisfies Record<string, string>

export type QuickPromptKey = keyof typeof QUICK_PROMPTS

/**
 * Composer 顶部快捷排显示哪几条、按什么顺序（正文一律取自 QUICK_PROMPTS）
 *
 * v2.3.6 重命名：MOCK_COMPOSER_CHIPS → QUICK_PROMPT_TEMPLATES
 * 澄清语义：这是"快捷提示词模板"（点击填入输入框），不是 mock 数据。
 * 用途：点击后把对应的运维提示词一键填入输入框（不是直接发送），由用户审阅后再发送。
 */
export const QUICK_PROMPT_TEMPLATES = ['诊断', '部署', '巡检', '回滚', '扩容'] as const satisfies
  readonly QuickPromptKey[]

export type QuickPromptTemplate = (typeof QUICK_PROMPT_TEMPLATES)[number]

/**
 * 欢迎态那一列建议行：一句人话的标签 + 引用哪一条正文（同样只写键）
 *
 * 图标住在 MessageList 里（那是渲染细节），这里只放文案与引用。
 */
export const WELCOME_SUGGESTIONS = [
  { key: '诊断', label: '查这台机器哪里不对劲：磁盘、内存、负载、失败服务' },
  { key: '失败命令', label: '解释一条刚跑完的失败命令，并给安全的下一步' },
  { key: '配置文件', label: '读一个配置文件，讲清它写了什么、有什么坑' },
  { key: '性能', label: '找性能瓶颈：CPU、内存、磁盘 IO、网络' },
] as const satisfies readonly { key: QuickPromptKey; label: string }[]
