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
 *     AT_COMMANDS / TOKEN；DEPLOY 与 AT_COMMANDS 已于 2026-10-24 随各自执行/解析链整删）
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
 * - CHAT        invoke  渲染 → 主：启动 Supervisor 流式 chat
 * - CHAT_CANCEL invoke  渲染 → 主：取消进行中的 chat 请求
 * - PAOR        invoke  渲染 → 主：PAOR 自动循环（Plan→Act→Observe→Reflect）
 * - START       invoke  渲染 → 主：启动 Agent 工作流（旧版扁平化兼容）
 * - CONFIRM     invoke  渲染 → 主：人工确认 Agent 决策（旧版扁平化兼容）
 * - CANCEL      invoke  渲染 → 主：取消正在执行的 Agent 会话
 * - STEP        push     主 → 渲染：Agent 工作流步骤变更
 * - CHUNK       push     主 → 渲染：Supervisor 流式 token 块推送
 * - DONE        push     主 → 渲染：Supervisor chat 完成信号
 * - ERROR       push     主 → 渲染：Supervisor chat 错误信号
 */
export const AGENT = {
  /** 启动 Supervisor 流式 chat（invoke: 渲染 → 主，v0.9） */
  CHAT: 'agent:chat',
  /** 取消进行中的 chat 请求（invoke: 渲染 → 主，v0.9） */
  CHAT_CANCEL: 'agent:chat:cancel',
  /** PAOR 自动循环（invoke: 渲染 → 主，v0.9.5） */
  PAOR: 'agent:paor',
  /** 启动 Agent 工作流（invoke: 渲染 → 主，v0.8 旧版扁平化兼容） */
  START: 'agent:start',
  /** 人工确认 Agent 决策（invoke: 渲染 → 主，v0.8 旧版扁平化兼容） */
  CONFIRM: 'agent:confirm',
  /** 取消正在执行的 Agent 会话（invoke: 渲染 → 主） */
  CANCEL: 'agent:cancel',
  /** Agent 工作流步骤变更推送（push: 主 → 渲染） */
  STEP: 'agent:step',
  /** Supervisor 流式 token 块推送（push: 主 → 渲染，v0.9） */
  CHUNK: 'agent:chunk',
  /** Supervisor chat 完成信号推送（push: 主 → 渲染，v0.9） */
  DONE: 'agent:done',
  /** Supervisor chat 错误信号推送（push: 主 → 渲染，v0.9） */
  ERROR: 'agent:error',
  /** 工具调用实时可视化推送（push: 主 → 渲染，v2.4） */
  TOOL_EVENT: 'agent:tool-event',
  /** PAOR 每轮迭代进度推送（push: 主 → 渲染，见 paor-types.ts） */
  PAOR_ITERATION: 'agent:paor:iteration',
} as const

/**
 * LLM IPC 通道常量
 *
 * 通道列表：
 * - CHAT              invoke  渲染 → 主：单轮对话推理
 * - TEST              invoke  渲染 → 主：测试 LLM API 连通性
 * - ANALYZE           invoke  渲染 → 主：分析问题（内置降级）
 * - VALIDATE          invoke  渲染 → 主：校验 LLM 配置有效性
 * - CHAT_WITH_CONTEXT invoke  渲染 → 主：带系统环境上下文的对话
 * - CHAT_WITH_TOOLS   invoke  渲染 → 主：带工具调用的对话
 * - TOOL_APPROVE      invoke  渲染 → 主：人工审批工具调用请求
 * - TOKEN             push     主 → 渲染：流式 token 推送（兼容旧版）
 * - CHUNK             push     主 → 渲染：流式 token 块推送（增强版）
 * - DONE              push     主 → 渲染：流式完成信号
 * - ERROR             push     主 → 渲染：流式错误信号
 * - TOOL_PROGRESS     push     主 → 渲染：工具调用进度
 * - TOOL_APPROVAL     push     主 → 渲染：工具调用审批请求
 */
export const LLM = {
  /** 单轮对话推理（invoke: 渲染 → 主） */
  CHAT: 'llm:chat',
  /** 测试 LLM API 连通性（invoke: 渲染 → 主） */
  TEST: 'llm:test',
  /** 分析问题（invoke: 渲染 → 主，内置降级，返回 JSON 字符串） */
  ANALYZE: 'llm:analyze',
  /** 校验 LLM 配置有效性（invoke: 渲染 → 主） */
  VALIDATE: 'llm:validate',
  /** 带系统环境上下文的对话（invoke: 渲染 → 主） */
  CHAT_WITH_CONTEXT: 'llm:chat-with-context',
  /** 带工具调用的对话（invoke: 渲染 → 主，v0.5.0） */
  CHAT_WITH_TOOLS: 'llm:chat-with-tools',
  /** 人工审批工具调用请求（invoke: 渲染 → 主） */
  TOOL_APPROVE: 'llm:tool-approve',
  /** 流式 token 推送（push: 主 → 渲染，兼容旧版） */
  TOKEN: 'llm:token',
  /** 流式 token 块推送（push: 主 → 渲染，增强版，含 totalTokens） */
  CHUNK: 'llm:chunk',
  /** 流式完成信号推送（push: 主 → 渲染，含完整文本） */
  DONE: 'llm:done',
  /** 流式错误信号推送（push: 主 → 渲染，含错误码/消息/是否可重试） */
  ERROR: 'llm:error',
  /** 工具调用进度推送（push: 主 → 渲染） */
  TOOL_PROGRESS: 'llm:tool-progress',
  /** 工具调用审批请求推送（push: 主 → 渲染） */
  TOOL_APPROVAL: 'llm:tool-approval',
} as const

/**
 * SSH IPC 通道常量
 *
 * 通道列表：
 * - CONNECT       invoke  渲染 → 主：建立 SSH 连接
 * - DISCONNECT    invoke  渲染 → 主：断开 SSH 连接
 * - EXEC          invoke  渲染 → 主：执行一次性 SSH 命令
 * - SHELL_START   invoke  渲染 → 主：新开一条交互式 Shell，返回 shellId
 * - SHELL_CLOSE   invoke  渲染 → 主：关闭一条 Shell 通道（不断连接）
 * - SHELL_LIST    invoke  渲染 → 主：列出某会话当前开着的 shellId
 * - SHELL_WRITE   invoke  渲染 → 主：向指定 Shell 写入数据（首参 shellId）
 * - SHELL_RESIZE  invoke  渲染 → 主：调整指定 Shell 终端窗口大小（首参 shellId）
 * - STATE_CHANGED push    主 → 渲染：心跳保活状态变更（重连/最终断开）
 */
