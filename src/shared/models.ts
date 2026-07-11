/**
 * TDSF-Linux Desktop 共享数据模型
 * 主进程、Preload、渲染进程三端共享的类型定义
 */

// ============================================================================
// SSH 相关类型
// ============================================================================

/** SSH 认证方式 */
export type SshAuthType = 'password' | 'privateKey'

/** SSH 连接配置 */
export interface SshConfig {
  /** 服务器唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** 主机地址 */
  host: string
  /** 端口号，默认 22 */
  port: number
  /** 用户名 */
  username: string
  /** 认证方式 */
  authType: SshAuthType
  /** 密码（authType='password' 时使用） */
  password?: string
  /** 私钥文件路径（authType='privateKey' 时使用） */
  privateKeyPath?: string
  /** 私钥内容（直接传入，优先于 privateKeyPath） */
  privateKey?: string
  /** 私钥口令（可选） */
  passphrase?: string
  /** 跳板机配置（可选） */
  jumpHost?: Omit<SshConfig, 'id' | 'name' | 'jumpHost'>
  /** 是否保持连接 */
  keepAlive?: boolean
}

/** SSH 命令执行结果 */
export interface CommandResult {
  /** 退出码，0 表示成功 */
  exitCode: number
  /** 标准输出 */
  stdout: string
  /** 标准错误 */
  stderr: string
  /** 执行耗时（毫秒） */
  duration: number
}

/** SSH 连接状态 */
export type SshConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * 服务器凭证（敏感信息，加密存储）
 *
 * 通过 SafeStore 加密保存，不写入 electron-store 明文配置。
 * key 格式：`server-cred-{serverId}`
 */
export interface ServerCredential {
  /** 密码（authType='password' 时使用） */
  password?: string
  /** 私钥内容（authType='privateKey' 时使用） */
  privateKey?: string
  /** 私钥口令（可选） */
  passphrase?: string
}

// ============================================================================
// 监控相关类型
// ============================================================================

/** 服务器监控数据 */
export interface MonitorData {
  /** 时间戳 */
  timestamp: number
  /** CPU 使用率（%） */
  cpuUsage: number
  /** 内存使用率（%） */
  memoryUsage: number
  /** 磁盘使用率（%） */
  diskUsage: number
  /** 网络入站速率（KB/s） */
  networkIn: number
  /** 网络出站速率（KB/s） */
  networkOut: number
  /** 系统负载（1分钟平均） */
  loadAverage: number
  /** 运行时长（秒） */
  uptime: number
  /** 进程数 */
  processCount: number
}

/** 系统信息（静态） */
export interface SystemInfo {
  hostname: string
  os: string
  kernel: string
  architecture: string
  cpuModel: string
  cpuCores: number
  totalMemory: number
  totalDisk: number
}

// ============================================================================
// LLM 相关类型
// ============================================================================

/** LLM 配置 */
export interface LlmConfig {
  /** API Base URL */
  baseUrl: string
  /** API Key（加密存储） */
  apiKey: string
  /** 模型名称 */
  model: string
  /** 温度参数（0-2） */
  temperature: number
  /** 最大 tokens */
  maxTokens: number
  /** 请求超时（毫秒） */
  timeout: number
}

/** 对话消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** 工具调用时的名称 */
  name?: string
  /** 工具调用 ID */
  toolCallId?: string
}

/** LLM 流式响应的 token 块 */
export interface LlmStreamChunk {
  /** 本次增量文本 */
  delta: string
  /** 累计 token 数（可选，部分 API 不返回） */
  totalTokens?: number
}

/** LLM 错误信息 */
export interface LlmError {
  /** 错误码（如 'NETWORK'、'TIMEOUT'、'AUTH'、'RATE_LIMIT'、'UNKNOWN'） */
  code: string
  /** 用户可读的错误信息（不包含 stack trace） */
  message: string
  /** 是否可重试 */
  retryable: boolean
}

/** LLM 配置校验结果 */
export interface LlmValidationResult {
  /** 是否有效 */
  valid: boolean
  /** 错误信息列表（valid=false 时有值） */
  errors: string[]
}

/**
 * 系统环境上下文
 *
 * 用于 llm:chat-with-context 通道，将当前系统状态传递给 LLM。
 * 由 SystemInfo（静态）+ MonitorData（动态）合并而成。
 */
