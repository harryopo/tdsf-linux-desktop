/**
 * IPC 通道常量定义（Phase 6 起统一管理）
 *
 * IPC 4 步同步铁律：
 *   1. 定义（本文件）→ 2. ipc/index.ts 注册 → 3. preload 暴露 → 4. electron.d.ts 类型声明
 *
 * Phase 6 Task 6.5：调度器 IPC 通道
 *   - LIST    invoke  渲染 → 主：查询所有定时任务状态
 *   - TOGGLE  invoke  渲染 → 主：启用/禁用指定任务
 *   - TRIGGER invoke  渲染 → 主：立即触发指定任务（不等 cron 时间）
 *   - STATUS  push    主 → 渲染：任务执行后主动推送状态更新
 *
 * polish-tdsf-p1-issues Task A：集中化所有 ipcMain.handle 字面量为常量
 *   - 新增 19 个域常量（AGENT / LLM / SSH / STORAGE / CONFIG / SERVER / LOOP / MONITOR /
 *     LOG / KNOWLEDGE / HISTORY / DIAGNOSTICS / SIDECAR / SANDBOX / MCP / TUTORIAL /
 *     DEPLOY / AT_COMMANDS / TOKEN / PROMPTFOO）
 *   - 通道值与原字面量完全一致，向后兼容
 */

/**
 * 调度器 IPC 通道常量
 *
 * 使用 `as const` 保证字面量类型推断，避免拼写错误。
 * 主进程 ipc handler、preload 暴露、渲染层调用均引用此常量。
 */
export const SCHEDULER = {
  /** 查询所有定时任务状态（invoke: 渲染 → 主） */
  LIST: 'scheduler:list',
  /** 启用/禁用指定任务（invoke: 渲染 → 主） */
  TOGGLE: 'scheduler:toggle',
  /** 立即触发指定任务（invoke: 渲染 → 主） */
  TRIGGER: 'scheduler:trigger',
  /** 任务状态变更推送（push: 主 → 渲染） */
  STATUS: 'scheduler:status',
} as const

/**
 * Agent IPC 通道常量
 *
 * 通道列表：
 * - CANCEL  invoke  渲染 → 主：取消正在执行的 Agent 会话
 */
export const AGENT = {
  /** 取消正在执行的 Agent 会话（invoke: 渲染 → 主） */
  CANCEL: 'agent:cancel',
} as const

/**
 * LLM IPC 通道常量
 *
 * 通道列表：
 * - CHAT         invoke  渲染 → 主：单轮对话推理
 * - TEST         invoke  渲染 → 主：测试 LLM API 连通性
 * - VALIDATE     invoke  渲染 → 主：校验 LLM 配置有效性
 * - TOOL_APPROVE invoke  渲染 → 主：人工审批工具调用请求
 */
export const LLM = {
  /** 单轮对话推理（invoke: 渲染 → 主） */
  CHAT: 'llm:chat',
  /** 测试 LLM API 连通性（invoke: 渲染 → 主） */
  TEST: 'llm:test',
  /** 校验 LLM 配置有效性（invoke: 渲染 → 主） */
  VALIDATE: 'llm:validate',
  /** 人工审批工具调用请求（invoke: 渲染 → 主） */
  TOOL_APPROVE: 'llm:tool-approve',
} as const

/**
 * v2.0 Phase B 新增：内联补全 + Diff 应用 IPC 通道常量
 *
 * 通道列表：
 * - INLINE_COMPLETION       invoke  渲染 → 主：请求光标位置补全
 * - INLINE_COMPLETION_CANCEL invoke  渲染 → 主：取消进行中的补全请求
 * - APPLY_DIFF              invoke  渲染 → 主：应用 diff 到文件（写入新内容）
 * - DIFF_PREVIEW            invoke  渲染 → 主：预览 diff（unified diff 格式）
 *
 * 设计依据：v2.0 Phase B · Task B.5（IPC 4 步同步铁律）
 */
export const LLM_INLINE = {
  /** 请求光标位置补全（invoke: 渲染 → 主） */
  INLINE_COMPLETION: 'llm:inline-completion',
  /** 取消进行中的补全请求（invoke: 渲染 → 主） */
  INLINE_COMPLETION_CANCEL: 'llm:inline-completion:cancel',
  /** 应用 diff 到文件（invoke: 渲染 → 主，写入新内容到磁盘） */
  APPLY_DIFF: 'llm:apply-diff',
  /** 预览 diff（invoke: 渲染 → 主，返回 unified diff 字符串） */
  DIFF_PREVIEW: 'llm:diff-preview',
} as const

