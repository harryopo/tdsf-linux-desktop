/**
 * Provider Info IPC Handlers（v0.9.5 P0 - 组 5 新增）
 *
 * 注册 v0.9.5 引入的 Provider 能力 + 定价透明化相关 IPC 通道。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - provider:capabilities      — 返回指定 provider 的能力声明
 * - provider:capabilities-all  — 返回所有 provider 的能力声明
 * - provider:pricing           — 返回指定 provider 的定价表
 * - provider:pricing-all       — 返回所有 provider 的定价表
 *
 * 与现有 agent-runtime.ts 中 provider:list / provider:get / provider:save / provider:set-default 的关系：
 * - agent-runtime.ts 中的 provider:* 通道用于 Provider 配置 CRUD
 * - 本文件的 provider:capabilities* / provider:pricing* 通道用于查询 Provider 的能力 + 定价
 * - 两者并存：配置 CRUD 走 agent-runtime.ts，能力 + 定价查询走本文件
 *
 * 设计要点：
 * - 独立文件（避免 agent-runtime.ts 进一步膨胀，agent-runtime.ts 已 > 350 行）
 * - capabilities 优先用 ProviderConfig.capabilities，回退到 PROVIDER_CAPABILITIES 默认表
 * - pricing 优先用 ProviderConfig.pricing，回退到 PROVIDER_PRICING 默认表
 * - 不存在指定 Provider ID 时返回 null
 * - ProviderCapabilities / ModelPricing 接口已定义在 @shared/agent-types.ts
 *
 * 方案书依据：v0.9.5 §UI接入接线图（5 组 P0 级缺失 IPC - 组 5：Provider 能力 + 定价透明）
 */

import { ipcMain } from 'electron'
import { getProvider } from '../core/agent/providers/provider-registry'
import {
  PROVIDER_CAPABILITIES,
  getProviderCapabilities,
} from '../core/agent/providers/provider-capabilities'
import {
  PROVIDER_PRICING,
  getProviderPricing,
} from '../core/agent/providers/provider-pricing'
import type {
  ProviderCapabilities,
  ModelPricing,
  ProviderCapabilitiesRequest,
  ProviderCapabilitiesResponse,
  ProviderCapabilitiesAllResponse,
  ProviderPricingRequest,
  ProviderPricingResponse,
  ProviderPricingAllResponse,
} from '@shared/agent-types'
import { logger } from '../services/log/logger'

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册 Provider Info IPC handlers
 *
 * 注册以下通道（4 个）：
 * - provider:capabilities      — 查询指定 provider 的能力声明
 * - provider:capabilities-all  — 查询所有 provider 的能力声明
 * - provider:pricing           — 查询指定 provider 的定价表
 * - provider:pricing-all       — 查询所有 provider 的定价表
 *
 * IPC 4 步同步：
 * 1. main 层 handler：本文件
 * 2. ipc/index.ts：导入并调用 registerProviderInfoHandlers()
 * 3. preload/index.ts：暴露 4 个方法
 * 4. electron.d.ts：声明 4 个类型
 */