export interface EnvironmentContext {
  /** 主机名 */
  hostname: string
  /** 操作系统版本 */
  os: string
  /** 内核版本 */
  kernel: string
  /** CPU 型号 */
  cpuModel: string
  /** CPU 核心数 */
  cpuCores: number
  /** 总内存（字节） */
  totalMemory: number
  /** 总磁盘（字节） */
  totalDisk: number
  /** CPU 使用率（%） */
  cpuUsage: number
  /** 内存使用率（%） */
  memoryUsage: number
  /** 磁盘使用率（%） */
  diskUsage: number
  /** 系统运行时长（秒） */
  uptime: number
  /** 当前进程数 */
  processCount: number
  /** 系统负载（1分钟平均） */
  loadAverage: number
}

/** 命令执行结果上下文（用于提示词构建） */
export interface CommandExecutionContext {
  /** 执行的命令 */
  command: string
  /** 命令输出 */
  output: string
  /** 退出码，0 表示成功 */
  exitCode: number
}

// ============================================================================
// 核心算法类型
// ============================================================================

/** 证据来源类型 */
export type EvidenceSource = 'log' | 'metric' | 'command' | 'config' | 'knowledge'

/** 证据条目 */
export interface Evidence {
  /** 证据 ID */
  id: string
  /** 来源类型 */
  source: EvidenceSource
  /** 来源描述（如 "/var/log/syslog"） */
  sourceDetail: string
  /** 证据内容 */
  content: string
  /** Drain3 模板匹配度 [0, 1] */
  drainMatch: number
  /** 来源先验可信度 [0, 1] */
  sourcePrior: number
  /** 置信度 [0, 1]（计算得出） */
  confidence: number
  /** 时间戳 */
  timestamp: number
  /** 是否通过 Ground-Check */
  verified: boolean
}

/** 风险等级 */
export type RiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

/** 风险评估结果 */
export interface RiskAssessment {
  level: RiskLevel
  /** 风险评分 [0, 100] */
  score: number
  /** 命中的规则 */
  matchedRules: string[]
  /** 风险描述 */
  description: string
  /** 是否需要人工确认 */
  requireConfirmation: boolean
  /** 是否被阻止 */
  blocked: boolean
}

/** 决策卡片 */
export interface DecisionCard {
  id: string
  /** 问题描述 */
  problem: string
  /** 根因假设 */
  hypothesis: string
  /** 证据链 */
  evidences: Evidence[]
  /** 综合置信度 */
  confidence: number
  /** 风险评估 */
  risk: RiskAssessment
  /** 修复命令 */
  fixCommand: string
  /** 修复说明 */
  fixDescription: string
  /** 回滚命令 */
  rollbackCommand?: string
  /** 状态 */
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'verified' | 'failed'
  /** 时间戳 */
  timestamp: number
  /** 关联的会话 ID */
  sessionId?: string
}

// ============================================================================
// Agent 工作流类型
// ============================================================================

/** Agent 工作流步骤 */
export type AgentStep =
  | 'collect'      // 采集环境
  | 'analyze'      // 分析日志
  | 'reason'       // 生成建议
  | 'check'        // 安全检查
  | 'confirm'      // 人工确认
  | 'execute'      // 执行命令
  | 'verify'       // 验证结果

/** Agent 工作流状态 */
export interface AgentWorkflowState {
  /** 当前步骤 */
  currentStep: AgentStep
  /** 已完成步骤 */
  completedSteps: AgentStep[]
  /** 步骤详情 */
  stepDetails: Record<AgentStep, string>
  /** 是否等待人工确认 */
  waitingForConfirmation: boolean
  /** 决策卡片 */
  decisionCard: DecisionCard | null
  /** 错误信息 */
  error: string | null
  /** 时间戳 */
  timestamp: number
}

// ============================================================================
// 知识库类型（知识双轨制）
// ============================================================================

/** 知识类型 */
export type KnowledgeType = 'command_skill' | 'incident_case'

