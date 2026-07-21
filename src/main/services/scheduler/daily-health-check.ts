/**
 * 每日健康检查定时任务（Phase 6 Task 6.2）
 *
 * 设计依据：
 *   - DEC-7：cron 用 Asia/Shanghai 时区
 *   - 依赖注入：核心函数接受 SshExecutor / RuleAnalyzer 接口，
 *     便于测试 mock；运行时由 createDailyHealthCheckTask 工厂注入真实实现。
 *   - 错误隔离：单台服务器失败不中断整体任务，记录到 details.failures。
 *   - 不写数据库：告警仅记录到 TaskResult.details.alerts。
 *
 * cron: `0 9 * * *`（每日 09:00 北京时间）
 * 流程：connect → 4 次 exec 采集 CPU/内存/磁盘/网络 → ruleAnalyzer.analyze → 汇总
 * 运行时无 mock，真实调用 SshConnectionManager + rule-engine.analyzeByRules。
 */

import type { SshConfig, CommandResult } from '@shared/models'
import type { SchedulerTask, TaskResult } from '@shared/scheduler-types'
import { SshConnectionManager } from '../ssh/connection-manager'
import { analyzeByRules } from '../../core/rule-engine'
import { logger } from '../../core/logger'

// ============================================================================
// 公共类型定义
// ============================================================================

/** 单台服务器的指标采集结果（4 项原始输出 + 采集时间） */
export interface ServerMetrics {
  serverId: string
  serverName: string
  host: string
  /** CPU 命令原始输出（top -bn1 | grep "Cpu(s)" | awk '{print $2}'） */
  cpuRaw: string
  /** 内存命令原始输出（free -m | awk '/Mem/{print $3"/"$2}'，格式 used/total MB） */
  memoryRaw: string
  /** 磁盘命令原始输出（df -h / | awk 'NR==2{print $5}'，格式 45%） */
  diskRaw: string
  /** 网络命令原始输出（cat /proc/net/dev | grep eth0） */
  networkRaw: string
  /** 采集时间戳（epoch ms） */
  collectedAt: number
}

export type AlertSeverity = 'warning' | 'critical'
export type AlertCategory = 'cpu' | 'memory' | 'disk' | 'network' | 'unknown'

/** 单条健康告警 */
export interface HealthAlert {
  serverId: string
  serverName: string
  severity: AlertSeverity
  category: AlertCategory
  /** 告警消息（中文，一行） */
  message: string
  /** 根因假设（来自规则引擎，可选） */
  hypothesis?: string
  /** 修复命令（来自规则引擎，可选） */
  fixCommand?: string
  /** 置信度 [0, 1]（来自规则引擎，可选） */
  confidence?: number
}

/** 单台服务器检查结果（成功或失败） */
export interface ServerCheckResult {
  serverId: string
  serverName: string
  success: boolean
  metrics?: ServerMetrics
  error?: string
}

/** details.failures 元素结构 */
export interface ServerFailure {
  serverId: string
  serverName: string
  error: string
}

/** 巡检任务详细结果（TaskResult.details 字段结构） */
export interface HealthCheckDetails {
  serversChecked: number
  successes: ServerCheckResult[]
  failures: ServerFailure[]
  metrics: ServerMetrics[]
  alerts: HealthAlert[]
  /** 规则引擎异常信息（规则引擎整体异常时不中断任务） */
  ruleEngineError?: string
}

// ============================================================================
// 依赖注入接口
// ============================================================================

