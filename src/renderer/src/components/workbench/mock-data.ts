/**
 * mock-data — Workbench 工作台 mock 数据
 *
 * 设计稿：tdsf-linux-redesign/pages/workbench-ai.html
 *
 * 包含：
 * 1. 服务器/文件树 mock（4 服务器 + 嵌套文件夹/文件）
 * 2. AI 对话消息 mock（5 条：2 用户 + 3 AI）
 * 3. 终端输出 mock（多行命令 + 输出）
 * 4. 编辑器标签 mock（终端 + 3 文件）
 * 5. 状态栏 mock（连接状态 + 光标位置）
 * 6. AI 工具面板 mock（8 个工具面板：思考/Skill/知识库/搜索/方法论/命令/指标/证据）
 *
 * 所有数据均为本地 mock，不接 IPC。
 */

// ============================================================
// 1. 服务器/文件树
// ============================================================

/** 服务器连接状态 */
export type ServerStatus = 'connected' | 'warning' | 'offline'

/** 文件树节点类型 */
export type FileTreeNodeType = 'server' | 'folder' | 'file'

/** 文件树节点（递归） */
export interface FileTreeNode {
  /** 节点 ID */
  id: string
  /** 显示名称 */
  label: string
  /** 节点类型 */
  type: FileTreeNodeType
  /** 子节点（仅 folder/server 有） */
  children?: FileTreeNode[]
  /** 服务器状态（仅 server） */
  status?: ServerStatus
  /** 服务器 IP（仅 server） */
  ip?: string
  /** 文件徽章数字（如未读日志数） */
  badge?: number
  /** 文件图标颜色（仅 file） */
  iconColor?: string
  /** 是否默认展开 */
  defaultExpanded?: boolean
  /** 关联的编辑器标签 ID（仅 file，点击后打开标签） */
  tabId?: string
}

/** mock 文件树数据 */
export const MOCK_FILE_TREE: FileTreeNode[] = [
  {
    id: 'srv-prod-web-01',
    label: 'prod-web-01',
    type: 'server',
    status: 'connected',
    ip: '192.168.1.10',
    defaultExpanded: true,
    children: [
      {
        id: 'folder-etc-nginx',
        label: 'etc/nginx',
        type: 'folder',
        defaultExpanded: true,
        children: [
          {
            id: 'file-nginx-conf',
            label: 'nginx.conf',
            type: 'file',
            iconColor: 'var(--trae-code-constant)',
            tabId: 'tab-nginx-conf',
          },
        ],
      },
      {
        id: 'folder-var-log',
        label: 'var/log',
        type: 'folder',
        badge: 12,
        defaultExpanded: true,
        children: [
          {
            id: 'file-nginx-access',
            label: 'nginx-access.log',
            type: 'file',
            iconColor: 'var(--trae-code-attribute)',
            tabId: 'tab-nginx-access',
          },
          {
            id: 'file-nginx-error',
            label: 'nginx-error.log',
            type: 'file',
            iconColor: 'var(--trae-code-attribute)',
            tabId: 'tab-nginx-error',
          },
        ],
      },
      {
        id: 'folder-home-deploy',
        label: 'home/deploy',
        type: 'folder',
        defaultExpanded: false,
        children: [],
      },
    ],
  },
  {
    id: 'srv-prod-db-02',
    label: 'prod-db-02',
    type: 'server',
    status: 'connected',
    ip: '192.168.1.20',
    defaultExpanded: false,
    children: [],
  },
  {
    id: 'srv-staging-web',
    label: 'staging-web',
    type: 'server',
    status: 'warning',
    ip: '10.0.4.12',
    defaultExpanded: false,
    children: [],
  },
  {
    id: 'srv-backup-01',
    label: 'backup-01',
    type: 'server',
    status: 'offline',
    ip: '192.168.1.30',
    defaultExpanded: false,
    children: [],
  },
]

// ============================================================
// 2. 编辑器标签 + 文件内容
// ============================================================

/** 编辑器标签 ID */
export type EditorTabId = 'tab-terminal' | 'tab-nginx-conf' | 'tab-nginx-access' | 'tab-nginx-error'

/** 编辑器标签 */
export interface EditorTab {
  id: EditorTabId
  label: string
  iconColor?: string
}

/** mock 编辑器标签 */
export const MOCK_EDITOR_TABS: EditorTab[] = [
  { id: 'tab-terminal', label: '终端' },
  { id: 'tab-nginx-conf', label: 'nginx.conf', iconColor: 'var(--trae-code-constant)' },
  { id: 'tab-nginx-access', label: 'nginx-access.log', iconColor: 'var(--trae-code-attribute)' },
  { id: 'tab-nginx-error', label: 'nginx-error.log', iconColor: 'var(--trae-code-attribute)' },
]

