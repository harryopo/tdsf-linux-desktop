/**
 * SidecarManager：管理 Python Sidecar 进程的生命周期
 *
 * v1.0 核心 MVP：管理 Sidecar-A（SRE + 日志解析）
 *
 * 设计参考：
 * - VS Code Language Server Manager：spawn + health check + restart
 * - JupyterLab Server Manager：自动恢复
 * - 复用 v0.9.5 McpLifecycleHardened 5 阶段状态机思想
 *
 * 端口分配：
 * - 19000: Sidecar-A (SRE + Drain3 + OpenDerisk + LLM)
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
  id: string // "sre"
  name: string // "Sidecar-A: SRE"
  pythonPath: string // venv python 路径
  workingDir: string // sidecar-a 目录
  entry: string // main.py 路径
  host: string // 127.0.0.1
  port: number // 19000
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
  /**
   * 侧车的空闲退出请求（D3）：true 只代表"它想退、正在等宿主批准"。
   * 缺字段说明跑的是旧版侧车，按"没有请求"处理，绝不能当成批准。
   */
  idle_shutdown_request?: boolean
  /** 侧车已连续空闲多少秒（不算宿主的存活轮询） */
  idle_seconds?: number
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
 * Sidecar-A 默认配置
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
/** 重启预算：30 秒窗口内最多 3 次（D3） */
export const RESTART_BUDGET_MAX = 3
export const RESTART_BUDGET_WINDOW_MS = 30_000
/** 单次 HTTP 请求上限：健康检查快，业务调用给到 180 秒 */
export const HEALTH_REQUEST_TIMEOUT_MS = 5_000
export const BUSINESS_REQUEST_TIMEOUT_MS = 180_000
/** stderr 环形缓冲行数（崩溃时最后几行才是现场） */
export const STDERR_RING_SIZE = 40

/**
 * 进程是否还活着（signal 0 只做存在性探测，不发真信号）
 *
 * Windows 上 Node 同样支持用 0 探测存在性；进程不在时抛 ESRCH。
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 滚动窗口内还剩多少重启预算
 *
 * 抽成纯函数是为了能被单测钉住 —— 以前的"累计 3 次、成功即清零"
 * 让每隔 30 秒崩一次的 sidecar 可以无限重启，那种缺陷光看代码看不出来。
 */
export function remainingRestartBudget(
  restartTimes: readonly number[],
  now: number,
  max: number = RESTART_BUDGET_MAX,
  windowMs: number = RESTART_BUDGET_WINDOW_MS
): number {
  const used = restartTimes.filter((t) => now - t < windowMs).length
  return Math.max(0, max - used)
}

/** 预算是否还允许再重启一次 */
export function canRestartWithinBudget(
  restartTimes: readonly number[],
  now: number,
  max: number = RESTART_BUDGET_MAX,
  windowMs: number = RESTART_BUDGET_WINDOW_MS
): boolean {
  return remainingRestartBudget(restartTimes, now, max, windowMs) > 0
}

export class SidecarManager extends EventEmitter {
  private config: SidecarConfig
  private process: ChildProcess | null = null
  private status: SidecarStatus = 'stopped'
  private healthCheckTimer: NodeJS.Timeout | null = null
  private lastError: string | null = null
  private restartCount = 0
  /** 最近若干次重启的时间戳，用于 30 秒滚动窗口预算 */
  private restartTimes: number[] = []
  /** stderr 环形缓冲，崩溃时把最后几行带进日志与状态 */
  private readonly stderrRing: string[] = []
  /** 主动停止标记：区分"用户关的应用"与"进程自己崩了" */
  private stopping = false
  /**
   * 宿主这边正在等业务结果的业务请求数。
   * 空闲退出批准的依据之一：用户还等着结果时不能放侧车走。
   */
  private businessInFlight = 0
  /** 排队中的重启定时器，stop() 必须掐掉它 */
  private restartTimer: NodeJS.Timeout | null = null

  constructor(config: SidecarConfig = SIDECAR_A_CONFIG) {
    super()
    this.config = config
  }

  /**
   * 重启预算判定（D3）
   *
   * 以前是"累计 3 次、成功启动后清零"，于是每隔 30 秒崩一次的 sidecar
   * 可以无限重启。改成滚动窗口：只看最近 30 秒内的重启次数。
   */
  private canRestart(now = Date.now()): boolean {
    return canRestartWithinBudget(this.restartTimes, now)
  }