/** SSH 执行器接口（依赖注入，便于测试 mock，运行时由 SshConnectionManagerAdapter 实现） */
export interface SshExecutor {
  connect(config: SshConfig): Promise<string>
  exec(
    sessionId: string,
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
  disconnect(sessionId: string): Promise<boolean>
}

/** 规则分析器接口（依赖注入，输入指标返回告警列表） */
export interface RuleAnalyzer {
  analyze(metrics: ServerMetrics): HealthAlert[]
}

/** runDailyHealthCheck 的依赖注入参数 */
export interface HealthCheckParams {
  sshExecutor: SshExecutor
  servers: SshConfig[]
  ruleAnalyzer: RuleAnalyzer
}

// 指标采集命令
const CMD_CPU = `top -bn1 | grep "Cpu(s)" | awk '{print $2}'`
const CMD_MEMORY = `free -m | awk '/Mem/{print $3"/"$2}'`
const CMD_DISK = `df -h / | awk 'NR==2{print $5}'`
const CMD_NETWORK = `cat /proc/net/dev | grep eth0`

// 任务常量
const DAILY_HEALTH_CHECK_CRON = '0 9 * * *'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'

// 告警阈值（百分比）
const CPU_ALERT_THRESHOLD = 80
const MEMORY_ALERT_THRESHOLD = 80
const DISK_ALERT_THRESHOLD = 85
const CRITICAL_THRESHOLD = 95

// ============================================================================
// 核心执行函数
// ============================================================================

/**
 * 执行每日健康检查（核心逻辑，便于单元测试）
 *
 * 流程：
 *   1. servers 为空时返回 success=true 的"无服务器配置"结果
 *   2. 逐台服务器：connect → 4 次 exec 采集指标 → disconnect
 *      单台失败 try/catch 隔离，记录到 details.failures
 *   3. 调用 ruleAnalyzer.analyze(metrics) 进行规则分析
 *      规则引擎整体异常 try/catch 兜底，记录到 details.ruleEngineError
 *   4. 汇总 alerts（不直接写数据库），返回 TaskResult
 *
 * 不抛异常：所有异常都被捕获并转换为 TaskResult 字段。
 */
export async function runDailyHealthCheck(
  params: HealthCheckParams
): Promise<TaskResult> {
  const startedAt = Date.now()
  const { sshExecutor, servers, ruleAnalyzer } = params

  if (!servers || servers.length === 0) {
    return {
      success: true,
      summary: '无服务器配置，跳过巡检',
      details: {
        serversChecked: 0,
        successes: [],
        failures: [],
        metrics: [],
        alerts: [],
      },
      durationMs: Date.now() - startedAt,
    }
  }

  const successes: ServerCheckResult[] = []
  const failures: ServerFailure[] = []
  const metricsList: ServerMetrics[] = []
  const alerts: HealthAlert[] = []
  let ruleEngineError: string | undefined

  // 逐台服务器采集指标（错误隔离）
  for (const server of servers) {
    try {
      const metrics = await collectServerMetrics(sshExecutor, server)
      successes.push({
        serverId: server.id,
        serverName: server.name,
        success: true,
        metrics,
      })
      metricsList.push(metrics)
    } catch (e) {
      const err = e as Error
      failures.push({
        serverId: server.id,
        serverName: server.name,
        error: err.message,
      })
      logger.warn(
        `[DailyHealthCheck] 服务器 ${server.name} (${server.host}) 采集失败: ${err.message}`
      )
    }
  }

  // 规则分析（整体异常 try/catch 兜底）
  if (metricsList.length > 0) {
    try {
      for (const metrics of metricsList) {
        alerts.push(...ruleAnalyzer.analyze(metrics))
      }
    } catch (e) {
      const err = e as Error
      ruleEngineError = err.message
      logger.error(
        `[DailyHealthCheck] 规则引擎异常: ${err.message}（已采集 ${metricsList.length} 台指标但未生成告警）`
      )
    }
  }

  return {
    // 即使部分服务器失败，整体任务视为成功（已正常完成巡检流程）
    success: true,
    summary: formatSummary(
      servers.length,
      successes.length,
      failures.length,
      alerts.length,
      ruleEngineError
    ),
    details: {
      serversChecked: servers.length,
      successes,
      failures,
      metrics: metricsList,
      alerts,
      ruleEngineError,
    },
    durationMs: Date.now() - startedAt,
  }
}

/** 采集单台服务器 4 项指标：connect → 4 次并发 exec → disconnect（异常向上抛） */
async function collectServerMetrics(
  executor: SshExecutor,
  server: SshConfig
): Promise<ServerMetrics> {
  let sessionId: string | null = null
  try {
    sessionId = await executor.connect(server)
    const [cpu, memory, disk, network] = await Promise.all([
      safeExec(executor, sessionId, CMD_CPU),
      safeExec(executor, sessionId, CMD_MEMORY),
      safeExec(executor, sessionId, CMD_DISK),
      safeExec(executor, sessionId, CMD_NETWORK),
    ])
    return {
      serverId: server.id,
      serverName: server.name,
      host: server.host,
      cpuRaw: cpu,
      memoryRaw: memory,
      diskRaw: disk,
      networkRaw: network,
      collectedAt: Date.now(),
    }
  } finally {
    // 无论成功失败都尝试断开连接，避免会话泄漏
    if (sessionId) {
      try {
        await executor.disconnect(sessionId)
      } catch {
        // 断开失败不阻断指标返回（指标已采集成功）
      }
    }
  }
}

/** 执行单条命令并返回 stdout（exitCode != 0 时抛错） */
async function safeExec(
  executor: SshExecutor,
  sessionId: string,
  command: string
): Promise<string> {
  const result = await executor.exec(sessionId, command)
  if (result.exitCode !== 0) {
    throw new Error(
      `命令执行失败 (exit=${result.exitCode}): ${command} · stderr=${result.stderr.trim()}`
    )
  }
  return result.stdout.trim()
}

/** 格式化巡检摘要（例："检查 3 台服务器，成功 2 台，失败 1 台，发现 2 个告警"） */
function formatSummary(
  total: number,
  successCount: number,
  failCount: number,
  alertCount: number,
  ruleEngineError?: string
): string {
  const parts: string[] = [`检查 ${total} 台服务器，成功 ${successCount} 台`]
  if (failCount > 0) parts.push(`失败 ${failCount} 台`)
  parts.push(`发现 ${alertCount} 个告警`)
  if (ruleEngineError) parts.push('规则引擎异常')
  return parts.join('，')
}

// ============================================================================
// 默认 RuleAnalyzer 实现（运行时使用，无 mock）
// ============================================================================

/**
 * 默认规则分析器（阈值 + 关键词双引擎）
 *
 *   1. 阈值检查：CPU/内存/磁盘超过阈值时生成告警（CPU=80% / 内存=80% / 磁盘=85% / 严重=95%）
 *   2. 关键词检查：调用 rule-engine.analyzeByRules 匹配 OOM/磁盘满等场景，
 *      补充根因假设与修复命令（attach 到已有阈值告警，或单独产出 unknown 告警）
 */
export class DefaultRuleAnalyzer implements RuleAnalyzer {
  analyze(metrics: ServerMetrics): HealthAlert[] {
    const alerts: HealthAlert[] = []

    // CPU 阈值检查
    const cpuPercent = parseCpuUsage(metrics.cpuRaw)
    if (cpuPercent !== null) {
      if (cpuPercent >= CRITICAL_THRESHOLD) {
        alerts.push(this.buildAlert(metrics, 'critical', 'cpu',
          `CPU 使用率 ${cpuPercent.toFixed(1)}% (≥${CRITICAL_THRESHOLD}%)`))
      } else if (cpuPercent >= CPU_ALERT_THRESHOLD) {
        alerts.push(this.buildAlert(metrics, 'warning', 'cpu',
          `CPU 使用率 ${cpuPercent.toFixed(1)}% (≥${CPU_ALERT_THRESHOLD}%)`))
      }
    }

    // 内存阈值检查
    const memPercent = parseMemoryUsage(metrics.memoryRaw)
    if (memPercent !== null) {
      if (memPercent >= CRITICAL_THRESHOLD) {
        alerts.push(this.buildAlert(metrics, 'critical', 'memory',
          `内存使用率 ${memPercent.toFixed(1)}% (≥${CRITICAL_THRESHOLD}%)`))
      } else if (memPercent >= MEMORY_ALERT_THRESHOLD) {
        alerts.push(this.buildAlert(metrics, 'warning', 'memory',
          `内存使用率 ${memPercent.toFixed(1)}% (≥${MEMORY_ALERT_THRESHOLD}%)`))
      }
    }

    // 磁盘阈值检查
    const diskPercent = parseDiskUsage(metrics.diskRaw)
    if (diskPercent !== null) {
      if (diskPercent >= CRITICAL_THRESHOLD) {
        alerts.push(this.buildAlert(metrics, 'critical', 'disk',
          `磁盘使用率 ${diskPercent.toFixed(1)}% (≥${CRITICAL_THRESHOLD}%)`))
      } else if (diskPercent >= DISK_ALERT_THRESHOLD) {
        alerts.push(this.buildAlert(metrics, 'warning', 'disk',
          `磁盘使用率 ${diskPercent.toFixed(1)}% (≥${DISK_ALERT_THRESHOLD}%)`))
      }
    }

    // 网络检查（无明确阈值，仅在原始输出异常时告警）
    if (!metrics.networkRaw || metrics.networkRaw.trim() === '') {
      alerts.push(this.buildAlert(metrics, 'warning', 'network',
        '网络接口 eth0 未找到或无数据'))
    }

    // 关键词分析：合并所有原始输出，调用 analyzeByRules 补充根因
    const combinedRaw = `cpu: ${metrics.cpuRaw}\nmemory: ${metrics.memoryRaw}\ndisk: ${metrics.diskRaw}\nnetwork: ${metrics.networkRaw}`
    const ruleResult = analyzeByRules('每日巡检', combinedRaw)
    if (ruleResult) {
      // 阈值告警已存在时附加根因；否则单独产出一条 unknown 告警
      const existing = alerts.find((a) =>
        a.category === 'cpu' || a.category === 'memory' || a.category === 'disk'
      )
      if (existing) {
        existing.hypothesis = ruleResult.hypothesis
        existing.fixCommand = ruleResult.fixCommand
        existing.confidence = ruleResult.confidence
      } else {
        alerts.push({
          serverId: metrics.serverId,
          serverName: metrics.serverName,
          severity: 'warning',
          category: 'unknown',
          message: `规则引擎匹配: ${ruleResult.hypothesis}`,
          hypothesis: ruleResult.hypothesis,
          fixCommand: ruleResult.fixCommand,
          confidence: ruleResult.confidence,
        })
      }
    }

    return alerts
  }

