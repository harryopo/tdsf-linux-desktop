/**
 * Drain3 日志模板提取桥接
 *
 * 职责：
 * - 通过 child_process 调用 Python Drain3 脚本
 * - 提取日志中的固定模板（用于异常检测）
 * - 失败时降级到本地正则匹配
 *
 * 调研依据：07-开源项目调研-AIOps-2025.md Top1（837⭐）
 * 价值：增强置信度公式中的 drainMatch 维度（学术深度）
 *
 * 实现策略：
 * - Python Drain3 脚本：`src/main/services/log/drain3_bridge.py`
 * - Node.js 通过 stdio JSON-RPC 与 Python 通信
 * - 输入：日志文本（多行）
 * - 输出：模板列表 [{templateId, template, count}]
 */
import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/** Drain3 提取的模板 */
export interface LogTemplate {
  /** 模板 ID */
  templateId: string
  /** 模板字符串（含 <*> 通配符） */
  template: string
  /** 匹配次数 */
  count: number
}

/** Drain3 配置 */
export interface Drain3Config {
  /** Python 可执行文件路径（默认 python3） */
  pythonPath?: string
  /** Drain3 脚本路径（默认 src/main/services/log/drain3_bridge.py） */
  scriptPath?: string
  /** 相似度阈值（默认 0.5） */
  similarityThreshold?: number
  /** 最大子节点数（默认 100） */
  maxChildren?: number
}

/** Drain3 桥接服务 */
export class Drain3Bridge {
  private readonly config: Required<Drain3Config>
  private process: ChildProcess | null = null
  private requestId = 0
  private pendingRequests = new Map<number, {
    resolve: (value: LogTemplate[]) => void
    reject: (reason: Error) => void
  }>()

  constructor(config: Drain3Config = {}) {
    this.config = {
      pythonPath: config.pythonPath ?? 'python3',
      scriptPath: config.scriptPath ?? join(__dirname, 'drain3_bridge.py'),
      similarityThreshold: config.similarityThreshold ?? 0.5,
      maxChildren: config.maxChildren ?? 100
    }
  }

  /**
   * 启动 Python 进程
   */
  async start(): Promise<void> {
    if (this.process) {
      return
    }

    if (!existsSync(this.config.scriptPath)) {
      throw new Error(`Drain3 脚本不存在: ${this.config.scriptPath}（可选功能，不影响主流程）`)
    }

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.config.pythonPath, [
          this.config.scriptPath,
          '--similarity', String(this.config.similarityThreshold),
          '--max-children', String(this.config.maxChildren)
        ])

        let buffer = ''
        this.process.stdout?.on('data', (data: Buffer) => {
          buffer += data.toString()
          // 按行分割 JSON 响应
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const response = JSON.parse(line) as {
                id: number
                result?: LogTemplate[]
                error?: string
              }
              const pending = this.pendingRequests.get(response.id)
              if (pending) {
                this.pendingRequests.delete(response.id)
                if (response.error) {
                  pending.reject(new Error(response.error))
                } else {
                  pending.resolve(response.result ?? [])
                }
              }
            } catch {
              // 忽略非 JSON 行（如启动日志）
            }
          }
        })

        this.process.stderr?.on('data', (data: Buffer) => {
          console.warn('[Drain3]', data.toString().trim())
        })

        this.process.on('error', (err) => {
          reject(err)
        })

        this.process.on('exit', (code) => {
          if (code !== 0 && this.process) {
            console.warn(`[Drain3] 进程退出: code=${code}`)
          }
          this.process = null
          // 拒绝所有 pending 请求
          for (const [, pending] of this.pendingRequests) {
            pending.reject(new Error('Drain3 进程已退出'))
          }
          this.pendingRequests.clear()
        })

        // 等待进程就绪
        setTimeout(resolve, 500)
      } catch (err) {
        reject(err as Error)
      }
    })
  }

  /**
   * 提取日志模板
   *
   * @param logLines - 日志行数组
   * @returns 模板列表（按 count 降序）
   */
  async extractTemplates(logLines: string[]): Promise<LogTemplate[]> {
    if (!this.process) {
      // 未启动则降级到本地正则
      return this.fallbackToRegex(logLines)
    }

    const id = ++this.requestId
    return new Promise<LogTemplate[]>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      try {
        this.process!.stdin?.write(
          JSON.stringify({ id, lines: logLines }) + '\n'
        )
      } catch (err) {
        this.pendingRequests.delete(id)
        reject(err as Error)
      }
    })
  }

  /**
   * 关闭 Drain3 进程
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }

  /**
   * 本地正则降级方案
   *
   * 提取常见日志模式：
   * - 时间戳替换为 <*>
   * - 数字替换为 <*>
   * - IP 地址替换为 <*>
   * - UUID 替换为 <*>
   */
  private fallbackToRegex(logLines: string[]): LogTemplate[] {
    const templateCount = new Map<string, number>()

    for (const line of logLines) {
      // 简单模板化：替换数字、IP、UUID
      const template = line
        .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '<*>')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<*>')
        .replace(/\b\d+\b/g, '<*>')
        .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<*>')

      templateCount.set(template, (templateCount.get(template) ?? 0) + 1)
    }

    return Array.from(templateCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([template, count], index) => ({
        templateId: `local_${index}`,
        template,
        count
      }))
  }
}

/** Drain3 单例（懒加载） */
let drain3Instance: Drain3Bridge | null = null

export function getDrain3Bridge(): Drain3Bridge {
  if (!drain3Instance) {
    drain3Instance = new Drain3Bridge()
  }
  return drain3Instance
}
