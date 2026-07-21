/**
 * SidecarManager：管理 Python Sidecar 进程的生命周期
 *
 * v1.0 核心 MVP：只管理 Sidecar-A（SRE + 日志解析）
 * v1.5 升级：统一管理 Sidecar A/B/C（多进程隔离 + 端口分配）
 *
 * 设计参考：
 * - VS Code Language Server Manager：spawn + health check + restart
 * - JupyterLab Server Manager：多进程 + 自动恢复
 * - 复用 v0.9.5 McpLifecycleHardened 5 阶段状态机思想（单 sidecar 内部）
 *
 * 端口分配（v1.5）：
 * - 19000: Sidecar-A (SRE + Drain3 + OpenDerisk + LLM)
 * - 19001: Sidecar-B (Analytics + DoWhy + Phoenix 占位)
 * - 19002: Sidecar-C (Agent + smolagents + AgentScope 占位)
 * - 7931-8080 在 Windows 上被系统服务保留，19000 段空闲
 */
import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { logger } from '../logger'
import { getDiagnosticsService } from '../../services/diagnostics/diagnostics-service'
import type { LogEvent, LogLevel, LogSource } from '../../services/diagnostics/types'

/**
 * Sidecar 状态
 */
export type SidecarStatus = 'stopped' | 'starting' | 'ready' | 'degraded' | 'crashed'

/**
 * Sidecar 配置
 */
export interface SidecarConfig {
  id: string // "sre" | "analytics" | "agent"
  name: string // "Sidecar-A: SRE"
  pythonPath: string // venv python 路径
  workingDir: string // sidecar-a 目录
  entry: string // main.py 路径
  host: string // 127.0.0.1
  port: number // 19000/19001/19002
  healthCheckIntervalMs: number // 5000
  startupTimeoutMs: number // 10000
}

/**
 * 适配器状态（从 /health 端点获取）
 */
export interface AdaptersStatus {
  drain3: { ready: boolean; total_clusters: number }
  open_derisk: { ready: boolean; mode: string; rules_count: number }
}

/**
 * 健康响应
 */
export interface HealthResponse {
  status: string
  version: string
  adapters: AdaptersStatus
  uptime_seconds: number
}

/**
 * 端到端 Pipeline 响应（v1.5）
 */
export interface PipelineResponse {
  parse: {
    templates: Array<{
      template_id: string
      template: string
      count: number
      examples: string[]
    }>
    total_lines: number
    unique_templates: number
  }
  diagnose: {
    root_cause: string
    confidence: number
    severity: string
    recommendations: string[]
    reasoning: string[]
    source: string  // v1.5: "open-derisk-llm-enhanced" | "rule-based" | "rule-based-llm-failed" | "rule-fallback"
    // v1.5 新增字段
    related_risks: string[]
    rule_confidence: number | null
    llm_confidence: number | null
  }
}

/**
 * LLM 配置（v1.5 新增）
 * 用于透传到 Sidecar-A 启用 LLM 增强诊断
 */
export interface LlmConfigPayload {
  apiKey: string
  baseUrl: string
  model: string
}

/**
 * 通用 Sidecar 工具调用响应（v1.5 多 sidecar）
 */
export interface ToolCallResponse {
  ok: boolean
  data?: unknown
  error?: string
}

/**
 * 三个 Sidecar 的默认配置（v1.5 多 sidecar 架构）
 *
 * 设计原则：
 * - 每个 Sidecar 独立 venv + 独立端口
 * - Sidecar-A 必启用（v1.0 已落地）
 * - Sidecar-B/C 懒启动（首次调用时启动，节省资源）
 * - v1.5 简化：Sidecar-B/C 复用 .venv-sidecar-a（共享 fastapi+uvicorn 公共依赖）
 *   后续 v1.6 可拆分为独立 venv（隔离 Analytics/Agent 重依赖）
 */
const _SHARED_VENV = process.platform === 'win32'
  ? path.join(process.cwd(), '.venv-sidecar-a', 'Scripts', 'python.exe')
  : path.join(process.cwd(), '.venv-sidecar-a', 'bin', 'python')