export const SSH = {
  /** 建立 SSH 连接（invoke: 渲染 → 主） */
  CONNECT: 'ssh:connect',
  /**
   * 按已保存的服务器 ID 连接（invoke: 渲染 → 主）
   *
   * 与 CONNECT 的区别只有一个但很关键：渲染层只交 ID（外加可选的一次性口令），
   * 存好的密码/私钥由主进程自己从 SecureStore 取，永不跨进程边界。
   */
  CONNECT_BY_ID: 'ssh:connectById',
  /** 断开 SSH 连接（invoke: 渲染 → 主） */
  DISCONNECT: 'ssh:disconnect',
  /** 执行一次性 SSH 命令（invoke: 渲染 → 主，非交互式） */
  EXEC: 'ssh:exec',
  /** 启动交互式 Shell（invoke: 渲染 → 主）；返回新建通道的 shellId，一条连接可开多个终端 */
  SHELL_START: 'ssh:shell:start',
  /** 关闭一条 Shell 通道（invoke: 渲染 → 主）；只关终端，不断整条 SSH 连接 */
  SHELL_CLOSE: 'ssh:shell:close',
  /** 列出某条会话当前开着的 shellId（invoke: 渲染 → 主），渲染层恢复标签用 */
  SHELL_LIST: 'ssh:shell:list',
  /**
   * 向交互式 Shell 写入数据（invoke: 渲染 → 主）— 首参是 shellId
   *
   * 主进程用 LineGate 行缓冲：键入阶段不判，攒到 `\r`（PTY 里就是 accept-line）
   * 时整行过一次 command-gate；block 级不转发该段数据，改为回显拦截提示并返回 false。
   * 全屏程序（vim/less 等，靠输出侧的备用屏指令识别）期间暂停判定。
   */
  SHELL_WRITE: 'ssh:shell:write',
  /**
   * 执行"他人代写"的整条命令（invoke: 渲染 → 主）— AI 建议 / 决策页重新执行
   *
   * 首参是 shellId（投进哪个终端）。与 SHELL_WRITE 的分工：本通道拿到的是完整一条命令，
   * 可以整条判定并在 block 时直接抛错；SHELL_WRITE 只能等用户敲回车。
   * 两条都过 command-gate，没有哪条是"无闸"路径。
   */
  SHELL_RUN_AUTHORED: 'ssh:shell:run-authored',
  /** 调整 Shell 终端窗口大小（invoke: 渲染 → 主）— 首参是 shellId */
  SHELL_RESIZE: 'ssh:shell:resize',
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
  /**
   * 删除 SSH 密钥对（invoke: 渲染 → 主，Phase M）
   *
   * 删除 ~/.ssh/ 目录下指定密钥文件（私钥 + 公钥 .pub）。
   * 幂等：删除不存在的密钥返回 success=true。
   */
  DELETE_KEYPAIR: 'ssh:delete-keypair',
  /**
   * 上传 SSH 私钥（invoke: 渲染 → 主，Phase M）
   *
   * 弹出文件选择对话框 → 用户选择私钥文件 → 复制到 ~/.ssh/ → chmod 600。
   * 公钥同步生成（ssh-keygen -y derive 公钥，写入 .pub，chmod 644）。
   */
  UPLOAD_KEYPAIR: 'ssh:upload-keypair',
  /**
   * 生成 SSH 密钥对（invoke: 渲染 → 主，Phase M）
   *
   * 调用 ssh-keygen 生成 ed25519 / rsa 密钥对，默认输出到 ~/.ssh/。
   * 私钥权限 600，公钥 644。
   */
  GENERATE_KEYPAIR: 'ssh:generate-keypair',
  /**
   * 列出 ~/.ssh/ 目录下所有密钥对（invoke: 渲染 → 主，Phase M）
   *
   * 扫描 ~/.ssh/ 目录，识别私钥文件（无 .pub 后缀的非配置文件），
   * 返回 SshKeyPair[]。用于 Card 2 密钥列表展示。
   */
  LIST_KEYPAIRS: 'ssh:list-keypairs',
  /**
   * 读取 ~/.ssh/config 的 Host 列表（invoke: 渲染 → 主）
   *
   * 路径固定为用户主目录，不接受渲染层传路径；只回解析后的非敏感字段。
   */
  LIST_CONFIG_HOSTS: 'ssh:list-config-hosts',
} as const

/**
 * SFTP 文件操作 IPC 通道常量
 *
 * 通道列表：
 * - LIST      invoke  渲染 → 主：列出远程目录
 * - UPLOAD    invoke  渲染 → 主：上传文件
 * - DOWNLOAD  invoke  渲染 → 主：下载文件
 * - DELETE    invoke  渲染 → 主：删除文件/目录
 * - RENAME    invoke  渲染 → 主：重命名
 * - CHMOD     invoke  渲染 → 主：修改权限
 * - READ_FILE invoke  渲染 → 主：读取远程文件内容到字符串
 * - WRITE_FILE invoke 渲染 → 主：写入字符串到远程文件
 * - STAT      invoke  渲染 → 主：获取文件/目录元信息
 * - MKDIR     invoke  渲染 → 主：创建远程目录
 * - PROGRESS  push    主 → 渲染：上传/下载进度推送
 */
export const SFTP = {
  /** 列出远程目录（invoke: 渲染 → 主） */
  LIST: 'sftp:list',
  /** 上传文件（invoke: 渲染 → 主） */
  UPLOAD: 'sftp:upload',
  /** 下载文件（invoke: 渲染 → 主） */
  DOWNLOAD: 'sftp:download',
  /** 删除文件/目录（invoke: 渲染 → 主） */
  DELETE: 'sftp:delete',
  /** 重命名（invoke: 渲染 → 主） */
  RENAME: 'sftp:rename',
  /** 修改权限（invoke: 渲染 → 主） */
  CHMOD: 'sftp:chmod',
  /** 读取远程文件内容到字符串（invoke: 渲染 → 主，10MB 上限） */
  READ_FILE: 'sftp:readFile',
  /** 写入字符串到远程文件（invoke: 渲染 → 主，覆盖原文件） */
  WRITE_FILE: 'sftp:writeFile',
  /** 获取文件/目录元信息（invoke: 渲染 → 主，返回 SftpEntry 或 null） */
  STAT: 'sftp:stat',
  /** 创建远程目录（invoke: 渲染 → 主） */
  MKDIR: 'sftp:mkdir',
  /** 上传/下载进度推送（push: 主 → 渲染，载荷 SftpProgressEvent） */
  PROGRESS: 'sftp:progress',
} as const

