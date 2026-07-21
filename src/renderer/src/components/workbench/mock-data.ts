/**
 * mock-data — Workbench AI 对话 mock 数据
 *
 * 包含：
 * 1. AI 对话消息 mock（5 条：2 用户 + 3 AI）
 * 2. AI 工具面板类型定义（thought/skill/knowledge/web/command/metric/evidence 等）
 * 3. Composer 快捷动作 chips
 *
 * 所有数据均为本地 mock，不接 IPC。
 *
 * R15 清理：移除了 10 个死代码导出（文件树/编辑器标签/终端输出/状态栏/Token 曲线）
 * 及关联的 7 个死类型定义。仅保留 AI 面板相关类型和常量。
 */

// ============================================================
// 1. AI 对话消息类型
// ============================================================

/** 消息类型（内部使用，外部通过 ChatMessage 引用） */
type ChatRole = 'user' | 'ai'

/** AI 工具面板类型（内部使用，外部通过 AIToolPanel 引用） */
type AIToolType =
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

// ============================================================
// 2. AI 对话消息 mock
// ============================================================

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
// 3. AI 面板 Composer 工具栏
// ============================================================

/** Composer 快捷动作（chips） */
export const MOCK_COMPOSER_CHIPS = ['诊断', '部署', '巡检', '回滚', '扩容']