  private buildAlert(
    metrics: ServerMetrics,
    severity: AlertSeverity,
    category: AlertCategory,
    message: string
  ): HealthAlert {
    return {
      serverId: metrics.serverId,
      serverName: metrics.serverName,
      severity,
      category,
      message,
    }
  }
}

// ============================================================================
// 指标解析工具函数
// ============================================================================

/** 解析 CPU 使用率（"12.3" / "12.3 us, 4.5 sy" → 12.3；空串返回 null） */
function parseCpuUsage(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const value = parseFloat(match[1])
  return Number.isFinite(value) ? value : null
}

/** 解析内存使用率（"2048/8192" → 25，非法返回 null） */
function parseMemoryUsage(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/(\d+)\s*\/\s*(\d+)/)
  if (!match) return null
  const used = parseInt(match[1], 10)
  const total = parseInt(match[2], 10)
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null
  return (used / total) * 100
}

/** 解析磁盘使用率（"45%" / "45" → 45，"Use%" / "" → null） */
function parseDiskUsage(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const numStr = trimmed.replace('%', '').trim()
  if (!/^\d+(\.\d+)?$/.test(numStr)) return null
  const value = parseFloat(numStr)
  return Number.isFinite(value) ? value : null
}

// ============================================================================
// 运行时 SshExecutor 适配器（包装 SshConnectionManager 单例，无 mock）
// ============================================================================