/**
 * 终端数据推送 IPC 通道常量
 *
 * - TERMINAL_DATA push 主 → 渲染：交互式 Shell 数据回传
 */
export const TERMINAL = {
  /** Shell 数据回传推送（push: 主 → 渲染，载荷 shellId + 原始字节串；渲染层按 shellId 投给对应终端） */
  DATA: 'terminal:data',
} as const

/**
 * 应用窗口（W4）IPC 通道常量
 *
 * 通道列表：
 * - OPEN_SECONDARY  invoke  渲染 → 主：再开一个应用窗口，返回窗口总数
 *
 * 只给"开一个"这一个动作，不给"关别人的窗口""枚举窗口"这类能力：
 * 渲染层能关掉另一个窗口里的东西，等于把另一个窗口的状态交出去了。
 */
export const WINDOW = {
  /** 再开一个应用窗口（invoke: 渲染 → 主，返回当前窗口数） */
  OPEN_SECONDARY: 'window:open-secondary',
} as const

/**
 * 预览（W5）IPC 通道常量
 *
 * 通道列表：
 * - OPEN      invoke  渲染 → 主：为一个远端目标铸一个预览句柄，返回 token 与 iframe 用的 URL
 * - CLOSE     invoke  渲染 → 主：作废一个句柄（关掉预览标签时调）
 * - READ_TEXT invoke  渲染 → 主：读句柄入口文件的文本（Markdown 在渲染层安全渲染，不进 iframe）
 *
 * 这里没有"给我一个任意路径的字节"这种通道：预览的子资源一律走
 * tdsf-preview: 协议 + 铸句柄时定死的笼子，见 src/main/services/preview/preview-handles.ts。
 */
export const PREVIEW = {
  OPEN: 'preview:open',
  CLOSE: 'preview:close',
  READ_TEXT: 'preview:readText',
} as const

/**
 * 远端 Shell 集成（#61）IPC 通道常量
 *
 * 通道列表（三条都是 invoke：渲染 → 主，入参只有一个 sessionId）：
 * - STATUS     问这台机器现在的状态，连带把将要写入的两处原文带回来给界面逐字展示
 * - INSTALL    用户确认之后才调：写 ~/.tdsf-shell-integration.sh + rc 里加一个标记块
 * - UNINSTALL  把标记块从 rc 里剥掉，删掉集成脚本
 *
 * 故意没有"给所有会话都装上"的通道：装到谁的机器上是逐台的决定，
 * 而且写入路径全在主进程里定死，渲染层连文件名都传不进来。
 */
export const SHELL_INTEGRATION = {
  STATUS: 'ssh:shell-integration:status',
  INSTALL: 'ssh:shell-integration:install',
  UNINSTALL: 'ssh:shell-integration:uninstall',
} as const

/**
 * 本机终端（W3）IPC 通道常量
 *
 * 通道列表：
 * - STATUS        invoke  渲染 → 主：node-pty 是否可用 + 用的是哪个 Shell
 * - START         invoke  渲染 → 主：开一条本机终端，返回 shellId
 * - LIST          invoke  渲染 → 主：当前开着的本机终端 shellId
 * - WRITE         invoke  渲染 → 主：写入按键（不判定，理由同 ssh:shell:write）
 * - RESIZE        invoke  渲染 → 主：调整窗口大小
 * - CLOSE         invoke  渲染 → 主：关掉这条终端（连带杀它的子进程树）
 * - RUN_AUTHORED  invoke  渲染 → 主：执行整条代写命令，先过 core/command-gate
 * - EXIT          push    主 → 渲染：本机终端进程退出，渲染层据此摘标签
 *
 * 输出复用 terminal:data（载荷第一个字段就是 shellId，本机与远端同一套分发），
 * 不另开一条数据通道——两条数据通道意味着渲染层要维护两份订阅与两段缓存。
 */
export const LOCAL_TTY = {
  /** 可用性（invoke: 渲染 → 主，返回 { available, reason, shellPath }） */
  STATUS: 'local-tty:status',
  /** 开一条本机终端（invoke: 渲染 → 主，返回 shellId） */
  START: 'local-tty:start',
  /** 列出开着的本机终端（invoke: 渲染 → 主，返回 string[]） */
  LIST: 'local-tty:list',
  /** 写入按键数据（invoke: 渲染 → 主）— 仅供用户键入，主进程不做命令判定 */
  WRITE: 'local-tty:write',
  /** 调整窗口大小（invoke: 渲染 → 主） */
  RESIZE: 'local-tty:resize',
  /** 关闭一条本机终端（invoke: 渲染 → 主） */
  CLOSE: 'local-tty:close',
  /**
   * 执行"他人代写"的整条命令（invoke: 渲染 → 主）— AI 建议 / 决策页重新执行
   *
   * 与 WRITE 分开：逐键输入没法当整条命令评估，但整条可以，本通道先过风险闸。
   */
  RUN_AUTHORED: 'local-tty:run-authored',
  /** 进程退出推送（push: 主 → 渲染，载荷 shellId） */
  EXIT: 'local-tty:exit',
} as const

/**
 * 终端智能补全 IPC 通道常量（v0.9.7 P3 M1 新增：零 Token 本地补全）
 *
 * 通道列表：
 * - COMPLETE  invoke  渲染 → 主：根据当前输入返回补全建议
 * - ACCEPT    invoke  渲染 → 主：用户接受某条建议（提升 Frecency 分数）
 * - IMPORT    invoke  渲染 → 主：批量导入历史命令（如读取远端 ~/.bash_history）
 *
 * 设计依据：v0.9.7 P3 M1 · 终端补全引擎 Phase 1（IPC 4 步同步铁律）
 */
