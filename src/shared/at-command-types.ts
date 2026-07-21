/**
 * @命令共享类型（主进程 + Preload + 渲染进程三端共享）
 *
 * v0.9 一次性补齐 8 类 @命令的完整类型契约：
 * - 类型枚举：AtCommandType / AtCommandSource
 * - 基础接口：AtCommand（统一所有 @命令的数据结构）
 * - 8 类 payload：LogCommandPayload / CmdCommandPayload / FileCommandPayload /
 *                 MetricCommandPayload / DecisionCommandPayload / KbCommandPayload /
 *                 SkillCommandPayload / ServerCommandPayload
 * - 展示元数据：AT_COMMAND_LABELS / AT_COMMAND_ICONS / AT_COMMAND_LIST
 *
 * 设计原则：
 * - 不依赖 main 进程的任何模块（确保 preload/renderer 可安全导入）
 * - 所有类型均为 export type / export interface，无运行时副作用
 * - 常量（AT_COMMAND_LABELS / AT_COMMAND_ICONS / AT_COMMAND_LIST）为纯数据，可安全序列化跨 IPC 传输
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令）+ §4.3（@命令接口契约）
 */

/**
 * @命令类型枚举（8 类）
 *
 * 方案书 §4.1 表
 *
 * | 类型     | 中文     | 用途                          |
 * |----------|----------|-------------------------------|
 * | log      | 日志     | 日志片段注入                  |
 * | cmd      | 命令     | 命令 + 预测结果注入           |
 * | file     | 文件     | 远程文件内容注入              |
 * | metric   | 指标     | 监控指标注入                  |
 * | decision | 决策     | 历史决策注入                  |
 * | kb       | 知识库   | 知识库条目注入                |
 * | skill    | Skill   | skill 调用注入                |
 * | server   | 服务器   | 服务器信息注入                |
 */
export type AtCommandType =
  | 'log' // 日志片段
  | 'cmd' // 命令 + 预测结果
  | 'file' // 远程文件内容
  | 'metric' // 监控指标
  | 'decision' // 历史决策
  | 'kb' // 知识库条目
  | 'skill' // skill 调用
  | 'server' // 服务器信息

/**
 * @命令来源标识（决定数据来源）
 *
 * 用于审计与回溯：每条 @命令注入 LLM 时会记录来源，便于后续溯源。
 */
export type AtCommandSource =
  | 'ide' // IDE 文件树 / 编辑器
  | 'terminal' // 终端
  | 'monitor' // 监控面板
  | 'history' // 历史面板
  | 'knowledge' // 知识库面板
  | 'chat-input' // ChatPanel 输入框直接输入 @
  | 'drag-drop' // 拖拽注入

/**
 * @命令基础接口（统一契约）
 *
 * 方案书 §4.3 v0.9 接口契约
 *
 * 每条 @命令在解析完成后，统一转换为 AtCommand 对象，
 * 由 ChatPanel 拼装到 LLM prompt 中。
 */
export interface AtCommand {
  /** 命令类型（8 类之一） */
  type: AtCommandType
  /** 各类命令的具体数据（按 type 解析为对应 payload 类型） */
  payload: AtCommandPayload
  /** 来源标识（IDE/终端/监控/历史等） */
  source: AtCommandSource
  /** 时间戳（ms） */
  timestamp: number
  /** 显示文本（在 ChatPanel 输入框中显示为 Chip 的内容，如 '@file /etc/hosts'） */
  displayText: string
  /** 注入到 LLM 的实际内容（已格式化的文本，可直接拼接到 prompt） */
  injectedText: string
}

/**
 * @命令 payload 联合类型（按 type 区分）
 *
 * 使用时通过 `cmd.type` 做类型守卫，再断言 payload 为对应的具体类型。
 */
export type AtCommandPayload =
  | LogCommandPayload
  | CmdCommandPayload
  | FileCommandPayload
  | MetricCommandPayload
  | DecisionCommandPayload
  | KbCommandPayload
  | SkillCommandPayload
  | ServerCommandPayload

/** @log 命令 payload（日志片段注入） */
export interface LogCommandPayload {
  /** 日志原文 */
  rawText: string
  /** 来源分类（如 'syslog' / 'nginx' / 'application'） */
  category?: string
  /** 时间范围（开始-结束 ISO 时间） */
  timeRange?: { start: string; end: string }
}

/** @cmd 命令 payload（命令 + 预测结果注入） */
export interface CmdCommandPayload {
  /** 命令原文 */
  command: string
  /** 命令预测结果（执行后的输出，可选） */
  predictedOutput?: string
  /** 历史执行次数 */
  useHistory?: number
}