/**
 * SSH IPC 通道常量
 *
 * 通道列表：
 * - CONNECT       invoke  渲染 → 主：建立 SSH 连接
 * - DISCONNECT    invoke  渲染 → 主：断开 SSH 连接
 * - SHELL_START   invoke  渲染 → 主：启动交互式 Shell
 * - STATE_CHANGED push    主 → 渲染：心跳保活状态变更（重连/最终断开）
 */
export const SSH = {
  /** 建立 SSH 连接（invoke: 渲染 → 主） */
  CONNECT: 'ssh:connect',
  /** 断开 SSH 连接（invoke: 渲染 → 主） */
  DISCONNECT: 'ssh:disconnect',
  /** 启动交互式 Shell（invoke: 渲染 → 主） */
  SHELL_START: 'ssh:shell:start',
  /** 心跳保活状态变更推送（push: 主 → 渲染），载荷 SshStateEvent */
  STATE_CHANGED: 'ssh:state-changed',
  /**
   * 主机密钥确认弹窗推送（push: 主 → 渲染，Phase L）
   * 载荷 SshHostKeyPromptEvent，首次连接或密钥变更时推送
   */
  HOST_KEY_PROMPT: 'ssh:host-key-prompt',
  /**
   * 主机密钥弹窗用户响应（invoke: 渲染 → 主，Phase L）
   * 载荷 SshHostKeyResponsePayload，用户选择后响应主进程的 pending Promise
   */
  HOST_KEY_RESPONSE: 'ssh:host-key-response',
} as const

/**
 * v2.0 Phase C 新增：SFTP 文件搜索 + 内容 grep IPC 通道常量
 *
 * 通道列表：
 * - SEARCH  invoke  渲染 → 主：模糊查找远程文件（find -type f -name）
 * - GREP    invoke  渲染 → 主：远程内容搜索（grep -rn）
 *
 * 设计依据：v2.0 Phase C · Task C.1 / C.2（IPC 4 步同步铁律）
 */
export const SFTP_SEARCH = {
  /** 模糊查找远程文件（invoke: 渲染 → 主，3 秒超时，最多 50 条） */
  SEARCH: 'sftp:search',
  /** 远程内容 grep（invoke: 渲染 → 主，支持 regex/wholeWord/caseSensitive） */
  GREP: 'sftp:grep',
} as const

/**
 * v2.0 Phase C 新增：远程文件监听 IPC 通道常量
 *
 * 通道列表：
 * - WATCH_START  invoke  渲染 → 主：开始监听远程路径文件变更
 * - WATCH_STOP   invoke  渲染 → 主：停止监听
 * - CHANGED      push     主 → 渲染：文件变更事件推送
 *
 * 设计依据：v2.0 Phase C · Task C.3（IPC 4 步同步铁律，inotifywait 优先 + 轮询降级）
 */
export const FILE_WATCH = {
  /** 开始监听远程路径文件变更（invoke: 渲染 → 主），返回 watchId */
  WATCH_START: 'file:watch:start',
  /** 停止监听（invoke: 渲染 → 主），参数 { watchId } */
  WATCH_STOP: 'file:watch:stop',
  /** 文件变更事件推送（push: 主 → 渲染），载荷 { watchId, path, event } */
  CHANGED: 'file:changed',
} as const

/**
 * 安全存储 IPC 通道常量
 *
 * 通道列表：
 * - GET_API_KEY     invoke  渲染 → 主：读取加密存储的 API Key
 * - DELETE_API_KEY  invoke  渲染 → 主：删除加密存储的 API Key
 */
export const STORAGE = {
  /** 读取加密存储的 API Key（invoke: 渲染 → 主） */
  GET_API_KEY: 'storage:getApiKey',
  /** 删除加密存储的 API Key（invoke: 渲染 → 主） */
  DELETE_API_KEY: 'storage:deleteApiKey',
} as const

/**
 * 配置存储 IPC 通道常量
 *
 * 通道列表：
 * - GET  invoke  渲染 → 主：读取配置项
 * - SET  invoke  渲染 → 主：写入配置项
 */
