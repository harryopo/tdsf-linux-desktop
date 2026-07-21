/**
 * Docker Desktop 检测（v0.9 新增）
 *
 * 通过 `child_process exec` 调用 `docker version --format {{.Server.Version}}`：
 * 1. 检测 docker CLI 是否安装（PATH 中可执行）
 * 2. 检测 Docker Desktop 守护进程是否在运行
 *
 * 失败原因区分：
 * - 未安装：命令不存在（ENOENT）
 * - 已安装但未运行：命令存在但 daemon 不可达（非 0 退出码）
 *
 * 方案书依据：v0.9 §8（沙箱集成）+ 源码分析报告 §九（决策点 1：Docker Desktop 检测）
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '../log/logger'

const execAsync = promisify(exec)

/** docker version 命令超时（毫秒） */
const DOCKER_DETECT_TIMEOUT_MS = 10_000

/**
 * Docker 检测结果
 */
export interface DockerInfo {
  /** docker CLI 是否已安装（PATH 中可找到可执行文件） */
  installed: boolean
  /** Docker Server 版本号（如 "27.5.0"），未安装或未运行时为 null */
  version: string | null
  /** Docker Desktop 守护进程是否在运行 */
  running: boolean
  /** 错误信息（installed=false 或 running=false 时填充） */
  error?: string
}

/**
 * 检测 Docker Desktop 是否已安装且在运行
 *
 * 实现逻辑：
 * 1. 调用 `docker version --format {{.Server.Version}}`
 * 2. 命令成功（exit 0）且 stdout 非空 → installed=true, running=true, version=stdout.trim()
 * 3. 命令失败：
 *    - ENOENT（找不到可执行文件） → installed=false
 *    - 其他错误（如 daemon 未启动） → installed=true, running=false
 *
 * @returns DockerInfo 检测结果
 */
export async function detectDockerDesktop(): Promise<DockerInfo> {
  logger.info('IPC.SANDBOX', '检测 Docker Desktop...')

  try {
    const { stdout } = await execAsync(
      'docker version --format {{.Server.Version}}',
      { timeout: DOCKER_DETECT_TIMEOUT_MS }
    )
    const version = stdout.trim()
    if (!version) {
      // 极端情况：命令成功但输出为空（理论上不应发生）
      const info: DockerInfo = {
        installed: true,
        version: null,
        running: false,
        error: 'docker version 输出为空，可能 daemon 未响应',
      }
      logger.warn('IPC.SANDBOX', 'Docker 检测：输出为空', { ...info })
      return info
    }

    const info: DockerInfo = {
      installed: true,
      version,
      running: true,
    }
    logger.info('IPC.SANDBOX', `Docker Desktop 已就绪 (v${version})`)
    return info
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    const stderr = (e.stderr ?? e.message ?? '').toString()
    const lowerErr = stderr.toLowerCase()

    // ENOENT：命令不存在 → 未安装
    if (e.code === 'ENOENT' || lowerErr.includes('not found') || lowerErr.includes('not recognized')) {
      const info: DockerInfo = {
        installed: false,
        version: null,
        running: false,
        error: '未检测到 Docker，请先安装 Docker Desktop',
      }
      logger.warn('IPC.SANDBOX', 'Docker 未安装')
      return info
    }

    // daemon 不可达（已安装但未启动）
    // 注意：exec 错误的 code 可能是 string（如 'ENOENT'）或 number（退出码 1），
    // 这里通过 stderr 内容判断更可靠，避免与 ENOENT（string）混淆
    if (
      lowerErr.includes('cannot connect to the docker daemon') ||
      lowerErr.includes('error during connect') ||
      lowerErr.includes('is the docker daemon running') ||
      lowerErr.includes('no such host') ||
      (typeof e.code === 'number' && e.code === 1)
    ) {
      const info: DockerInfo = {
        installed: true,
        version: null,
        running: false,
        error: 'Docker Desktop 已安装但未运行，请启动 Docker Desktop',
      }
      logger.warn('IPC.SANDBOX', 'Docker daemon 未运行', { stderr })
      return info
    }

    // 其他未知错误
    const info: DockerInfo = {
      installed: false,
      version: null,
      running: false,
      error: `Docker 检测失败：${stderr.slice(0, 200)}`,
    }
    logger.error('IPC.SANDBOX', 'Docker 检测异常', { error: stderr.slice(0, 500) })
    return info
  }
}