export const SIDECAR_CONFIGS: Record<string, SidecarConfig> = {
  sre: {
    id: 'sre',
    name: 'Sidecar-A: SRE + 日志解析',
    pythonPath: _SHARED_VENV,
    workingDir: path.join(process.cwd(), 'sidecar-a'),
    entry: 'main.py',
    host: '127.0.0.1',
    port: 19000,
    healthCheckIntervalMs: 5000,
    startupTimeoutMs: 10000,
  },
  analytics: {
    id: 'analytics',
    name: 'Sidecar-B: Analytics + DoWhy + Phoenix (占位)',
    pythonPath: _SHARED_VENV,  // v1.5 共享 venv（v1.6 可拆）
    workingDir: path.join(process.cwd(), 'sidecar-b'),
    entry: 'main.py',
    host: '127.0.0.1',
    port: 19001,
    healthCheckIntervalMs: 5000,
    startupTimeoutMs: 10000,
  },
  agent: {
    id: 'agent',
    name: 'Sidecar-C: Agent + smolagents + AgentScope (占位)',
    pythonPath: _SHARED_VENV,  // v1.5 共享 venv（v1.6 可拆）
    workingDir: path.join(process.cwd(), 'sidecar-c'),
    entry: 'main.py',
    host: '127.0.0.1',
    port: 19002,
    healthCheckIntervalMs: 5000,
    startupTimeoutMs: 10000,
  },
}

/**
 * 向后兼容的 Sidecar-A 配置别名
 */
const SIDECAR_A_CONFIG = SIDECAR_CONFIGS.sre

/**
 * SidecarManager 单例
 *
 * v1.5 修复：导出类（export）以支持集成测试直接实例化
 * 生产代码仍推荐使用 getSidecarManager() 工厂函数获取单例
 */
export class SidecarManager extends EventEmitter {
  private config: SidecarConfig
  private process: ChildProcess | null = null
  private status: SidecarStatus = 'stopped'
  private healthCheckTimer: NodeJS.Timeout | null = null
  private lastError: string | null = null
  private restartCount = 0

  constructor(config: SidecarConfig = SIDECAR_A_CONFIG) {
    super()
    this.config = config
  }

  /**
   * 推断日志级别（从原始文本中识别）
   *
   * 规则：
   *   - 包含 "ERROR"/"CRITICAL"/"FATAL" → ERROR
   *   - 包含 "WARN" → WARN
   *   - 包含 "Traceback"/"Exception"/"Failed" → ERROR
   *   - 其他 → INFO
   */
  private inferLogLevel(raw: string): LogLevel {
    const upper = raw.toUpperCase()
    if (upper.includes('CRITICAL') || upper.includes('FATAL')) return 'FATAL'
    if (upper.includes('ERROR') || upper.includes('TRACEBACK') ||
        upper.includes('EXCEPTION') || upper.includes('FAILED')) return 'ERROR'
    if (upper.includes('WARN')) return 'WARN'
    if (upper.includes('DEBUG')) return 'DEBUG'
    return 'INFO'
  }

  /**
   * 把 Sidecar 日志转发到 DiagnosticsService（核心钩子）
   *
   * 实现用户原话："当循环工程启动时利用后端的日志进行分析"
   *
   * @param raw 原始日志文本（已 trim）
   * @param isStderr 是否来自 stderr（stderr 默认升级为 WARN）
   */
  private forwardLog(raw: string, isStderr = false): void {
    if (!raw || !raw.trim()) return
    const trimmed = raw.trim()

    // stderr 默认升级为 WARN（除非已经是 ERROR/FATAL）
    let level = this.inferLogLevel(trimmed)
    if (isStderr && level === 'INFO') level = 'WARN'

    // 推断 source：根据 this.config.id
    const source: LogSource = (this.config.id as LogSource) || 'sre'

    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      source,
      level,
      raw: trimmed,
      pid: this.process?.pid,
    }

