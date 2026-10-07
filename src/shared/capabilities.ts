/**
 * 能力就绪度表（阶段 F4）
 *
 * 为什么要这张表：这个项目对外承诺"可信决策"，最怕的不是某项功能没做，
 * 而是没做的功能在界面上看起来像做了。每条状态都按"从用户点进去的那一下
 * 到主进程算法再回到渲染组件"整条链路实测得出，任一环缺失就不算已接通：
 *
 * - live      已接通：用户能点到，数据是真的，结果会回到界面
 * - degraded  降级运行：链路通，但正常条件下走的是简化路径或受容量限制
 * - pending   待开发：代码在仓库里，但用户走不到，或产端还没接上
 *
 * 界面只读这张表（见 设置 → 关于 → 功能就绪度），不许在组件里另写一套状态文案。
 */

export type CapabilityStatus = 'live' | 'degraded' | 'pending'

export interface CapabilityRow {
  id: string
  /** 界面显示名 */
  label: string
  status: CapabilityStatus
  /** 这一档实际能做到什么、缺什么（界面副标题） */
  note: string
}

/** 状态显示名（界面上的胶囊文字） */
export const CAPABILITY_STATUS_LABELS: Record<CapabilityStatus, string> = {
  live: '已接通',
  degraded: '降级运行',
  pending: '待开发',
}

export const CAPABILITIES: CapabilityRow[] = [
  {
    id: 'ssh-terminal',
    label: 'SSH 终端与命令执行',
    status: 'live',
    note: '连接、执行、SFTP 读写与主机密钥校验都在主进程真实发生。',
  },
  {
    id: 'command-gate',
    label: '高危命令拦截',
    status: 'live',
    note: '判据已外置成数据文件，未确认的载荷一律拒绝（fail-closed）。',
  },
  {
    id: 'ai-chat',
    label: 'AI 助手与工具调用',
    status: 'live',
    note: '对话走 Supervisor，工具执行结果与命令轨迹会回到消息里。',
  },
  {
    id: 'credibility',
    label: 'D-S / PCR5 可信度融合',
    status: 'degraded',
    note: '融合链路已接通并显示在消息里；6 个证据源里 3 个目前喂的是恒定值，分数偏乐观。',
  },
  {
    id: 'calibration',
    label: 'ECE 校准与 Temperature Scaling',
    status: 'pending',
    note: '算法和设置页都在，但没有任何通路把"预测—实际对错"写成校准样本，校准表恒为空。',
  },
  {
    id: 'trace-langfuse',
    label: 'Langfuse 链路追踪',
    status: 'pending',
    note: '主进程埋点齐全，没有 Key 时静默降级；设置里没有填 Key 的入口，用户无法开启。',
  },
  {
    id: 'mcp-tools',
    label: 'MCP 工具服务',
    status: 'pending',
    note: '30 个工具已注册，但服务默认不启动（需 MCP_SERVER_ENABLED=true）；应用内聊天用的是另外 7 个内联工具。',
  },
  {
    id: 'claude-sdk',
    label: 'Claude Agent SDK 通道',
    status: 'pending',
    note: 'IPC 与 preload 已暴露 generate/stream/cancel，渲染层没有任何调用点。',
  },
  {
    id: 'terminal-blocks',
    label: '终端命令块（OSC 133 / 633）',
    status: 'pending',
    note: '消费端已实测可用：对端 shell 发出 OSC 133/633 时会切成命令块并计入状态栏。缺的是产端——我们没有给远端装 shell 集成，所以连普通服务器时命令块仍是 0。',
  },
  {
    id: 'monitor-history',
    label: '监控历史与时间窗口',
    status: 'degraded',
    note: '采样值来自真实 SSH 执行，但只在内存里保留最近 60 个点（约 1 分钟）；选 6H/24H 并不会拉长历史。',
  },
  {
    id: 'sidecar',
    label: 'Python 侧车分析',
    status: 'degraded',
    note: '按需启动并在失败时给出可操作提示；未启动时日志分析回退到本地正则模板。',
  },
  {
    id: 'decision-export',
    label: '决策审计报告导出',
    status: 'live',
    note: '详情页导出 Markdown / HTML / JSON 到磁盘；应用内报告浏览器还没做。',
  },
]

/** 按状态汇总（给"关于"页的标题行用） */
export function capabilityCounts(rows: CapabilityRow[] = CAPABILITIES): Record<CapabilityStatus, number> {
  const out: Record<CapabilityStatus, number> = { live: 0, degraded: 0, pending: 0 }
  for (const r of rows) out[r.status] += 1
  return out
}