export const TERMINAL_COMPLETION = {
  /** 请求补全建议（invoke: 渲染 → 主，返回 CompletionSuggestion[]） */
  COMPLETE: 'terminal-completion:complete',
  /** 接受建议（invoke: 渲染 → 主，提升 Frecency 分数） */
  ACCEPT: 'terminal-completion:accept',
  /** 批量导入历史命令（invoke: 渲染 → 主，参数 commands: string[], directory?: string） */
  IMPORT: 'terminal-completion:import',
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
 * - SAVE_API_KEY    invoke  渲染 → 主：加密保存 API Key
 * - GET_API_KEY     invoke  渲染 → 主：读取加密存储的 API Key
 * - DELETE_API_KEY  invoke  渲染 → 主：删除加密存储的 API Key
 */
export const STORAGE = {
  /** 加密保存 API Key（invoke: 渲染 → 主） */
  SAVE_API_KEY: 'storage:saveApiKey',
  /** 读取加密存储的 API Key（invoke: 渲染 → 主） */
  /** 是否存有该 provider 的 API Key（只回布尔，不回原文；替代原 GET_API_KEY） */
  HAS_API_KEY: 'storage:hasApiKey',
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
  /** 写入配置项（invoke: 渲染 → 主）——只接受非权限性键，见 ipc/storage.ts */
  SET: 'config:set',
  /**
   * 保存 LLM 配置（invoke: 渲染 → 主）
   * 专用通道：主进程校验 baseUrl 后才落盘，避免"渲染层写 baseUrl + 主进程带真 Key"
   */
  SAVE_LLM: 'config:saveLlm',
} as const

/**
 * 服务器配置 IPC 通道常量
 *
 * 通道列表：
 * - LIST        invoke  渲染 → 主：列出已保存的 SSH 服务器
 * - SAVE        invoke  渲染 → 主：保存服务器配置
 * - EXPORT      invoke  渲染 → 主：导出服务器配置 JSON
 * - IMPORT      invoke  渲染 → 主：导入服务器配置 JSON
 * - EXPORT_FILE invoke  渲染 → 主：弹保存框并写文件（不含凭据）
 * - IMPORT_FILE invoke  渲染 → 主：弹打开框并导入（凭据留空）
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
  /** 导出服务器配置到用户选定的文件（invoke: 渲染 → 主，主进程弹保存框） */
  EXPORT_FILE: 'server:export-file',
  /** 从用户选定的文件导入服务器配置（invoke: 渲染 → 主，主进程弹打开框） */
  IMPORT_FILE: 'server:import-file',
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
  /** LLM 调用开始推送（push: 主 → 渲染） */
  LLM_START: 'loop:llm-start',
  /** LLM 调用完成推送（push: 主 → 渲染） */
  LLM_DONE: 'loop:llm-done',
  /** 工作流步骤变更推送（push: 主 → 渲染） */
  STEP: 'loop:step',
  /** 决策卡片推送（push: 主 → 渲染） */
  DECISION: 'loop:decision',
  /** 工作流完成信号推送（push: 主 → 渲染） */
  DONE: 'loop:done',
  /** 工作流错误信号推送（push: 主 → 渲染） */
  ERROR: 'loop:error',
  /** 工作流阻塞信号推送（push: 主 → 渲染） */
  BLOCKED: 'loop:blocked',
} as const

/**
 * 监控 IPC 通道常量
 *
 * 通道列表：
 * - START           invoke  渲染 → 主：启动服务器监控
 * - STOP            invoke  渲染 → 主：停止服务器监控
 * - GET_SYSTEM_INFO invoke  渲染 → 主：获取系统静态信息
 * - DATA            push    主 → 渲染：监控数据推送（实时指标）
 * - SYSTEM_INFO     push    主 → 渲染：系统信息推送（首次采集时一次）
 */
export const MONITOR = {
  /** 启动服务器监控（invoke: 渲染 → 主） */
  START: 'monitor:start',
  /** 停止服务器监控（invoke: 渲染 → 主） */
  STOP: 'monitor:stop',
  /** 获取系统静态信息（invoke: 渲染 → 主） */
  GET_SYSTEM_INFO: 'monitor:getSystemInfo',
  /** 监控数据推送（push: 主 → 渲染，实时指标，每 interval 秒一次） */
  DATA: 'monitor:data',
  /** 系统信息推送（push: 主 → 渲染，首次采集时推送一次） */
  SYSTEM_INFO: 'monitor:systemInfo',
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
  /** 读取日志（invoke: 渲染 → 主） */
  READ: 'log:read',
  /** 渲染进程日志上报（invoke: 渲染 → 主） */
  RENDERER: 'log:renderer',
} as const

/**
 * 知识库 IPC 通道常量
 *
 * 通道列表：
 * - ADD     invoke  渲染 → 主：新增知识条目
 * - DELETE  invoke  渲染 → 主：删除知识条目
 * - IMPORT  invoke  渲染 → 主：批量导入知识条目
 * - EXPORT  invoke  渲染 → 主：批量导出知识条目
 * - GET     invoke  渲染 → 主：按 id 查询单条知识条目（M4 Task 1 新增，替代 kbExport 误用）
 */
/**
 * Agent 长期记忆通道（v2.8）
 *
 * 自动沉淀的跨会话记忆（用户画像/偏好/环境事实/错误教训）管理。
 */
export const MEMORY = {
  /** 列出全部记忆（invoke: 渲染 → 主，可按 type 过滤） */
  LIST: 'memory:list',
  /** 关键词检索记忆（invoke: 渲染 → 主） */
  SEARCH: 'memory:search',
  /** 按 id 删除记忆（invoke: 渲染 → 主） */
  DELETE: 'memory:delete',
  /** 沉淀审计日志（invoke: 渲染 → 主） */
  AUDIT: 'memory:audit',
} as const

