/**
 * Claude Agent SDK 集成模块 - 统一导出（barrel）
 *
 * 职责：
 * 集中导出 Claude Agent SDK 集成层的所有公开 API，供 IPC handler、
 * Supervisor、其他 Provider 调用。
 *
 * 导出内容：
 * - ClaudeSdkProvider：主类，封装 query() 调用，提供 generate/stream/cancel
 * - ClaudeSdkChatParams：stream/generate 调用参数类型
 * - createClaudeSdkTools / createLinuxOpsMcpServer / TDSF_LINUX_OPS_SERVER_NAME：工具适配
 * - convertClaudeResultToChatResult / extractPartialText 等：输出转换工具
 *
 * 方案书依据：v0.9 §3（Provider 抽象）+ 调研文档 §8（Claude Agent SDK 集成）
 */

// Provider 主类
export { ClaudeSdkProvider } from './claude-sdk-provider'
// 主进程内部扩展类型（含 onToken/onDone/onError/mcpServers 回调）
export type { ClaudeSdkInternalChatParams } from './claude-sdk-provider'
// ClaudeSdkChatParams 已迁移到 @shared/agent-types（供主进程/preload/renderer 三端共享）
// 此处 re-export 保持外部导入路径 `from '../claude-sdk'` 仍可用
export type { ClaudeSdkChatParams } from '@shared/agent-types'

// 工具适配（SSH/SFTP → SDK MCP tools）
export {
  createClaudeSdkTools,
  createLinuxOpsMcpServer,
  TDSF_LINUX_OPS_SERVER_NAME,
} from './claude-sdk-tools'

// 输出转换（SDKMessage → ChatResult）
export {
  convertClaudeResultToChatResult,
  extractAssistantText,
  extractPartialText,
  extractUsage,
  mapStopReason,
  mapErrorSubtype,
  isResultMessage,
  isAssistantMessage,
  isPartialAssistantMessage,
} from './claude-sdk-wrapper'
export type { ConvertClaudeResultOptions } from './claude-sdk-wrapper'
