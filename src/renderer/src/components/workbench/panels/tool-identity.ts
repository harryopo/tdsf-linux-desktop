/**
 * 工具调用的身份判定（AI 面板显示链路的唯一入口）
 *
 * 为什么单独一个文件：改之前这里只有两条分支——"命令类"和"其余一律按检索渲染"。
 * 于是知识库检索、技能匹配、长期记忆、MCP 工具、模型装配提示全挤在同一种折叠行里，
 * 名字还是模型调用的英文原名（`monitor_get_data` 这种），用户看不出 agent 到底干了哪类事。
 * 用户点名的这几类（skill / MCP / 知识库 / 思考 / 命令输入输出）现在各有身份。
 *
 * 判据配套：tests/unit/tool-identity.test.ts 会去主进程那份工具目录里对名单，
 * 新增工具而这里没登记，测试当场红（免得又变成"界面显示英文原名"）。
 */
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BookOpen,
  Boxes,
  Cpu,
  FileText,
  Layers,
  Search,
  Sparkles,
  Terminal as TerminalIcon,
  Wrench,
} from 'lucide-react'

/** 工具类别（决定卡片形状与徽标语气） */
export type ToolKind =
  /** 真的在远端跑了一条命令（输入是命令、输出是 stdout） */
  | 'command'
  /** 读文件 */
  | 'file'
  /** 知识库 / 教程检索 */
  | 'knowledge'
  /** 技能包匹配 */
  | 'skill'
  /** 长期记忆召回 */
  | 'memory'
  /** 监控指标读数 */
  | 'metric'
  /** MCP 工具（外部服务器提供） */
  | 'mcp'
  /** 模型侧的装配/路由提示，不是对系统的操作 */
  | 'route'
  /** 没登记过：照原名显示，绝不猜 */
  | 'unknown'

export interface ToolIdentity {
  kind: ToolKind
  /** 中文展示名；unknown 时就是模型调用的原名（不编一个中文名糊弄过去） */
  label: string
  icon: LucideIcon
}

/**
 * 已登记的工具名。
 *
 * 名单必须与 src/main/core/agent/tools/chat-tool-router.ts 的 ChatToolId 对齐，
 * 那条对账由 tests/unit/tool-identity.test.ts 跑真文件内容，不靠注释自觉。
 */
const KNOWN_TOOLS: Record<string, ToolIdentity> = {
  ssh_readonly: { kind: 'command', label: '只读诊断命令', icon: TerminalIcon },
  ssh_write: { kind: 'command', label: '写操作命令', icon: TerminalIcon },
  ssh_journal_follow: { kind: 'command', label: '实时日志追踪', icon: TerminalIcon },
  ssh_exec: { kind: 'command', label: '执行命令', icon: TerminalIcon },
  sftp_read: { kind: 'file', label: '读远程文件', icon: FileText },
  kb_search: { kind: 'knowledge', label: '检索知识库', icon: Layers },
  tutorial_search: { kind: 'knowledge', label: '检索教程', icon: BookOpen },
  skill_match: { kind: 'skill', label: '匹配技能', icon: Wrench },
  memory_recall: { kind: 'memory', label: '回忆长期记忆', icon: Sparkles },
  // 真名是 monitor_get_data（src/shared/llm-tool-types.ts 的 TOOL_IDS）；
  // 这里曾写 monitor_get，于是这张卡从来没按监控渲染过
  monitor_get_data: { kind: 'metric', label: '采集监控指标', icon: Activity },
  profiler_run: { kind: 'metric', label: '运行性能剖析', icon: Activity },
  deploy_list_templates: { kind: 'knowledge', label: '列出部署模板', icon: Boxes },
  tool_route: { kind: 'route', label: '工具装配', icon: Cpu },
  thinking_route: { kind: 'route', label: '思考强度选择', icon: Cpu },
}

/** 类别徽标文案（面板里那一格小标签） */
export const TOOL_KIND_LABELS: Record<ToolKind, string> = {
  command: '命令',
  file: '文件',
  knowledge: '知识库',
  skill: '技能',
  memory: '记忆',
  metric: '监控',
  mcp: 'MCP',
  route: '装配',
  unknown: '工具',
}

/**
 * 进行中的说法按类别分。
 *
 * 以前所有非命令类都写死"检索中…"，于是 MCP 调用、技能匹配、模型装配
 * 都在报"检索"——用户据此以为 agent 在查资料，其实它在调外部工具。
 */
export const TOOL_KIND_RUNNING_LABELS: Record<ToolKind, string> = {
  command: '执行中…',
  file: '读取中…',
  knowledge: '检索中…',
  skill: '匹配中…',
  memory: '回忆中…',
  metric: '采集中…',
  mcp: '调用中…',
  route: '装配中…',
  unknown: '调用中…',
}

/**
 * 入参那一行的提示词。
 *
 * 以前不分类别一律写"查询："，于是 MCP 的 JSON 入参、监控的目标、
 * 读文件的路径都被叫成"查询"——界面在替用户编一个没发生过的动作。
 */
export const TOOL_KIND_INPUT_LABELS: Record<ToolKind, string> = {
  command: '命令',
  file: '路径',
  knowledge: '查询',
  skill: '手册',
  memory: '回忆关键词',
  metric: '采集对象',
  mcp: '入参',
  route: '判断依据',
  unknown: '入参',
}

/**
 * 入参是不是"结构化数据"（JSON 串）。
 *
 * 主进程对没有 command/query 字段的入参会 JSON.stringify（见 supervisor 的
 * tool-call 分支），于是 MCP 的入参形如 {"path":"...","limit":5}。
 * 这种串塞进"查询：“…”"的引号里就是一团读不懂的字，要按代码样式单独排版。
 */
export function isStructuredInput(input: string): boolean {
  const t = input.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

/**
 * 判定一次工具调用的身份
 *
 * MCP 工具的命名带分隔符（`server__tool` / `mcp__server__tool` 两式都见过），
 * 认出来就显示成「server · tool」，不再甩一长串英文给用户。
 */
export function identifyTool(name: string | undefined): ToolIdentity {
  const raw = name ?? 'tool'
  const known = KNOWN_TOOLS[raw]
  if (known) return known

  const mcp = /^(?:mcp__)?([A-Za-z0-9._-]+?)__([A-Za-z0-9._-]+)$/.exec(raw)
  if (mcp) {
    return { kind: 'mcp', label: `${mcp[1]} · ${mcp[2]}`, icon: Boxes }
  }

  return { kind: 'unknown', label: raw, icon: Search }
}

/** 这一类是不是"对系统真的动了手"（决定要不要给审批/风险相关的视觉） */
export function isCommandKind(kind: ToolKind): boolean {
  return kind === 'command'
}
