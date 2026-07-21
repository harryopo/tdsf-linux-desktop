/**
 * Mastra Instance Singleton — TDSF 全局 Mastra 实例
 *
 * Mastra 是 @mastra/core 的顶层编排器，注册 Agent / Tool / Workflow 等。
 * 本模块创建全局单例，供 IPC handler 和 supervisor 使用。
 *
 * 架构定位：
 * ┌──────────────────────────────────────────┐
 * │            Mastra Instance                │
 * │  ┌────────────┐  ┌────────────────────┐  │
 * │  │  Ops Agent  │  │  Shared Tools (5)  │  │
 * │  │ (Mastra)    │  │  (createTool 格式)  │  │
 * │  └────────────┘  └────────────────────┘  │
 * └──────────────────────────────────────────┘
 *         ↕ 委托                    ↕ 复用
 * ┌─────────────────┐    ┌──────────────────────┐
 * │  supervisor      │    │  ToolRegistry         │
 * │  (PAOR 7步 HITL) │    │  (Vercel AI SDK 格式) │
 * └─────────────────┘    └──────────────────────┘
 *
 * 使用方式：
 * ```ts
 * import { getMastraInstance } from './mastra'
 * const mastra = getMastraInstance(llmConfig, db)
 * const agent = mastra.getAgent('tdsf-ops-agent')
 * const result = await agent.generate(messages)
 * ```
 */
import { Mastra } from '@mastra/core/mastra'
import type { LlmConfig } from '@shared/models'
import type { DatabaseManager } from '../../../services/db/database'
import { createOpsAgent } from './ops-agent'
import { logger } from '../../../services/log/logger'

/** 全局 Mastra 实例（懒初始化单例） */
let mastraInstance: Mastra | null = null

/** 当前实例对应的 LLM 配置指纹（用于检测配置变更） */
let currentConfigFingerprint = ''

/**
 * 计算配置指纹（判断是否需要重建实例）
 */
function configFingerprint(config: LlmConfig): string {
  return `${config.apiKey?.slice(0, 8) ?? ''}:${config.baseUrl ?? ''}:${config.model ?? ''}`
}

/**
 * 获取或创建 Mastra 全局实例
 *
 * 如果配置未变化，返回缓存实例；配置变化（如用户切换模型）时自动重建。
 *
 * @param llmConfig LLM 配置
 * @param db 数据库管理器（可选，tutorial_search 工具需要）
 * @returns Mastra 实例
 */
export function getMastraInstance(
  llmConfig: LlmConfig,
  db?: DatabaseManager
): Mastra {
  const fp = configFingerprint(llmConfig)

  // 配置未变化 → 返回缓存
  if (mastraInstance && currentConfigFingerprint === fp) {
    return mastraInstance
  }

  // 配置变化或首次 → 重建
  if (mastraInstance) {
    logger.info('MASTRA', '配置变更，重建 Mastra 实例', {
      oldFingerprint: currentConfigFingerprint,
      newFingerprint: fp,
    })
  }

  // 创建 Ops Agent
  const opsAgent = createOpsAgent({ llmConfig, db })

  // 创建 Mastra 实例
  mastraInstance = new Mastra({
    agents: {
      'tdsf-ops-agent': opsAgent,
    },
  })

  currentConfigFingerprint = fp

  logger.info('MASTRA', 'Mastra 实例创建完成', {
    agents: ['tdsf-ops-agent'],
    model: llmConfig.model,
  })

  return mastraInstance
}

/**
 * 重置 Mastra 实例（测试用 / 配置清空时调用）
 */
export function resetMastraInstance(): void {
  mastraInstance = null
  currentConfigFingerprint = ''
  logger.info('MASTRA', 'Mastra 实例已重置')
}

/**
 * 检查 Mastra 实例是否已初始化
 */
export function isMastraInitialized(): boolean {
  return mastraInstance !== null
}