    try {
      getDiagnosticsService().ingestLog(event)
    } catch (err) {
      // 诊断服务异常不应影响 Sidecar 主流程
      logger.warn(`[SidecarManager] 转发日志到 DiagnosticsService 失败: ${(err as Error).message}`)
    }
  }

  /**
   * 启动 Sidecar 进程
   */
  async start(): Promise<void> {
    if (this.status === 'ready' || this.status === 'starting') {
      logger.info(`[SidecarManager] Sidecar ${this.config.id} 已在运行中`)
      return
    }

    this.status = 'starting'
    this.lastError = null
    this.emit('status', this.status)

    logger.info(`[SidecarManager] 启动 ${this.config.name}（${this.config.host}:${this.config.port}）`)

    try {
      // 1. spawn Python 进程
      this.process = spawn(
        this.config.pythonPath,
        ['-m', this.config.entry.replace(/\.py$/, '').replace(/\//g, '.')],
        {
          cwd: this.config.workingDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUNBUFFERED: '1' },
        },
      )

      // 2. 监听 stdout/stderr（转发到 DiagnosticsService 进行实时分析）
      this.process.stdout?.on('data', (data) => {
        const text = data.toString().trim()
        logger.info(`[${this.config.id}] ${text}`)
        // 转发到诊断服务（循环工程启动时分析）
        this.forwardLog(text, false)
      })
      this.process.stderr?.on('data', (data) => {
        const text = data.toString().trim()
        logger.warn(`[${this.config.id}] ${text}`)
        // stderr 转发到诊断服务（标记 isStderr=true）
        this.forwardLog(text, true)
      })

      // 3. 监听进程退出
      this.process.on('exit', (code, signal) => {
        const exitMsg = `Sidecar ${this.config.id} 退出（code=${code}, signal=${signal}）`
        logger.warn(`[SidecarManager] ${exitMsg}`)
        // 转发退出事件到诊断服务（触发 sidecar_crash 规则）
        this.forwardLog(`[SidecarManager] ${exitMsg}`, code !== 0 && code !== null)

        this.status = 'crashed'
        this.emit('status', this.status)
        this.emit('exit', { code, signal })

        // 自动重启（最多 3 次）
        if (this.restartCount < 3) {
          this.restartCount++
          const restartMsg = `自动重启 ${this.config.id}（第 ${this.restartCount} 次）`
          logger.info(`[SidecarManager] ${restartMsg}`)
          this.forwardLog(`[SidecarManager] ${restartMsg}`, false)
          setTimeout(() => this.start(), 2000)
        } else {
          const limitMsg = `Sidecar ${this.config.id} 重启超限（3 次），停止重试`
          logger.error(`[SidecarManager] ${limitMsg}`)
          this.forwardLog(`[SidecarManager] ${limitMsg}`, true)
        }
      })

      // 4. 等待健康检查通过
      await this.waitForReady(this.config.startupTimeoutMs)
      this.status = 'ready'
      this.restartCount = 0
      this.emit('status', this.status)

      // 5. 启动定时健康检查
      this.startHealthCheck()

      const readyMsg = `Sidecar ${this.config.id} 就绪 ✓`
      logger.info(`[SidecarManager] ${readyMsg}`)
      this.forwardLog(`[SidecarManager] ${readyMsg}`, false)
    } catch (err) {
      this.status = 'crashed'
      this.lastError = err instanceof Error ? err.message : String(err)
      this.emit('status', this.status)
      const failMsg = `Sidecar ${this.config.id} 启动失败：${this.lastError}`
      logger.error(`[SidecarManager] ${failMsg}`)
      // 转发启动失败日志（会触发 health_check_fail 规则）
      this.forwardLog(`[SidecarManager] ${failMsg}`, true)
      throw err
    }
  }

  /**
   * 等待健康检查通过
   */
  private async waitForReady(timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await this.health()
        if (resp.status === 'ok') return
      } catch {
        // 还未就绪，继续等待
      }
      await this.sleep(500)
    }
    throw new Error(`Sidecar 启动超时（${timeoutMs}ms）`)
  }

  /**
   * 启动定时健康检查
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
    }
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.health()
        if (this.status === 'degraded') {
          this.status = 'ready'
          this.emit('status', this.status)
        }
      } catch (err) {
        if (this.status === 'ready') {
          this.status = 'degraded'
          this.lastError = err instanceof Error ? err.message : String(err)
          this.emit('status', this.status)
          logger.warn(`[SidecarManager] Sidecar ${this.config.id} degraded：${this.lastError}`)
        }
      }
    }, this.config.healthCheckIntervalMs)
  }

  /**
   * 健康检查
   */
  async health(): Promise<HealthResponse> {
    const resp = await fetch(`http://${this.config.host}:${this.config.port}/health`)
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }
    return (await resp.json()) as HealthResponse
  }

  /**
   * 端到端 Pipeline（核心：日志 → Drain3 → OpenDerisk）
   * v1.5 新增：支持 llmConfig 透传，启用 LLM 增强诊断
   */
  async runPipeline(
    logLines: string[],
    serviceName: string = 'unknown',
    llmConfig?: LlmConfigPayload,
  ): Promise<PipelineResponse> {
    if (this.status !== 'ready') {
      throw new Error(`Sidecar 未就绪（status=${this.status}）`)
    }
    const body: Record<string, unknown> = { log_lines: logLines, service_name: serviceName }
    if (llmConfig) {
      body.llm_config = {
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
        model: llmConfig.model,
      }
      logger.info(`[SidecarManager] Pipeline 启用 LLM 增强（model=${llmConfig.model}）`)
    }
    const resp = await fetch(`http://${this.config.host}:${this.config.port}/pipeline/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Pipeline 调用失败：HTTP ${resp.status} - ${errText}`)
    }
    return (await resp.json()) as PipelineResponse
  }

  /**
   * 仅 Drain3 解析
   */
  async parseLogs(logLines: string[], maxClusters: number = 50): Promise<PipelineResponse['parse']> {
    const resp = await fetch(`http://${this.config.host}:${this.config.port}/drain3/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_lines: logLines, max_clusters: maxClusters }),
    })
    if (!resp.ok) throw new Error(`Drain3 失败：HTTP ${resp.status}`)
    return (await resp.json()) as PipelineResponse['parse']
  }

  /**
   * 仅 OpenDerisk 诊断
   */
  async diagnose(templates: PipelineResponse['parse']['templates'], serviceName: string = 'unknown') {
    const resp = await fetch(`http://${this.config.host}:${this.config.port}/sre/diagnose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_templates: templates, service_name: serviceName }),
    })
    if (!resp.ok) throw new Error(`OpenDerisk 失败：HTTP ${resp.status}`)
    return resp.json()
  }

  /**
   * 停止 Sidecar
   */
  async stop(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
    if (this.process) {
      logger.info(`[SidecarManager] 停止 ${this.config.id}（PID=${this.process.pid}）`)
      this.process.kill('SIGTERM')
      // 等待进程退出（最多 3s）
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.process?.kill('SIGKILL')
          resolve()
        }, 3000)
        this.process?.on('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      this.process = null
    }
    this.status = 'stopped'
    this.emit('status', this.status)
  }

  /**
   * 获取当前状态
   */
  getStatus(): { status: SidecarStatus; lastError: string | null; restartCount: number } {
    return { status: this.status, lastError: this.lastError, restartCount: this.restartCount }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================
// 单例导出（v1.5 多 sidecar 支持）
// ============================================================
const instances: Map<string, SidecarManager> = new Map()

/**
 * 按 sidecarId 获取单例（v1.5 新增）
 *
 * 用法：
 *   getSidecarManager('sre')       // Sidecar-A (19000)
 *   getSidecarManager('analytics') // Sidecar-B (19001)
 *   getSidecarManager('agent')     // Sidecar-C (19002)
 *   getSidecarManager()            // 向后兼容：默认 Sidecar-A
 */
export function getSidecarManager(sidecarId: string = 'sre'): SidecarManager {
  if (!instances.has(sidecarId)) {
    const config = SIDECAR_CONFIGS[sidecarId] || SIDECAR_A_CONFIG
    instances.set(sidecarId, new SidecarManager(config))
    logger.info(`[SidecarManager] 创建 ${config.name} 单例`)
  }
  return instances.get(sidecarId)!
}

/**
 * 获取所有 sidecar 状态（v1.5 新增）
 *
 * 用于 UI 状态条统一展示 A/B/C 三个 sidecar 健康状态
 */
export function getAllSidecarStatuses(): Record<string, { status: SidecarStatus; lastError: string | null }> {
  const result: Record<string, { status: SidecarStatus; lastError: string | null }> = {}
  for (const [id, mgr] of instances) {
    const s = mgr.getStatus()
    result[id] = { status: s.status, lastError: s.lastError }
  }
  // 未启动的 sidecar 标记为 stopped
  for (const id of Object.keys(SIDECAR_CONFIGS)) {
    if (!result[id]) {
      result[id] = { status: 'stopped', lastError: null }
    }
  }
  return result
}

/**
 * 关闭所有 sidecar 进程
 *
 * 应在 app.on('before-quit') 钩子中调用
 */
export async function shutdownSidecarManager(): Promise<void> {
  for (const [id, mgr] of instances) {
    try {
      await mgr.stop()
      logger.info(`[SidecarManager] 关闭 ${id}`)
    } catch (err) {
      logger.error(`[SidecarManager] 关闭 ${id} 失败：${err}`)
    }
  }
  instances.clear()
}
