/**
 * Subagent 调度 14 步协议 - 类型与常量定义
 *
 * 独立文件，供 task-protocol.ts（入口）和 task-protocol-steps.ts（步骤实现）共同导入，
 * 避免循环依赖。
 *
 * v2.0 Phase D：补齐 14 步骨架为真实逻辑，扩展 TaskProtocolContext 接口
 * 新增可选字段，保持向后兼容（不删除现有字段）。
 *
 * 借鉴 Kilo Code task 工具 14 步流程：
 *   d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §4.3
 */
import type { ModelMessage } from 'ai'
import type { LanguageModel } from 'ai'
import type {
  ProviderConfig,
  ProviderType,
  PersistedProviderConfig,
  ThinkingStrength,
  ChatResult,
  AgentMode,
  ModeConfig,
  AttentionFocus,
} from '@shared/agent-types'
import type { Subagent, SubagentRegistry } from './base'

/**
 * Re-export 共享类型（便于 steps 文件单点导入）
 */
export type {
  Subagent,
  SubagentRegistry,
} from './base'

/**
 * Re-export Provider 模型实例类型（main 内部使用，含 LanguageModel 运行时类型）
 */
export interface ProviderModelInstance {
  /** LanguageModel 实例（@ai-sdk/* 创建） */
  model: LanguageModel
  /** 来源 Provider 配置（脱敏后，不含 apiKey） */
  config: PersistedProviderConfig
  /** 实际使用的模型名（可能被用户覆盖） */
  resolvedModel: string
}

/**
 * Subagent 调度 14 步流程（借鉴 Kilo Code task 工具）
 *
 * 顺序固定，名称与 Kilo Code 完全一致：
 * 1. validate-input → 2. check-permission → 3. load-subagent-config
 * → 4. derive-permissions → 5. prepare-context → 6. select-provider
 * → 7. select-mode → 8. build-prompt → 9. invoke-subagent
 * → 10. stream-output → 11. collect-usage → 12. validate-output
 * → 13. cleanup → 14. return-result
 */
export type TaskProtocolStep =
  | 'validate-input'
  | 'check-permission'
  | 'load-subagent-config'
  | 'derive-permissions'
  | 'prepare-context'
  | 'select-provider'
  | 'select-mode'
  | 'build-prompt'
  | 'invoke-subagent'
  | 'stream-output'
  | 'collect-usage'
  | 'validate-output'
  | 'cleanup'
  | 'return-result'

/**
 * 14 步顺序常量（与 Kilo Code 完全一致）
 *
 * 用于 executeTaskProtocol 串行遍历，以及测试断言顺序一致性。
 */
export const TASK_PROTOCOL_STEPS: readonly TaskProtocolStep[] = [
  'validate-input',
  'check-permission',
  'load-subagent-config',
  'derive-permissions',
  'prepare-context',
  'select-provider',
  'select-mode',
  'build-prompt',
  'invoke-subagent',
  'stream-output',
  'collect-usage',
  'validate-output',
  'cleanup',
  'return-result',
] as const

/**
 * 单步执行结果
 */
export interface StepResult {
  /** 步骤名 */
  step: TaskProtocolStep
  /** 是否成功 */
  success: boolean
  /** 步骤输出（可选） */
  output?: unknown
  /** 错误信息（失败时填充） */
  error?: string
  /** 耗时（ms） */
  durationMs: number
}

/**
 * 派生的权限规则（step 4 产出）
 *
 * 借鉴 Kilo Code deriveSubagentSessionPermission：
 * - 继承父 session 的 deny 规则和 external_directory 规则
 * - subagent 默认禁止 question / interactive_terminal 工具
 */
export interface DerivedPermissions {
  /** 拒绝的工具列表（subagent 默认禁用 question / interactive_terminal） */
  denyRules: string[]
  /** 外部目录访问限制（subagent 不能访问的目录） */
  externalDirectory: string[]
  /** 是否从父会话继承 */
  inherited: boolean
  /** 父会话 ID（如有） */
  parentSessionId?: string
}

/**
 * Subagent 元数据（step 3 产出）
 */
export interface SubagentMeta {
  /** Subagent 名称 */
  name: string
  /** 显示名称 */
  displayName: string
  /** 简短描述 */
  description: string
  /** 配置来源（builtin / custom / skeleton） */
  source: 'builtin' | 'custom' | 'skeleton'
}