export const KNOWLEDGE = {
  /** 新增知识条目（invoke: 渲染 → 主） */
  ADD: 'kb:add',
  /** 删除知识条目（invoke: 渲染 → 主） */
  DELETE: 'kb:delete',
  /** 批量导入知识条目（invoke: 渲染 → 主） */
  IMPORT: 'kb:import',
  /** 批量导出知识条目（invoke: 渲染 → 主） */
  EXPORT: 'kb:export',
  /** 搜索知识条目（invoke: 渲染 → 主） */
  SEARCH: 'kb:search',
  /** 更新知识条目（invoke: 渲染 → 主） */
  UPDATE: 'kb:update',
  /** 按 id 查询单条知识条目（invoke: 渲染 → 主，未找到返回 null） */
  GET: 'kb:get',
  /** 记录浏览（invoke: 渲染 → 主） */
  VIEW: 'kb:view',
  /** 热门知识（invoke: 渲染 → 主） */
  HOT: 'kb:hot',
  /** 最近浏览记录（invoke: 渲染 → 主） */
  RECENT_VIEWS: 'kb:recent-views',
  /** 弹打开框导入 Markdown/文本/JSON 知识文件（invoke: 渲染 → 主，#180） */
  IMPORT_FILE: 'kb:import-file',
  /** 给还没有向量的条目补齐语义索引（invoke: 渲染 → 主，#180） */
  REINDEX_EMBEDDINGS: 'kb:reindex-embeddings',
} as const

/**
 * 决策历史 IPC 通道常量
 *
 * 通道列表：
 * - GET   invoke  渲染 → 主：查询决策卡片
 * - SAVE  invoke  渲染 → 主：保存决策卡片
 * - AUDIT invoke  渲染 → 主：读取决策审计链（行 + 校验结论）
 */
export const HISTORY = {
  /** 查询决策卡片（invoke: 渲染 → 主） */
  GET: 'history:get',
  /**
   * 保存决策记录（invoke: 渲染 → 主）
   *
   * 入参是 HistorySaveIntent 而不是 DecisionCard：风险等级、置信度、id、时间戳
   * 由主进程判定后生成，渲染层只交代事实（P0-5）。
   */
  SAVE: 'history:save',
  /**
   * 读取某条决策的审计链（invoke: 渲染 → 主）
   *
   * 返回库里存的行 + 主进程重算的校验结论。渲染层不再自己拼事件、也不再自己算哈希：
   * 那样得到的只是"打开时的视图"，改库里的卡改不出来（任务 #174）。
   */
  AUDIT: 'history:audit',
  /** 查询决策历史列表（invoke: 渲染 → 主） */
  LIST: 'history:list',
  /** 查询决策统计（invoke: 渲染 → 主） */
  STATS: 'history:stats',
  /** 查询高危命令拦截记录（invoke: 渲染 → 主） */
  BLOCKS: 'history:blocks',
} as const

/**
 * 对话历史落盘（任务 #177 / #178）
 *
 * 通道列表：
 * - APPEND invoke  渲染 → 主：落一条消息（同 id 覆盖，收尾那一笔补全半截回答）
 * - LIST   invoke  渲染 → 主：按会话取最近若干条（正序回看）
 * - CLEAR  invoke  渲染 → 主：删掉某一档的全部记录（面板头那颗「清空对话」）
 *
 * 为什么要这三条：`stores/agent-store.ts` 是纯内存的，重启后对话全丢；
 * 而显示侧读的是未过滤的全量列表，于是切了服务器还能看见上一台的回答。
 * 写入口在渲染层（那里才是"界面看到什么"的正本），但入参在主进程当场判形状——
 * 渲染进程按红线是沙箱 + 不可信输入，不能因为它写了什么就往库里塞什么。
 * CLEAR 是落盘之后才欠出来的那一条：只清内存的话，重启后回看会把"已经清掉"的问答
 * 原样请回来，按钮说的不算数。
 */