export const CONFIG = {
  /** 读取配置项（invoke: 渲染 → 主） */
  GET: 'config:get',
  /** 写入配置项（invoke: 渲染 → 主） */
  SET: 'config:set',
} as const

/**
 * 服务器配置 IPC 通道常量
 *
 * 通道列表：
 * - LIST        invoke  渲染 → 主：列出已保存的 SSH 服务器
 * - SAVE        invoke  渲染 → 主：保存服务器配置
 * - EXPORT      invoke  渲染 → 主：导出服务器配置 JSON
 * - IMPORT      invoke  渲染 → 主：导入服务器配置 JSON
 * - DELETE_CRED invoke  渲染 → 主：删除服务器凭据
 */
export const SERVER = {
  /** 列出已保存的 SSH 服务器（invoke: 渲染 → 主） */
  LIST: 'server:list',
  /** 保存服务器配置（invoke: 渲染 → 主） */
  SAVE: 'server:save',
  /** 导出服务器配置 JSON（invoke: 渲染 → 主） */
  EXPORT: 'server:export',
  /** 导入服务器配置 JSON（invoke: 渲染 → 主） */
  IMPORT: 'server:import',
  /** 删除服务器凭据（invoke: 渲染 → 主） */
  DELETE_CRED: 'server:delete-cred',
} as const

/**
 * 循环工程 IPC 通道常量
 *
 * 通道列表：
 * - START    invoke  渲染 → 主：启动循环工程子 agent
 * - CONFIRM  invoke  渲染 → 主：人工确认决策卡片
 * - CANCEL   invoke  渲染 → 主：取消正在执行的工作流
 */
export const LOOP = {
  /** 启动循环工程子 agent（invoke: 渲染 → 主） */
  START: 'loop:start',
  /** 人工确认决策卡片（invoke: 渲染 → 主） */
  CONFIRM: 'loop:confirm',
  /** 取消正在执行的工作流（invoke: 渲染 → 主） */
  CANCEL: 'loop:cancel',
} as const

/**
 * 监控 IPC 通道常量
 *
 * 通道列表：
 * - STOP  invoke  渲染 → 主：停止服务器监控
 */
export const MONITOR = {
  /** 停止服务器监控（invoke: 渲染 → 主） */
  STOP: 'monitor:stop',
} as const

/**
 * 日志 IPC 通道常量
 *
 * 通道列表：
 * - STATS         invoke  渲染 → 主：查询日志统计
 * - CLEAR_BUFFER  invoke  渲染 → 主：清空日志缓冲区
 * - SET_MIN_LEVEL invoke  渲染 → 主：设置最小日志级别
 * - FLUSH         invoke  渲染 → 主：刷盘日志
 */
export const LOG = {
  /** 查询日志统计（invoke: 渲染 → 主） */
  STATS: 'log:stats',
  /** 清空日志缓冲区（invoke: 渲染 → 主） */
  CLEAR_BUFFER: 'log:clearBuffer',
  /** 设置最小日志级别（invoke: 渲染 → 主） */
  SET_MIN_LEVEL: 'log:setMinLevel',
  /** 刷盘日志（invoke: 渲染 → 主） */
  FLUSH: 'log:flush',
} as const

/**
 * 知识库 IPC 通道常量
 *
 * 通道列表：
 * - ADD     invoke  渲染 → 主：新增知识条目
 * - DELETE  invoke  渲染 → 主：删除知识条目
 * - IMPORT  invoke  渲染 → 主：批量导入知识条目
 * - EXPORT  invoke  渲染 → 主：批量导出知识条目
 */
export const KNOWLEDGE = {
  /** 新增知识条目（invoke: 渲染 → 主） */
  ADD: 'kb:add',
  /** 删除知识条目（invoke: 渲染 → 主） */
  DELETE: 'kb:delete',
  /** 批量导入知识条目（invoke: 渲染 → 主） */
  IMPORT: 'kb:import',
  /** 批量导出知识条目（invoke: 渲染 → 主） */
  EXPORT: 'kb:export',
} as const

/**
 * 决策历史 IPC 通道常量
 *
 * 通道列表：
 * - GET   invoke  渲染 → 主：查询决策卡片
 * - SAVE  invoke  渲染 → 主：保存决策卡片
 */
export const HISTORY = {
  /** 查询决策卡片（invoke: 渲染 → 主） */
  GET: 'history:get',
  /** 保存决策卡片（invoke: 渲染 → 主） */
  SAVE: 'history:save',
} as const

