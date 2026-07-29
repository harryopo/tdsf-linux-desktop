/**
 * 主对话工具目录 + 意图路由（v2.6）
 *
 * 背景：supervisor 主对话（agent:chat）原来硬编码挂载全部工具，
 * 用户无法看到"为什么这轮挂了这些工具"，新增工具也要改多处散落代码。
 *
 * 职责：
 * 1. CHAT_TOOL_CATALOG —— 主对话工具单一目录（元数据：意图关键词/依赖/提示词片段）。
 *    新增工具只需：目录里加一条 + supervisor 的 candidateTools 里加定义。
 * 2. routeChatTools —— 零 Token 本地意图识别：对最后一条用户消息做关键词匹配，
 *    返回本轮应挂载的工具子集与理由；无明确意图时保守挂载全部可用工具
 *    （LLM tool-calling 本身按需调用，路由层的价值是省 token + 决策可视化）。
 *
 * 可视化：supervisor 把路由结果经 onToolEvent 推「工具装配」卡片（toolName='tool_route'），
 * 复用 agent:tool-event 通道，前端 LiveMessageRow 折叠行展示，零新增 IPC。
 */

/** 主对话工具 ID（与 supervisor candidateTools 的键一致） */
export type ChatToolId = 'ssh_readonly' | 'ssh_write' | 'ssh_journal_follow' | 'sftp_read' | 'kb_search' | 'tutorial_search' | 'memory_recall'

/** 工具目录条目（元数据，不含工具实现本体） */
export interface ChatToolCatalogEntry {
  id: ChatToolId
  /** 中文展示名（装配卡片用） */
  label: string
  /** 运行时依赖：ssh=需要活跃 SSH 会话；db=需要本地数据库；null=无依赖 */
  requires: 'ssh' | 'db' | null
  /** 意图名（装配卡片展示，如"系统诊断"） */
  intent: string
  /** 意图关键词（任一命中即视为该意图，全部大小写不敏感） */
  intentPatterns: RegExp[]
  /** system prompt 提示片段（挂载该工具时拼入，指导模型真实调用） */
  promptHint: string
}

/**
 * 主对话工具目录（单一数据源）
 *
 * promptHint 文案沿用 supervisor 原硬编码 system prompt，保持模型行为不回退。
 */
export const CHAT_TOOL_CATALOG: ChatToolCatalogEntry[] = [
  {
    id: 'ssh_readonly',
    label: '只读诊断命令',
    requires: 'ssh',
    intent: '系统诊断/状态查询',
    intentPatterns: [
      /磁盘|内存|cpu|负载|进程|服务|日志|端口|网络|防火墙|状态|巡检|诊断|排查|检查|查看|执行|运行|挂载|分区|性能|慢|卡|异常|报错|失败|宕机|重启/i,
      /\b(df|du|free|top|ps|ss|netstat|systemctl|journalctl|uname|uptime|lsof|iostat|vmstat|hostnamectl)\b/i,
      /nginx|mysql|redis|docker|kafka|apache|php|java|python|node/i,
    ],
    promptHint:
      '你已连接到一台真实服务器，有 ssh_readonly 工具可执行【只读】诊断命令；' +
      '当用户询问系统状态（磁盘/内存/CPU/进程/服务/日志等）或要求执行只读命令时，' +
      '必须调用 ssh_readonly 获取真实输出后再回答，绝不凭空描述或编造结果。',
  },
  {
    id: 'ssh_write',
    label: '写操作命令',
    requires: 'ssh',
    intent: '修复/变更执行',
    intentPatterns: [
      /修改|重启|启动|停止|安装|卸载|配置|启用|禁用|创建|删除|更新|升级|修复|解决一下|帮我做|帮我改|帮我装|执行修复|reload|restart|install/i,
    ],
    promptHint:
      '你有 ssh_write 工具可执行【写操作】（改配置/重启服务/装包等），' +
      '每次调用都会弹审批卡片等用户确认；确需修改服务器状态时才调用，并在 reason 里说明原因。',
  },
  {
    id: 'ssh_journal_follow',
    label: '实时日志追踪',
    requires: 'ssh',
    intent: '日志实时追踪',
    intentPatterns: [
      /实时日志|跟踪日志|间歇|偶尔报错|实时监控日志|journalctls*-f|tails*-f|实时看日志|动态日志/i,
    ],
    promptHint:
      '你有 ssh_journal_follow 工具可限时实时追踪日志（自动停止），排查间歇性/实时报错时使用。',
  },
  {
    id: 'sftp_read',
    label: '读远程文件',
    requires: 'ssh',
    intent: '文件内容分析',
    intentPatterns: [
      /看看.*文件|分析.*日志|读取.*配置|配置文件内容|打开.*\.(conf|log|yaml|yml|json|ini|cfg)|\/etc\/|\/var\/log\//i,
    ],
    promptHint:
      '你有 sftp_read 工具可读取远程文件内容（日志/配置）用于分析，需要看文件内容时调用并给出分析。',
  },
  {
    id: 'kb_search',
    label: '检索知识库',
    requires: 'db',
    intent: '经验/案例检索',
    intentPatterns: [
      /以前|之前|经验|案例|类似|历史|处理过|遇到过|解决过|故障库|知识库|怎么解决|怎么处理|如何解决|如何处理/i,
    ],
    promptHint:
      '你有 kb_search 工具可检索本地运维知识库（历史故障案例/命令技能），' +
      '遇到"这类问题以前怎么处理/有无经验"时优先检索；',
  },
  {
    id: 'tutorial_search',
    label: '检索教程',
    requires: 'db',
    intent: '学习/配置指导',
    intentPatterns: [
      /教程|学习|学一下|入门|文档|指南|手册|怎么配置|如何配置|怎么安装|如何安装|怎么部署|如何部署|怎么用|如何使用|怎么设置|如何设置/i,
    ],
    promptHint:
      '你有 tutorial_search 工具可搜索官方 Linux 教程，' +
      '用户想学习/配置某功能时优先检索并给出教程来源。',
  },
  {
    id: 'memory_recall',
    label: '回忆长期记忆',
    requires: 'db',
    intent: '历史记忆回忆',
    intentPatterns: [
      /记得|还记得|上次|上回|之前说过|以前说过|我说过|我们聊过|我的服务器|我的环境|我的习惯|我的偏好/i,
    ],
    promptHint:
      '你有 memory_recall 工具可检索跨会话长期记忆（用户画像/环境事实/错误教训），' +
      '用户提及"上次/之前/记得吗"或需要历史上下文时优先调用；记忆仅作参考，当前指令与真实机器状态优先。',
  },
]

