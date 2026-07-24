/**
 * OpenHands 容器启动器（v0.9 新增）
 *
 * 通过 `docker compose` 命令管理 OpenHands App Server 容器生命周期：
 * - start：拉起容器（detached 模式），等待端口就绪
 * - stop：优雅停止并移除容器
 * - isRunning：检查容器是否在运行
 * - waitForReady：轮询健康检查端点
 *
 * 设计原则：
 * 1. **不 hardcode 路径**：compose 文件路径、端口、镜像名都从外部传入
 * 2. **HC-1 网络日志可见**：所有 docker 命令执行都通过 logger 记录
 * 3. **HC-6 沙箱隔离**：容器隔离由 Docker 自身保证，本类只负责生命周期
 *
 * 方案书依据：v0.9 §8（沙箱集成）+ 源码分析报告 §二（Docker 容器架构）
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { logger } from '../log/logger'
import {
  OPENHANDS_DEFAULT_BASE_URL,
  OPENHANDS_DEFAULT_PORT,
  PORT_READY_POLL_INTERVAL_MS,
  SANDBOX_START_TIMEOUT_MS,
} from './types'

const execAsync = promisify(exec)

/** docker compose 命令超时（毫秒，首次拉镜像可能较慢） */
const DOCKER_COMPOSE_TIMEOUT_MS = 180_000

/**
 * OpenHands Runner 配置
 *
 * 由调用方（IPC 层）从 ConfigStore 读取后传入，避免本类直接依赖 ConfigStore。
 */
export interface OpenHandsRunnerConfig {
  /** docker-compose.yml 文件绝对路径 */
  composeFilePath: string
  /** OpenHands App Server 监听端口（默认 3000） */
  port: number
  /** 健康检查基地址（默认 http://localhost:3000） */
  baseUrl: string
  /** 启动超时（毫秒，默认 120000） */
  startTimeoutMs?: number
}

/**
 * OpenHands 容器启动器
 *
 * 单实例使用（同一时刻只允许一个 OpenHands App Server），
 * 多实例场景需在调用层做互斥。
 */
export class OpenHandsRunner {
  /** 容器服务名（docker-compose.yml 中定义的 service name） */
  private static readonly SERVICE_NAME = 'openhands'

  private readonly config: Required<OpenHandsRunnerConfig>

  /**
   * @param config Runner 配置（不传则使用默认值，便于快速测试）
   */
  constructor(config?: Partial<OpenHandsRunnerConfig>) {
    this.config = {
      composeFilePath:
        config?.composeFilePath ??
        path.join(__dirname, '..', '..', '..', 'resources', 'sandbox', 'openhands', 'docker-compose.yml'),
      port: config?.port ?? OPENHANDS_DEFAULT_PORT,
      baseUrl: config?.baseUrl ?? OPENHANDS_DEFAULT_BASE_URL,
      startTimeoutMs: config?.startTimeoutMs ?? SANDBOX_START_TIMEOUT_MS,
    }
  }