/**
 * 诊断 IPC 通道常量
 *
 * 通道列表：
 * - GET_REPORT   invoke  渲染 → 主：获取诊断报告
 * - GET_STATS    invoke  渲染 → 主：获取诊断统计
 * - CLEAR        invoke  渲染 → 主：清空诊断数据
 * - SET_ENABLED  invoke  渲染 → 主：启用/禁用诊断
 */
export const DIAGNOSTICS = {
  /** 获取诊断报告（invoke: 渲染 → 主） */
  GET_REPORT: 'diagnostics:get-report',
  /** 获取诊断统计（invoke: 渲染 → 主） */
  GET_STATS: 'diagnostics:get-stats',
  /** 清空诊断数据（invoke: 渲染 → 主） */
  CLEAR: 'diagnostics:clear',
  /** 启用/禁用诊断（invoke: 渲染 → 主） */
  SET_ENABLED: 'diagnostics:set-enabled',
} as const

/**
 * Sidecar 进程 IPC 通道常量
 *
 * 通道列表：
 * - START        invoke  渲染 → 主：启动 sidecar 进程
 * - STOP         invoke  渲染 → 主：停止 sidecar 进程
 * - STATUS       invoke  渲染 → 主：查询 sidecar 状态
 * - HEALTH       invoke  渲染 → 主：sidecar 健康检查
 * - LIST_STATUS  invoke  渲染 → 主：列出所有 sidecar 状态
 */
export const SIDECAR = {
  /** 启动 sidecar 进程（invoke: 渲染 → 主） */
  START: 'sidecar:start',
  /** 停止 sidecar 进程（invoke: 渲染 → 主） */
  STOP: 'sidecar:stop',
  /** 查询 sidecar 状态（invoke: 渲染 → 主） */
  STATUS: 'sidecar:status',
  /** sidecar 健康检查（invoke: 渲染 → 主） */
  HEALTH: 'sidecar:health',
  /** 列出所有 sidecar 状态（invoke: 渲染 → 主） */
  LIST_STATUS: 'sidecar:list-status',
} as const

/**
 * 沙箱 IPC 通道常量
 *
 * 通道列表：
 * - DETECT_DOCKER  invoke  渲染 → 主：检测 Docker 环境
 */
export const SANDBOX = {
  /** 检测 Docker 环境（invoke: 渲染 → 主） */
  DETECT_DOCKER: 'sandbox:detect-docker',
} as const

/**
 * MCP（Model Context Protocol）IPC 通道常量
 *
 * 通道列表：
 * - GET_STATE          invoke  渲染 → 主：查询 MCP 状态
 * - RESET              invoke  渲染 → 主：重置 MCP
 * - EXTERNAL_STATUS    invoke  渲染 → 主：查询外部 MCP 服务器状态
 * - EXTERNAL_TOOLS     invoke  渲染 → 主：查询外部 MCP 工具列表
 * - EXTERNAL_RECONNECT invoke  渲染 → 主：重连外部 MCP 服务器
 */
export const MCP = {
  /** 查询 MCP 状态（invoke: 渲染 → 主） */
  GET_STATE: 'mcp:get-state',
  /** 重置 MCP（invoke: 渲染 → 主） */
  RESET: 'mcp:reset',
  /** 查询外部 MCP 服务器状态（invoke: 渲染 → 主） */
  EXTERNAL_STATUS: 'mcp:external-status',
  /** 查询外部 MCP 工具列表（invoke: 渲染 → 主） */
  EXTERNAL_TOOLS: 'mcp:external-tools',
  /** 重连外部 MCP 服务器（invoke: 渲染 → 主） */
  EXTERNAL_RECONNECT: 'mcp:external-reconnect',
} as const

/**
 * 教程 IPC 通道常量
 *
 * 通道列表：
 * - CATEGORIES        invoke  渲染 → 主：查询教程分类
 * - SEED_VERSION      invoke  渲染 → 主：查询种子版本
 * - SEED_RELOAD       invoke  渲染 → 主：重新加载种子数据
 * - LIST_SOURCES      invoke  渲染 → 主：列出来源
 * - CRAWL_START       invoke  渲染 → 主：启动爬取
 * - CRAWL_STATUS      invoke  渲染 → 主：查询爬取状态
 * - CRAWL_CANCEL      invoke  渲染 → 主：取消爬取
 * - DISK_INFO         invoke  渲染 → 主：查询磁盘信息
 * - CLEANUP_ORPHANS   invoke  渲染 → 主：清理孤儿文件
 * - CHECKPOINTS       invoke  渲染 → 主：查询断点
 * - RESET_CHECKPOINT  invoke  渲染 → 主：重置断点
 * - SEARCH_STATUS     invoke  渲染 → 主：查询索引状态
 */
