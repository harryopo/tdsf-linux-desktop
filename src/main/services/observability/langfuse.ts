/**
 * Langfuse LLM 可观测性服务
 *
 * 职责：
 * - 记录每次 LLM 调用的 trace（输入/输出/token 消耗/延迟）
 * - 记录 Agent 工作流的完整步骤链路
 * - 失败自动降级：未配置 Langfuse Key 时静默跳过
 *
 * 调研依据：07-开源项目调研-AIOps-2025.md Top2
 * 价值：让评委现场点开 Langfuse Cloud 看 trace（评委爽点 4）
 */
import { Langfuse, type LangfuseTraceClient } from 'langfuse'
import { ConfigStore, type LangfuseConfig } from '../storage/config-store'

// 重新导出 LangfuseConfig 以保持向后兼容
export type { LangfuseConfig }

/** Trace 元数据 */
export interface TraceContext {
  /** 会话 ID（关联到 SSH 会话） */
  sessionId: string
  /** 工作流名（agent/llm-chat/etc.） */
  workflowName: string
  /** 用户问题 */
  userQuery?: string
  /** 自定义元数据 */
  metadata?: Record<string, unknown>
}

/** Span 选项 */
export interface SpanOptions {
  name: string
  input?: unknown
  metadata?: Record<string, unknown>
}

/** Langfuse 支持的 Level */
export type LangfuseLevel = 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR'

/** Span 句柄 */
export interface SpanHandle {
  end(output?: unknown, options?: { level?: LangfuseLevel; statusMessage?: string }): void
}

/** Trace 句柄接口 */
export interface TraceHandle {
  /** 创建子 Span */
  span(options: SpanOptions): SpanHandle
  /** 结束 Trace */
  end(options?: { level?: LangfuseLevel; statusMessage?: string }): void
  /** Trace ID（用于关联 UI 显示） */
  getTraceId(): string | null
}

/** Langfuse 服务（单例） */
export class LangfuseService {
  private static instance: LangfuseService | null = null
  private client: Langfuse | null = null
  private enabled = false

  private constructor() {}

  /** 获取单例 */
  static getInstance(): LangfuseService {
    if (!this.instance) {
      this.instance = new LangfuseService()
    }
    return this.instance
  }

  /**
   * 初始化：从 ConfigStore 读取配置，未配置则禁用
   */
  init(): void {
    const config = ConfigStore.getLangfuseConfig()
    if (!config || !config.secretKey || !config.publicKey) {
      this.enabled = false
      this.client = null
      console.log('[Langfuse] 未配置 API Key，可观测性已禁用（降级到本地日志）')
      return
    }

    try {
      // v3 SDK：host 不在 LangfuseOptions 中，由 SDK 自动推断
      // 自托管可通过环境变量 LANGFUSE_BASEURL 或 SDK 内部处理
      this.client = new Langfuse({
        secretKey: config.secretKey,
        publicKey: config.publicKey
      })
      this.enabled = true
      console.log('[Langfuse] 已启用')
    } catch (err) {
      this.enabled = false
      this.client = null
      console.error('[Langfuse] 初始化失败:', err)
    }
  }

  /**
   * 是否启用
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 启动 Trace
   *
   * @param context - Trace 上下文
   * @returns Trace 句柄（包含 endTrace 和 span 方法）
   */
  startTrace(context: TraceContext): TraceHandle {
    if (!this.enabled || !this.client) {
      return new NoopTraceHandle(context)
    }
    return new LangfuseTraceHandle(this.client, context)
  }

  /**
   * 关闭客户端（应用退出时调用）
   */
  async shutdown(): Promise<void> {
    if (this.client) {
      try {
        await this.client.shutdownAsync()
      } catch {
        // 忽略关闭错误
      }
    }
    this.client = null
    this.enabled = false
  }
}

/** Langfuse 真实 Trace 句柄 */
class LangfuseTraceHandle implements TraceHandle {
  // Langfuse v3 SDK 的 LangfuseTraceClient（client.trace() 返回值）
  private readonly trace: LangfuseTraceClient

  constructor(client: Langfuse, context: TraceContext) {
    this.trace = client.trace({
      name: context.workflowName,
      sessionId: context.sessionId,
      input: context.userQuery,
      metadata: context.metadata
    })
  }

  span(options: SpanOptions): SpanHandle {
    const span = this.trace.span({
      name: options.name,
      input: options.input,
      metadata: options.metadata
    })

    return {
      end(output, opts) {
        try {
          const endBody: Record<string, unknown> = {}
          if (output !== undefined) endBody.output = output
          if (opts?.level) endBody.level = opts.level
          if (opts?.statusMessage) endBody.statusMessage = opts.statusMessage
          span.end(endBody)
        } catch {
          // 静默吞掉 Langfuse 错误，不影响主流程
        }
      }
    }
  }

  end(options?: { level?: LangfuseLevel; statusMessage?: string }): void {
    try {
      if (options?.level || options?.statusMessage) {
        // 用变量传参避免 excess property check（SDK 的 CreateLangfuseTraceBody
        // 类型未显式声明 level/statusMessage，但运行时 API 支持这些字段）
        const updateBody: Record<string, unknown> = {}
        if (options.level) updateBody.level = options.level
        if (options.statusMessage) updateBody.statusMessage = options.statusMessage
        this.trace.update(updateBody)
      }
    } catch {
      // 静默吞掉
    }
  }

  getTraceId(): string | null {
    try {
      return this.trace.id ?? null
    } catch {
      return null
    }
  }
}

/** Noop Trace 句柄（未启用时使用） */
class NoopTraceHandle implements TraceHandle {
  constructor(_context: TraceContext) {}

  span(_options: SpanOptions): SpanHandle {
    return {
      end(_output?: unknown, _options?: { level?: LangfuseLevel; statusMessage?: string }) {
        // noop
      }
    }
  }

  end(_options?: { level?: LangfuseLevel; statusMessage?: string }): void {
    // noop
  }

  getTraceId(): string | null {
    return null
  }
}
