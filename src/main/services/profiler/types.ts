/**
 * 系统架构感知（System Profiler）类型定义
 *
 * 用于描述一次完整系统探查的结构化结果，
 * 供 MarkdownRenderer 渲染、RiskDetector 检测、UI 展示使用。
 */

/** 探查组（按系统维度分组） */
export type ProfilerGroupName =
  | 'system'        // 系统标识
  | 'cpu-memory'    // CPU 与内存
  | 'storage'       // 存储
  | 'network'       // 网络
  | 'users'         // 用户
  | 'services'      // 服务
  | 'tools'         // 开发工具
  | 'virt'          // 虚拟化
  | 'web'           // Web 应用
  | 'ops'           // 运维

/** 风险等级 */
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** 单个探查项的原始结果 */
export interface ProfilerItem {
  /** 探查分组 */
  group: ProfilerGroupName
  /** 中文组名（用于展示） */
  groupLabel: string
  /** 执行的命令 */
  cmd: string
  /** 命令的标准输出 */
  stdout: string
  /** 命令的标准错误 */
  stderr: string
  /** 退出码（-1 表示超时或异常） */
  exitCode: number
  /** 执行耗时（毫秒） */
  durationMs: number
  /** 是否成功 */
  ok: boolean
  /** 错误信息（如果有） */
  error?: string
}

/** 探查执行错误 */
export interface ProfilerError {
  group: ProfilerGroupName
  groupLabel: string
  cmd: string
  error: string
  durationMs: number
}

/** 一次完整探查的结构化结果 */
export interface ProfilerResult {
  /** 目标主机 */
  host: string
  /** SSH 会话 ID */
  sessionId: string
  /** 探查完成时间（毫秒时间戳） */
  generatedAt: number
  /** 探查总耗时（毫秒） */
  totalDurationMs: number
  /** 探查项列表（按组归类） */
  items: ProfilerItem[]
  /** 探查错误列表 */
  errors: ProfilerError[]
  /** 风险检测结果（运行风险检测后填充） */
  risks?: RiskItem[]
}

/** 单个风险检测项 */
export interface RiskItem {
  /** 风险等级 */
  level: RiskLevel
  /** 风险类别 */
  category: string
  /** 风险标题 */
  title: string
  /** 详细描述 */
  description: string
  /** 触发证据（命令输出片段） */
  evidence: string
  /** 修复建议 */
  suggestion: string
}

/** Profiler 对外暴露的执行结果（IPC 返回） */
export interface ProfilerRunResponse {
  /** 探查结果 */
  result: ProfilerResult
  /** 渲染好的 md 文本（直接展示给用户） */
  md: string
  /** 风险列表 */
  risks: RiskItem[]
  /** 探查风险摘要（展示在 UI 顶部） */
  summary: {
    total: number
    critical: number
    high: number
    medium: number
    low: number
  }
}