// ============================================================
// 3. 终端输出
// ============================================================

/** 终端行类型 */
export type TerminalLineType = 'welcome' | 'prompt' | 'comment' | 'output-success' | 'output-error' | 'output-warn' | 'output-default' | 'cursor'

/** 终端单行 */
export interface TerminalLine {
  /** 行类型 */
  type: TerminalLineType
  /** 文本内容（prompt 类型时是命令，comment 类型时是中文注释；segments 类型时可省略） */
  text?: string
  /** prompt 类型时的提示符前缀（如 root@prod-web-01:~#） */
  prompt?: string
  /** 额外的中文说明（comment 类型时用） */
  tooltip?: string
  /** 输出片段（一行多色时用，与 text 二选一） */
  segments?: Array<{ text: string; color?: string }>
}

/** mock 终端输出（4 个命令块） */
export const MOCK_TERMINAL_LINES: TerminalLine[] = [
  { type: 'welcome', text: 'Welcome to Ubuntu 22.04 LTS (GNU/Linux 5.15.0 x86_64)' },
  { type: 'welcome', text: 'Last login: Fri Jul 17 14:20:12 2026 from 10.0.0.5' },
  { type: 'prompt', prompt: 'root@prod-web-01:~#', text: 'systemctl status nginx' },
  { type: 'comment', text: '查看nginx服务运行状态' },
  { type: 'output-success', text: '● nginx.service - A high performance web server' },
  { type: 'output-success', text: '     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)' },
  {
    type: 'output-warn',
    segments: [
      { text: '     Active: ' },
      { text: 'active (running)', color: 'var(--trae-status-error-default)' },
      { text: ' since Fri 2026-07-17 14:15:02 CST; 7min ago' },
    ],
  },
  { type: 'output-success', text: '   Main PID: 1246 (nginx)' },
  { type: 'prompt', prompt: 'root@prod-web-01:~#', text: 'ss -s' },
  { type: 'comment', text: '查看当前socket连接统计' },
  { type: 'output-success', text: 'Total: 12843 (kernel 13020)' },
  { type: 'output-success', text: 'TCP:   10240 (estab 8920, closed 1024, orphaned 0, timewait 890)' },
  { type: 'output-error', text: 'TCP       10240     8920      1320   <-- 连接数接近worker_connections上限' },
  { type: 'prompt', prompt: 'root@prod-web-01:~#', text: 'curl -s -w "%{time_total}\\n" -o /dev/null http://localhost/api/health' },
  { type: 'comment', text: '测试本地接口响应时间' },
  {
    type: 'output-error',
    segments: [
      { text: '1.203' },
      { text: 's', color: 'var(--trae-code-text)' },
    ],
  },
  { type: 'cursor', prompt: 'root@prod-web-01:~#', text: '' },
]

// ============================================================
// 4. AI 对话消息
// ============================================================

/** 消息类型 */
export type ChatRole = 'user' | 'ai'

/** AI 工具面板类型 */
export type AIToolType =
  | 'thought'
  | 'skill'
  | 'knowledge'
  | 'web'
  | 'methodology'
  | 'command'
  | 'metric'
  | 'evidence'
  | 'summary'
  | 'summary-card'
  | 'progress'
  | 'rollback'
  | 'pause'

/** 工具面板内容（简化结构，渲染时由组件决定样式） */
export interface AIToolPanel {
  type: AIToolType
  title: string
  /** 状态徽章文本（如"分析完成"、"v1.2"、"3条匹配"） */
  badge?: string
  /** 状态徽章颜色 key */
  badgeVariant?: 'brand' | 'success' | 'warning' | 'error' | 'neutral' | 'violet'
  /** 耗时（秒） */
  duration?: number
  /** 是否默认展开 */
  defaultOpen?: boolean
  /** 子步骤列表（如思考步骤、执行步骤） */
  steps?: Array<{ label: string; description?: string; status?: 'success' | 'active' | 'pending'; duration?: number; hint?: string }>
  /** 关联命令（command 类型用） */
  command?: { prompt: string; cmd: string; translation?: string; output?: string[]; success?: boolean }
  /** 指标对比表（metric 类型用） */
  metrics?: Array<{ label: string; before: string; after: string; delta: string; beforeColor?: string; deltaColor?: string }>
  /** 证据来源（evidence 类型用） */
  evidences?: Array<{ label: string; percent: number; color?: string }>
  /** 知识库结果（knowledge 类型用） */
  kbResults?: Array<{ id: string; title: string; percent: number; color?: string; desc?: string; cited?: boolean }>
  /** 联网搜索结果（web 类型用） */
  webResults?: Array<{ title: string; source: string; percent: number; highMatch?: boolean }>
  /** SRE 黄金信号（methodology 类型用） */
  signals?: Array<{ label: string; value: string; color: string; statusColor?: string }>
  /** 汇总卡片完成项（summary-card 类型用） */
  summaryItems?: string[]
  /** 回滚面板（rollback 类型用） */
  rollback?: { cmd: string; reason: string; status: string; time?: string }
  /** 暂停面板（pause 类型用） */
  pause?: { description: string; pausedFor: string }
  /** Skill 元信息（skill 类型用，显示输入/输出参数） */
  skillMeta?: { name: string; version: string; scope: string; input: string; output: string }
}