export const CHAT = {
  /** 落一条对话消息（invoke: 渲染 → 主） */
  APPEND: 'chat:append',
  /** 按会话回看对话历史（invoke: 渲染 → 主） */
  LIST: 'chat:list',
  /** 删掉某一档的全部对话记录（invoke: 渲染 → 主，返回删掉的条数） */
  CLEAR: 'chat:clear',
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
  /** 获取诊断日志（invoke: 渲染 → 主） */
  GET_LOGS: 'diagnostics:get-logs',
  /** 获取诊断发现（invoke: 渲染 → 主） */
  GET_FINDINGS: 'diagnostics:get-findings',
  /** 注入测试事件（invoke: 渲染 → 主） */
  INGEST_TEST: 'diagnostics:ingest-test',
  /** 诊断日志批量推送（push: 主 → 渲染） */
  LOG_BATCH: 'diagnostics:log-batch',
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
  /** 启动指定 sidecar（invoke: 渲染 → 主） */
  START_ONE: 'sidecar:start-one',
  /** 停止指定 sidecar（invoke: 渲染 → 主） */
  STOP_ONE: 'sidecar:stop-one',
  /** 指定 sidecar 健康检查（invoke: 渲染 → 主） */
  HEALTH_ONE: 'sidecar:health-one',
  /** sidecar 日志解析管线（invoke: 渲染 → 主） */
  PIPELINE: 'sidecar:pipeline',
  /** sidecar 工具调用（invoke: 渲染 → 主） */
  TOOL_CALL: 'sidecar:tool-call',
  /** 解析 sidecar 日志（invoke: 渲染 → 主） */
  PARSE_LOGS: 'sidecar:parse-logs',
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
  /** 启动沙箱（invoke: 渲染 → 主） */
  START: 'sandbox:start',
  /** 停止沙箱（invoke: 渲染 → 主） */
  STOP: 'sandbox:stop',
  /** 查询沙箱状态（invoke: 渲染 → 主） */
  STATUS: 'sandbox:status',
  /** 创建沙箱（invoke: 渲染 → 主） */
  CREATE: 'sandbox:create',
  /** 列出沙箱（invoke: 渲染 → 主） */
  LIST: 'sandbox:list',
  /** 在沙箱内执行命令（invoke: 渲染 → 主） */
  EXECUTE: 'sandbox:execute',
  /** 审批沙箱命令（invoke: 渲染 → 主） */
  APPROVE: 'sandbox:approve',
  /** 沙箱命令审批请求推送（push: 主 → 渲染） */
  APPROVAL_REQUEST: 'sandbox:approval-request',
  /** 删除沙箱（invoke: 渲染 → 主） */
  DELETE: 'sandbox:delete',
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
  /** MCP 生命周期状态变更推送（push: 主 → 渲染） */
  STATE_CHANGED: 'mcp:state-changed',
  /** 查询外部 MCP 服务器状态（invoke: 渲染 → 主） */
  EXTERNAL_STATUS: 'mcp:external-status',
  /** 查询外部 MCP 工具列表（invoke: 渲染 → 主） */
  EXTERNAL_TOOLS: 'mcp:external-tools',
  /** 重连外部 MCP 服务器（invoke: 渲染 → 主） */
  EXTERNAL_RECONNECT: 'mcp:external-reconnect',
  /** 调用外部 MCP 工具（invoke: 渲染 → 主） */
  EXTERNAL_CALL: 'mcp:external-call',
  EXTERNAL_LIST: 'mcp:external-list',
  EXTERNAL_ADD: 'mcp:external-add',
  EXTERNAL_REMOVE: 'mcp:external-remove',
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
  /** 爬取进度推送（push: 主 → 渲染） */
  CRAWL_PROGRESS: 'tutorial:crawlProgress',
  /** 爬取完成推送（push: 主 → 渲染） */
  CRAWL_DONE: 'tutorial:crawlDone',
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
  /** 列出教程（invoke: 渲染 → 主） */
  LIST: 'tutorial:list',
  /** 获取教程详情（invoke: 渲染 → 主） */
  GET: 'tutorial:get',
  /** 搜索教程（invoke: 渲染 → 主） */
  SEARCH: 'tutorial:search',
  /** 混合检索教程（invoke: 渲染 → 主，FTS + 向量） */
  HYBRID_SEARCH: 'tutorial:hybrid-search',
  /** 回填 embedding 向量（invoke: 渲染 → 主，旧版同步通道，v2.5 保留向后兼容） */
  BACKFILL_EMBEDDINGS: 'tutorial:backfill-embeddings',
  /** 启动异步回填（invoke: 渲染 → 主，v2.5 Phase C 新增，立即返回 taskId） */
  BACKFILL_START: 'tutorial:backfill-start',
  /** 取消异步回填（invoke: 渲染 → 主，v2.5 Phase C 新增） */
  BACKFILL_CANCEL: 'tutorial:backfill-cancel',
  /** 查询回填状态（invoke: 渲染 → 主，v2.5 Phase C 新增） */
  BACKFILL_STATUS: 'tutorial:backfill-status',
  /** 回填进度推送（push: 主 → 渲染，v2.5 Phase C 新增，每页完成后触发） */
  BACKFILL_PROGRESS: 'tutorial:backfill-progress',
  /** 学习路径推荐（invoke: 渲染 → 主） */
  RECOMMEND_PATH: 'tutorial:recommend-path',
  /** 教程统计（invoke: 渲染 → 主，总浏览人次 + 总课程数） */
  STATS: 'tutorial:stats',
  /** 查询所有教程学习进度（invoke: 渲染 → 主，v2.3.2 新增，跨设备同步） */
  PROGRESS: 'tutorial:progress',
  /** 更新单条教程学习进度（invoke: 渲染 → 主，v2.3.2 新增，跨设备同步） */
  UPDATE_PROGRESS: 'tutorial:updateProgress',
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
  /** 查询 Token 用量统计（invoke: 渲染 → 主） */
  STATS: 'token:stats',
  /** 查询 Token 用量记录列表（invoke: 渲染 → 主） */
  RECORDS: 'token:records',
  /** 查询 Token 成本统计（invoke: 渲染 → 主） */
  COST_STATS: 'token:cost-stats',
} as const

/**
 * 系统级 IPC 通道常量（v2.2 P1 修复 #20：preload system 常量集中化）
 *
 * 通道列表：
 * - PING  invoke  渲染 → 主：心跳保活 ping
 *
 * 设计说明：
 * - 主进程在所有业务 IPC 之前注册（main/ipc/index.ts:95），用于早期响应渲染进程心跳
 * - 渲染进程通过 window.electronAPI.systemPing() 调用（preload 已暴露）
 * - 主进程使用字面量豁免（B4）：registerAllIpcHandlers 调用前 ipc-channels 模块未初始化
 *   但实际同文件已 import 其他常量，故豁免不适用，主进程同步替换为 SYSTEM.PING
 */
export const SYSTEM = {
  /** 心跳保活 ping（invoke: 渲染 → 主，返回 { ok, timestamp, protocolVersion }） */
  PING: 'system:ping',
} as const

/**
 * 应用更新 IPC 通道常量（v2.2 P1 修复 #24：AboutSettings 检查更新功能）
 *
 * 通道列表：
 * - CHECK_UPDATE   invoke  渲染 → 主：检查 GitHub Releases 是否有新版本
 * - DOWNLOAD_UPDATE invoke 渲染 → 主：打开浏览器跳转到 Release 页面（简化方案）
 *
 * 设计说明（简化方案 · 不引入 electron-updater）：
 * - 主进程用 net.fetch 请求 GitHub Releases API，比对版本号
 * - 不实现自动下载安装（避免 electron-updater 复杂配置）
 * - "下载更新" 实际打开浏览器到 Release 页面，由用户手动下载
 */
export const APP = {
  /** 检查更新（invoke: 渲染 → 主，HTTP GET GitHub Releases API 比对版本号） */
  CHECK_UPDATE: 'app:check-update',
  /** 下载更新（invoke: 渲染 → 主，打开浏览器到 Release 页面） */
  DOWNLOAD_UPDATE: 'app:download-update',
  /** 获取应用信息（invoke: 渲染 → 主，返回版本/安装路径/构建时间等） */
  GET_INFO: 'app:get-info',
  /** 导出模型配置与统计（invoke: 渲染 → 主，写入 userData/exports） */
  EXPORT_MODEL_STATS: 'app:export-model-stats',
} as const

/**
 * 文件系统 IPC 通道常量（v2.2 P1 修复 #22：AIPanel 图片附件基础版）
 *
 * 通道列表：
 * - UPLOAD_IMAGE invoke  渲染 → 主：选择图片文件并返回 base64 数据
 *
 * 设计说明：
 * - 主进程用 dialog.showOpenDialog 让用户选择图片
 * - 读取文件并转 base64 data URL 返回渲染层
 * - 限制图片大小（4MB）和扩展名（png/jpg/jpeg/gif/webp/bmp）
 */
export const FS = {
  /** 选择图片文件并返回 base64 数据 URL（invoke: 渲染 → 主） */
  UPLOAD_IMAGE: 'fs:upload-image',
} as const

