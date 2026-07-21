/**
 * Token 统计服务（v0.9 Week 1 基础版 → Week 3 持久化版）
 *
 * 职责：
 * - 累计每次 LLM 调用的 token 使用量
 * - 按时间维度（当日/当周/当月）+ Subagent 维度聚合
 * - 提供 IPC 通道 token:stats / token:reset 的数据源
 *
 * 持久化策略：
 * - 使用 electron-store 持久化（key: 'tokenStats'），进程重启后恢复
 * - 防抖写入：每累计 10 条新记录或每 30 秒写入一次（取先到者）
 * - 保持内存性能：不在每次 record 时同步写磁盘
 * - 优雅降级：electron-store 不可用时（如测试环境）退回纯内存模式
 * - 设计为可替换的存储后端（未来接入 SQLite 按天归档）
 *
 * v0.9.4 批次 4 - 任务 6 新增：
 * - getCostStats()：按时间维度 + Subagent 维度 + Provider 维度聚合成本（USD）
 * - 借鉴 Aider 成本累计展示：每次执行后展示 token + 成本
 *
 * 方案书依据：v0.9 §5 Token 监控设计 + v0.9.4 §11 第 7 类（任务 6）
 */
import type { TokenUsageRecord, TokenStats } from './types'
// v0.9.5 P0 - 组 1：CostStats 已迁移到 @shared/agent-types（SSOT）
import type { CostStats } from '@shared/agent-types'
import { logger } from '../../../services/log/logger'
import { getProvider } from './provider-registry'
import {
  getProviderPricing,
  calculateCost,
  PROVIDER_PRICING,
} from './provider-pricing'

// ============================================================================
// 持久化层（electron-store）
//
// 使用 ConfigStore 的通用 get/set 方法读写 key 'tokenStats'。
// 如果 ConfigStore 导入失败（测试环境 / electron 未初始化），
// 则 gracefully degrade 为纯内存模式。
// ============================================================================

/** 持久化存储键名 */
const STORE_KEY = 'tokenStats'

/** 防抖阈值：累计新记录数达到此值时触发写入 */
const PERSIST_RECORD_THRESHOLD = 10

/** 防抖阈值：距上次写入超过此毫秒数时触发写入 */
const PERSIST_INTERVAL_MS = 30_000

/** 标记 electron-store 是否可用（false = 纯内存降级模式） */
let storeAvailable = false

/** 尝试导入 ConfigStore（动态 require 以兼容测试环境） */
let ConfigStoreRef: { get(key: string): unknown; set(key: string, value: unknown): boolean } | null =
  null

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ConfigStore } = require('../../../services/storage/config-store')
  ConfigStoreRef = ConfigStore
  storeAvailable = true
} catch {
  // electron-store 不可用（测试环境 / app 未 ready），降级为纯内存
  storeAvailable = false
}

/**
 * 内存存储的 token 使用记录（最多保留 MAX_RECORDS 条，超出后 FIFO 丢弃）
 *
 * 保留原始记录便于后续按任意维度聚合（如按 Provider + 日期交叉查询）。
 */
const MAX_RECORDS = 5000
const usageRecords: TokenUsageRecord[] = []

// ============================================================================
// 防抖持久化控制
// ============================================================================

/** 自上次持久化以来新增的记录数 */
let recordsSinceLastPersist = 0

/** 防抖定时器句柄 */
let persistTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 将当前内存中的 usageRecords 写入 electron-store
 *
 * 写入格式：TokenUsageRecord[]（JSON 序列化由 electron-store 内部处理）
 * 超出 MAX_RECORDS 的旧记录已在 recordTokenUsage 中被 FIFO 丢弃，
 * 因此此处直接序列化整个数组。
 */
