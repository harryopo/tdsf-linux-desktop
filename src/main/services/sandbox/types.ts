/**
 * OpenHands 沙箱相关类型定义（v0.9 新增）
 *
 * 与 OpenHands 后端 Pydantic 模型一一对应：
 * - sandbox_models.py#SandboxStatus  → SandboxStatus
 * - sandbox_models.py#ExposedUrl     → ExposedUrl
 * - sandbox_models.py#SandboxInfo    → SandboxInfo
 * - sandbox_models.py#SandboxPage    → SandboxPage
 * - sandbox_models.py#SecretNameItem → SecretNameItem
 *
 * 方案书依据：v0.9 §8（沙箱集成）+ 源码分析报告 §五（Sandbox 数据模型）
 *
 * 注意：所有字段命名保持与 OpenHands REST API 响应一致（snake_case），
 *      便于直接 JSON 反序列化，避免字段映射的额外开销与错位风险。
 */

/**
 * 沙箱运行状态（对应 SandboxStatus 枚举）
 *
 * - STARTING：启动中（容器正在拉起，agent_server 尚未就绪）
 * - RUNNING：运行中（可接受 /execute / /read_file 等调用）
 * - PAUSED：已暂停（容器冻结，恢复后状态保持）
 * - ERROR：错误（启动失败或运行时异常）
 * - MISSING：已删除（可能已被自动清理）
 */
export type SandboxStatus = 'STARTING' | 'RUNNING' | 'PAUSED' | 'ERROR' | 'MISSING'

/**
 * 沙箱内服务的暴露 URL（对应 ExposedUrl 模型）
 *
 * OpenHands 沙箱可暴露多个服务，通过 name 区分：
 * - AGENT_SERVER：命令执行 / 文件操作入口（必需）
 * - VSCODE：VS Code Server（可选，IDE 集成）
 * - WORKER_1 / WORKER_2：并行 worker（可选）
 */
export interface ExposedUrl {
  /** 服务名（标准名：AGENT_SERVER / VSCODE / WORKER_1 / WORKER_2） */
  name: string
  /** 主机可访问的 URL（如 http://localhost:54321） */
  url: string
  /** 容器内端口（如 3000） */
  port: number
}

/**
 * 标准暴露服务名常量
 *
 * 与 OpenHands 源码 sandbox_models.py 中的常量保持一致。
 */
export const AGENT_SERVER_NAME = 'AGENT_SERVER'
export const VSCODE_NAME = 'VSCODE'
export const WORKER_1_NAME = 'WORKER_1'
export const WORKER_2_NAME = 'WORKER_2'

/**
 * 沙箱信息（对应 SandboxInfo 模型）
 *
 * 由 OpenHands App Server 在创建/查询/列表时返回。
 * session_api_key 在 STARTING / PAUSED 状态下为 null。
 */
export interface SandboxInfo {
  /** 沙箱唯一 ID（UUID） */
  id: string
  /** 创建者用户 ID（本地模式下可能为 null） */
  created_by_user_id: string | null
  /** 沙箱规格 ID（资源配额模板，决定 CPU / 内存 / 磁盘） */
  sandbox_spec_id: string
  /** 当前状态 */
  status: SandboxStatus
  /**
   * 访问沙箱的 API Key
   *
   * 用法：作为 `X-Session-API-Key` HTTP Header 传给沙箱内 agent_server。
   * 注意：STARTING / PAUSED 状态下为 null，需 wait_for_sandbox_running 后再取。
   */
  session_api_key: string | null
  /** 沙箱内服务的访问 URL 列表（STARTING / PAUSED / ERROR 可能不返回） */
  exposed_urls: ExposedUrl[] | null
  /** 创建时间（ISO 8601 字符串） */
  created_at: string
}

/**
 * 沙箱分页响应（对应 SandboxPage 模型）
 *
 * 用于 GET /sandboxes/search 接口。
 */
export interface SandboxPage {
  /** 当前页的沙箱列表 */
  items: SandboxInfo[]
  /** 下一页 ID（为 null 表示无更多数据） */
  next_page_id: string | null
}

/**
 * Secret 名称项（对应 SecretNameItem 模型）
 *
 * 注意：仅返回名称与描述，**不含值**（HC-6 敏感文件 redact）。
 * 取值需另外调用 getSecret(name)。
 */
export interface SecretNameItem {
  /** Secret 名称 / 环境变量名 */
  name: string
  /** 描述（可空） */
  description: string | null
}

/**
 * Secret 列表响应（对应 SecretNamesResponse 模型）
 */
export interface SecretNamesResponse {
  /** 可用 secret 列表 */
  secrets: SecretNameItem[]
}

/**
 * 沙箱内命令执行结果
 *
 * 对应 agent_server 的 POST /execute 响应。
 * 字段命名与 OpenHands Action/Observation 协议保持一致。
 *
 * 注意：与 `@shared/models.CommandResult`（SSH 命令结果）结构兼容，
 *      但 duration 为可选（沙箱 agent_server 不一定返回耗时）。
 *      这里独立命名以避免命名冲突，并在 IPC 边界统一转换为 CommandResult。
 */
export interface SandboxCommandResult {
  /** 标准输出（已脱敏） */
  stdout: string
  /** 标准错误（已脱敏） */
  stderr: string
  /** 退出码（0 = 成功，非 0 = 失败） */
  exitCode: number
  /** 执行耗时（毫秒，agent_server 不一定返回） */
  durationMs?: number
}

/**
 * 沙箱健康状态
 *
 * 用于 UI 展示当前 OpenHands 集成是否可用。
 */
export interface SandboxHealthStatus {
  /** Docker Desktop 是否已安装且运行 */
  dockerReady: boolean
  /** Docker 版本（未安装时为 null） */
  dockerVersion: string | null
  /** OpenHands App Server 是否在运行（端口可达） */
  openhandsRunning: boolean
  /** 错误信息（任一项失败时填充） */
  error?: string
}

/**
 * 沙箱客户端配置
 *
 * 不要 hardcode API URL —— 从配置读取（HC：可配置化）。
 */
export interface OpenHandsClientConfig {
  /** OpenHands App Server 基地址（默认 http://localhost:3000） */
  baseUrl: string
  /** 请求超时（毫秒，默认 30000） */
  timeoutMs?: number
  /** 用户级鉴权 token（可选，本地模式下 OpenHands 默认不校验） */
  authToken?: string
}

/**
 * 默认沙箱规格 ID
 *
 * OpenHands 内置规格：4 CPU / 4GB RAM / 10GB 磁盘。
 * 用户可在 UI 中覆盖。
 */
export const DEFAULT_SANDBOX_SPEC_ID = 'default'

/**
 * OpenHands App Server 默认端口
 */
export const OPENHANDS_DEFAULT_PORT = 3000

/**
 * OpenHands App Server 默认基地址
 */
export const OPENHANDS_DEFAULT_BASE_URL = `http://localhost:${OPENHANDS_DEFAULT_PORT}`

/**
 * 沙箱启动默认超时（毫秒）
 *
 * 首次启动需要拉镜像，给 120 秒兜底。
 */
export const SANDBOX_START_TIMEOUT_MS = 120_000

/**
 * 端口就绪轮询间隔（毫秒）
 */
export const PORT_READY_POLL_INTERVAL_MS = 2_000