/**
 * Profiler 系统架构感知 IPC 通道常量（v2.2 P1 修复 #18/#20：补齐缺失域）
 *
 * 通道列表：
 * - RUN             invoke  渲染 → 主：执行系统架构感知（27 项探查 + 风险检测 + md 渲染）
 * - EXPORT_MD       invoke  渲染 → 主：导出 md 文件
 * - EXPORT_PDF      invoke  渲染 → 主：导出 PDF 文件
 * - DEFAULT_FILE_NAME invoke 渲染 → 主：生成默认文件名
 */
export const PROFILER = {
  /** 执行系统架构感知（invoke: 渲染 → 主） */
  RUN: 'profiler:run',
  /** 导出 md 文件（invoke: 渲染 → 主） */
  EXPORT_MD: 'profiler:exportMd',
  /** 导出 PDF 文件（invoke: 渲染 → 主） */
  EXPORT_PDF: 'profiler:exportPdf',
  /** 生成默认文件名（invoke: 渲染 → 主） */
  DEFAULT_FILE_NAME: 'profiler:defaultFileName',
} as const

/**
 * PAOR（Plan→Act→Observe→Reflect）IPC 通道常量
 *
 * 通道列表：
 * - APPROVE invoke  渲染 → 主：人工审批 PAOR 循环步骤
 */
export const PAOR = {
  /** 人工审批 PAOR 循环步骤（invoke: 渲染 → 主） */
  APPROVE: 'paor:approve',
  /** 高危命令/步骤审批卡推送（push: 主 → 渲染，见 paor-types.ts） */
  APPROVAL_REQUEST: 'paor:approval-request',
} as const

/**
 * Provider 信息查询 IPC 通道常量
 *
 * 通道列表：
 * - LIST             invoke  渲染 → 主：列出已配置的 Provider
 * - GET              invoke  渲染 → 主：获取单个 Provider 配置
 * - SAVE             invoke  渲染 → 主：保存 Provider 配置
 * - SET_DEFAULT      invoke  渲染 → 主：设置默认 Provider
 * - CAPABILITIES     invoke  渲染 → 主：查询单个 Provider 能力
 * - CAPABILITIES_ALL invoke  渲染 → 主：查询所有 Provider 能力
 * - PRICING          invoke  渲染 → 主：查询单个 Provider 定价
 * - PRICING_ALL      invoke  渲染 → 主：查询所有 Provider 定价
 */
export const PROVIDER = {
  /** 列出已配置的 Provider（invoke: 渲染 → 主） */
  LIST: 'provider:list',
  /** 获取单个 Provider 配置（invoke: 渲染 → 主） */
  GET: 'provider:get',
  /** 保存 Provider 配置（invoke: 渲染 → 主） */
  SAVE: 'provider:save',
  /** 设置默认 Provider（invoke: 渲染 → 主） */
  SET_DEFAULT: 'provider:set-default',
  /** 获取默认 Provider ID（invoke: 渲染 → 主） */
  GET_DEFAULT: 'provider:get-default',
  /** 查询单个 Provider 能力（invoke: 渲染 → 主） */
  CAPABILITIES: 'provider:capabilities',
  /** 查询所有 Provider 能力（invoke: 渲染 → 主） */
  CAPABILITIES_ALL: 'provider:capabilities-all',
  /** 查询单个 Provider 定价（invoke: 渲染 → 主） */
  PRICING: 'provider:pricing',
  /** 查询所有 Provider 定价（invoke: 渲染 → 主） */
  PRICING_ALL: 'provider:pricing-all',
} as const

/**
 * 模式（Mode）IPC 通道常量
 *
 * 通道列表：
 * - LIST        invoke  渲染 → 主：列出所有模式
 * - SET_DEFAULT invoke  渲染 → 主：设置默认模式
 * - GET_CURRENT invoke  渲染 → 主：获取当前模式
 */
export const MODE = {
  /** 列出所有模式（invoke: 渲染 → 主） */
  LIST: 'mode:list',
  /** 设置默认模式（invoke: 渲染 → 主） */
  SET_DEFAULT: 'mode:set-default',
  /** 获取当前模式（invoke: 渲染 → 主） */
  GET_CURRENT: 'mode:get-current',
} as const





/**
 * 子 Agent IPC 通道常量
 *
 * 通道列表：
 * - LIST   invoke  渲染 → 主：列出子 Agent
 * - RELOAD invoke  渲染 → 主：重新加载子 Agent 配置
 */
export const SUBAGENT = {
  /** 列出子 Agent（invoke: 渲染 → 主） */
  LIST: 'subagent:list',
  /** 重新加载子 Agent 配置（invoke: 渲染 → 主） */
  RELOAD: 'subagent:reload',
} as const

/**
 * 模型统计 IPC 通道常量（v2.3.2 新增：补齐 ModelSettings 静态数据）
 *
 * 通道列表：
 * - TOOL_CALLS invoke 渲染 → 主：查询工具调用统计（按工具名聚合 count + percent）
 */
export const MODEL_STATS = {
  /** 查询工具调用统计（invoke: 渲染 → 主，返回 ToolCallStat[]） */
  TOOL_CALLS: 'model:toolCalls',
} as const

/**
 * 预算告警 IPC 通道常量（v2.3.2 新增：补齐 ModelSettings 静态数据）
 *
 * 通道列表：
 * - ALERTS invoke 渲染 → 主：查询预算告警历史（最近 N 条）
 */
export const BUDGET = {
  /** 查询预算告警历史（invoke: 渲染 → 主，返回 BudgetAlert[]） */
  ALERTS: 'budget:alerts',
} as const

