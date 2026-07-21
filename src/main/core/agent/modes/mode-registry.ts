/**
 * Mode 注册表（v0.9.4 批次 3 - 任务 4）
 *
 * 借鉴 Kilo Code 的多模式架构（packages/opencode/src/agent/agent.ts）：
 * - mode 即 primary agent，每个 mode 有独立的 system prompt + 工具白名单 + 行为约束
 * - 通过 Permission.merge(defaults, guard, user) 控制每模式的工具权限
 *
 * 5 个模式（覆盖典型 Linux 运维 Agent 场景）：
 * - chat     — 普通对话（默认，纯问答无副作用）
 * - ask      — 询问模式（只读，不修改文件，类似 Aider ask mode）
 * - plan     — 计划模式（仅生成方案不执行，类似 Cline plan-and-act 的 plan 阶段）
 * - code     — 代码模式（读写文件 + 执行命令，全功能模式）
 * - debug    — 调试模式（分析问题 + 提出修复方案，但不直接应用）
 *
 * 设计要点：
 * - MODE_CONFIGS 用 as const 满足类型穷尽性
 * - isValidMode 用类型守卫，便于从外部输入安全转换
 * - 与 ThinkingStrength 正交：Mode 控制工具白名单 + 行为约束，
 *   Strength 控制思考深度（fast/standard/deep）
 *
 * 方案书依据：v0.9.4 §11 第 5 类（Mode 五模式）
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §3
 */
import type { AgentMode, ModeConfig } from '@shared/agent-types'
import { PLAN_MODE_SYSTEM_PROMPT } from './plan-prompt'
import { ASK_MODE_SYSTEM_PROMPT } from './ask-prompt'

// ============================================================================
// 5 个模式的默认配置
// ============================================================================

/**
 * chat 模式系统提示
 *
 * 纯问答，无副作用。回答 Linux 运维问题、解释命令、提供建议。
 */
const CHAT_MODE_SYSTEM_PROMPT = `你是 Linux 运维助手，回答用户问题。

行为约束：
- 你是只读助手，不修改文件、不执行命令
- 回答简洁、准确，优先用例子说明
- 涉及风险操作时主动提示用户
- 不确定时明确说"我不知道"，不臆测

工具使用：
- 可用工具：search（搜索文档）、kb（知识库）、log（日志）、metric（指标）、history（历史）、tutorial（教程）
- 不允许写文件、执行命令、修改 sandbox 配置`

/**
 * code 模式系统提示
 *
 * 全功能模式，可读写文件 + 执行命令。运维场景默认模式。
 */
const CODE_MODE_SYSTEM_PROMPT = `你是 Linux 运维 Agent，全功能模式。

行为约束：
- 可读写文件、执行 shell 命令、调用所有工具
- 涉及高风险操作（重启服务、修改系统配置）必须先经用户审批
- 执行前预估影响范围，给出回滚方案
- 优先用最小改动解决问题，避免大范围重构

工具使用：
- 允许全部工具（'*'）
- 写文件 / 执行命令前必须通过 risk-engine 风险评估
- 涉及 SSH 主机的操作必须通过 sandbox-exec 工具`

/**
 * debug 模式系统提示
 *
 * 分析问题 + 提出修复方案，但不直接应用。借鉴 Kilo Code debug 模式。
 */
const DEBUG_MODE_SYSTEM_PROMPT = `你是 Linux 运维调试专家，专长于系统性问题诊断和修复方案设计。

行为约束：
- 反思 5-7 个可能的问题来源
- 收敛到 1-2 个最可能的来源
- 通过日志、指标、profiler 工具收集证据验证假设
- 明确要求用户确认诊断结果后再应用修复
- 优先用最小、针对性的修复，避免大范围重构
- 不直接修改文件，仅提出修复方案

工具使用：
- 可用工具：search、kb、log、metric、history、tutorial、file.read、profiler
- 不允许写文件、执行命令、修改 sandbox 配置
- 引用证据时标注来源：[LOG:xxx] [METRIC:xxx] [PROFILER:xxx]`

/**
 * 5 个模式的默认配置表
 *
 * 作为 Record<AgentMode, ModeConfig>，保证类型穷尽性：
 * 新增 AgentMode 字面量时 TS 会强制要求在此处添加对应配置。
 */