export function persist(): void {
  if (!storeAvailable || !ConfigStoreRef) {
    return
  }
  try {
    ConfigStoreRef.set(STORE_KEY, usageRecords)
    recordsSinceLastPersist = 0
    logger.debug('AGENT.TOKEN', 'token 统计已持久化', {
      recordCount: usageRecords.length,
    })
  } catch (err) {
    logger.warn('AGENT.TOKEN', 'token 统计持久化失败', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * 从 electron-store 加载已持久化的 token 记录到内存
 *
 * 在模块初始化时调用。如果存储中无数据或格式无效，静默跳过。
 * 加载后重置防抖计数器。
 */
export function loadPersisted(): void {
  if (!storeAvailable || !ConfigStoreRef) {
    return
  }
  try {
    const saved = ConfigStoreRef.get(STORE_KEY)
    if (Array.isArray(saved) && saved.length > 0) {
      // 校验基本字段（防止损坏数据）
      const valid = saved.filter(
        (r: unknown): r is TokenUsageRecord =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as TokenUsageRecord).totalTokens === 'number' &&
          typeof (r as TokenUsageRecord).timestamp === 'number'
      )
      // 只保留最近 MAX_RECORDS 条
      const trimmed = valid.slice(-MAX_RECORDS)
      usageRecords.push(...trimmed)
      logger.info('AGENT.TOKEN', '已从持久化存储恢复 token 记录', {
        restored: trimmed.length,
      })
    }
  } catch (err) {
    logger.warn('AGENT.TOKEN', '加载持久化 token 记录失败，使用空记录', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  recordsSinceLastPersist = 0
}

/**
 * 调度一次防抖持久化
 *
 * 触发条件（取先到者）：
 * 1. 累计新记录数 >= PERSIST_RECORD_THRESHOLD（10 条）
 * 2. 距上次写入超过 PERSIST_INTERVAL_MS（30 秒）
 */
function schedulePersist(): void {
  if (!storeAvailable) {
    return
  }
  recordsSinceLastPersist++

  // 条件 1：记录数达到阈值，立即写入
  if (recordsSinceLastPersist >= PERSIST_RECORD_THRESHOLD) {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    persist()
    return
  }

  // 条件 2：时间窗口（30 秒内无新写入则自动写入）
  if (!persistTimer) {
    persistTimer = setTimeout(() => {
      persistTimer = null
      persist()
    }, PERSIST_INTERVAL_MS)
  }
}

// 模块初始化：加载已持久化的记录
loadPersisted()

/**
 * 累计一条 token 使用记录
 *
 * @param record 单次调用的 token 使用记录
 */
export function recordTokenUsage(record: TokenUsageRecord): void {
  usageRecords.push(record)
  // 超出上限时丢弃最早的记录
  if (usageRecords.length > MAX_RECORDS) {
    usageRecords.splice(0, usageRecords.length - MAX_RECORDS)
  }
  logger.debug('AGENT.TOKEN', 'token 使用记录', {
    providerId: record.providerId,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    subagent: record.subagent,
    strength: record.strength,
  })

  // 防抖持久化：不阻塞主流程
  schedulePersist()
}

/**
 * 计算时间窗口的起始时间戳
 *
 * - today：当日 0 点（本地时区）
 * - week：本周一 0 点（本地时区，ISO 周从周一开始）
 * - month：本月 1 日 0 点（本地时区）
 */
function getWindowStarts(): { todayStart: number; weekStart: number; monthStart: number } {
  const now = new Date()
  // 当日 0 点
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  // 本周一 0 点（getDay()=0 是周日，需要回退 6 天；其余回退 day-1 天）
  const dayOfWeek = now.getDay()
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysFromMonday
  ).getTime()
  // 本月 1 日 0 点
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return { todayStart, weekStart, monthStart }
}

/**
 * 获取聚合后的 token 统计
 *
 * @returns 当日/当周/当月/总 + 按 Subagent/Provider 分布
 */
export function getTokenStats(): TokenStats {
  const { todayStart, weekStart, monthStart } = getWindowStarts()
  const stats: TokenStats = {
    today: 0,
    week: 0,
    month: 0,
    total: 0,
    bySubagent: {},
    byProvider: {},
  }

  for (const r of usageRecords) {
    stats.total += r.totalTokens
    if (r.timestamp >= monthStart) {
      stats.month += r.totalTokens
      if (r.timestamp >= weekStart) {
        stats.week += r.totalTokens
        if (r.timestamp >= todayStart) {
          stats.today += r.totalTokens
        }
      }
    }
    stats.bySubagent[r.subagent] = (stats.bySubagent[r.subagent] ?? 0) + r.totalTokens
    stats.byProvider[r.providerId] = (stats.byProvider[r.providerId] ?? 0) + r.totalTokens
  }

  return stats
}

/**
 * 获取原始 token 使用记录（用于 UI 详细列表展示，Week 3 用）
 *
 * @param limit 最多返回条数（默认 100）
 */
export function getTokenRecords(limit = 100): TokenUsageRecord[] {
  return usageRecords.slice(-limit)
}

/**
 * 重置 token 统计（清空所有记录）
 *
 * Week 3 会改为按日期归档到 SQLite 后再清空内存。
 */
export function resetTokenStats(): void {
  const count = usageRecords.length
  usageRecords.length = 0
  // 取消待执行的防抖写入
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  recordsSinceLastPersist = 0
  // 立即持久化空状态，防止重启后恢复旧数据
  persist()
  logger.info('AGENT.TOKEN', 'token 统计已重置', { cleared: count })
}

// ============================================================================
// v0.9.4 批次 4 - 任务 6：成本累计统计
//
// 借鉴 Aider 成本累计展示：每次执行后展示 token + 成本
//   d:\ai\linux教学一体\idea-to-dev-output\31-源码分析-Aider-终端优先与git沙箱回滚.md §P0-31
//
// 设计要点：
// - 复用 getTokenStats 的时间窗口计算逻辑（当日/当周/当月/总）
// - 优先使用 record.cost 字段（批次 2 已计算），缺失时按 calculateCost 重算
// - Provider 不存在时 fallback 到 PROVIDER_PRICING['openai-compatible']
// - 仅 main 内部使用，不暴露 IPC 通道（IPC 通道由后续批次或 v0.9.5 决定）
//
// v0.9.5 P0 - 组 1：CostStats 接口已迁移到 @shared/agent-types.ts（SSOT），
//                  通过 token:cost-stats IPC 通道暴露给渲染进程。
// ============================================================================

/**
 * 计算单条 token 使用记录的成本（USD）
 *
 * 计算逻辑：
 * 1. 如果 record.cost 已设置（批次 2 由 recordTokenUsage 调用方计算），直接使用
 * 2. 否则，查找 Provider 配置：
 *    a. 调用 getProvider(record.providerId) 获取 PersistedProviderConfig
 *    b. Provider 存在 → 调用 getProviderPricing(config) 获取定价
 *    c. Provider 不存在 → fallback 到 PROVIDER_PRICING['openai-compatible']
 * 3. 调用 calculateCost(record, pricing) 计算 cost
 *
 * @param record token 使用记录
 * @returns 成本（USD），四舍五入到 6 位小数
 */
function computeRecordCost(record: TokenUsageRecord): number {
  // 1. 优先使用已计算的 cost 字段
  if (typeof record.cost === 'number' && record.cost >= 0) {
    return record.cost
  }

  // 2. 查找 Provider 配置
  let pricing
  try {
    const config = getProvider(record.providerId)
    if (config) {
      pricing = getProviderPricing(config)
    } else {
      // Provider 不存在 → fallback 到 openai-compatible 默认定价
      pricing = PROVIDER_PRICING['openai-compatible']
    }
  } catch (err) {
    // getProvider 抛错（如 electron-store 未初始化）→ fallback 到默认定价
    logger.warn('AGENT.TOKEN', 'getCostStats: getProvider 抛错，使用默认定价', {
      providerId: record.providerId,
      error: err instanceof Error ? err.message : String(err),
    })
    pricing = PROVIDER_PRICING['openai-compatible']
  }

  // 3. 计算 cost
  return calculateCost(record, pricing)
}

/**
 * 获取累计成本统计
 *
 * 借鉴 Aider 成本累计展示：按时间维度 + Subagent 维度聚合成本（USD）。
 *
 * 计算逻辑：
 * 1. 遍历 usageRecords，对每条记录调用 computeRecordCost 计算 cost
 * 2. 按时间窗口（当日/当周/当月/总）累加 cost
 * 3. 按 Subagent 维度（record.subagent）累加 cost
 * 4. 按 Provider 维度（record.providerId）累加 cost
 *
 * 注意事项：
 * - 仅在 main 内部使用，不暴露 IPC 通道
 * - Provider 不存在时 fallback 到 PROVIDER_PRICING['openai-compatible']
 * - cost 字段未设置时（旧记录）按 calculateCost 重算
 * - 时间窗口复用 getTokenStats 的 getWindowStarts 逻辑
 *
 * @returns 成本统计
 *
 * @example
 * ```ts
 * const stats = getCostStats()
 * console.log(`今日消费: $${stats.todayCost.toFixed(4)}`)
 * console.log(`本月消费: $${stats.monthCost.toFixed(4)}`)
 * console.log(`按 Subagent 分布:`, stats.bySubagent)
 * ```
 */
export function getCostStats(): CostStats {
  const { todayStart, weekStart, monthStart } = getWindowStarts()
  const stats: CostStats = {
    todayCost: 0,
    weekCost: 0,
    monthCost: 0,
    totalCost: 0,
    bySubagent: {},
    byProvider: {},
  }

  for (const r of usageRecords) {
    const cost = computeRecordCost(r)

    stats.totalCost += cost
    if (r.timestamp >= monthStart) {
      stats.monthCost += cost
      if (r.timestamp >= weekStart) {
        stats.weekCost += cost
        if (r.timestamp >= todayStart) {
          stats.todayCost += cost
        }
      }
    }

    stats.bySubagent[r.subagent] = (stats.bySubagent[r.subagent] ?? 0) + cost
    stats.byProvider[r.providerId] = (stats.byProvider[r.providerId] ?? 0) + cost
  }

  // 四舍五入到 6 位小数（避免浮点精度问题）
  stats.todayCost = Math.round(stats.todayCost * 1_000_000) / 1_000_000
  stats.weekCost = Math.round(stats.weekCost * 1_000_000) / 1_000_000
  stats.monthCost = Math.round(stats.monthCost * 1_000_000) / 1_000_000
  stats.totalCost = Math.round(stats.totalCost * 1_000_000) / 1_000_000
  for (const key of Object.keys(stats.bySubagent)) {
    stats.bySubagent[key] = Math.round(stats.bySubagent[key] * 1_000_000) / 1_000_000
  }
  for (const key of Object.keys(stats.byProvider)) {
    stats.byProvider[key] = Math.round(stats.byProvider[key] * 1_000_000) / 1_000_000
  }

  return stats
}