export function registerProviderInfoHandlers(): void {
  // ------------------------------------------------------------------
  // provider:capabilities — 查询指定 provider 的能力声明
  // ------------------------------------------------------------------
  // 参数：(request: ProviderCapabilitiesRequest) — { providerId: string }
  // 返回：ProviderCapabilities | null（Provider 不存在时返回 null）
  // 用途：UI 显示能力图标（如 🔄 streaming / 🔧 toolCall / 👁 vision / 📏 contextWindow）
  //
  // 优先级（由 getProviderCapabilities 实现）：
  // 1. ProviderConfig.capabilities（用户自定义）→ 直接返回
  // 2. PROVIDER_CAPABILITIES[config.type]（默认表）→ 返回默认值
  ipcMain.handle(
    'provider:capabilities',
    async (
      _event,
      request: ProviderCapabilitiesRequest
    ): Promise<ProviderCapabilitiesResponse> => {
      try {
        if (!request || typeof request.providerId !== 'string') {
          logger.warn('IPC.PROVIDER', `provider:capabilities 入参非法`, { request })
          return null
        }

        const config = getProvider(request.providerId)
        if (!config) {
          logger.debug('IPC.PROVIDER', `provider:capabilities Provider 不存在`, {
            providerId: request.providerId,
          })
          return null
        }

        const capabilities: ProviderCapabilities = getProviderCapabilities(config)
        logger.debug('IPC.PROVIDER', `provider:capabilities`, {
          providerId: request.providerId,
          type: config.type,
          streaming: capabilities.streaming,
          toolCall: capabilities.toolCall,
          vision: capabilities.vision,
          contextWindow: capabilities.contextWindow,
        })
        return capabilities
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取 Provider 能力失败'
        logger.error('IPC.PROVIDER', `provider:capabilities 失败: ${msg}`)
        throw new Error(`获取 Provider 能力失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // provider:capabilities-all — 查询所有 provider 的能力声明
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：Record<string, ProviderCapabilities>（按 ProviderType 索引）
  // 用途：UI 显示所有 ProviderType 的默认能力（如 Provider 配置页的能力说明表格）
  //
  // 注意：返回的是 PROVIDER_CAPABILITIES 默认表（按 type 索引），
  //       不含用户自定义 capabilities（用户自定义需通过 provider:capabilities 单独查询）
  ipcMain.handle(
    'provider:capabilities-all',
    async (): Promise<ProviderCapabilitiesAllResponse> => {
      try {
        // 深拷贝避免外部修改污染默认表
        const result: ProviderCapabilitiesAllResponse = {}
        for (const [type, caps] of Object.entries(PROVIDER_CAPABILITIES)) {
          result[type] = { ...caps }
        }
        logger.debug('IPC.PROVIDER', `provider:capabilities-all`, {
          typeCount: Object.keys(result).length,
        })
        return result
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取所有 Provider 能力失败'
        logger.error('IPC.PROVIDER', `provider:capabilities-all 失败: ${msg}`)
        throw new Error(`获取所有 Provider 能力失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // provider:pricing — 查询指定 provider 的定价表
  // ------------------------------------------------------------------
  // 参数：(request: ProviderPricingRequest) — { providerId: string }
  // 返回：ModelPricing | null（Provider 不存在时返回 null）
  // 用途：UI 显示 Provider 累计成本（如本月已消费 $X.XX）+ 成本告警
  //
  // 优先级（由 getProviderPricing 实现）：
  // 1. ProviderConfig.pricing（用户自定义）→ 直接返回
  // 2. PROVIDER_PRICING[config.type]（默认表）→ 返回默认值
  ipcMain.handle(
    'provider:pricing',
    async (
      _event,
      request: ProviderPricingRequest
    ): Promise<ProviderPricingResponse> => {
      try {
        if (!request || typeof request.providerId !== 'string') {
          logger.warn('IPC.PROVIDER', `provider:pricing 入参非法`, { request })
          return null
        }

        const config = getProvider(request.providerId)
        if (!config) {
          logger.debug('IPC.PROVIDER', `provider:pricing Provider 不存在`, {
            providerId: request.providerId,
          })
          return null
        }

        const pricing: ModelPricing = getProviderPricing(config)
        logger.debug('IPC.PROVIDER', `provider:pricing`, {
          providerId: request.providerId,
          type: config.type,
          inputCostPer1M: pricing.inputCostPer1M,
          outputCostPer1M: pricing.outputCostPer1M,
          currency: pricing.currency,
        })
        return pricing
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取 Provider 定价失败'
        logger.error('IPC.PROVIDER', `provider:pricing 失败: ${msg}`)
        throw new Error(`获取 Provider 定价失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // provider:pricing-all — 查询所有 provider 的定价表
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：Record<string, ModelPricing>（按 ProviderType 索引）
  // 用途：UI 显示所有 ProviderType 的默认定价（如 Provider 配置页的定价说明表格）
  //
  // 注意：返回的是 PROVIDER_PRICING 默认表（按 type 索引），
  //       不含用户自定义 pricing（用户自定义需通过 provider:pricing 单独查询）
  ipcMain.handle(
    'provider:pricing-all',
    async (): Promise<ProviderPricingAllResponse> => {
      try {
        // 深拷贝避免外部修改污染默认表
        const result: ProviderPricingAllResponse = {}
        for (const [type, pricing] of Object.entries(PROVIDER_PRICING)) {
          result[type] = { ...pricing }
        }
        logger.debug('IPC.PROVIDER', `provider:pricing-all`, {
          typeCount: Object.keys(result).length,
        })
        return result
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取所有 Provider 定价失败'
        logger.error('IPC.PROVIDER', `provider:pricing-all 失败: ${msg}`)
        throw new Error(`获取所有 Provider 定价失败: ${msg}`)
      }
    }
  )

  logger.info('IPC.PROVIDER', `Provider Info IPC handlers 已注册`, {
    channels: [
      'provider:capabilities',
      'provider:capabilities-all',
      'provider:pricing',
      'provider:pricing-all',
    ],
  })
}