export const TUTORIAL = {
  /** 查询教程分类（invoke: 渲染 → 主） */
  CATEGORIES: 'tutorial:categories',
  /** 查询种子版本（invoke: 渲染 → 主） */
  SEED_VERSION: 'tutorial:seedVersion',
  /** 重新加载种子数据（invoke: 渲染 → 主） */
  SEED_RELOAD: 'tutorial:seedReload',
  /** 列出来源（invoke: 渲染 → 主） */
  LIST_SOURCES: 'tutorial:listSources',
  /** 启动爬取（invoke: 渲染 → 主） */
  CRAWL_START: 'tutorial:crawlStart',
  /** 查询爬取状态（invoke: 渲染 → 主） */
  CRAWL_STATUS: 'tutorial:crawlStatus',
  /** 取消爬取（invoke: 渲染 → 主） */
  CRAWL_CANCEL: 'tutorial:crawlCancel',
  /** 查询磁盘信息（invoke: 渲染 → 主） */
  DISK_INFO: 'tutorial:diskInfo',
  /** 清理孤儿文件（invoke: 渲染 → 主） */
  CLEANUP_ORPHANS: 'tutorial:cleanupOrphans',
  /** 查询断点（invoke: 渲染 → 主） */
  CHECKPOINTS: 'tutorial:checkpoints',
  /** 重置断点（invoke: 渲染 → 主） */
  RESET_CHECKPOINT: 'tutorial:resetCheckpoint',
  /** 查询索引状态（invoke: 渲染 → 主） */
  SEARCH_STATUS: 'tutorial:search-status',
} as const

/**
 * 部署 IPC 通道常量
 *
 * 通道列表：
 * - LIST_TEMPLATES  invoke  渲染 → 主：列出部署模板
 * - GET_TEMPLATE    invoke  渲染 → 主：获取部署模板详情
 * - CANCEL          invoke  渲染 → 主：取消部署
 * - GET_STATUS      invoke  渲染 → 主：查询部署状态
 */
export const DEPLOY = {
  /** 列出部署模板（invoke: 渲染 → 主） */
  LIST_TEMPLATES: 'deploy:listTemplates',
  /** 获取部署模板详情（invoke: 渲染 → 主） */
  GET_TEMPLATE: 'deploy:getTemplate',
  /** 取消部署（invoke: 渲染 → 主） */
  CANCEL: 'deploy:cancel',
  /** 查询部署状态（invoke: 渲染 → 主） */
  GET_STATUS: 'deploy:getStatus',
} as const

/**
 * AT 命令 IPC 通道常量
 *
 * 通道列表：
 * - LIST  invoke  渲染 → 主：列出 AT 命令
 */
export const AT_COMMANDS = {
  /** 列出 AT 命令（invoke: 渲染 → 主） */
  LIST: 'at:list',
} as const

/**
 * Token 用量 IPC 通道常量
 *
 * 通道列表：
 * - RESET  invoke  渲染 → 主：重置 Token 用量统计
 */
export const TOKEN = {
  /** 重置 Token 用量统计（invoke: 渲染 → 主） */
  RESET: 'token:reset',
} as const

/**
 * Promptfoo 评测 IPC 通道常量
 *
 * 通道列表：
 * - RUN_RED_TEAM  invoke  渲染 → 主：运行红队测试
 * - RUN_EVAL      invoke  渲染 → 主：运行评测
 * - LIST_TESTS    invoke  渲染 → 主：列出测试
 */
export const PROMPTFOO = {
  /** 运行红队测试（invoke: 渲染 → 主） */
  RUN_RED_TEAM: 'promptfoo:run-red-team',
  /** 运行评测（invoke: 渲染 → 主） */
  RUN_EVAL: 'promptfoo:run-eval',
  /** 列出测试（invoke: 渲染 → 主） */
  LIST_TESTS: 'promptfoo:list-tests',
} as const