  /**
   * 启动 OpenHands 容器
   *
   * 步骤：
   * 1. 校验 docker-compose.yml 存在
   * 2. 执行 `docker compose -f xxx.yml up -d`
   * 3. 等待端口就绪（轮询健康检查端点）
   *
   * 注意：首次启动会拉取 openhands/openhands:latest 镜像（约 1.5-2GB），
   *      可能需要数分钟，请耐心等待。
   */
  async start(): Promise<void> {
    logger.info('IPC.SANDBOX', '启动 OpenHands 容器', {
      composeFile: this.config.composeFilePath,
      port: this.config.port,
    })

    // 1. 校验 compose 文件存在
    if (!fs.existsSync(this.config.composeFilePath)) {
      throw new Error(
        `docker-compose.yml 不存在：${this.config.composeFilePath}，请检查应用打包是否完整`
      )
    }

    // 2. 启动容器（detached 模式）
    const cmd = `docker compose -f "${this.config.composeFilePath}" up -d`
    logger.info('IPC.SANDBOX', `执行命令：${cmd}`)
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: DOCKER_COMPOSE_TIMEOUT_MS,
      })
      if (stdout.trim()) {
        logger.debug('IPC.SANDBOX', 'docker compose up stdout', { stdout: stdout.slice(0, 500) })
      }
      if (stderr.trim()) {
        // docker compose 把进度信息输出到 stderr，不一定是错误
        logger.debug('IPC.SANDBOX', 'docker compose up stderr', { stderr: stderr.slice(0, 500) })
      }
    } catch (err) {
      const e = err as Error & { stderr?: string }
      const msg = e.stderr ?? e.message
      logger.error('IPC.SANDBOX', 'docker compose up 失败', { error: msg.slice(0, 500) })
      throw new Error(`OpenHands 容器启动失败：${msg.slice(0, 200)}`)
    }

    // 3. 等待端口就绪
    await this.waitForReady(this.config.startTimeoutMs)

    logger.info('IPC.SANDBOX', 'OpenHands 容器已就绪', { baseUrl: this.config.baseUrl })
  }

  /**
   * 停止 OpenHands 容器
   *
   * 执行 `docker compose -f sandbox.yml down`，优雅停止并移除容器。
   * 工作区数据通过 volume 持久化，下次启动可恢复。
   */
  async stop(): Promise<void> {
    logger.info('IPC.SANDBOX', '停止 OpenHands 容器', {
      composeFile: this.config.composeFilePath,
    })

    const cmd = `docker compose -f "${this.config.composeFilePath}" down`
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 60_000,
      })
      if (stdout.trim()) {
        logger.debug('IPC.SANDBOX', 'docker compose down stdout', { stdout: stdout.slice(0, 500) })
      }
      if (stderr.trim()) {
        logger.debug('IPC.SANDBOX', 'docker compose down stderr', { stderr: stderr.slice(0, 500) })
      }
      logger.info('IPC.SANDBOX', 'OpenHands 容器已停止')
    } catch (err) {
      const e = err as Error & { stderr?: string }
      const msg = e.stderr ?? e.message
      logger.error('IPC.SANDBOX', 'docker compose down 失败', { error: msg.slice(0, 500) })
      throw new Error(`OpenHands 容器停止失败：${msg.slice(0, 200)}`)
    }
  }

  /**
   * 检查 OpenHands 容器是否在运行
   *
   * 通过 `docker compose ps --services --filter "status=running"` 校验
   * openhands 服务是否处于 running 状态。
   */
  async isRunning(): Promise<boolean> {
    try {
      const cmd = `docker compose -f "${this.config.composeFilePath}" ps --services --filter "status=running"`
      const { stdout } = await execAsync(cmd, { timeout: 10_000 })
      const runningServices = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const isUp = runningServices.includes(OpenHandsRunner.SERVICE_NAME)
      logger.debug('IPC.SANDBOX', '容器状态检查', {
        runningServices,
        target: OpenHandsRunner.SERVICE_NAME,
        isUp,
      })
      return isUp
    } catch (err) {
      // docker compose ps 在容器不存在时也会返回非 0，这里视为未运行
      logger.debug('IPC.SANDBOX', '容器状态检查异常（视为未运行）', {
        error: (err as Error).message,
      })
      return false
    }
  }

  /**
   * 等待端口就绪
   *
   * 轮询 OpenHands App Server 的健康检查端点（/alive），
   * 在 timeout 内成功响应即视为就绪。
   *
   * @param timeout 超时时间（毫秒），默认 120000
   */
  async waitForReady(timeout?: number): Promise<void> {
    const timeoutMs = timeout ?? this.config.startTimeoutMs
    const deadline = Date.now() + timeoutMs
    const healthUrl = `${this.config.baseUrl}/alive`

    logger.info('IPC.SANDBOX', `等待 OpenHands 就绪：${healthUrl}`, {
      timeoutMs,
      pollInterval: PORT_READY_POLL_INTERVAL_MS,
    })

    let lastError: string | null = null
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(healthUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(3_000),
        })
        if (resp.ok || resp.status === 200) {
          logger.info('IPC.SANDBOX', 'OpenHands 已就绪', {
            url: healthUrl,
            status: resp.status,
          })
          return
        }
        lastError = `HTTP ${resp.status}`
      } catch (err) {
        lastError = (err as Error).message
      }
      await sleep(PORT_READY_POLL_INTERVAL_MS)
    }

    throw new Error(
      `OpenHands 启动超时（${timeoutMs}ms），最后错误：${lastError ?? 'unknown'}`
    )
  }

  /**
   * 获取当前配置（用于 IPC 层展示状态）
   */
  getConfig(): Readonly<Required<OpenHandsRunnerConfig>> {
    return this.config
  }
}

/**
 * 异步 sleep 工具函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 默认 Runner 实例（使用内置 docker-compose.yml）
 *
 * 注意：在生产环境下，compose 文件会被打包到 resourcesPath，
 *      需在 main/index.ts 启动时根据 process.resourcesPath 重建实例。
 */
export const defaultOpenHandsRunner = new OpenHandsRunner()