/** AI 消息内容块（表格、洞察、操作按钮等富文本） */
export type ChatBlock =
  | { type: 'paragraph'; text: string }
  | {
      type: 'table'
      headers: string[]
      rows: Array<{ cells: string[]; cellColors?: (string | undefined)[] }>
    }
  | { type: 'insight'; title: string; text: string }
  | { type: 'actions'; buttons: Array<{ label: string; primary?: boolean; navigate: string }> }

/** 一条对话消息 */
export interface ChatMessage {
  id: string
  role: ChatRole
  /** 用户消息文本 */
  text?: string
  /** 用户消息时间戳 */
  time?: string
  /** AI 消息包含的工具面板序列 */
  panels?: AIToolPanel[]
  /** AI 文字摘要 */
  summary?: string
  /** 摘要样式变体：plain=纯文本（如 Msg 2），checked=带 check-circle 图标（如 Msg 5） */
  summaryVariant?: 'plain' | 'checked'
  /** AI 富文本内容块 */
  blocks?: ChatBlock[]
  /** Token 使用量 */
  tokens?: number
  /** 耗时（秒） */
  duration?: number
}

/** mock 5 条对话消息 */
export const MOCK_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-1',
    role: 'user',
    text: 'nginx响应延迟突然升高，P99到了1.2s，帮我排查并解决',
    time: '14:22',
  },
  {
    id: 'msg-2',
    role: 'ai',
    panels: [
      {
        type: 'thought',
        title: '深度思考',
        badge: '分析完成',
        badgeVariant: 'brand',
        duration: 2.1,
        defaultOpen: true,
        steps: [
          { label: '① 分析问题', description: '用户报告nginx P99延迟升高至1.2s', status: 'success' },
          { label: '② 采集证据', description: 'worker_connections达上限10240', status: 'success' },
          { label: '③ 推理分析', description: '连接数超限导致请求排队', status: 'success' },
          { label: '④ 验证假设', description: '对比历史基线确认根因', status: 'success' },
        ],
      },
      {
        type: 'skill',
        title: '调用Skill: nginx-troubleshoot',
        badge: 'v1.2',
        badgeVariant: 'neutral',
        duration: 2.3,
        defaultOpen: true,
        skillMeta: {
          name: 'nginx-troubleshoot',
          version: 'v1.2',
          scope: '本地',
          input: '{"target":"prod-web-01","metric":"p99_latency","threshold":"200ms"}',
          output: '{"root_cause":"worker_connections上限","confidence":0.87,"suggested_action":"restart"}',
        },
        steps: [
          { label: '采集nginx状态', status: 'success', duration: 0.8 },
          { label: '分析worker_connections', status: 'success', duration: 0.6 },
          { label: '匹配历史故障', status: 'success', duration: 0.9 },
        ],
      },
      {
        type: 'knowledge',
        title: '检索知识库',
        badge: '3条匹配',
        badgeVariant: 'brand',
        defaultOpen: false,
        kbResults: [
          { id: 'KB-021', title: 'Nginx连接数优化指南', percent: 98, color: 'var(--trae-status-success-default)', desc: '调整worker_connections参数以提升并发能力...', cited: true },
          { id: 'KB-088', title: 'P99延迟排查方法论', percent: 85, color: 'var(--trae-bg-brand)', desc: '从连接队列分析P99异常的根因...' },
          { id: 'KB-145', title: 'worker_connections调优案例', percent: 79, color: 'var(--trae-accent-amber)', desc: '实际案例：电商大促期间连接数调优...' },
        ],
      },
      {
        type: 'web',
        title: '联网搜索',
        badge: '4条',
        badgeVariant: 'neutral',
        defaultOpen: false,
        webResults: [
          { title: 'Nginx worker_connections 官方文档', source: 'nginx.org', percent: 95, highMatch: true },
          { title: 'Optimizing Nginx for High Traffic', source: 'digitalocean.com', percent: 88, highMatch: true },
          { title: 'Tuning Nginx Worker Connections', source: 'nginx.com', percent: 76, highMatch: false },
          { title: 'Linux TCP参数调优最佳实践', source: 'cloud.tencent.com', percent: 72, highMatch: false },
        ],
      },
      {
        type: 'methodology',
        title: '应用方法论',
        badge: 'SRE黄金信号',
        badgeVariant: 'violet',
        defaultOpen: false,
        signals: [
          { label: '延迟', value: 'P99 1.2s', color: 'var(--trae-text-tertiary)', statusColor: 'var(--trae-status-error-default)' },
          { label: '流量', value: '890/s', color: 'var(--trae-text-tertiary)', statusColor: 'var(--trae-status-success-default)' },
          { label: '错误', value: '0.3%', color: 'var(--trae-text-tertiary)', statusColor: 'var(--trae-status-alert-default)' },
          { label: '饱和度', value: '100%', color: 'var(--trae-text-tertiary)', statusColor: 'var(--trae-status-error-default)' },
        ],
      },
      {
        type: 'command',
        title: '执行命令',
        defaultOpen: true,
        command: {
          prompt: 'root@prod-web-01:~#',
          cmd: 'sudo systemctl restart nginx',
          translation: '重启nginx服务',
          output: ['● nginx.service restarted', '   Active: running'],
          success: true,
        },
      },
      {
        type: 'metric',
        title: '指标对比',
        badge: '重启前后',
        badgeVariant: 'neutral',
        defaultOpen: true,
        metrics: [
          { label: 'P99延迟', before: '1.2s', after: '180ms', delta: '↓85%', beforeColor: 'var(--trae-status-error-default)', deltaColor: 'var(--trae-status-success-default)' },
          { label: '连接数', before: '10240', after: '3210', delta: '↓69%', beforeColor: 'var(--trae-status-error-default)', deltaColor: 'var(--trae-status-success-default)' },
          { label: 'CPU', before: '68%', after: '32%', delta: '↓36%', beforeColor: 'var(--trae-status-alert-default)', deltaColor: 'var(--trae-status-success-default)' },
        ],
      },
      {
        type: 'evidence',
        title: '证据来源',
        badge: '置信度0.87',
        badgeVariant: 'neutral',
        defaultOpen: false,
        evidences: [
          { label: 'ss -s 连接数统计', percent: 42, color: 'var(--trae-bg-brand)' },
          { label: 'nginx error.log 日志', percent: 35, color: 'var(--trae-bg-brand)' },
          { label: 'curl 响应时间测试', percent: 23, color: 'var(--trae-bg-brand)' },
        ],
      },
      {
        type: 'summary-card',
        title: '分析完成',
        badge: '7/7步',
        badgeVariant: 'brand',
        defaultOpen: true,
        summaryItems: [
          '深度思考推理',
          '调用Skill诊断',
          '检索知识库',
          '联网搜索验证',
          '应用SRE方法论',
          '执行重启命令',
          '验证P99恢复',
        ],
      },
    ],
    summary:
      'nginx已重启，P99延迟从1.2s降至180ms，改善85%。根因为worker_connections达到默认上限10240导致请求排队。建议将配置提升至65535并优化TCP内核参数。',
    summaryVariant: 'plain',
    tokens: 2135,
    duration: 5.2,
  },
  {
    id: 'msg-2b',
    role: 'ai',
    blocks: [
      {
        type: 'paragraph',
        text: '分析完成，以下是 prod-web-01 的资源使用概况：',
      },
      {
        type: 'table',
        headers: ['指标', '当前值', '阈值', '状态'],
        rows: [
          { cells: ['CPU 使用率', '68%', '80%', '正常'], cellColors: [undefined, undefined, 'var(--trae-text-tertiary)', 'var(--trae-status-success-default)'] },
          { cells: ['内存使用率', '4.2G', '8G', '正常'], cellColors: [undefined, undefined, 'var(--trae-text-tertiary)', 'var(--trae-status-success-default)'] },
          { cells: ['worker_connections', '10240', '10240', '告警'], cellColors: [undefined, 'var(--trae-status-alert-default)', 'var(--trae-text-tertiary)', 'var(--trae-status-alert-default)'] },
          { cells: ['磁盘使用率', '45%', '90%', '正常'], cellColors: [undefined, undefined, 'var(--trae-text-tertiary)', 'var(--trae-status-success-default)'] },
        ],
      },
      {
        type: 'insight',
        title: '关键发现',
        text: 'worker_connections 已达上限，建议提升至 20480 并热加载 nginx。',
      },
      {
        type: 'actions',
        buttons: [
          { label: '采纳建议', primary: true, navigate: '/decision/DEC-087' },
          { label: '查看详情', primary: false, navigate: '/decision/DEC-087' },
        ],
      },
    ],
  },
  {
    id: 'msg-3',
    role: 'user',
    text: '执行，先沙箱预演',
    time: '14:24',
  },
  {
    id: 'msg-4',
    role: 'ai',
    panels: [
      {
        type: 'progress',
        title: '执行进度',
        badge: '进行中',
        badgeVariant: 'brand',
        defaultOpen: true,
        steps: [
          { label: '沙箱预演通过', status: 'success', duration: 0.8 },
          { label: '执行命令', status: 'success', duration: 1.2 },
          { label: '验证结果', status: 'active', hint: '验证P99恢复...' },
          { label: '生成总结', status: 'pending', hint: '待执行' },
          { label: '更新知识库', status: 'pending', hint: '待执行' },
        ],
      },
      {
        type: 'rollback',
        title: '回滚操作',
        badge: '已执行',
        badgeVariant: 'error',
        defaultOpen: true,
        rollback: {
          cmd: 'sudo systemctl start nginx.old',
          reason: '用户主动回滚，恢复原nginx进程',
          status: '回滚成功',
          time: '14:25',
        },
      },
      {
        type: 'pause',
        title: '执行已暂停',
        badge: '等待确认',
        badgeVariant: 'warning',
        defaultOpen: true,
        pause: {
          description: 'Agent执行已暂停，等待您的确认后继续',
          pausedFor: '已暂停 3s',
        },
      },
    ],
    tokens: 1400,
    duration: 3.1,
  },
  {
    id: 'msg-5',
    role: 'ai',
    summary: '操作完成。nginx已重启，P99延迟从1.2s降至180ms。',
    summaryVariant: 'checked',
    tokens: 5660,
    duration: 0,
  },
]