/** 路由可用性上下文 */
export interface ChatToolAvailability {
  /** 是否有活跃且已连接的 SSH 会话 */
  ssh: boolean
  /** 本地数据库是否可用 */
  db: boolean
}

/** 意图路由结果 */
export interface ChatToolRoute {
  /** 本轮挂载的工具 ID（按目录顺序） */
  mounted: ChatToolId[]
  /** 命中的意图名列表（空 = 未识别到明确意图） */
  intents: string[]
  /** 人类可读的路由理由（装配卡片展示） */
  reason: string
  /** 是否走了"无明确意图 → 全量挂载"兜底 */
  fallbackAll: boolean
  /** 挂载工具的 promptHint 拼接（供 system prompt 使用） */
  promptHints: string
  /** 因依赖缺失被跳过的工具（如 SSH 未连接时的 ssh_readonly） */
  unavailable: Array<{ id: ChatToolId; label: string; missing: string }>
}

/** 判断目录条目在当前上下文下是否可用 */
function isAvailable(entry: ChatToolCatalogEntry, ctx: ChatToolAvailability): boolean {
  if (entry.requires === 'ssh') return ctx.ssh
  if (entry.requires === 'db') return ctx.db
  return true
}

/**
 * 意图路由：根据最后一条用户消息选择本轮挂载的工具子集
 *
 * 规则：
 * 1. 先按运行时依赖过滤出可用工具（SSH 未连接 → ssh_readonly 不参与）
 * 2. 对可用工具做意图关键词匹配；命中 ≥1 个 → 只挂命中集合（省 token）
 * 3. 无任何命中 → 保守挂载全部可用工具（模型自行按需调用，避免漏挂答不了）
 */
export function routeChatTools(
  userText: string,
  ctx: ChatToolAvailability,
): ChatToolRoute {
  const text = (userText || '').slice(0, 2000)

  const available: ChatToolCatalogEntry[] = []
  const unavailable: ChatToolRoute['unavailable'] = []
  for (const entry of CHAT_TOOL_CATALOG) {
    if (isAvailable(entry, ctx)) {
      available.push(entry)
    } else {
      unavailable.push({
        id: entry.id,
        label: entry.label,
        missing: entry.requires === 'ssh' ? 'SSH 未连接' : '数据库不可用',
      })
    }
  }

  const matched = text
    ? available.filter((e) => e.intentPatterns.some((p) => p.test(text)))
    : []

  const selected = matched.length > 0 ? matched : available
  const fallbackAll = matched.length === 0

  const reason = fallbackAll
    ? `未识别到明确意图，挂载全部 ${selected.length} 个可用工具，由模型按需调用`
    : `识别到意图【${matched.map((e) => e.intent).join('、')}】，按需挂载 ${selected.length} 个工具`

  return {
    mounted: selected.map((e) => e.id),
    intents: matched.map((e) => e.intent),
    reason,
    fallbackAll,
    promptHints: selected.map((e) => e.promptHint).join(''),
    unavailable,
  }
}