  /** 记一次重启并返回窗口内已用次数 */
  private recordRestart(now = Date.now()): number {
    this.restartTimes.push(now)
    this.restartCount = this.restartTimes.length
    return this.restartCount
  }

  /** 追加一行 stderr，超出环形上限就丢最旧的 */
  private pushStderrLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    this.stderrRing.push(trimmed)
    if (this.stderrRing.length > STDERR_RING_SIZE) this.stderrRing.shift()
  }

  /** 取 stderr 尾部若干行（默认全部已缓冲的） */
  getStderrTail(limit = STDERR_RING_SIZE): string[] {
    return this.stderrRing.slice(-Math.max(0, Math.min(limit, STDERR_RING_SIZE)))
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
    // 显式 start() 就是"我要它跑起来"，解除上一次的主动停止标记
    this.stopping = false

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
        this.pushStderrLine(text)
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

        // 主动停止（应用退出/用户关面板）不重启，也不算崩溃
        if (this.stopping) {
          this.status = 'stopped'
          this.emit('status', this.status)
          this.emit('exit', { code, signal })
          return
        }

        this.status = 'crashed'
        this.emit('status', this.status)
        this.emit('exit', { code, signal })

        // 崩溃时把 stderr 尾部带进日志，否则只有一句"退出了"，现场全丢
        const tail = this.getStderrTail(5)
        if (tail.length > 0) {
          logger.warn(`[SidecarManager] ${this.config.id} 最后 5 行 stderr：${tail.join(' ⏎ ')}`)
        }

        // 自动重启（30 秒窗口内最多 3 次）
        if (this.canRestart()) {
          const n = this.recordRestart()
          const restartMsg = `自动重启 ${this.config.id}（窗口内第 ${n} 次）`
          logger.info(`[SidecarManager] ${restartMsg}`)
          this.forwardLog(`[SidecarManager] ${restartMsg}`, false)
          // 句柄必须存下来：stop() 不掐掉它的话，应用都关了 start() 还会再跑一次
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null
            if (this.stopping) return
            void this.start().catch(() => {
              /* start() 内部已记录失败，这里只防未处理拒绝 */
            })
          }, 2000)
        } else {
          const limitMsg = `Sidecar ${this.config.id} 重启超限（${RESTART_BUDGET_WINDOW_MS / 1000} 秒内 ${RESTART_BUDGET_MAX} 次），停止重试`
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
      // 已经被 stop() 接管：不要把状态改回 crashed，也不要去动进程
      if (this.stopping) {
        this.status = 'stopped'
        this.emit('status', this.status)
        logger.info(`[SidecarManager] ${this.config.id} 启动过程中被停止，按停止处理`)
        return
      }
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
      // 期间被 stop() 了就立刻退出，否则这个循环会在停止之后才醒来并把状态改坏
      if (this.stopping) throw new Error('Sidecar 在等待就绪期间被停止')
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
        const h = await this.health()
        // 侧车提出"我空闲了，能退吗"—— 由宿主决定，侧车自己不会退
        if (h.idle_shutdown_request === true) {
          await this.answerIdleShutdownRequest(h.idle_seconds ?? 0)
        }
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
    const resp = await fetch(`http://${this.config.host}:${this.config.port}/health`, {
      signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    })
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }
    return (await resp.json()) as HealthResponse
  }

  /** 业务请求统一走这里：顺带记住在途数，空闲退出批准要用它判断 */
  private async businessFetch(path: string, init: RequestInit): Promise<Response> {
    this.businessInFlight += 1
    try {
      return await fetch(`http://${this.config.host}:${this.config.port}${path}`, init)
    } finally {
      this.businessInFlight -= 1
    }
  }

  /**
   * 答复侧车的空闲退出请求（D3 的 idle_shutdown_request）
   *
   * 批准前先把 stopping 立起来：否则进程一没，重启预算把它当崩溃，
   * 30 秒窗口内立刻再拉一个起来 —— 侧车"想省资源"反而变成拉锯。
   * 有在途业务请求就拒绝：用户还等着结果，不能放承载结果的进程走。
   */
  async answerIdleShutdownRequest(idleSeconds: number): Promise<'approve' | 'refuse'> {
    const approve = this.businessInFlight === 0
    const resp = await this.businessFetch('/host/idle-shutdown-consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve }),
      signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    })
    if (!resp.ok) {
      logger.warn(`[SidecarManager] 空闲退出答复失败：HTTP ${resp.status}`)
      return 'refuse'
    }
    const verdict = (await resp.json()) as { ok?: boolean; exiting?: boolean }
    if (approve && verdict.exiting === true) {
      this.stopping = true
      logger.info(
        `[SidecarManager] 已批准 ${this.config.id} 空闲退出（连续空闲 ${Math.round(idleSeconds)} 秒），` +
          '按有意停止处理，不触发自动重启'
      )
      this.forwardLog(`[SidecarManager] ${this.config.id} 空闲退出获宿主批准`, false)
      return 'approve'
    }
    logger.info(`[SidecarManager] ${this.config.id} 空闲退出请求已拒绝（在途业务 ${this.businessInFlight}）`)
    return 'refuse'
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
    const resp = await this.businessFetch('/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BUSINESS_REQUEST_TIMEOUT_MS),
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
    const resp = await this.businessFetch('/drain3/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_lines: logLines, max_clusters: maxClusters }),
      signal: AbortSignal.timeout(BUSINESS_REQUEST_TIMEOUT_MS),
    })
    if (!resp.ok) throw new Error(`Drain3 失败：HTTP ${resp.status}`)
    return (await resp.json()) as PipelineResponse['parse']
  }

  /**
   * 仅 OpenDerisk 诊断
   */
  async diagnose(templates: PipelineResponse['parse']['templates'], serviceName: string = 'unknown') {
    const resp = await this.businessFetch('/sre/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_templates: templates, service_name: serviceName }),
      signal: AbortSignal.timeout(BUSINESS_REQUEST_TIMEOUT_MS),
    })
    if (!resp.ok) throw new Error(`OpenDerisk 失败：HTTP ${resp.status}`)
    return resp.json()
  }

  /**
   * 停止 Sidecar
   */
  async stop(): Promise<void> {
    // 先立标记：否则 exit 回调会把"用户关的应用"当成崩溃去重启
    this.stopping = true
    // 掐掉排队中的重启——真机跑出来过：stop 之后 start() 又被定时器拉起一次
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
    if (this.process) {
      logger.info(`[SidecarManager] 停止 ${this.config.id}（PID=${this.process.pid}）`)
      const pid = this.process.pid
      // 早就退出的进程（如启动即失败）没有第二次 exit 事件可等，
      // 再挂监听就会白等满 3 秒才走 SIGKILL 分支
      const alreadyGone = this.process.exitCode !== null || this.process.signalCode !== null
      if (!alreadyGone) {
        this.process.kill('SIGTERM')
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
      }
      // SIGTERM/SIGKILL 之后仍活着的，就是拖家带口的孤儿进程，补一刀
      if (pid !== undefined && isPidAlive(pid)) {
        logger.warn(`[SidecarManager] ${this.config.id} PID=${pid} 未响应退出信号，强杀`)
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // 已经在这两步之间自己退了
        }
      }
      this.process = null
    }
    this.status = 'stopped'
    this.emit('status', this.status)
    // 下次手动 start() 从零开始算重启预算
    this.restartTimes = []
    this.restartCount = 0
  }

  /**
   * 获取当前状态
   */
  getStatus(): {
    status: SidecarStatus
    lastError: string | null
    restartCount: number
    /** 最近 30 秒窗口内的重启次数（预算见 RESTART_BUDGET_MAX） */
    restartsInWindow: number
    /** stderr 尾部若干行，崩溃现场靠它定位 */
    stderrTail: string[]
    /**
     * 是否已把这次退出标成"有意停止"。
     * 暴露它是因为"批准空闲退出后不许被自动重启拉起"这条只能靠它判红。
     */
    intentionalStop: boolean
  } {
    const now = Date.now()
    return {
      status: this.status,
      lastError: this.lastError,
      restartCount: this.restartCount,
      restartsInWindow: this.restartTimes.filter((t) => now - t < RESTART_BUDGET_WINDOW_MS).length,
      stderrTail: this.getStderrTail(),
      intentionalStop: this.stopping,
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================
// 单例导出
// ============================================================
const instances: Map<string, SidecarManager> = new Map()

/**
 * 按 sidecarId 获取单例
 *
 * 用法：
 *   getSidecarManager('sre')       // Sidecar-A (19000)
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