/**
 * Token 使用统计（step 11 产出）
 */
export interface StepUsage {
  /** 输入 token 数 */
  inputTokens: number
  /** 输出 token 数 */
  outputTokens: number
  /** 总 token 数 */
  totalTokens: number
  /** 成本（USD，可选） */
  cost?: number
}

/**
 * 14 步调度上下文（贯穿整个流程）
 *
 * 由调用方（如 ExploreSubagent）在启动协议时初始化，
 * executeTaskProtocol 在执行过程中不断将 StepResult 追加到 completedSteps，
 * 同时递增 currentStep。
 *
 * v2.0 Phase D 扩展：新增可选字段用于步骤间数据传递（保持向后兼容）：
 * - step 3 产出：subagentInstance / subagentMeta
 * - step 4 产出：derivedPermissions
 * - step 5 产出：attentionContext / toolWhitelist
 * - step 6 产出：providerConfig / providerType / modelInstance
 * - step 7 产出：mode / modeConfig
 * - step 8 产出：systemPrompt / userPrompt / messages
 * - step 9 产出：chatResult / abortController
 * - step 10 产出：output
 * - step 11 产出：usage
 */
export interface TaskProtocolContext {
  // === 原有字段（保持向后兼容） ===
  /** 任务 ID */
  taskId: string
  /** 父会话 ID（用于权限继承） */
  parentSessionId?: string
  /** 目标 Subagent 名称 */
  subagentName: string
  /** 任务输入 */
  input: unknown
  /** 已完成的步骤 */
  completedSteps: StepResult[]
  /** 当前步骤索引 */
  currentStep: number
  /** 是否已取消 */
  cancelled: boolean

  // === v2.0 Phase D 新增字段（可选，用于步骤间数据传递） ===

  /** Subagent 注册表（step 3 输入，可选；未提供时按 subagentName 查找内置 Subagent） */
  registry?: SubagentRegistry

  /** 已加载的 Subagent 实例（step 3 产出） */
  subagentInstance?: Subagent
  /** Subagent 元数据（step 3 产出） */
  subagentMeta?: SubagentMeta

  /** 派生的权限规则（step 4 产出） */
  derivedPermissions?: DerivedPermissions

  /** 构建的 attention context 文本（step 5 产出，注入到 system prompt） */
  attentionContext?: string
  /** 工具白名单（step 5 产出，来自 modeConfig + subagent 配置） */
  toolWhitelist?: string[]

  /** Provider 配置（step 6 产出，含 apiKey） */
  providerConfig?: ProviderConfig
  /** Provider 类型（step 6 产出，便于 step 9 分支调用） */
  providerType?: ProviderType
  /** LanguageModel 实例（step 6 产出，仅当 providerType !== 'claude-sdk' 时存在） */
  modelInstance?: ProviderModelInstance

  /** 选定的 mode（step 7 产出，默认 chat） */
  mode?: AgentMode
  /** mode 配置（step 7 产出） */
  modeConfig?: ModeConfig

  /** 系统 prompt（step 8 产出，含 modeConfig.systemPrompt + attentionContext） */
  systemPrompt?: string
  /** 用户 prompt（step 8 产出，从 input 解析） */
  userPrompt?: string
  /** 消息列表（step 8 产出，含 system + user） */
  messages?: ModelMessage[]

  /** LLM 调用结果（step 9 产出） */
  chatResult?: ChatResult
  /** AbortController（step 9 创建，step 13 释放） */
  abortController?: AbortController

  /** 最终输出文本（step 10 产出，从 chatResult.text 提取） */
  output?: string

  /** Token 使用（step 11 产出） */
  usage?: StepUsage

  /** 关联 ID（用于日志追踪 + 取消请求） */
  correlationId?: string

  /** 思考强度（默认 standard，影响 maxTokens） */
  strength?: ThinkingStrength

  /** 协议开始时间戳（step 14 用于计算总耗时） */
  startTime?: number

  /** 当前 attention 快照（step 5 从 AttentionTracker 获取） */
  attention?: AttentionFocus
}

/**
 * 步骤函数签名
 *
 * 每个步骤函数接收当前上下文，返回 StepResult（不抛异常）。
 */
export type StepFunction = (ctx: TaskProtocolContext) => Promise<StepResult> | StepResult
