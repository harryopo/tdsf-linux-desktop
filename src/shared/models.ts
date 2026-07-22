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
  /** 是否保持连接（启用心跳保活） */
  keepAlive?: boolean
  /** 心跳保活间隔（秒），不传时后端默认 30s */
  keepAliveIntervalSec?: number
  /**
   * 是否启用严格主机密钥校验（Phase L）
   * - true：首次连接弹窗确认，密钥变更拒绝连接
   * - false / undefined：跳过 known_hosts 校验（不推荐，存在中间人攻击风险）
   */
  strictHostKeyCheck?: boolean
  /**
   * known_hosts 文件路径（Phase L）
   * 不传时默认使用 `~/.ssh/known_hosts`（主进程解析为 app.getPath('home')/.ssh/known_hosts）
   */
  knownHostsPath?: string
}

// ============================================================================
// Phase L：SSH 主机密钥校验（known_hosts）相关类型
// ============================================================================

/** SSH 主机密钥类型（OpenSSH 兼容） */
export type SshHostKeyType =
  | 'ssh-rsa'
  | 'ssh-ed25519'
  | 'ecdsa-sha2-nistp256'
  | 'ecdsa-sha2-nistp384'
  | 'ecdsa-sha2-nistp521'
  | 'ssh-dss'
  | (string & {})

/** SSH 主机密钥元信息 */
export interface SshHostKeyMeta {
  /** 密钥类型（如 'ssh-ed25519'） */
  keyType: SshHostKeyType
  /** base64 编码的公钥数据（不含类型前缀） */
  keyData: string
  /** OpenSSH 兼容的 SHA256 指纹（格式：`SHA256:base64`） */
  sha256: string
}

/** known_hosts 校验结果状态 */
export type SshHostKeyStatus = 'match' | 'mismatch' | 'not-found' | 'revoked'

/** known_hosts 校验结果 */
export interface SshHostKeyCheckResult {
  /** 校验状态 */
  status: SshHostKeyStatus
  /** 当前服务器返回的密钥元信息 */
  currentKey: SshHostKeyMeta
  /** known_hosts 中已记录的密钥元信息（mismatch 时用于对比） */
  knownKey?: SshHostKeyMeta
}

/**
 * 主机密钥确认弹窗事件（主 → 渲染推送，Phase L）
 *
 * 当 hostVerifier 检测到首次连接（not-found）或密钥变更（mismatch）时，
 * 主进程通过 IPC 推送此事件到渲染进程，弹窗等待用户选择。
 */
export interface SshHostKeyPromptEvent {
  /** 唯一请求 ID，用于关联响应 */
  requestId: string
  /** 会话 ID（对应 SshConnectionManager 的 sessionId） */
  sessionId: string
  /** 服务器 ID（对应 SshConfig.id） */
  serverId: string
  /** 主机地址 */
  host: string
  /** 端口 */
  port: number
  /** 触发场景：首次连接 / 密钥变更 */
  scenario: 'unknown-host' | 'host-key-changed'
  /** 当前服务器返回的密钥元信息 */
  currentKey: SshHostKeyMeta
  /** known_hosts 中已记录的密钥元信息（仅 host-key-changed 时有值） */
  knownKey?: SshHostKeyMeta
  /** 构建好的提示文案（可直接展示） */
  promptMessage: string
}

/**
 * 用户对主机密钥弹窗的响应动作（渲染 → 主，Phase L）
 *
 * - accept-once：仅本次继续连接（不写入 known_hosts）
 * - accept-and-save：继续连接并保存密钥到 known_hosts
 * - reject：拒绝连接（终止握手）
 */
export type SshHostKeyResponseAction =
  | 'accept-once'
  | 'accept-and-save'
  | 'reject'

/**
 * 主机密钥响应载荷（渲染 → 主 invoke）
 *
 * 渲染进程通过 sshRespondHostKey(requestId, action) 响应主进程的弹窗推送。
 */