/** 知识条目（command_skills + incident_cases 双轨制） */
export interface KnowledgeEntry {
  id: string
  /** 知识类型 */
  type: KnowledgeType
  /** 标题 */
  title: string
  /** 问题描述 */
  problem: string
  /** 根因 */
  rootCause?: string
  /** 修复命令 */
  commands: string[]
  /** 回滚命令 */
  rollbackCommands?: string[]
  /** 验证方法 */
  verification?: string
  /** 关键词（用于检索） */
  keywords: string[]
  /** 标签 */
  tags: string[]
  /** 成功率 [0, 1] */
  successRate: number
  /** 使用次数 */
  useCount: number
  /** 向量嵌入（用于相似度搜索） */
  embedding?: number[]
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

// ============================================================================
// IPC 通道类型映射
// ============================================================================

/** IPC 通道参数和返回值类型映射 */
export interface IpcChannelMap {
  // SSH 相关
  'ssh:connect': { args: [SshConfig]; return: string }
  'ssh:disconnect': { args: [string]; return: boolean }
  'ssh:exec': { args: [string, string]; return: CommandResult }
  'ssh:shell:start': { args: [string]; return: boolean }
  'ssh:shell:write': { args: [string, string]; return: boolean }
  'ssh:shell:resize': { args: [string, number, number]; return: boolean }
  'sftp:list': { args: [string, string]; return: SftpEntry[] }
  'sftp:upload': { args: [string, string, string]; return: boolean }
  'sftp:download': { args: [string, string, string]; return: boolean }
  'sftp:delete': { args: [string, string]; return: boolean }
  'sftp:rename': { args: [string, string, string]; return: boolean }
  'sftp:chmod': { args: [string, string, number]; return: boolean }

  // 监控相关
  'monitor:start': { args: [string, number]; return: boolean }
  'monitor:stop': { args: [string]; return: boolean }
  'monitor:getSystemInfo': { args: [string]; return: SystemInfo }

  // LLM 相关
  'llm:chat': { args: [ChatMessage[]]; return: string }
  'llm:test': { args: [LlmConfig]; return: boolean }
  'llm:analyze': { args: [string, Evidence[]]; return: string }
  'llm:validate': { args: [LlmConfig]; return: LlmValidationResult }
  'llm:chat-with-context': {
    args: [ChatMessage[], EnvironmentContext]
    return: string
  }

  // Agent 工作流
  'agent:start': { args: [string, string]; return: boolean }
  'agent:confirm': { args: [string, boolean]; return: boolean }
  'agent:cancel': { args: [string]; return: boolean }

  // 安全存储
  'storage:saveApiKey': { args: [string, string]; return: boolean }
  'storage:getApiKey': { args: [string]; return: string | null }
  'storage:deleteApiKey': { args: [string]; return: boolean }

  // 服务器列表管理
  'server:list': { args: []; return: SshConfig[] }
  'server:save': { args: [SshConfig[]]; return: boolean }
  'server:export': { args: []; return: string }
  'server:import': { args: [string]; return: SshConfig[] }
  'server:delete-cred': { args: [string]; return: boolean }

  // 配置存储
  'config:get': { args: [string]; return: unknown }
  'config:set': { args: [string, unknown]; return: boolean }

  // 知识库
  'kb:search': { args: [string, KnowledgeType?, number?]; return: KnowledgeEntry[] }
  'kb:add': { args: [KnowledgeEntry]; return: boolean }
  'kb:update': { args: [string, Partial<KnowledgeEntry>]; return: boolean }
  'kb:delete': { args: [string]; return: boolean }
  'kb:import': { args: [KnowledgeEntry[]]; return: number }
  'kb:export': { args: [KnowledgeType?]; return: KnowledgeEntry[] }

  // 决策历史
  'history:list': { args: [number?, number?]; return: DecisionCard[] }
  'history:get': { args: [string]; return: DecisionCard | null }
  'history:save': { args: [DecisionCard]; return: boolean }

  // 终端数据推送（主进程 → 渲染进程）
  'terminal:data': { args: [string, string]; return: void }
  'monitor:data': { args: [string, MonitorData]; return: void }
  'llm:token': { args: [string]; return: void }
  'llm:chunk': { args: [LlmStreamChunk]; return: void }
  'llm:done': { args: [string]; return: void }
  'llm:error': { args: [LlmError]; return: void }
  'agent:step': { args: [AgentWorkflowState]; return: void }
}

/** SFTP 目录条目 */
export interface SftpEntry {
  name: string
  longName: string
  isDirectory: boolean
  isFile: boolean
  isSymlink: boolean
  size: number
  modifyTime: number
  accessTime: number
  rights: {
    user: string
    group: string
    other: string
  }
  owner: string
  group: string
}
