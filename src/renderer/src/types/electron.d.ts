/**
 * electronAPI 全局类型声明
 *
 * preload 脚本通过 contextBridge 暴露的 IPC 桥接接口类型定义。
 * 渲染进程通过 window.electronAPI 调用主进程能力，所有方法返回 Promise。
 *
 * 事件监听方法（onXxx）用于接收主进程推送的实时数据。
 */
import type {
  SshConfig,
  CommandResult,
  SystemInfo,
  MonitorData,
  ChatMessage,
  LlmConfig,
  Evidence,
  KnowledgeEntry,
  KnowledgeType,
  DecisionCard,
  AgentWorkflowState,
} from '@shared/models'

/** electronAPI 接口定义 */
export interface ElectronAPI {
  // ===== SSH 相关 =====
  /** 建立 SSH 连接，返回 sessionId */
  sshConnect(config: SshConfig): Promise<string>
  /** 断开 SSH 连接 */
  sshDisconnect(sessionId: string): Promise<boolean>
  /** 执行 SSH 命令 */
  sshExec(sessionId: string, command: string): Promise<CommandResult>
  /** 启动交互式 Shell */
  sshShellStart(sessionId: string): Promise<boolean>
  /** 向 Shell 写入数据 */
  sshShellWrite(sessionId: string, data: string): Promise<boolean>
  /** 调整 Shell 终端尺寸 */
  sshShellResize(sessionId: string, cols: number, rows: number): Promise<boolean>

  // ===== 监控相关 =====
  /** 启动监控采集 */
  monitorStart(sessionId: string, interval: number): Promise<boolean>
  /** 停止监控采集 */
  monitorStop(sessionId: string): Promise<boolean>
  /** 获取系统静态信息 */
  monitorGetSystemInfo(sessionId: string): Promise<SystemInfo>

  // ===== LLM 相关 =====
  /** LLM 对话 */
  llmChat(messages: ChatMessage[]): Promise<string>
  /** 测试 LLM 连接 */
  llmTest(config: LlmConfig): Promise<boolean>
  /** LLM 分析（结合证据） */
  llmAnalyze(question: string, evidences: Evidence[]): Promise<string>

  // ===== Agent 工作流 =====
  /** 启动 Agent 工作流 */
  agentStart(sessionId: string, question: string): Promise<boolean>
  /** 确认/拒绝 Agent 决策 */
  agentConfirm(decisionId: string, approved: boolean): Promise<boolean>
  /** 取消 Agent 工作流 */
  agentCancel(decisionId: string): Promise<boolean>

  // ===== 安全存储 =====
  /** 保存 API Key（加密存储） */
  storageSaveApiKey(key: string, value: string): Promise<boolean>
  /** 获取 API Key */
  storageGetApiKey(key: string): Promise<string | null>
  /** 删除 API Key */
  storageDeleteApiKey(key: string): Promise<boolean>

  // ===== 配置存储 =====
  /** 获取配置项 */
  configGet<T = unknown>(key: string): Promise<T>
  /** 设置配置项 */
  configSet(key: string, value: unknown): Promise<boolean>

  // ===== 知识库 =====
  /** 搜索知识库 */
  kbSearch(query: string, type?: KnowledgeType, limit?: number): Promise<KnowledgeEntry[]>
  /** 添加知识条目 */
  kbAdd(entry: KnowledgeEntry): Promise<boolean>
  /** 更新知识条目 */
  kbUpdate(id: string, partial: Partial<KnowledgeEntry>): Promise<boolean>
  /** 删除知识条目 */
  kbDelete(id: string): Promise<boolean>
  /** 批量导入知识 */
  kbImport(entries: KnowledgeEntry[]): Promise<number>
  /** 导出知识库 */
  kbExport(type?: KnowledgeType): Promise<KnowledgeEntry[]>

  // ===== 决策历史 =====
  /** 获取决策历史列表 */
  historyList(offset?: number, limit?: number): Promise<DecisionCard[]>
  /** 获取单个决策详情 */
  historyGet(id: string): Promise<DecisionCard | null>
  /** 保存决策记录 */
  historySave(card: DecisionCard): Promise<boolean>

  // ===== 事件监听（主进程 → 渲染进程） =====
  /** 监听终端数据推送 */
  onTerminalData(callback: (sessionId: string, data: string) => void): void
  /** 监听监控数据推送 */
  onMonitorData(callback: (sessionId: string, data: MonitorData) => void): void
  /** 监听 LLM 流式 token */
  onLlmToken(callback: (token: string) => void): void
  /** 监听 Agent 工作流步骤更新 */
  onAgentStep(callback: (state: AgentWorkflowState) => void): void
}

/** 扩展 Window 接口，声明 electronAPI 全局变量 */
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