/**
 * 可信度评估 IPC 通道常量
 *
 * 通道列表：
 * - ASSESS                  invoke  渲染 → 主：评估可信度
 * - DAG                     invoke  渲染 → 主：构建证据 DAG
 * - EXPORT_AUDIT_REPORT     invoke  渲染 → 主：导出审计报告
 * - LIST_AUDIT_REPORTS      invoke  渲染 → 主：列出审计报告
 * - LOAD_AUDIT_REPORT       invoke  渲染 → 主：加载审计报告
 * - FORMAT_AUDIT_REPORT     invoke  渲染 → 主：格式化审计报告
 * - EXPORT_DECISION_HTML    invoke  渲染 → 主：按 decisionId 简化导出 HTML 报告
 * - CALIBRATE               invoke  渲染 → 主：校准指定 Provider（v2.4 Phase C 新增）
 * - GET_CALIBRATION         invoke  渲染 → 主：获取指定 Provider 的当前 T 值（v2.4 Phase C 新增）
 * - GET_CALIBRATION_STATE   invoke  渲染 → 主：获取全局校准状态（v2.4 Phase C 新增）
 * - RESET_CALIBRATION       invoke  渲染 → 主：重置指定 Provider 的校准（v2.4 Phase C 新增）
 * - COMPUTE_ECE             invoke  渲染 → 主：计算指定 Provider 的当前 ECE（v2.4 Phase C 新增）
 * - ADD_CALIBRATION_SAMPLE  invoke  渲染 → 主：记录新的校准样本（v2.4 Phase C 新增）
 */
export const CREDIBILITY = {
  /** 评估可信度（invoke: 渲染 → 主） */
  ASSESS: 'credibility:assess',
  /** 构建证据 DAG（invoke: 渲染 → 主） */
  DAG: 'credibility:dag',
  /** 导出审计报告（invoke: 渲染 → 主） */
  EXPORT_AUDIT_REPORT: 'credibility:export-audit-report',
  /** 列出审计报告（invoke: 渲染 → 主） */
  LIST_AUDIT_REPORTS: 'credibility:list-audit-reports',
  /** 加载审计报告（invoke: 渲染 → 主） */
  LOAD_AUDIT_REPORT: 'credibility:load-audit-report',
  /** 格式化审计报告（invoke: 渲染 → 主） */
  FORMAT_AUDIT_REPORT: 'credibility:format-audit-report',
  /** 按 decisionId 简化导出 HTML 报告（invoke: 渲染 → 主，v2.3.2 新增） */
  EXPORT_DECISION_HTML: 'credibility:export-decision-html',
  // v2.4 Phase C 收尾：校准 IPC 通道（6 个）
  /** 校准指定 Provider（基于历史样本，invoke: 渲染 → 主） */
  CALIBRATE: 'credibility:calibrate',
  /** 获取指定 Provider 的当前 T 值（invoke: 渲染 → 主） */
  GET_CALIBRATION: 'credibility:get-calibration',
  /** 获取全局校准状态（invoke: 渲染 → 主） */
  GET_CALIBRATION_STATE: 'credibility:get-calibration-state',
  /** 重置指定 Provider 的校准（invoke: 渲染 → 主） */
  RESET_CALIBRATION: 'credibility:reset-calibration',
  /** 计算指定 Provider 的当前 ECE（invoke: 渲染 → 主） */
  COMPUTE_ECE: 'credibility:compute-ece',
  /** 记录新的校准样本（invoke: 渲染 → 主） */
  ADD_CALIBRATION_SAMPLE: 'credibility:add-calibration-sample',
} as const

/**
 * 风险评估 IPC 通道常量（M2 新增：命令风险检查）
 *
 * 通道列表：
 * - CHECK invoke 渲染 → 主：检查命令风险等级（AST + 正则降级）
 *
 * 设计依据：M2 Task 2 · IPC 4 步同步铁律
 * 桥接主进程 assessCommandRisk（src/main/ipc/sandbox-approval.ts），
 * 该函数已封装 AST 优先 + 正则降级逻辑，返回 { risk, reasons }。
 */
export const RISK = {
  /** 检查命令风险等级（invoke: 渲染 → 主，桥接 assessCommandRisk） */
  CHECK: 'risk:check',
  /** 读取真正生效的拦截规则表（invoke: 渲染 → 主，桥接 COMMAND_RULES_SNAPSHOT） */
  RULES: 'risk:rules',
} as const

/** risk:rules 的单条规则视图（与主进程 COMMAND_RULES_SNAPSHOT.rules 同形） */
export interface RiskRuleView {
  id: string
  /** 命中的命令名（数据文件里的 '@名单' 引用已展开成真实命令列表） */
  commands: readonly string[]
  /** null = 只看 argv0；数组 = 参数里还要命中其中之一 */
  subcommands: readonly string[] | null
  level: 'safe' | 'low' | 'medium' | 'high' | 'block'
  reason: string
  requiresConfirm: boolean
  audit: boolean
  irreversible: boolean
}

/** risk:rules 的返回载荷 */
export interface RiskRulesSnapshot {
  version: number
  blockDetectors: readonly string[]
  rules: readonly RiskRuleView[]
}

/**
 * 告警 IPC 通道常量（M3 新增：告警确认）
 *
 * 通道列表：
 * - ACK invoke  渲染 → 主：确认告警（标记已处理，主进程内存 Map 记录）
 *
 * 设计依据：M3 Task 2 · IPC 4 步同步铁律
 * 告警是瞬时状态，主进程内存 Map 存储 ack 状态，重启后重置（不持久化到磁盘）。
 * 渲染层在 AlertDrawer "标记已处理" 按钮中调用，ack 后关闭 Drawer。
 */
export const ALERT = {
  /** 确认告警（invoke: 渲染 → 主，主进程内存 Map 记录 ack 状态） */
  ACK: 'alert:ack',
} as const

/**
 * BOOT 域 — 启动加载阶段推送
 *
 * 主进程在加载关键阶段（IPC ready / SQLite init / KB indexed / done）时
 * 通过 push 通道向渲染层推送当前阶段，BootPage 据此推进进度条。
 */
export const BOOT = {
  /** 加载阶段推送（push: 主 → 渲染） */
  LOADING_STAGE: 'boot:loading-stage',
  /** 拉取最近一次加载阶段（invoke: 渲染 → 主）——补 push 之前订阅未就绪的竞态 */
  GET_STATE: 'boot:get-state',
} as const

/**
 * DB 域 — 数据库运行状态（A4：SQLite 降级可见化）
 *
 * 通道列表：
 * - STATUS invoke 渲染 → 主：读取 better-sqlite3 可用性与 schema 版本
 *
 * 设计依据：此前降级只写主进程日志（main/index.ts），渲染层无从知晓，
 * 用户会在"数据静默不持久化"的状态下继续操作。STATUS 供全局横幅消费。
 */
export const DB = {
  /** 读取数据库状态（invoke: 渲染 → 主，返回 DbStatus） */
  STATUS: 'db:status',
} as const