/** SshConnectionManager 适配器：把单例适配为 SshExecutor，exec 转换为简化结构 */
export class SshConnectionManagerAdapter implements SshExecutor {
  private readonly manager: SshConnectionManager

  constructor(manager: SshConnectionManager = SshConnectionManager.getInstance()) {
    this.manager = manager
  }

  async connect(config: SshConfig): Promise<string> {
    return this.manager.connect(config)
  }

  async exec(
    sessionId: string,
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result: CommandResult = await this.manager.exec(sessionId, command)
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }
  }

  async disconnect(sessionId: string): Promise<boolean> {
    return this.manager.disconnect(sessionId)
  }
}

// ============================================================================
// 任务工厂函数（注册到 Scheduler 时使用）
// ============================================================================

/**
 * 创建每日健康检查定时任务（运行时工厂函数）
 *
 * 注入真实实现：
 *   - sshExecutor = new SshConnectionManagerAdapter()
 *   - ruleAnalyzer = new DefaultRuleAnalyzer()
 *   - servers = ConfigStore.loadServerList()（每次执行实时读取，避免热更新遗漏）
 *
 * cron: `0 9 * * *`（每日 09:00 北京时间，DEC-7）
 *
 * @returns SchedulerTask 对象，可直接传给 Scheduler.register()
 */
export function createDailyHealthCheckTask(): SchedulerTask {
  return {
    id: 'daily-health-check',
    name: '每日健康检查',
    cron: DAILY_HEALTH_CHECK_CRON,
    timezone: DEFAULT_TIMEZONE,
    enabled: true,
    handler: async (): Promise<TaskResult> => {
      // 延迟加载 ConfigStore，避免模块初始化时序问题（electron-store 需 app.ready）
      const { ConfigStore } = await import('../storage/config-store')
      const servers = ConfigStore.loadServerList()
      const sshExecutor = new SshConnectionManagerAdapter()
      const ruleAnalyzer = new DefaultRuleAnalyzer()
      return runDailyHealthCheck({ sshExecutor, servers, ruleAnalyzer })
    },
  }
}