export interface SshHostKeyResponsePayload {
  /** 关联请求 ID */
  requestId: string
  /** 用户选择的动作 */
  action: SshHostKeyResponseAction
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
 * 心跳保活状态变更事件（主 → 渲染推送）
 *
 * 当心跳失败达到阈值后，先尝试自动重连（reconnecting），
 * 重连全部失败后推送最终断开（disconnected）。
 */
export interface SshStateEvent {
  /** 会话 ID */
  sessionId: string
  /** 服务器 ID（对应 SshConfig.id） */
  serverId: string
  /** 保活状态：reconnecting=正在重连 / disconnected=最终断开 */
  state: 'reconnecting' | 'disconnected'
  /** 状态变更原因（如「心跳连续失败 3 次」「重连 3 次均失败」） */
  reason: string
  /** 重连尝试次数（disconnected 时为总尝试次数，reconnecting 时为 0） */
  attemptCount: number
}

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
  /** 总内存（字节，由 free -b 采集） */
  totalMemory: number
  /** 总磁盘（字节，由 df -B1 采集） */
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
  /** 综合置信度 [0, 1] */
  confidence: number
  /**
   * Trident 三叉决策评分（借鉴 instructkr/claw-code §3.1）
   *
   * 每个子分数为 [0, 1]：
   * - dangerScore：命令危险度反向值（0=极高危，1=安全）
   *   ↪ 原始命令危险度 = 1 - dangerScore
   * - idempotentScore：操作幂等性（0=破坏性，1=完全幂等）
   *   ↪ 幂等操作可重复执行，非幂等只能执行一次
   * - relevanceScore：上下文关联度（0=无证据，1=充分证据）
   *   ↪ 来自 Evidence 数量 + 来源多样性
   *
   * 综合分计算公式：
   * confidence = dangerScore × 0.35 + idempotentScore × 0.25 + relevanceScore × 0.40
   *
   * 如果子分数缺失，则按"保守原则"全部填 0.5（中性），由 confidence 字段继续生效
   */
  trident?: {
    dangerScore: number
    idempotentScore: number
    relevanceScore: number
    /** 三叉综合分（与 confidence 一致，但显式标注来自 Trident） */
    compositeScore: number
    /** 三叉决策来源（哪个启发式 / 模型 / 规则） */
    source: 'heuristic' | 'llm' | 'hybrid'
  }
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
  /** Ground-Check 溯源验证统计（方案书 §4.2） */
  groundCheck?: {
    /** 证据总数 */
    total: number
    /** 通过溯源验证数 */
    verified: number
    /** 被拒绝数（疑似幻觉，标记"仅供参考"） */
    rejected: number
    /** 是否触发了定向重采（最多 1 次） */
    retried: boolean
  }
  /** analyze 步骤检测到的日志模式匹配（R14 增强） */
  logPatterns?: {
    /** 匹配的模式 ID */
    patternId: string
    /** 模式描述 */
    description: string
    /** 匹配次数 */
    matchCount: number
    /** 严重度 */
    severity: 'info' | 'warning' | 'critical'
  }[]
  /** 错误信息 */
  error: string | null
  /** 时间戳 */
  timestamp: number
}

// ============================================================================
// 知识库类型（知识双轨制）
// ============================================================================

/** 知识类型 */
export type KnowledgeType = 'command_skill' | 'incident_case' | 'tutorial'

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
  'monitor:systemInfo': { args: [string, SystemInfo]; return: void }
  'llm:token': { args: [string]; return: void }
  'llm:chunk': { args: [LlmStreamChunk]; return: void }
  'llm:done': { args: [string]; return: void }
  'llm:error': { args: [LlmError]; return: void }
  'agent:step': { args: [AgentWorkflowState]; return: void }

  // v0.9.5 P0 新增：MCP 5 阶段生命周期状态机（借鉴 claw-code §3.3）
  'mcp:get-state': { args: []; return: McpStateContext }
  'mcp:reset': { args: []; return: boolean }
  'mcp:state-changed': { args: [McpStateContext]; return: void }

  // v0.9.6 新增：外部 MCP Server（Client 侧）
  'mcp:external-status': { args: []; return: ExternalMcpServerStatus[] }
  'mcp:external-tools': { args: []; return: Array<{ name: string; description: string; serverId: string; serverName: string }> }
  'mcp:external-call': { args: [string, string, Record<string, unknown>]; return: { success: boolean; content: Array<{ type: 'text'; text: string }>; error?: string } }
  'mcp:external-reconnect': { args: [string]; return: boolean }
}