/** @file 命令 payload（远程文件内容注入） */
export interface FileCommandPayload {
  /** 远程文件绝对路径 */
  remotePath: string
  /** 文件内容 */
  content: string
  /** 文件大小（字节） */
  size: number
  /** 文件 MIME 类型（可选） */
  mimeType?: string
}

/** @metric 命令 payload（监控指标注入） */
export interface MetricCommandPayload {
  /** 指标名（如 'cpu' / 'memory' / 'disk'） */
  metric: string
  /** 当前值 */
  value: number
  /** 单位（如 '%' / 'MB'） */
  unit: string
  /** 历史值序列（可选，用于趋势分析） */
  history?: Array<{ timestamp: number; value: number }>
}

/** @decision 命令 payload（历史决策注入） */
export interface DecisionCommandPayload {
  /** 决策卡片 ID */
  decisionId: string
  /** 决策摘要 */
  summary: string
  /** 完整决策卡片（JSON 字符串，可选） */
  fullCard?: string
}

/** @kb 命令 payload（知识库条目注入） */
export interface KbCommandPayload {
  /** 知识条目 ID */
  entryId: string
  /** 知识类型 */
  type: 'command_skill' | 'incident_case' | 'tutorial'
  /** 标题 */
  title: string
  /** 内容摘要 */
  content: string
}

/** @skill 命令 payload（skill 调用） */
export interface SkillCommandPayload {
  /** skill 名称 */
  skillName: string
  /** skill 调用参数 */
  args?: Record<string, unknown>
  /** skill 来源（'trae' / 'claude' / 'custom'） */
  source?: 'trae' | 'claude' | 'custom'
}

/** @server 命令 payload（服务器信息注入） */
export interface ServerCommandPayload {
  /** 服务器 ID */
  serverId: string
  /** 服务器名称 */
  name: string
  /** 主机地址 */
  host: string
  /** 端口 */
  port: number
  /** 操作系统（可选） */
  os?: string
  /** 内核版本（可选） */
  kernel?: string
}

/**
 * 8 类 @命令的展示标签（中文）
 *
 * 用于 ChatPanel @命令选择器、Chip 显示、UI 提示等。
 */
export const AT_COMMAND_LABELS: Record<AtCommandType, string> = {
  log: '日志',
  cmd: '命令',
  file: '文件',
  metric: '指标',
  decision: '决策',
  kb: '知识库',
  skill: 'Skill',
  server: '服务器',
}

/**
 * 8 类 @命令的图标（Ant Design 图标名，UI 用）
 *
 * 图标命名与 @ant-design/icons 的导出保持一致。
 */
export const AT_COMMAND_ICONS: Record<AtCommandType, string> = {
  log: 'FileTextOutlined',
  cmd: 'CodeOutlined',
  file: 'FileOutlined',
  metric: 'LineChartOutlined',
  decision: 'HistoryOutlined',
  kb: 'BookOutlined',
  skill: 'ToolOutlined',
  server: 'CloudServerOutlined',
}

/**
 * 8 类 @命令的展示信息（UI 选择器列表）
 *
 * 一份数据源（Single Source of Truth）：UI 选择器、帮助文档、IPC at:list 都从此派生。
 */
export const AT_COMMAND_LIST: Array<{
  type: AtCommandType
  label: string
  icon: string
  description: string
}> = [
  { type: 'log', label: '日志', icon: AT_COMMAND_ICONS.log, description: '注入日志片段（鼠标划选 + 拖拽）' },
  { type: 'cmd', label: '命令', icon: AT_COMMAND_ICONS.cmd, description: '注入命令 + 预测结果' },
  { type: 'file', label: '文件', icon: AT_COMMAND_ICONS.file, description: '注入远程文件内容（IDE 拖拽）' },
  { type: 'metric', label: '指标', icon: AT_COMMAND_ICONS.metric, description: '注入监控指标（监控面板拖拽）' },
  { type: 'decision', label: '决策', icon: AT_COMMAND_ICONS.decision, description: '注入历史决策（历史面板拖拽）' },
  { type: 'kb', label: '知识库', icon: AT_COMMAND_ICONS.kb, description: '注入知识库条目（@ 触发搜索）' },
  { type: 'skill', label: 'Skill', icon: AT_COMMAND_ICONS.skill, description: '调用 skill（MCP 协议）' },
  { type: 'server', label: '服务器', icon: AT_COMMAND_ICONS.server, description: '注入服务器信息（服务器列表拖拽）' },
]

/**
 * @命令解析结果（at:parse IPC 通道返回）
 *
 * 由 AtCommandParser.parse() 返回，包含去除 @命令后的纯文本和解析出的命令列表。
 */
export interface AtCommandParseResult {
  /** 去除 @命令后的纯文本（用户原始输入减去 @命令片段） */
  text: string
  /** 解析出的 @命令列表（已 resolve 为 AtCommand 对象，可拼装到 prompt） */
  commands: AtCommand[]
}