export const MODE_CONFIGS: Record<AgentMode, ModeConfig> = {
  /**
   * chat 模式：纯问答无副作用
   */
  chat: {
    mode: 'chat',
    displayName: '普通对话',
    systemPrompt: CHAT_MODE_SYSTEM_PROMPT,
    allowedTools: ['search', 'kb', 'log', 'metric', 'history', 'tutorial'],
    canWriteFiles: false,
    canExecuteCommands: false,
    canModifySandbox: false,
    description: '普通对话：纯问答，不修改文件不执行命令（默认模式）',
  },

  /**
   * ask 模式：只读询问，回答前先用工具收集信息
   */
  ask: {
    mode: 'ask',
    displayName: '询问模式',
    systemPrompt: ASK_MODE_SYSTEM_PROMPT,
    allowedTools: ['search', 'kb', 'log', 'metric', 'history', 'tutorial', 'file.read'],
    canWriteFiles: false,
    canExecuteCommands: false,
    canModifySandbox: false,
    description: '询问模式：只读，回答前先用工具收集信息，引用信息源',
  },

  /**
   * plan 模式：仅生成方案不执行
   *
   * v0.9.5 P0 新增：Plan→Build 双模衔接
   * - nextModeOnConfirm='code'：用户确认方案后 UI 提示"开始执行"，调用 modeSetDefault('code') 切到代码模式
   * - nextModeButtonLabel='开始执行'：衔接按钮文案
   *
   * 借鉴 xai-org/grok-build §4 Plan/Build 双模：先 Plan 推理得到结构化方案，
   * 确认后再切到 Build 模式执行，避免 LLM 在不确定时贸然执行高风险命令。
   */
  plan: {
    mode: 'plan',
    displayName: '计划模式',
    systemPrompt: PLAN_MODE_SYSTEM_PROMPT,
    allowedTools: ['search', 'kb', 'log', 'metric', 'history', 'tutorial', 'file.read'],
    canWriteFiles: false,
    canExecuteCommands: false,
    canModifySandbox: false,
    description: '计划模式：仅生成方案不执行，输出步骤清单等待用户确认',
    nextModeOnConfirm: 'code',
    nextModeButtonLabel: '开始执行',
  },

  /**
   * code 模式：全功能（读写文件 + 执行命令）
   */
  code: {
    mode: 'code',
    displayName: '代码模式',
    systemPrompt: CODE_MODE_SYSTEM_PROMPT,
    allowedTools: ['*'],
    canWriteFiles: true,
    canExecuteCommands: true,
    canModifySandbox: false,
    description: '代码模式：全功能，可读写文件 + 执行命令（需人工审批高风险操作）',
  },

  /**
   * debug 模式：分析问题 + 提出修复方案，但不直接应用
   */
  debug: {
    mode: 'debug',
    displayName: '调试模式',
    systemPrompt: DEBUG_MODE_SYSTEM_PROMPT,
    allowedTools: [
      'search',
      'kb',
      'log',
      'metric',
      'history',
      'tutorial',
      'file.read',
      'profiler',
    ],
    canWriteFiles: false,
    canExecuteCommands: false,
    canModifySandbox: false,
    description: '调试模式：分析问题 + 提出修复方案，不直接应用',
  },
}

// ============================================================================
// 查询函数
// ============================================================================

/**
 * 获取指定模式的配置
 *
 * @param mode AgentMode
 * @returns 对应的 ModeConfig（从 MODE_CONFIGS 默认表查找）
 * @throws 如果 mode 不在 AgentMode 联合类型中（理论上不会触发，因 TS 类型守卫）
 */
export function getModeConfig(mode: AgentMode): ModeConfig {
  return MODE_CONFIGS[mode]
}

/**
 * 类型守卫：判断字符串是否为合法的 AgentMode
 *
 * 用于从外部输入（IPC / 配置文件 / 用户输入）安全转换为 AgentMode。
 *
 * @param mode 任意字符串
 * @returns 是否为合法 AgentMode（类型守卫）
 */
export function isValidMode(mode: string): mode is AgentMode {
  return (['chat', 'ask', 'plan', 'code', 'debug'] as const).includes(mode as AgentMode)
}

/**
 * 便捷方法：获取指定模式的工具白名单
 *
 * @param mode AgentMode
 * @returns 工具白名单数组（'*' 表示允许全部）
 */
export function getAllowedTools(mode: AgentMode): string[] {
  return MODE_CONFIGS[mode].allowedTools
}

/**
 * 检查指定模式是否允许调用某工具
 *
 * @param mode AgentMode
 * @param toolName 工具名
 * @returns 是否允许（白名单包含该工具名，或白名单包含 '*'）
 */
export function isToolAllowed(mode: AgentMode, toolName: string): boolean {
  const allowed = MODE_CONFIGS[mode].allowedTools
  return allowed.includes('*') || allowed.includes(toolName)
}

/**
 * 获取所有模式列表（用于 UI 下拉选择）
 *
 * @returns 所有 AgentMode 数组
 */
export function getAllModes(): AgentMode[] {
  return Object.keys(MODE_CONFIGS) as AgentMode[]
}

/**
 * 默认模式
 *
 * 应用启动时的默认 Mode（与 Kilo Code 不同，我们用 chat 而非 code 作为默认）。
 */
export const DEFAULT_MODE: AgentMode = 'chat'

// ============================================================================
// v0.9.5 P0 - 组 2：当前默认 mode 模块级状态（单例）
//
// 任务：v0.9.5 渲染层 UI 集成 - 暴露 mode:list / mode:set-default / mode:get-current IPC 通道
//
// 设计要点：
// - 模块级 let 变量（单例），跨 IPC 调用共享
// - 默认值与 DEFAULT_MODE 一致（'chat'）
// - setCurrentMode 入参用 isValidMode 类型守卫防御非法值
// - 通过 mode:set-default IPC 通道暴露给渲染进程
// ============================================================================

/**
 * 当前默认 mode（模块级单例状态）
 *
 * 应用启动时初始化为 DEFAULT_MODE（'chat'）。
 * 通过 setCurrentMode 修改，getCurrentMode 查询。
 */
let currentMode: AgentMode = DEFAULT_MODE

/**
 * 获取当前默认 mode
 *
 * @returns 当前默认 AgentMode
 */
export function getCurrentMode(): AgentMode {
  return currentMode
}

/**
 * 设置当前默认 mode
 *
 * 入参先用 isValidMode 类型守卫防御非法值，非法值会被忽略并返回 false。
 *
 * @param mode 新的默认 mode
 * @returns 是否设置成功（false 表示 mode 不合法）
 */
export function setCurrentMode(mode: AgentMode): boolean {
  if (!isValidMode(mode)) {
    return false
  }
  currentMode = mode
  return true
}

/**
 * 重置当前默认 mode 到 DEFAULT_MODE（仅用于测试）
 *
 * 单例状态会跨测试用例共享，需要在 beforeEach 中调用此函数重置。
 */
export function resetCurrentMode(): void {
  currentMode = DEFAULT_MODE
}