/** MCP 生命周期状态枚举（与 mcp-lifecycle.ts 同步） */
export type McpLifecycleState = 'connected' | 'degraded' | 'recovering' | 'failed' | 'backoff'

/** MCP 状态上下文 */
export interface McpStateContext {
  state: McpLifecycleState
  consecutiveFailures: number
  retryAttempts: number
  lastFailureAt: number | null
  lastFailureReason: string | null
  backoffUntil: number | null
  backoffRemainingSec: number
}

/** 外部 MCP Server 连接配置（Agent 作为 Client 调用外部工具） */
export interface ExternalMcpServer {
  /** 唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** 传输协议 */
  transport: 'stdio' | 'sse' | 'streamable-http'
  /** stdio 模式：可执行命令 */
  command?: string
  /** stdio 模式：命令参数 */
  args?: string[]
  /** stdio 模式：环境变量 */
  env?: Record<string, string>
  /** stdio 模式：工作目录 */
  cwd?: string
  /** sse/streamable-http 模式：URL */
  url?: string
  /** 是否启用 */
  enabled: boolean
  /** 连接超时（毫秒，默认 30000） */
  timeoutMs?: number
}

/** 外部 MCP Server 连接状态 */
export type ExternalMcpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** 外部 MCP Server 运行时状态 */
export interface ExternalMcpServerStatus {
  id: string
  name: string
  connectionState: ExternalMcpConnectionState
  toolCount: number
  error?: string
  lastConnectedAt?: number
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

// ============================================================================
// 系统架构感知（System Profiler）相关类型
// ============================================================================

/** Profiler 风险等级（区别于原 RiskLevel 的 SAFE/LOW/MEDIUM 等） */
export type ProfilerRiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** 风险项 */
export interface RiskItem {
  level: ProfilerRiskLevel
  category: string
  title: string
  description: string
  evidence: string
  suggestion: string
}

/** 单个探查项 */
export interface ProfilerItem {
  group: string
  groupLabel: string
  cmd: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  ok: boolean
  error?: string
}

/** 探查执行错误 */
export interface ProfilerError {
  group: string
  groupLabel: string
  cmd: string
  error: string
  durationMs: number
}

/** 探查结果 */
export interface ProfilerResult {
  host: string
  sessionId: string
  generatedAt: number
  totalDurationMs: number
  items: ProfilerItem[]
  errors: ProfilerError[]
  risks?: RiskItem[]
}

/** Profiler 执行响应（IPC 返回） */
export interface ProfilerRunResponse {
  result: ProfilerResult
  md: string
  risks: RiskItem[]
  summary: {
    total: number
    critical: number
    high: number
    medium: number
    low: number
    info: number
  }
}

// ============================================================================
// 日志系统类型（v0.7.0）
// ============================================================================

/** 日志级别 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

/** 日志条目（IPC logRead 返回） */
export interface LogEntry {
  /** 时间戳（ISO 格式） */
  ts: string
  /** 日志级别 */
  level: LogLevel
  /** 日志分类（如 ssh / llm / agent / system） */
  category: string
  /** 日志消息 */
  message: string
  /** 附加元数据 */
  meta?: Record<string, unknown>
  /** 关联 ID（用于追踪同一操作链路） */
  correlationId?: string
  /** 日志来源进程 */
  source: 'main' | 'renderer'
  /** 格式化日期字符串 */
  date: string
}

/** 日志统计（IPC logStats 返回） */
export interface LogStats {
  /** 日志总数 */
  total: number
  /** 按级别统计 */
  byLevel: Record<string, number>
  /** 按分类统计 */
  byCategory: Record<string, number>
  /** 最早日志时间戳 */
  oldestTs: string | null
  /** 最新日志时间戳 */
  newestTs: string | null
}