// ============================================================
// 5. AI 面板 Composer 工具栏
// ============================================================

/** Composer 快捷动作（chips） */
export const MOCK_COMPOSER_CHIPS = ['诊断', '部署', '巡检', '回滚', '扩容']

// ============================================================
// 6. 状态栏 mock
// ============================================================

/** 状态栏左侧项 */
export const MOCK_STATUSBAR_LEFT = [
  { id: 'main', icon: 'terminal', label: 'main', color: 'var(--trae-text-secondary)' },
  { id: 'ssh', label: 'SSH已连接', color: 'var(--trae-status-success-default)', dot: true },
  { id: 'errors', icon: 'check-circle', label: '0 Errors', color: 'var(--trae-text-secondary)' },
  { id: 'ai', icon: 'sparkles', label: 'AI已激活', color: 'var(--trae-text-brand)' },
]

/** 状态栏右侧项 */
export const MOCK_STATUSBAR_RIGHT = [
  { id: 'cursor', label: 'Ln 42, Col 16' },
  { id: 'encoding', label: 'UTF-8' },
  { id: 'file', icon: 'code', label: 'nginx.conf' },
  { id: 'p99', icon: 'zap', label: 'P99 180ms', iconColor: 'var(--trae-status-success-default)' },
]

// ============================================================
// 7. AI 面板标题栏 Token 曲线 mock
// ============================================================

/** Token 曲线数据点（7 个点，模拟 7 天趋势） */
export const MOCK_TOKEN_CHART_POINTS = '0,55 34,48 68,52 102,38 136,42 170,28 204,32 240,18'

/** Token 统计 */
export const MOCK_TOKEN_STATS = {
  today: 2135,
  week: 12450,
  month: 45600,
  inputTokens: 1245,
  outputTokens: 890,
  ratio: '1.4:1',
}

/** Token 预算 */
export const MOCK_TOKEN_BUDGET = {
  used: 2135,
  total: 4000,
  percent: 53,
}

/** 上下文使用率 */
export const MOCK_CONTEXT_USAGE = {
  used: 12,
  usedTokens: '24.6K',
  totalTokens: '200K',
}
